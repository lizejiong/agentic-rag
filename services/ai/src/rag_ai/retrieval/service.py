from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from rag_ai.models.base import EmbeddingModel, Reranker
from rag_ai.retrieval.fusion import FusionResult, reciprocal_rank_fusion
from rag_ai.retrieval.lexical_repository import LexicalRepository
from rag_ai.retrieval.models import (
    AclSnapshot,
    RankedChunk,
    RetrievalPathSummary,
    RetrievalSummary,
    RetrievalTrace,
    RetrievalTraceItem,
    RetrievedChunk,
    SpacePolicy,
)
from rag_ai.retrieval.vector_repository import VectorRepository

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RetrievalOptions:
    vector_top_k: int = 50
    lexical_top_k: int = 50
    rrf_k: int = 60
    rrf_top_k: int = 30
    rerank_top_k: int = 10


class RetrievalService:
    def __init__(
        self,
        *,
        vector_repo: VectorRepository,
        lexical_repo: LexicalRepository,
        embedding_model: EmbeddingModel,
        reranker: Reranker,
        options: RetrievalOptions,
    ) -> None:
        self._vector_repo = vector_repo
        self._lexical_repo = lexical_repo
        self._embedding_model = embedding_model
        self._reranker = reranker
        self._options = options

    async def retrieve(
        self,
        query: str,
        space_ids: list[UUID],
        acl: AclSnapshot,
        policies: list[SpacePolicy],
    ) -> tuple[list[RankedChunk], RetrievalSummary]:
        started = time.perf_counter()
        options = self._options

        # Determine which spaces allow embedding; disable vector path if none.
        embedding_space_ids = [
            policy.space_id
            for policy in policies
            if policy.embedding_enabled and acl.can_view_space(policy.space_id)
        ]

        vector_task = asyncio.create_task(
            self._run_vector(query, embedding_space_ids, acl, options.vector_top_k)
        )
        lexical_task = asyncio.create_task(
            self._run_lexical(query, space_ids, acl, options.lexical_top_k)
        )

        vector_results, vector_summary = await vector_task
        lexical_results, lexical_summary = await lexical_task

        fused = reciprocal_rank_fusion(
            vector_results,
            lexical_results,
            k=options.rrf_k,
            top_k=options.rrf_top_k,
        )

        reranker_enabled = any(policy.reranker_enabled for policy in policies)
        final_chunks: list[RankedChunk]
        rerank_note: str | None = None
        if reranker_enabled and fused:
            candidates_for_rerank = [
                (str(item.chunk.chunk_id), item.chunk.content) for item in fused
            ]
            try:
                reranked = await self._reranker.rerank(
                    query, candidates_for_rerank, top_k=options.rerank_top_k
                )
            except Exception:
                logger.warning("Reranker failed; returning RRF results", exc_info=True)
                final_chunks = self._rrf_chunks(fused, options.rerank_top_k)
                rerank_note = "Reranker 调用失败，已回退为 RRF 排名。"
            else:
                rerank_ids = {item.chunk_id for item in reranked}
                final_chunks = []
                for item in fused:
                    if str(item.chunk.chunk_id) in rerank_ids:
                        rank_item = next(
                            (r for r in reranked if r.chunk_id == str(item.chunk.chunk_id)), None
                        )
                        final_chunks.append(
                            RankedChunk(
                                chunk=item.chunk,
                                rrf_score=item.rrf_score,
                                rerank_score=rank_item.score if rank_item else None,
                            )
                        )
                # Preserve reranker ordering.
                order = {item.chunk_id: index for index, item in enumerate(reranked)}
                final_chunks.sort(key=lambda rc: order.get(str(rc.chunk.chunk_id), len(order)))
        else:
            final_chunks = self._rrf_chunks(fused, options.rerank_top_k)
            rerank_note = "当前知识空间未启用 Reranker，沿用 RRF 排名。"

        fusion_by_id = {item.chunk_id: item for item in fused}
        trace = RetrievalTrace(
            vector=[
                RetrievalTraceItem(chunk=chunk, rank=rank, score=chunk.score)
                for rank, chunk in enumerate(vector_results, start=1)
            ],
            lexical=[
                RetrievalTraceItem(chunk=chunk, rank=rank, score=chunk.score)
                for rank, chunk in enumerate(lexical_results, start=1)
            ],
            rrf=[
                RetrievalTraceItem(
                    chunk=item.chunk,
                    rank=rank,
                    score=item.rrf_score,
                    vector_rank=item.vector_rank,
                    lexical_rank=item.lexical_rank,
                    rrf_score=item.rrf_score,
                )
                for rank, item in enumerate(fused, start=1)
            ],
            rerank=[
                RetrievalTraceItem(
                    chunk=item.chunk,
                    rank=rank,
                    score=item.rerank_score if item.rerank_score is not None else item.rrf_score,
                    vector_rank=fusion_by_id[item.chunk.chunk_id].vector_rank
                    if item.chunk.chunk_id in fusion_by_id
                    else None,
                    lexical_rank=fusion_by_id[item.chunk.chunk_id].lexical_rank
                    if item.chunk.chunk_id in fusion_by_id
                    else None,
                    rrf_score=item.rrf_score,
                    rerank_score=item.rerank_score,
                )
                for rank, item in enumerate(final_chunks, start=1)
            ],
            rerank_note=rerank_note,
        )

        elapsed_ms = (time.perf_counter() - started) * 1000
        summary = RetrievalSummary(
            query=query,
            vector_top_k=options.vector_top_k,
            lexical_top_k=options.lexical_top_k,
            rrf_k=options.rrf_k,
            rrf_top_k=options.rrf_top_k,
            rerank_top_k=options.rerank_top_k,
            reranker_enabled=reranker_enabled,
            paths=[vector_summary, lexical_summary],
            rrf_candidate_count=len(fused),
            final_candidate_count=len(final_chunks),
            embedding_model=self._embedding_model.model_name,
            embedding_version=self._embedding_model.version,
            reranker_model=self._reranker.model_name if reranker_enabled else "",
            reranker_version=self._reranker.version if reranker_enabled else "",
            elapsed_ms=elapsed_ms,
            trace=trace,
        )
        return final_chunks, summary

    async def retrieve_with_trace(
        self,
        query: str,
        space_ids: list[UUID],
        acl: AclSnapshot,
        policies: list[SpacePolicy],
    ) -> tuple[list[RankedChunk], RetrievalSummary, RetrievalTrace]:
        """Return the exact trace produced by one production retrieval run."""
        final_chunks, summary = await self.retrieve(query, space_ids, acl, policies)
        if summary.trace is None:
            raise RuntimeError("Retrieval trace was not produced")
        return final_chunks, summary, summary.trace

    @staticmethod
    def _rrf_chunks(fused: list[FusionResult], top_k: int) -> list[RankedChunk]:
        return [
            RankedChunk(chunk=item.chunk, rrf_score=item.rrf_score)
            for item in fused[:top_k]
        ]

    async def _run_vector(
        self,
        query: str,
        space_ids: list[UUID],
        acl: AclSnapshot,
        top_k: int,
    ) -> tuple[list[RetrievedChunk], RetrievalPathSummary]:
        if not space_ids:
            return (
                [],
                RetrievalPathSummary(
                    path="vector",
                    space_id=space_ids[0] if space_ids else UUID(int=0),
                    candidates_returned=0,
                    candidates_after_acl=0,
                ),
            )
        try:
            embed_result = await self._embedding_model.embed([query])
            results = await self._vector_repo.search(
                embed_result.embeddings[0], space_ids, acl, top_k=top_k
            )
            return (
                results,
                RetrievalPathSummary(
                    path="vector",
                    space_id=space_ids[0],
                    candidates_returned=len(results),
                    candidates_after_acl=len(results),
                ),
            )
        except Exception as error:
            return (
                [],
                RetrievalPathSummary(
                    path="vector",
                    space_id=space_ids[0],
                    candidates_returned=0,
                    candidates_after_acl=0,
                    error=f"{type(error).__name__}: {error}",
                ),
            )

    async def _run_lexical(
        self,
        query: str,
        space_ids: list[UUID],
        acl: AclSnapshot,
        top_k: int,
    ) -> tuple[list[RetrievedChunk], RetrievalPathSummary]:
        if not space_ids:
            return (
                [],
                RetrievalPathSummary(
                    path="lexical",
                    space_id=space_ids[0] if space_ids else UUID(int=0),
                    candidates_returned=0,
                    candidates_after_acl=0,
                ),
            )
        try:
            results = await self._lexical_repo.search(query, space_ids, acl, top_k=top_k)
            return (
                results,
                RetrievalPathSummary(
                    path="lexical",
                    space_id=space_ids[0],
                    candidates_returned=len(results),
                    candidates_after_acl=len(results),
                ),
            )
        except Exception as error:
            return (
                [],
                RetrievalPathSummary(
                    path="lexical",
                    space_id=space_ids[0],
                    candidates_returned=0,
                    candidates_after_acl=0,
                    error=f"{type(error).__name__}: {error}",
                ),
            )


def build_retrieval_options(settings: Any) -> RetrievalOptions:
    return RetrievalOptions(
        vector_top_k=settings.retrieval_vector_top_k,
        lexical_top_k=settings.retrieval_lexical_top_k,
        rrf_k=settings.retrieval_rrf_k,
        rrf_top_k=settings.retrieval_rrf_top_k,
        rerank_top_k=settings.retrieval_rerank_top_k,
    )

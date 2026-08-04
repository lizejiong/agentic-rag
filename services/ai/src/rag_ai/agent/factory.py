from __future__ import annotations

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import create_async_engine

from rag_ai.agent.runner import Agent
from rag_ai.memory.session_memory import RedisSessionMemoryStore
from rag_ai.models.base import ChatModel, EmbeddingModel, Reranker
from rag_ai.models.factory import create_chat_model, create_embedding_model, create_reranker
from rag_ai.retrieval.evidence_selector import EvidenceSelector
from rag_ai.retrieval.lexical_repository import LexicalRepository
from rag_ai.retrieval.service import RetrievalOptions, RetrievalService
from rag_ai.retrieval.vector_repository import VectorRepository
from rag_ai.settings import WorkerSettings


def build_retrieval_service(
    settings: WorkerSettings,
    *,
    embedding_model: EmbeddingModel | None = None,
    reranker: Reranker | None = None,
) -> RetrievalService:
    engine = create_async_engine(settings.async_sqlalchemy_url, pool_pre_ping=True)
    embedding = embedding_model or create_embedding_model(
        provider=settings.embedding_provider,
        dimensions=settings.embedding_dimensions,
        version=settings.embedding_version,
        api_key=settings.embedding_api_key or settings.openai_api_key,
        base_url=settings.embedding_base_url or settings.openai_base_url,
    )
    rerank = reranker or create_reranker(
        provider=settings.reranker_provider,
        dimensions=settings.embedding_dimensions,
        version=settings.reranker_version,
        api_key=settings.reranker_api_key,
        base_url=settings.reranker_base_url,
        timeout_seconds=settings.reranker_timeout_seconds,
        instruct=settings.reranker_instruct,
    )
    from elasticsearch import AsyncElasticsearch

    lexical_repo = LexicalRepository(
        AsyncElasticsearch(settings.elasticsearch_url),
        settings.elasticsearch_index,
    )
    vector_repo = VectorRepository(
        engine,
        embedding.model_name,
        embedding.version,
    )
    return RetrievalService(
        vector_repo=vector_repo,
        lexical_repo=lexical_repo,
        embedding_model=embedding,
        reranker=rerank,
        options=RetrievalOptions(
            vector_top_k=settings.retrieval_vector_top_k,
            lexical_top_k=settings.retrieval_lexical_top_k,
            rrf_k=settings.retrieval_rrf_k,
            rrf_top_k=settings.retrieval_rrf_top_k,
            rerank_top_k=settings.retrieval_rerank_top_k,
        ),
    )


def build_memory_store(settings: WorkerSettings) -> RedisSessionMemoryStore:
    return RedisSessionMemoryStore(
        Redis.from_url(str(settings.redis_url)),
        window_turns=settings.memory_window_turns,
        ttl_seconds=settings.memory_ttl_seconds,
    )


def build_evidence_selector(settings: WorkerSettings) -> EvidenceSelector:
    return EvidenceSelector(
        model_name=settings.evidence_model_name,
        fallback_encoding=settings.evidence_fallback_encoding,
        rerank_min_score=settings.evidence_rerank_min_score,
        rrf_min_score=settings.evidence_rrf_min_score,
        rerank_max_relative_drop=settings.evidence_rerank_max_relative_drop,
        rerank_absolute_drop=settings.evidence_rerank_absolute_drop,
        rrf_max_relative_drop=settings.evidence_rrf_max_relative_drop,
        rrf_absolute_drop=settings.evidence_rrf_absolute_drop,
        cliff_min_chunks=settings.evidence_cliff_min_chunks,
        max_evidence_tokens=settings.evidence_max_evidence_tokens,
        max_chunk_tokens=settings.evidence_max_chunk_tokens,
        max_evidence_chunks=settings.evidence_max_evidence_chunks,
        output_reservation=settings.evidence_output_reservation,
        max_chunks_per_doc=settings.evidence_max_chunks_per_doc,
        jaccard_similarity_threshold=settings.evidence_jaccard_similarity_threshold,
    )


def build_agent(
    settings: WorkerSettings,
    *,
    retrieval: RetrievalService | None = None,
    chat: ChatModel | None = None,
) -> Agent:
    return Agent(
        retrieval=retrieval or build_retrieval_service(settings),
        chat=chat or create_chat_model(
            provider=settings.llm_provider,
            version=settings.llm_version,
            api_key=settings.llm_api_key or settings.openai_api_key,
            base_url=settings.llm_base_url or settings.openai_base_url,
        ),
        evidence_selector=build_evidence_selector(settings),
    )

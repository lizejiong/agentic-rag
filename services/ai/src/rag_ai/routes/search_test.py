"""Search test playground — standalone retrieval debug endpoint."""

from __future__ import annotations

import json
import logging
import time
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from rag_ai.agent.factory import build_agent, build_retrieval_service
from rag_ai.retrieval.models import RetrievalTraceItem
from rag_ai.routes.runs import _build_acl, _get_agent, _load_space_policies
from rag_ai.settings import get_worker_settings
from rag_ai.models.base import ChatMessage

router = APIRouter(prefix="/v1/retrieval", tags=["search-test"])
logger = logging.getLogger(__name__)

_retrieval_service = None


def _get_retrieval_service():
    global _retrieval_service
    if _retrieval_service is None:
        _retrieval_service = build_retrieval_service(get_worker_settings())
    return _retrieval_service


class SearchTestRequest(BaseModel):
    query: str
    selectedSpaceIds: list[UUID]
    aclSnapshot: dict
    maxResults: int = 10


class SearchTestChunk(BaseModel):
    chunkId: str
    documentId: str
    documentTitle: str
    content: str
    score: float
    path: str  # "vector" | "lexical" | "reranked"
    location: dict | None = None


class SearchTestTraceItem(SearchTestChunk):
    rank: int
    vectorRank: int | None = None
    lexicalRank: int | None = None
    rrfScore: float | None = None
    rerankScore: float | None = None


class SearchTestResponse(BaseModel):
    query: str
    totalResults: int
    results: list[SearchTestChunk]
    trace: dict[str, list[SearchTestTraceItem]] | None = None
    rerankNote: str | None = None


class ExpectedEvidence(BaseModel):
    document: str
    anchor: str
    quote: str


class EvaluationCase(BaseModel):
    id: str
    question: str
    expectedEvidence: list[ExpectedEvidence]
    referenceAnswer: str
    expectedAnswerPoints: list[str]
    expectNoAnswer: bool = False


class EvaluationRequest(BaseModel):
    selectedSpaceIds: list[UUID]
    aclSnapshot: dict
    cases: list[EvaluationCase]
    mode: Literal["retrieval", "full"] = "full"


class EvaluationStageMetrics(BaseModel):
    hitAt1: bool
    hitAt5: bool
    hitAt10: bool
    firstExpectedRank: int | None = None
    mrr: float


class EvaluationCaseResult(BaseModel):
    id: str
    question: str
    effectiveQuery: str
    expectNoAnswer: bool = False
    stages: dict[str, EvaluationStageMetrics]
    trace: dict[str, list[SearchTestTraceItem]]
    error: str | None = None
    rerankNote: str | None = None
    answer: str | None = None
    citations: list[SearchTestTraceItem] = []
    answerPointCoverage: float | None = None
    citationEvidencePrecision: float | None = None
    refusalCorrect: bool | None = None
    elapsedMs: float


class EvaluationResponse(BaseModel):
    mode: Literal["retrieval", "full"]
    results: list[EvaluationCaseResult]
    summary: dict
    elapsedMs: float


@router.post("/test", response_model=SearchTestResponse)
async def search_test(request: SearchTestRequest) -> SearchTestResponse:
    if not request.selectedSpaceIds:
        raise HTTPException(status_code=400, detail="At least one space required")

    acl = _build_acl(request.aclSnapshot)
    policies = await _load_space_policies(request.selectedSpaceIds, acl)

    service = _get_retrieval_service()
    try:
        chunks, summary = await service.retrieve(
            query=request.query,
            space_ids=request.selectedSpaceIds,
            acl=acl,
            policies=policies,
        )
        trace = summary.trace
        if trace is None:
            raise HTTPException(status_code=500, detail="Retrieval trace missing")
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Retrieval failed") from exc

    results: list[SearchTestChunk] = []
    for ranked_chunk in chunks[: request.maxResults]:
        chunk = ranked_chunk.chunk
        location = None
        if chunk.location:
            location = {
                "page": chunk.location.page,
                "slide": chunk.location.slide,
                "sheet": chunk.location.sheet,
            }
        results.append(
            SearchTestChunk(
                chunkId=str(chunk.chunk_id),
                documentId=str(chunk.document_id),
                documentTitle=chunk.title,
                content=chunk.content[:500],
                score=round(chunk.score, 4),
                path=chunk.path,
                location=location,
            )
        )

    def serialize_trace_item(item: RetrievalTraceItem) -> SearchTestTraceItem:
        chunk = item.chunk
        location = None
        if chunk.location:
            location = {
                "page": chunk.location.page,
                "slide": chunk.location.slide,
                "sheet": chunk.location.sheet,
            }
        return SearchTestTraceItem(
            chunkId=str(chunk.chunk_id),
            documentId=str(chunk.document_id),
            documentTitle=chunk.title,
            content=chunk.content[:500],
            score=round(item.score if item.score is not None else chunk.score, 4),
            path=chunk.path,
            location=location,
            rank=item.rank,
            vectorRank=item.vector_rank,
            lexicalRank=item.lexical_rank,
            rrfScore=round(item.rrf_score, 6) if item.rrf_score is not None else None,
            rerankScore=round(item.rerank_score, 6) if item.rerank_score is not None else None,
        )

    return SearchTestResponse(
        query=request.query,
        totalResults=len(results),
        results=results,
        trace={
            "vector": [serialize_trace_item(item) for item in trace.vector],
            "lexical": [serialize_trace_item(item) for item in trace.lexical],
            "rrf": [serialize_trace_item(item) for item in trace.rrf],
            "rerank": [serialize_trace_item(item) for item in trace.rerank],
        },
        rerankNote=trace.rerank_note,
    )


def _trace_item(item: RetrievalTraceItem) -> SearchTestTraceItem:
    chunk = item.chunk
    location = {
        key: value
        for key, value in {
            "page": chunk.location.page,
            "slide": chunk.location.slide,
            "sheet": chunk.location.sheet,
        }.items()
        if value is not None
    } or None
    return SearchTestTraceItem(
        chunkId=str(chunk.chunk_id),
        documentId=str(chunk.document_id),
        documentTitle=chunk.title,
        content=chunk.content[:500],
        score=round(item.score if item.score is not None else chunk.score, 4),
        path=chunk.path,
        location=location,
        rank=item.rank,
        vectorRank=item.vector_rank,
        lexicalRank=item.lexical_rank,
        rrfScore=round(item.rrf_score, 6) if item.rrf_score is not None else None,
        rerankScore=round(item.rerank_score, 6) if item.rerank_score is not None else None,
    )


def _matches_evidence(item: RetrievalTraceItem, expected: list[ExpectedEvidence]) -> bool:
    document_title = item.chunk.title.casefold()
    content = item.chunk.content.casefold()
    return any(
        evidence.document.casefold() in document_title and evidence.quote.casefold() in content
        for evidence in expected
    )


def _stage_metrics(items: list[RetrievalTraceItem], expected: list[ExpectedEvidence]) -> EvaluationStageMetrics:
    first = next((item.rank for item in items if _matches_evidence(item, expected)), None)
    return EvaluationStageMetrics(
        hitAt1=first is not None and first <= 1,
        hitAt5=first is not None and first <= 5,
        hitAt10=first is not None and first <= 10,
        firstExpectedRank=first,
        mrr=round(1 / first, 4) if first is not None else 0.0,
    )


def _empty_stage_metrics() -> EvaluationStageMetrics:
    return EvaluationStageMetrics(hitAt1=False, hitAt5=False, hitAt10=False, mrr=0.0)


def _failed_case_result(
    case: EvaluationCase, error: Exception, elapsed_ms: float
) -> EvaluationCaseResult:
    return EvaluationCaseResult(
        id=case.id,
        question=case.question,
        effectiveQuery=case.question,
        expectNoAnswer=case.expectNoAnswer,
        stages={stage: _empty_stage_metrics() for stage in ("vector", "lexical", "rrf", "rerank")},
        trace={stage: [] for stage in ("vector", "lexical", "rrf", "rerank")},
        error=f"{type(error).__name__}: {error}",
        elapsedMs=round(elapsed_ms, 2),
    )


async def _judge_answer(case: EvaluationCase, answer: str) -> float:
    settings = get_worker_settings()
    agent = build_agent(settings)
    prompt = (
        "你是严格的中文 RAG 评测裁判。只输出 0 到 1 的小数。\n"
        f"问题：{case.question}\n参考答案：{case.referenceAnswer}\n"
        f"必须覆盖的要点：{json.dumps(case.expectedAnswerPoints, ensure_ascii=False)}\n"
        f"实际回答：{answer}\n评分："
    )
    parts: list[str] = []
    async for token in agent._chat.astream([ChatMessage(role="user", content=prompt)]):
        parts.append(token)
    try:
        return max(0.0, min(1.0, float("".join(parts).strip())))
    except ValueError:
        return 0.0


async def _evaluate_case(
    request: EvaluationRequest,
    case: EvaluationCase,
    acl,
    policies,
    service,
    agent,
) -> EvaluationCaseResult:
    if request.mode == "full":
        agent_result = await agent.run_evaluation(
            request_id=uuid4(), trace_id=f"evaluation-{case.id}", actor_id=str(acl.user_id),
            query=case.question, selected_space_ids=request.selectedSpaceIds, acl=acl, policies=policies,
        )
        trace = agent_result.trace
        answer = agent_result.answer
        citations = [
            SearchTestTraceItem(
                chunkId=str(citation.chunkId), documentId=str(citation.documentId),
                documentTitle=citation.title, content=citation.snippet, score=0.0, path="rerank",
                location=citation.location.model_dump(exclude_none=True) or None, rank=index,
            )
            for index, citation in enumerate(agent_result.citations, start=1)
        ]
        effective_query = agent_result.effective_query
    else:
        _chunks, summary = await service.retrieve(case.question, request.selectedSpaceIds, acl, policies)
        trace = summary.trace
        answer = None
        citations = []
        effective_query = case.question

    if trace is None:
        raise RuntimeError("Evaluation trace missing")
    stages = {
        "vector": _stage_metrics(trace.vector, case.expectedEvidence),
        "lexical": _stage_metrics(trace.lexical, case.expectedEvidence),
        "rrf": _stage_metrics(trace.rrf, case.expectedEvidence),
        "rerank": _stage_metrics(trace.rerank or trace.rrf, case.expectedEvidence),
    }
    coverage = None
    citation_precision = None
    refusal_correct = None
    if request.mode == "full":
        assert answer is not None
        coverage = await _judge_answer(case, answer)
        if citations:
            citation_precision = round(
                sum(
                    1
                    for citation in citations
                    if any(evidence.quote.lower() in citation.content.lower() for evidence in case.expectedEvidence)
                )
                / len(citations),
                4,
            )
        elif not case.expectNoAnswer:
            citation_precision = 0.0
        if case.expectNoAnswer:
            refusal_correct = "无法回答" in answer or "没有" in answer

    return EvaluationCaseResult(
        id=case.id, question=case.question, effectiveQuery=effective_query,
        expectNoAnswer=case.expectNoAnswer, stages=stages,
        trace={
            "vector": [_trace_item(item) for item in trace.vector],
            "lexical": [_trace_item(item) for item in trace.lexical],
            "rrf": [_trace_item(item) for item in trace.rrf],
            "rerank": [_trace_item(item) for item in trace.rerank],
        },
        rerankNote=trace.rerank_note, answer=answer, citations=citations,
        answerPointCoverage=coverage, citationEvidencePrecision=citation_precision,
        refusalCorrect=refusal_correct, elapsedMs=0.0,
    )


@router.post("/evaluate", response_model=EvaluationResponse)
async def evaluate_retrieval(request: EvaluationRequest) -> EvaluationResponse:
    if len(request.selectedSpaceIds) != 1:
        raise HTTPException(status_code=400, detail="Evaluation requires exactly one space")
    if not request.cases or len(request.cases) > 25:
        raise HTTPException(status_code=400, detail="Evaluation requires 1 to 25 cases")

    started = time.perf_counter()
    acl = _build_acl(request.aclSnapshot)
    policies = await _load_space_policies(request.selectedSpaceIds, acl)
    service = _get_retrieval_service()
    agent = _get_agent()
    results: list[EvaluationCaseResult] = []
    for case in request.cases:
        case_started = time.perf_counter()
        try:
            result = await _evaluate_case(request, case, acl, policies, service, agent)
            result.elapsedMs = round((time.perf_counter() - case_started) * 1000, 2)
        except Exception as error:
            logger.exception("Evaluation case failed: %s", case.id)
            result = _failed_case_result(case, error, (time.perf_counter() - case_started) * 1000)
        results.append(result)

    def average(values: list[float]) -> float:
        return round(sum(values) / len(values), 4) if values else 0.0

    completed = [result for result in results if result.error is None]
    answerable = [result for result in completed if not result.expectNoAnswer]
    summary = {
        "caseCount": len(results),
        "completedCaseCount": len(completed),
        "failedCaseCount": len(results) - len(completed),
        "retrievalCaseCount": len(answerable),
        "stages": {
            stage: {
                "hitAt1": average([float(result.stages[stage].hitAt1) for result in answerable]),
                "hitAt5": average([float(result.stages[stage].hitAt5) for result in answerable]),
                "hitAt10": average([float(result.stages[stage].hitAt10) for result in answerable]),
                "mrr": average([result.stages[stage].mrr for result in answerable]),
            }
            for stage in ("vector", "lexical", "rrf", "rerank")
        },
        "answerPointCoverage": average([item.answerPointCoverage for item in completed if item.answerPointCoverage is not None]),
        "citationEvidencePrecision": average([item.citationEvidencePrecision for item in completed if item.citationEvidencePrecision is not None]),
        "refusalCorrect": average([float(item.refusalCorrect) for item in completed if item.refusalCorrect is not None]),
        "averageElapsedMs": average([item.elapsedMs for item in results]),
    }
    return EvaluationResponse(mode=request.mode, results=results, summary=summary, elapsedMs=round((time.perf_counter() - started) * 1000, 2))

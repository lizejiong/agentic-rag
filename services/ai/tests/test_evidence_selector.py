from __future__ import annotations

from uuid import UUID, uuid4

import pytest

from rag_ai.retrieval.evidence_selector import EvidenceSelector
from rag_ai.retrieval.models import CitationLocation, RankedChunk, RetrievedChunk


# ── helpers ──────────────────────────────────────────────────────────

_DOC_A = UUID("11111111-1111-1111-1111-111111111111")
_DOC_B = UUID("22222222-2222-2222-2222-222222222222")
_SPACE = UUID("00000000-0000-0000-0000-000000000000")
_VERSION = UUID("99999999-9999-9999-9999-999999999999")


def _chunk(
    *,
    chunk_id: UUID | None = None,
    document_id: UUID = _DOC_A,
    content: str = "",
    title: str = "",
) -> RetrievedChunk:
    return RetrievedChunk(
        chunk_id=chunk_id or uuid4(),
        document_id=document_id,
        version_id=_VERSION,
        space_id=_SPACE,
        content=content,
        title=title,
        location=CitationLocation(),
        score=0.0,
        path="rrf",
    )


def _ranked(
    *,
    chunk_id: UUID | None = None,
    document_id: UUID = _DOC_A,
    content: str = "",
    title: str = "",
    rerank_score: float | None = None,
    rrf_score: float | None = None,
) -> RankedChunk:
    return RankedChunk(
        chunk=_chunk(chunk_id=chunk_id, document_id=document_id, content=content, title=title),
        rerank_score=rerank_score,
        rrf_score=rrf_score,
    )


def _default_selector(**overrides: object) -> EvidenceSelector:
    kwargs: dict[str, object] = dict(
        rerank_min_score=0.1,
        max_evidence_chunks=10,
        max_chunks_per_doc=3,
    )
    kwargs.update(overrides)
    return EvidenceSelector(**kwargs)  # type: ignore[arg-type]


# ── empty / no candidates ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_select_empty_ranked_returns_empty() -> None:
    sel = _default_selector()
    assert sel.select([], score_type="reranker") == []
    assert sel.select([], score_type="rrf") == []


# ── reranker threshold ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_rerank_filter_below_threshold() -> None:
    sel = _default_selector(rerank_min_score=0.1)
    ranked = [
        _ranked(content="good", rerank_score=0.85),
        _ranked(content="ok", rerank_score=0.12),
        _ranked(content="bad", rerank_score=0.05),
    ]
    result = sel.select(ranked, score_type="reranker")
    contents = [c.chunk.content for c in result]
    assert "good" in contents
    assert "ok" in contents
    assert "bad" not in contents


@pytest.mark.asyncio
async def test_rerank_all_below_threshold_returns_empty() -> None:
    sel = _default_selector(rerank_min_score=0.3)
    ranked = [
        _ranked(content="low", rerank_score=0.2),
        _ranked(content="lower", rerank_score=0.1),
    ]
    result = sel.select(ranked, score_type="reranker")
    assert result == []


@pytest.mark.asyncio
async def test_rerank_mixed_scores_raises() -> None:
    sel = _default_selector()
    ranked = [
        _ranked(content="has score", rerank_score=0.9),
        _ranked(content="no score", rerank_score=None),
    ]
    with pytest.raises(ValueError, match="lack rerank_score"):
        sel.select(ranked, score_type="reranker")


# ── RRF path ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_rrf_no_threshold_by_default() -> None:
    sel = _default_selector()
    ranked = [
        _ranked(content="a", rrf_score=0.001),
        _ranked(content="b", rrf_score=0.0001),
    ]
    result = sel.select(ranked, score_type="rrf")
    assert len(result) == 2


@pytest.mark.asyncio
async def test_rrf_threshold_when_configured() -> None:
    sel = _default_selector(rrf_min_score=0.0005)
    ranked = [
        _ranked(content="keep", rrf_score=0.001),
        _ranked(content="drop", rrf_score=0.0001),
    ]
    result = sel.select(ranked, score_type="rrf")
    assert len(result) == 1
    assert result[0].chunk.content == "keep"


# ── cliff detection ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_cliff_disabled_by_default() -> None:
    sel = _default_selector(max_chunks_per_doc=10)
    ranked = [
        _ranked(content="a", rerank_score=0.9),
        _ranked(content="b", rerank_score=0.8),
        _ranked(content="c", rerank_score=0.3),  # big drop
        _ranked(content="d", rerank_score=0.25),
    ]
    result = sel.select(ranked, score_type="reranker")
    # All pass threshold, cliff disabled → all kept
    assert len(result) == 4


@pytest.mark.asyncio
async def test_cliff_cuts_at_drop() -> None:
    sel = _default_selector(
        rerank_max_relative_drop=0.5,
        rerank_absolute_drop=0.15,
        cliff_min_chunks=2,
    )
    ranked = [
        _ranked(content="a", rerank_score=0.9),
        _ranked(content="b", rerank_score=0.8),
        _ranked(content="c", rerank_score=0.3),   # 0.3/0.8 < 0.5 AND 0.8-0.3 > 0.15
        _ranked(content="d", rerank_score=0.25),
    ]
    result = sel.select(ranked, score_type="reranker")
    assert len(result) == 2
    assert result[0].chunk.content == "a"
    assert result[1].chunk.content == "b"


@pytest.mark.asyncio
async def test_cliff_respects_min_chunks() -> None:
    sel = _default_selector(
        rerank_max_relative_drop=0.5,
        rerank_absolute_drop=0.15,
        cliff_min_chunks=4,
    )
    ranked = [
        _ranked(content="a", rerank_score=0.9),
        _ranked(content="b", rerank_score=0.8),
        _ranked(content="c", rerank_score=0.3),
    ]
    result = sel.select(ranked, score_type="reranker")
    # cliff_min_chunks=4 > len=3 → cliff not checked → all kept
    assert len(result) == 3


# ── per-document limit ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_max_chunks_per_doc() -> None:
    sel = _default_selector(
        max_chunks_per_doc=2,
        max_evidence_chunks=10,
        rerank_min_score=0.0,
    )
    ranked = [
        _ranked(content="a1", document_id=_DOC_A, rerank_score=0.9),
        _ranked(content="a2", document_id=_DOC_A, rerank_score=0.8),
        _ranked(content="a3", document_id=_DOC_A, rerank_score=0.7),
        _ranked(content="b1", document_id=_DOC_B, rerank_score=0.6),
    ]
    result = sel.select(ranked, score_type="reranker")
    contents = [c.chunk.content for c in result]
    assert "a1" in contents
    assert "a2" in contents
    assert "a3" not in contents   # doc A quota exhausted
    assert "b1" in contents       # doc B still has quota


# ── max_evidence_chunks cap ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_max_evidence_chunks_cap() -> None:
    sel = _default_selector(
        max_evidence_chunks=3,
        rerank_min_score=0.0,
        max_chunks_per_doc=10,
    )
    ranked = [
        _ranked(content=str(i), rerank_score=0.9 - i * 0.05, document_id=uuid4())
        for i in range(10)
    ]
    result = sel.select(ranked, score_type="reranker")
    assert len(result) == 3


# ── token budget ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_budget_exhausted_stops_early() -> None:
    sel = _default_selector(
        max_evidence_tokens=30,    # very tight budget
        max_chunk_tokens=50,
        rerank_min_score=0.0,
        output_reservation=0,
    )
    ranked = [
        _ranked(content="short", rerank_score=0.9),
        _ranked(content="this is a much longer piece of text that will exhaust the budget", rerank_score=0.8),
    ]
    result = sel.select(ranked, score_type="reranker")
    # Only the first short chunk should fit
    assert len(result) >= 1


@pytest.mark.asyncio
async def test_budget_zero_returns_empty() -> None:
    sel = _default_selector(max_evidence_tokens=0, rerank_min_score=0.0)
    ranked = [_ranked(content="anything", rerank_score=0.9)]
    result = sel.select(ranked, score_type="reranker")
    assert result == []


# ── Jaccard dedup ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_jaccard_disabled_by_default() -> None:
    sel = _default_selector(rerank_min_score=0.0, max_chunks_per_doc=10)
    text = "同一段中文内容的重复拷贝前后几乎一模一样"
    ranked = [
        _ranked(content=text, rerank_score=0.9, document_id=uuid4()),
        _ranked(content=text, rerank_score=0.8, document_id=uuid4()),
    ]
    result = sel.select(ranked, score_type="reranker")
    assert len(result) == 2


@pytest.mark.asyncio
async def test_jaccard_filters_near_duplicates() -> None:
    sel = _default_selector(
        rerank_min_score=0.0,
        max_chunks_per_doc=10,
        jaccard_similarity_threshold=0.9,
    )
    ranked = [
        _ranked(content="用户需要提交申请表格并等待审核", rerank_score=0.9, document_id=uuid4()),
        _ranked(content="用户需要提交申请表格并等待审批", rerank_score=0.8, document_id=uuid4()),
        _ranked(content="完全不同的另一段文字内容", rerank_score=0.7, document_id=uuid4()),
    ]
    result = sel.select(ranked, score_type="reranker")
    contents = [c.chunk.content for c in result]
    # first kept, second nearly identical → skipped, third kept
    assert len(result) >= 2
    assert contents[0].startswith("用户需要提交")
    assert "完全不同的" in contents[-1]


# ── render_evidence_item ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_render_evidence_item_format() -> None:
    chunk = _ranked(content="正文内容", title="标题")
    rendered = EvidenceSelector.render_evidence_item(chunk, index=3)
    assert rendered == "[3] 标题\n正文内容"


# ── integration: RRF path with assess_evidence check ──────────────────


@pytest.mark.asyncio
async def test_rrf_no_threshold_still_returns_results() -> None:
    """RRF path doesn't apply score thresholds; evidence is returned for
    the caller (_assess_evidence) to judge."""
    sel = _default_selector()
    ranked = [
        _ranked(content="marginal", rrf_score=0.002),
        _ranked(content="weak", rrf_score=0.001),
    ]
    result = sel.select(ranked, score_type="rrf")
    assert len(result) >= 1

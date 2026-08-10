from uuid import uuid4

from rag_ai.agent.context_builder import ContextBuilder, GraphEvidenceCandidate
from rag_ai.retrieval.models import CitationLocation, RankedChunk, RetrievedChunk


def _chunk(*, chunk_id=None, content: str = "evidence") -> RankedChunk:
    return RankedChunk(
        RetrievedChunk(
            chunk_id=chunk_id or uuid4(), document_id=uuid4(), version_id=uuid4(), space_id=uuid4(),
            content=content, title="source", location=CitationLocation(), score=0.2, path="rerank",
        ),
        rrf_score=0.02, rerank_score=0.2,
    )


def test_graph_evidence_preserves_relation_and_deduplicates_raw_chunk() -> None:
    source = _chunk(content="The approval owner is procurement.")
    graph = GraphEvidenceCandidate(uuid4(), "采购", "负责", "审批", 0.8, source)

    context = ContextBuilder().build([source], [graph])

    assert len(context) == 1
    assert context[0].kind == "graph"
    assert "采购 负责 审批" in context[0].text


def test_graph_evidence_is_not_scored_as_document_relevance() -> None:
    graph = GraphEvidenceCandidate(uuid4(), "A", "依赖", "B", 0.8, _chunk())

    assert graph.evidence.rerank_score != 1.0
    assert ContextBuilder.has_valid_graph_evidence([graph]) is True

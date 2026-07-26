from argparse import Namespace
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pytest

from rag_ai.evaluation.metrics import citation_precision, ndcg_at_k, recall_at_k


def load_report_builder():
    script_path = Path(__file__).parents[1] / "scripts" / "evaluate_retrieval.py"
    spec = spec_from_file_location("evaluate_retrieval", script_path)
    assert spec and spec.loader
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.build_report


def test_retrieval_metrics_reward_relevant_ranked_results() -> None:
    relevant = {"chunk-a", "chunk-b"}
    retrieved = ["chunk-a", "noise", "chunk-b"]

    assert recall_at_k(retrieved, relevant, 10) == 1.0
    assert ndcg_at_k(retrieved, relevant, 10) == pytest.approx(0.9197, abs=0.0001)


def test_citation_precision_rejects_unsupported_citations() -> None:
    assert citation_precision(["chunk-a", "unknown"], {"chunk-a"}) == 0.5


def test_document_level_retrieval_can_skip_citation_gate_for_scifact() -> None:
    report = load_report_builder()(
        [
            {
                "retrievedDocumentIds": ["document-a"],
                "relevantDocumentIds": ["document-a"],
            }
        ],
        Namespace(
            min_recall=0.85,
            min_ndcg=0.75,
            min_citation=0.95,
            allow_missing_citations=True,
        ),
    )

    assert report["passed"] is True
    assert report["citationRequired"] is False

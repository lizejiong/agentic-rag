import json
from pathlib import Path

from rag_ai.evaluation.beir import load_scifact_cases, write_jsonl


def test_load_scifact_cases_reads_positive_test_qrels(tmp_path: Path) -> None:
    (tmp_path / "qrels").mkdir()
    (tmp_path / "queries.jsonl").write_text(
        '{"_id":"q2","text":"Second claim"}\n{"_id":"q1","text":"First claim"}\n',
        encoding="utf-8",
    )
    (tmp_path / "qrels" / "test.tsv").write_text(
        "query-id\tcorpus-id\tscore\nq1\tdoc-b\t1\nq1\tdoc-a\t1\nq2\tdoc-c\t0\n",
        encoding="utf-8",
    )

    cases = load_scifact_cases(tmp_path)

    assert cases == [
        {
            "id": "scifact:q1",
            "query": "First claim",
            "relevantDocumentIds": ["doc-a", "doc-b"],
            "sourceDataset": "BEIR SciFact",
            "license": "CC-BY-SA-4.0",
        }
    ]


def test_write_jsonl_creates_parent_directory(tmp_path: Path) -> None:
    output = tmp_path / "nested" / "cases.jsonl"

    write_jsonl([{"id": "scifact:q1"}], output)

    assert json.loads(output.read_text(encoding="utf-8")) == {"id": "scifact:q1"}

from datetime import UTC, datetime
from uuid import UUID

import pytest

from rag_ai.contracts.agent_events import TextDelta
from rag_ai.streaming.ndjson import MAX_NDJSON_BYTES, encode_ndjson


def test_encode_ndjson_rejects_events_larger_than_64_kib() -> None:
    event = TextDelta(
        requestId=UUID("00000000-0000-4000-8000-000000000001"),
        traceId="trace-test",
        seq=0,
        occurredAt=datetime(2026, 7, 18, tzinfo=UTC),
        type="text.delta",
        text="x" * (64 * 1024),
    )

    with pytest.raises(ValueError, match="64 KiB"):
        encode_ndjson(event)


def test_encode_ndjson_rejects_record_exactly_64_kib() -> None:
    seed = TextDelta(
        requestId=UUID("00000000-0000-4000-8000-000000000001"),
        traceId="trace-test",
        seq=0,
        occurredAt=datetime(2026, 7, 18, tzinfo=UTC),
        type="text.delta",
        text="x",
    )
    one_byte_text_size = len((seed.model_dump_json() + "\n").encode("utf-8"))
    record_overhead = one_byte_text_size - 1
    event = seed.model_copy(update={"text": "x" * (MAX_NDJSON_BYTES - record_overhead)})
    encoded = (event.model_dump_json() + "\n").encode("utf-8")

    assert len(encoded) == MAX_NDJSON_BYTES
    with pytest.raises(ValueError, match="64 KiB"):
        encode_ndjson(event)

from datetime import UTC, datetime
from uuid import UUID

import pytest

from rag_ai.contracts.agent_events import TextDelta
from rag_ai.streaming.ndjson import encode_ndjson


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

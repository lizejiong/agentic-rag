from rag_ai.contracts.agent_events import AgentEvent

MAX_NDJSON_BYTES = 64 * 1024


def encode_ndjson(event: AgentEvent, max_bytes: int = MAX_NDJSON_BYTES) -> bytes:
    encoded = (event.model_dump_json(exclude_none=True) + "\n").encode("utf-8")
    if len(encoded) >= max_bytes:
        raise ValueError("NDJSON event exceeds 64 KiB limit")
    return encoded

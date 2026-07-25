from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from redis.asyncio import Redis

from rag_ai.memory.session_memory import RedisSessionMemoryStore, SessionMemory
from rag_ai.models.base import ChatMessage


@pytest.fixture
def user_id() -> UUID:
    return uuid4()


@pytest.fixture
def session_id() -> str:
    return "test-session-1"


@pytest.mark.asyncio
async def test_load_returns_empty_for_new_session(
    user_id: UUID, session_id: str, redis_client: Redis
) -> None:
    store = RedisSessionMemoryStore(redis_client, window_turns=10)
    memory = await store.load(user_id, session_id)
    assert memory.messages == []
    assert memory.summary == ""


@pytest.mark.asyncio
async def test_append_and_load_roundtrip(
    user_id: UUID, session_id: str, redis_client: Redis
) -> None:
    store = RedisSessionMemoryStore(redis_client, window_turns=10)
    updated = await store.append_turn(
        user_id, session_id,
        user_message="What is Atlas?",
        assistant_message="Atlas is an enterprise RAG platform.",
    )
    assert len(updated.messages) == 2
    assert updated.messages[0].role == "user"
    assert updated.messages[0].content == "What is Atlas?"

    # Reload and verify it was persisted.
    reloaded = await store.load(user_id, session_id)
    assert len(reloaded.messages) == 2
    assert reloaded.messages[1].content == "Atlas is an enterprise RAG platform."


@pytest.mark.asyncio
async def test_sliding_window_trims_oldest_turns(
    user_id: UUID, session_id: str, redis_client: Redis
) -> None:
    store = RedisSessionMemoryStore(redis_client, window_turns=2)
    for i in range(5):
        await store.append_turn(
            user_id, session_id,
            user_message=f"Question {i}",
            assistant_message=f"Answer {i}",
        )
    memory = await store.load(user_id, session_id)
    # 2 turns = 4 messages
    assert len(memory.messages) == 4
    assert memory.messages[0].content == "Question 3"
    assert memory.messages[-1].content == "Answer 4"


@pytest.mark.asyncio
async def test_summary_includes_turn_count(
    user_id: UUID, session_id: str, redis_client: Redis
) -> None:
    store = RedisSessionMemoryStore(redis_client, window_turns=10)
    await store.append_turn(
        user_id, session_id,
        user_message="Tell me about hybrid retrieval.",
        assistant_message="Hybrid retrieval combines vector and keyword search.",
    )
    summary = await store.summary(user_id, session_id)
    assert "hybrid retrieval" in summary.lower() or "1 turns" in summary


@pytest.mark.asyncio
async def test_delete_removes_session(
    user_id: UUID, session_id: str, redis_client: Redis
) -> None:
    store = RedisSessionMemoryStore(redis_client, window_turns=10)
    await store.append_turn(
        user_id, session_id,
        user_message="Q", assistant_message="A",
    )
    await store.delete(user_id, session_id)
    memory = await store.load(user_id, session_id)
    assert memory.messages == []


@pytest.mark.asyncio
async def test_window_turns_zero_skips_persistence(
    user_id: UUID, session_id: str, redis_client: Redis
) -> None:
    store = RedisSessionMemoryStore(redis_client, window_turns=0)
    updated = await store.append_turn(
        user_id, session_id,
        user_message="Q", assistant_message="A",
    )
    assert updated.messages == []
    memory = await store.load(user_id, session_id)
    assert memory.messages == []


@pytest.fixture
async def redis_client() -> Redis:
    """Connect to the local development Redis instance."""
    client = Redis.from_url("redis://:atlas-local-redis@127.0.0.1:56379")
    yield client
    await client.aclose()

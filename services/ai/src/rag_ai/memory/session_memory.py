from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from redis.asyncio import Redis
from redis.exceptions import RedisError

from rag_ai.models.base import ChatMessage

logger = logging.getLogger(__name__)


@dataclass
class SessionMemory:
    messages: list[ChatMessage] = field(default_factory=list)
    summary: str = ""


class RedisSessionMemoryStore:
    """Redis-backed short-term conversation memory.

    Stores a sliding window of recent messages and a lightweight session
    summary under ``atlas:memory:{userId}:{sessionId}``. Expiry is set on
    every write so idle sessions are automatically reclaimed.
    """

    _KEY_PREFIX = "atlas:memory"

    def __init__(
        self,
        client: Redis,
        *,
        window_turns: int = 10,
        ttl_seconds: int = 86_400,
    ) -> None:
        self._client = client
        self._window_turns = max(window_turns, 0)
        self._ttl_seconds = ttl_seconds

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def load(self, user_id: UUID, session_id: str) -> SessionMemory:
        """Load the current window and summary for a session."""
        key = self._key(user_id, session_id)
        try:
            data = await self._client.get(key)
        except RedisError:
            logger.warning("Redis unavailable, returning empty memory", exc_info=True)
            return SessionMemory()

        if data is None:
            return SessionMemory()

        return self._deserialize(data)

    async def save(self, user_id: UUID, session_id: str, memory: SessionMemory) -> None:
        """Persist the sliding window and summary."""
        if self._window_turns == 0:
            return

        key = self._key(user_id, session_id)
        payload = self._serialize(memory)
        try:
            await self._client.set(key, payload, ex=self._ttl_seconds)
        except RedisError:
            logger.warning("Failed to persist session memory", exc_info=True)

    async def append_turn(
        self,
        user_id: UUID,
        session_id: str,
        user_message: str,
        assistant_message: str,
    ) -> SessionMemory:
        """Append a user/assistant turn, trim the window, and persist.

        Returns the updated ``SessionMemory`` so callers can hydrate the next
        Agent run without a follow-up read.
        """
        memory = await self.load(user_id, session_id)
        if self._window_turns == 0:
            return memory

        effective = memory.messages if memory.messages else []

        effective.append(ChatMessage(role="user", content=user_message))
        effective.append(ChatMessage(role="assistant", content=assistant_message))

        # Trim to the configured window (each turn is 2 messages).
        max_messages = self._window_turns * 2
        if len(effective) > max_messages:
            effective = effective[-max_messages:]

        # Rebuild summary from the retained window.
        summary = self._build_summary(effective)
        updated = SessionMemory(messages=effective, summary=summary)
        await self.save(user_id, session_id, updated)
        return updated

    async def delete(self, user_id: UUID, session_id: str) -> None:
        """Remove all memory for a session."""
        key = self._key(user_id, session_id)
        try:
            await self._client.delete(key)
        except RedisError:
            logger.warning("Failed to delete session memory", exc_info=True)

    async def summary(self, user_id: UUID, session_id: str) -> str:
        """Return the lightweight session summary, if any."""
        memory = await self.load(user_id, session_id)
        return memory.summary

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _key(self, user_id: UUID, session_id: str) -> str:
        return f"{self._KEY_PREFIX}:{user_id}:{session_id}"

    @staticmethod
    def _serialize(memory: SessionMemory) -> bytes:
        data: dict[str, Any] = {
            "messages": [
                {"role": message.role, "content": message.content}
                for message in memory.messages
            ],
            "summary": memory.summary,
        }
        return json.dumps(data, ensure_ascii=False).encode("utf-8")

    @staticmethod
    def _deserialize(raw: bytes) -> SessionMemory:
        data = json.loads(raw)
        messages = [
            ChatMessage(role=item["role"], content=item["content"])
            for item in data.get("messages", [])
        ]
        return SessionMemory(
            messages=messages,
            summary=data.get("summary", ""),
        )

    @staticmethod
    def _build_summary(messages: list[ChatMessage]) -> str:
        """Build a lightweight summary from the retained window.

        This is a deterministic heuristic: take the first segment of the
        oldest user message as the topic, and count turns. When a real LLM
        is available the summary could be replaced by a model call.
        """
        user_messages = [message for message in messages if message.role == "user"]
        if not user_messages:
            return ""
        first = user_messages[0].content
        # Use the first sentence or phrase as the topic hint.
        topic = first[:80].strip()
        if len(first) > 80:
            topic += "…"
        return f"{len(user_messages)} turns; topic: {topic}"

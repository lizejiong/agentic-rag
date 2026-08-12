from __future__ import annotations

from dataclasses import dataclass

from rag_ai.models.base import ChatMessage


ORPHAN_REFERENCES = (
    "它",
    "他",
    "她",
    "这",
    "那个",
    "上述",
    "前面",
    "这个",
    "that",
    "it",
    "they",
)
_MAX_REFERENCE_QUERY_LENGTH = 12
_MAX_HISTORY_ANCHOR_LENGTH = 500


@dataclass(frozen=True)
class ConversationResolution:
    effective_query: str
    contextualized: bool
    needs_clarification: bool


def normalize_query(query: str) -> str:
    return " ".join(query.split())


def is_orphan_reference(query: str) -> bool:
    normalized = normalize_query(query)
    compact = normalized.replace(" ", "")
    return bool(compact) and (
        any(normalized.casefold().startswith(term) for term in ORPHAN_REFERENCES)
        and len(compact) <= _MAX_REFERENCE_QUERY_LENGTH
    )


def resolve_retrieval_query(
    query: str, history: list[ChatMessage]
) -> ConversationResolution:
    normalized = normalize_query(query)
    if not is_orphan_reference(normalized):
        return ConversationResolution(
            effective_query=normalized,
            contextualized=False,
            needs_clarification=False,
        )

    anchor = _latest_user_question(history)
    if anchor is None:
        return ConversationResolution(
            effective_query=normalized,
            contextualized=False,
            needs_clarification=True,
        )
    return ConversationResolution(
        effective_query=f"{anchor}\n追问：{normalized}",
        contextualized=True,
        needs_clarification=False,
    )


def _latest_user_question(history: list[ChatMessage]) -> str | None:
    for message in reversed(history):
        if message.role != "user":
            continue
        content = normalize_query(message.content)
        if content:
            return content[:_MAX_HISTORY_ANCHOR_LENGTH]
    return None

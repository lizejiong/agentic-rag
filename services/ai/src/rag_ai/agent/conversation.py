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
_HISTORY_SUMMARY_PREFIX = "此前已授权的用户话题："
_MAX_HISTORY_SUMMARY_CODE_POINTS = 4000


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
    query: str, history: list[ChatMessage], history_summary: str = ""
) -> ConversationResolution:
    normalized = normalize_query(query)
    if not is_orphan_reference(normalized):
        return ConversationResolution(
            effective_query=normalized,
            contextualized=False,
            needs_clarification=False,
        )

    summary, summary_anchor = _canonical_history_summary(history_summary)
    anchor = _latest_user_question(history) or summary_anchor
    if anchor is None:
        return ConversationResolution(
            effective_query=normalized,
            contextualized=False,
            needs_clarification=True,
        )
    effective_query = f"{anchor}\n追问：{normalized}"
    if summary is not None:
        effective_query = f"{summary}\n{effective_query}"
    return ConversationResolution(
        effective_query=effective_query,
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


def _canonical_history_summary(history_summary: str) -> tuple[str | None, str | None]:
    if len(history_summary) > _MAX_HISTORY_SUMMARY_CODE_POINTS:
        return None, None
    normalized_line_endings = history_summary.replace("\r\n", "\n")
    if "\r" in normalized_line_endings:
        return None, None
    lines = normalized_line_endings.split("\n")
    if not lines or lines[0] != _HISTORY_SUMMARY_PREFIX:
        return None, None

    topics: list[str] = []
    for line in lines[1:]:
        if not line.startswith("- "):
            return None, None
        if len(line[2:]) > 240:
            return None, None
        topic = normalize_query(line[2:])
        if not topic:
            return None, None
        topics.append(topic)
        if len(topics) > 20:
            return None, None
    if not topics:
        return None, None
    return f"{_HISTORY_SUMMARY_PREFIX}\n" + "\n".join(f"- {topic}" for topic in topics), topics[-1]

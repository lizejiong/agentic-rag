from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from rag_ai.models.base import ChatMessage


Route = Literal["retrieve", "clarify", "refuse"]

# The first release deliberately keeps routing deterministic.  This makes the
# retrieval behaviour explainable and avoids adding a second model dependency to
# the critical path.  It can be replaced by a classified route later without
# changing the graph shape.
RELATION_TERMS = (
    "关系",
    "关联",
    "依赖",
    "影响",
    "上下游",
    "负责人",
    "属于",
    "相关",
    "relation",
    "relationship",
    "depends on",
    "depends",
    "owner",
)
ORPHAN_REFERENCES = ("它", "他", "她", "这", "那个", "上述", "前面", "这个", "that", "it", "they")


@dataclass(frozen=True)
class QuestionProfile:
    route: Route
    use_graph: bool
    normalized_query: str


def classify_question(
    query: str,
    history: list[ChatMessage],
    *,
    has_visible_space: bool,
) -> QuestionProfile:
    normalized = " ".join(query.split())
    if not has_visible_space:
        return QuestionProfile(route="refuse", use_graph=False, normalized_query=normalized)
    if _is_orphan_reference(normalized, history):
        return QuestionProfile(route="clarify", use_graph=False, normalized_query=normalized)

    folded = normalized.casefold()
    return QuestionProfile(
        route="retrieve",
        use_graph=any(term in folded for term in RELATION_TERMS),
        normalized_query=normalized,
    )


def _is_orphan_reference(query: str, history: list[ChatMessage]) -> bool:
    if history or not query:
        return False
    folded = query.casefold()
    # A one/two-token question which begins with a reference has no resolvable
    # antecedent.  Longer, self-contained questions such as “这个空间有哪些文档”
    # should still retrieve normally.
    compact = query.replace(" ", "")
    return (
        any(folded.startswith(term) for term in ORPHAN_REFERENCES)
        and len(compact) <= 12
    )

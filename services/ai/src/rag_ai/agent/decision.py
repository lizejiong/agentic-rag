from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from rag_ai.agent.conversation import normalize_query


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
    "负责",
)


@dataclass(frozen=True)
class QuestionProfile:
    route: Route
    use_graph: bool
    normalized_query: str


def classify_question(
    query: str,
    *,
    has_visible_space: bool,
) -> QuestionProfile:
    normalized = normalize_query(query)
    if not has_visible_space:
        return QuestionProfile(route="refuse", use_graph=False, normalized_query=normalized)

    folded = normalized.casefold()
    return QuestionProfile(
        route="retrieve",
        use_graph=any(term in folded for term in RELATION_TERMS),
        normalized_query=normalized,
    )

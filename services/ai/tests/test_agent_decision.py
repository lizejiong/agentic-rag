from rag_ai.agent.decision import classify_question
from rag_ai.models.base import ChatMessage


def test_question_without_visible_space_is_refused() -> None:
    profile = classify_question("介绍一下项目", [], has_visible_space=False)

    assert profile.route == "refuse"
    assert profile.use_graph is False


def test_orphan_reference_without_history_is_clarified() -> None:
    profile = classify_question("它是什么？", [], has_visible_space=True)

    assert profile.route == "clarify"


def test_relation_question_uses_both_evidence_channels() -> None:
    profile = classify_question("A 和 B 有什么依赖关系？", [], has_visible_space=True)

    assert profile.route == "retrieve"
    assert profile.use_graph is True


def test_ordinary_question_uses_document_retrieval() -> None:
    profile = classify_question(
        "项目的发布流程是什么？",
        [ChatMessage(role="user", content="请介绍项目")],
        has_visible_space=True,
    )

    assert profile.route == "retrieve"
    assert profile.use_graph is False

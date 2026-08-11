from rag_ai.agent.conversation import resolve_retrieval_query
from rag_ai.models.base import ChatMessage


def test_resolves_a_short_pronoun_follow_up_from_latest_user_question() -> None:
    resolution = resolve_retrieval_query(
        "它是谁负责的？",
        [ChatMessage(role="user", content="采购申请由谁审批？")],
    )

    assert resolution.effective_query == "采购申请由谁审批？\n追问：它是谁负责的？"
    assert resolution.contextualized is True
    assert resolution.needs_clarification is False


def test_uses_the_latest_user_message_and_ignores_assistant_answers() -> None:
    resolution = resolve_retrieval_query(
        "它是谁负责的？",
        [
            ChatMessage(role="user", content="旧的问题"),
            ChatMessage(role="assistant", content="不应成为检索锚点"),
            ChatMessage(role="user", content="最新的问题"),
            ChatMessage(role="assistant", content="同样不应成为检索锚点"),
        ],
    )

    assert resolution.effective_query == "最新的问题\n追问：它是谁负责的？"
    assert resolution.contextualized is True


def test_keeps_an_independent_question_unchanged() -> None:
    resolution = resolve_retrieval_query(
        "采购申请的审批流程是什么？",
        [ChatMessage(role="user", content="无关的上一轮问题")],
    )

    assert resolution.effective_query == "采购申请的审批流程是什么？"
    assert resolution.contextualized is False
    assert resolution.needs_clarification is False


def test_requires_clarification_for_a_pronoun_question_without_user_history() -> None:
    resolution = resolve_retrieval_query(
        "它是谁负责的？",
        [ChatMessage(role="assistant", content="这里没有用户问题")],
    )

    assert resolution.effective_query == "它是谁负责的？"
    assert resolution.contextualized is False
    assert resolution.needs_clarification is True


def test_normalizes_and_bounds_the_retrieval_anchor() -> None:
    resolution = resolve_retrieval_query(
        "  它是谁负责的？  ",
        [ChatMessage(role="user", content=f"  {'前' * 501}  ")],
    )

    assert resolution.effective_query == f"{'前' * 500}\n追问：它是谁负责的？"

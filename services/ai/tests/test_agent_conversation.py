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


def test_short_follow_up_combines_canonical_summary_and_latest_user_question() -> None:
    summary = "此前已授权的用户话题：\n- 旧主题\n- 更早主题"
    resolution = resolve_retrieval_query(
        "它是谁负责的？",
        [
            ChatMessage(role="assistant", content="不得作为锚点"),
            ChatMessage(role="user", content="最新用户问题"),
        ],
        summary,
    )

    assert resolution.effective_query == (
        "此前已授权的用户话题：\n- 旧主题\n- 更早主题\n最新用户问题\n追问：它是谁负责的？"
    )
    assert resolution.contextualized is True
    assert resolution.needs_clarification is False


def test_short_follow_up_uses_the_last_canonical_summary_topic_without_history() -> None:
    summary = "此前已授权的用户话题：\n- 旧主题\n- 最近主题"
    resolution = resolve_retrieval_query("它是谁负责的？", [], summary)

    assert resolution.effective_query == (
        "此前已授权的用户话题：\n- 旧主题\n- 最近主题\n最近主题\n追问：它是谁负责的？"
    )
    assert resolution.contextualized is True
    assert resolution.needs_clarification is False


def test_rejects_canonical_summary_topic_count_and_code_point_overflows() -> None:
    valid_count_summary = "此前已授权的用户话题：\n" + "\n".join("- topic" for _ in range(20))
    valid_topic_summary = f"此前已授权的用户话题：\n- {'😀' * 240}"
    too_many_topics = "此前已授权的用户话题：\n" + "\n".join("- topic" for _ in range(21))
    oversized_topic = f"此前已授权的用户话题：\n- {'😀' * 241}"

    assert (
        resolve_retrieval_query("它是谁负责的？", [], valid_count_summary).needs_clarification
        is False
    )
    assert (
        resolve_retrieval_query("它是谁负责的？", [], valid_topic_summary).needs_clarification
        is False
    )
    assert (
        resolve_retrieval_query("它是谁负责的？", [], too_many_topics).needs_clarification is True
    )
    assert (
        resolve_retrieval_query("它是谁负责的？", [], oversized_topic).needs_clarification is True
    )


def test_keeps_an_independent_question_unchanged() -> None:
    resolution = resolve_retrieval_query(
        "采购申请的审批流程是什么？",
        [ChatMessage(role="user", content="无关的上一轮问题")],
        "此前已授权的用户话题：\n- 不应添加到独立问题",
    )

    assert resolution.effective_query == "采购申请的审批流程是什么？"
    assert resolution.contextualized is False
    assert resolution.needs_clarification is False


def test_requires_clarification_for_a_pronoun_question_without_user_history() -> None:
    resolution = resolve_retrieval_query(
        "它是谁负责的？",
        [ChatMessage(role="assistant", content="这里没有用户问题")],
        "不是规范的摘要",
    )

    assert resolution.effective_query == "它是谁负责的？"
    assert resolution.contextualized is False
    assert resolution.needs_clarification is True


def test_rejects_a_summary_prefix_with_surrounding_whitespace() -> None:
    resolution = resolve_retrieval_query(
        "它是谁负责的？",
        [],
        "  此前已授权的用户话题：  \n- topic",
    )

    assert resolution.contextualized is False
    assert resolution.needs_clarification is True


def test_rejects_unicode_line_separators_and_accepts_crlf_summary_lines() -> None:
    unicode_separator = resolve_retrieval_query(
        "它是谁负责的？",
        [],
        "此前已授权的用户话题：\u2028- topic",
    )
    crlf_summary = resolve_retrieval_query(
        "它是谁负责的？",
        [],
        "此前已授权的用户话题：\r\n- topic",
    )

    assert unicode_separator.needs_clarification is True
    assert crlf_summary.needs_clarification is False


def test_normalizes_and_bounds_the_retrieval_anchor() -> None:
    resolution = resolve_retrieval_query(
        "  它是谁负责的？  ",
        [ChatMessage(role="user", content=f"  {'前' * 501}  ")],
    )

    assert resolution.effective_query == f"{'前' * 500}\n追问：它是谁负责的？"

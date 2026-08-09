from __future__ import annotations

import pytest

from rag_ai.graph.extractor import extract_candidates
from rag_ai.models.base import ChatMessage, ChatResponse, ChatModel


class FixedChatModel(ChatModel):
    @property
    def model_name(self) -> str:
        return "fixed"

    @property
    def version(self) -> str:
        return "1"

    async def achat(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float = 0.3,
        max_tokens: int = 2048,
        stop: list[str] | None = None,
    ) -> ChatResponse:
        return ChatResponse(
            content='[{"subject":"采购部","subject_type":"部门","predicate":"负责","object":"审批","object_type":"流程","quote":"采购部负责审批","confidence":0.9},{"subject":"采购部","subject_type":"部门","predicate":"拥有","object":"预算","object_type":"资源","quote":"不存在的证据","confidence":0.9}]'
        )


@pytest.mark.asyncio
async def test_extraction_keeps_only_relations_with_verbatim_chunk_evidence() -> None:
    candidates = await extract_candidates("采购部负责审批供应商合同。", FixedChatModel())

    assert [(item.subject, item.predicate, item.object, item.quote) for item in candidates] == [
        ("采购部", "负责", "审批", "采购部负责审批")
    ]

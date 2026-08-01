from __future__ import annotations

from typing import cast

import httpx

from rag_ai.models.base import RankedCandidate, Reranker


class SiliconFlowReranker(Reranker):
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str = "BAAI/bge-reranker-v2-m3",
        timeout_seconds: float = 15.0,
        instruction: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url
        self._model = model
        self._timeout_seconds = timeout_seconds
        self._instruction = instruction
        self._transport = transport

    @property
    def model_name(self) -> str:
        return "siliconflow"

    @property
    def version(self) -> str:
        return self._model

    async def rerank(
        self, query: str, candidates: list[tuple[str, str]], *, top_k: int
    ) -> list[RankedCandidate]:
        if not candidates:
            return []

        payload: dict[str, object] = {
            "model": self._model,
            "query": query,
            "documents": [content for _, content in candidates],
            "top_n": min(top_k, len(candidates)),
            "return_documents": False,
        }
        if self._instruction:
            payload["instruction"] = self._instruction

        async with httpx.AsyncClient(
            timeout=self._timeout_seconds, transport=self._transport
        ) as client:
            response = await client.post(
                self._base_url,
                headers={"Authorization": f"Bearer {self._api_key}"},
                json=payload,
            )
            response.raise_for_status()

        body = cast(object, response.json())
        if not isinstance(body, dict):
            raise ValueError("SiliconFlow reranker returned a non-object response")
        raw_results = body.get("results")
        if not isinstance(raw_results, list):
            raise ValueError("SiliconFlow reranker response is missing results")

        ranked: list[RankedCandidate] = []
        for raw_result in raw_results:
            if not isinstance(raw_result, dict):
                continue
            index = raw_result.get("index")
            score = raw_result.get("relevance_score")
            if (
                not isinstance(index, int)
                or not 0 <= index < len(candidates)
                or not isinstance(score, int | float)
            ):
                continue
            ranked.append(
                RankedCandidate(
                    chunk_id=candidates[index][0],
                    score=float(score),
                    details={"provider": "siliconflow", "model": self._model},
                )
            )
        return ranked

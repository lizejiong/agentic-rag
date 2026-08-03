from __future__ import annotations

from typing import cast

import httpx

from rag_ai.models.base import RankedCandidate, Reranker


class HttpReranker(Reranker):
    """Reranker backed by an OpenAI-compatible HTTP rerank API.

    Normalises minor payload-format differences across providers so a single
    implementation serves both SiliconFlow and Bailian (and any future
    OpenAI-compatible rerank endpoint).
    """

    _SPEC: dict[str, dict[str, object]] = {
        "siliconflow": {
            "instruction_field": "instruction",
            "extra_payload": {"return_documents": False},
        },
        "bailian": {
            "instruction_field": "instruct",
            "extra_payload": {},
        },
    }

    _DEFAULT_INSTRUCTION = (
        "Given a web search query, retrieve relevant passages that answer the query."
    )

    def __init__(
        self,
        *,
        provider: str,
        api_key: str,
        base_url: str,
        model: str,
        timeout_seconds: float = 15.0,
        instruction: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        if provider not in self._SPEC:
            raise ValueError(f"Unsupported reranker provider: {provider}")
        self._provider = provider
        self._api_key = api_key
        self._base_url = base_url
        self._model = model
        self._timeout_seconds = timeout_seconds
        self._instruction = instruction
        self._transport = transport

    @property
    def model_name(self) -> str:
        return self._provider

    @property
    def version(self) -> str:
        return self._model

    # ------------------------------------------------------------------
    # Payload construction
    # ------------------------------------------------------------------

    def _build_payload(
        self, query: str, documents: list[str], top_n: int
    ) -> dict[str, object]:
        spec = self._SPEC[self._provider]
        payload: dict[str, object] = {
            "model": self._model,
            "query": query,
            "documents": documents,
            "top_n": top_n,
            **spec["extra_payload"],
        }
        instruction = self._instruction
        if instruction is not None:
            payload[str(spec["instruction_field"])] = instruction
        elif self._provider == "bailian":
            # Bailian requires the instruct field in every request.
            payload[str(spec["instruction_field"])] = self._DEFAULT_INSTRUCTION
        return payload

    # ------------------------------------------------------------------
    # Core logic
    # ------------------------------------------------------------------

    async def rerank(
        self, query: str, candidates: list[tuple[str, str]], *, top_k: int
    ) -> list[RankedCandidate]:
        if not candidates:
            return []

        documents = [content for _, content in candidates]
        payload = self._build_payload(query, documents, min(top_k, len(candidates)))

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
            raise ValueError(
                f"{self._provider} reranker returned a non-object response"
            )
        raw_results = body.get("results")
        if not isinstance(raw_results, list):
            raise ValueError(
                f"{self._provider} reranker response is missing results"
            )

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
                    details={"provider": self._provider, "model": self._model},
                )
            )
        return ranked

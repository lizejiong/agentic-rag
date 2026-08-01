"""OpenAI model adapters — embedding and chat."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import cast

from openai import AsyncOpenAI, AsyncStream
from openai.types.chat import ChatCompletionChunk

from rag_ai.models.base import (
    ChatMessage,
    ChatModel,
    ChatResponse,
    EmbedResult,
    EmbeddingModel,
)


class OpenAIEmbeddingModel(EmbeddingModel):
    def __init__(
        self,
        *,
        api_key: str,
        model: str = "text-embedding-3-small",
        dimensions: int | None = None,
        base_url: str | None = None,
    ) -> None:
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url)
        self._model = model
        self._dimensions = dimensions or 1536
        self._version = model

    @property
    def dimensions(self) -> int:
        return self._dimensions

    @property
    def model_name(self) -> str:
        return self._model

    @property
    def version(self) -> str:
        return self._version

    async def embed(self, texts: list[str]) -> EmbedResult:
        extra: dict[str, object] = {}
        if "text-embedding-3" in self._model and self._dimensions:
            extra["dimensions"] = self._dimensions
        response = await self._client.embeddings.create(
            model=self._model,
            input=texts,
            **extra,  # type: ignore[arg-type]
        )
        embeddings = [item.embedding for item in response.data]
        return EmbedResult(
            texts=texts,
            embeddings=embeddings,
            model=self.model_name,
            version=self.version,
            dimensions=len(embeddings[0]) if embeddings else self._dimensions,
        )


class OpenAIChatModel(ChatModel):
    def __init__(
        self,
        *,
        api_key: str,
        model: str = "gpt-4o-mini",
        base_url: str | None = None,
    ) -> None:
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url)
        self._model = model

    @property
    def model_name(self) -> str:
        return self._model

    @property
    def version(self) -> str:
        return self._model

    async def achat(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float = 0.3,
        max_tokens: int = 2048,
        stop: list[str] | None = None,
    ) -> ChatResponse:
        api_messages = [
            {"role": msg.role, "content": msg.content} for msg in messages
        ]
        response = await self._client.chat.completions.create(
            model=self._model,
            messages=api_messages,  # type: ignore[arg-type]
            temperature=temperature,
            max_tokens=max_tokens,
            stop=stop or None,
        )
        choice = response.choices[0]
        return ChatResponse(
            content=choice.message.content or "",
            usage={
                "prompt_tokens": response.usage.prompt_tokens if response.usage else 0,
                "completion_tokens": response.usage.completion_tokens if response.usage else 0,
            },
        )

    async def astream(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float = 0.3,
        max_tokens: int = 2048,
        stop: list[str] | None = None,
    ) -> AsyncIterator[str]:
        api_messages = [
            {"role": msg.role, "content": msg.content} for msg in messages
        ]
        stream = cast(
            AsyncStream[ChatCompletionChunk],
            await self._client.chat.completions.create(
                model=self._model,
                messages=api_messages,  # type: ignore[arg-type]
                temperature=temperature,
                max_tokens=max_tokens,
                stop=stop or None,
                stream=True,
            ),
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                yield delta.content

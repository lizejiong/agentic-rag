"""Quick smoke test: verify OpenAI-compatible API key and model connectivity.

    uv run --project services/ai python scripts/test-openai-connectivity.py
"""
from __future__ import annotations

import os

from openai import AsyncOpenAI


async def main() -> None:
    key = os.environ.get("OPENAI_API_KEY", "")
    base_url = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
    chat_model = os.environ.get("LLM_VERSION", "gpt-4o-mini")
    embed_model = os.environ.get("EMBEDDING_VERSION", "text-embedding-3-small")
    embed_dim = int(os.environ.get("EMBEDDING_DIMENSIONS", "1536"))

    if not key:
        print("[FAIL] OPENAI_API_KEY not set in environment.\n")
        print("   Make sure you have the following in your .env file:")
        print("   OPENAI_API_KEY=sk-...")
        return

    client = AsyncOpenAI(api_key=key, base_url=base_url if base_url and base_url != "https://api.openai.com/v1" else None)
    print(f"Endpoint: {base_url}")
    print(f"Chat model: {chat_model}")
    print(f"Embed model: {embed_model}\n")

    # Test embedding
    print("Testing embedding...", end=" ", flush=True)
    try:
        extra: dict[str, object] = {}
        if "text-embedding-3" in embed_model:
            extra["dimensions"] = embed_dim
        emb = await client.embeddings.create(
            model=embed_model,
            input=["Hello world"],
            **extra,  # type: ignore[arg-type]
        )
        print(f"[OK] dims={len(emb.data[0].embedding)} tokens={emb.usage.total_tokens}")
    except Exception as e:
        print(f"[FAIL] {type(e).__name__}: {e}")

    # Test chat
    print("Testing chat ...   ", end=" ", flush=True)
    try:
        chat = await client.chat.completions.create(
            model=chat_model,
            messages=[{"role": "user", "content": "Say 'OK' in one word."}],
            max_tokens=10,
        )
        content = chat.choices[0].message.content or ""
        tokens = f"prompt={chat.usage.prompt_tokens} completion={chat.usage.completion_tokens}" if chat.usage else ""
        print(f"[OK] reply='{content.strip()}' {tokens}")
    except Exception as e:
        print(f"[FAIL] {type(e).__name__}: {e}")

    await client.close()


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())

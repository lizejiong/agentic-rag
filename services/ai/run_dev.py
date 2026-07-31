"""Development server launcher — compatible event loop on all platforms."""
from __future__ import annotations

import asyncio
import os
import sys

import uvicorn

if __name__ == "__main__":
    config = uvicorn.Config(
        "rag_ai.main:app",
        host="127.0.0.1",
        port=int(os.environ.get("AI_PORT", "8001")),
        loop="asyncio",
        reload=sys.platform != "win32",
    )
    server = uvicorn.Server(config)

    if sys.platform == "win32":
        with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
            runner.run(server.serve())
    else:
        asyncio.run(server.serve())

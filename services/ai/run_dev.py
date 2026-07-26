"""Development server launcher — sets correct event loop on Windows."""
from __future__ import annotations

import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import uvicorn

if __name__ == "__main__":
    uvicorn.run("rag_ai.main:app", host="127.0.0.1", port=8001, reload=True)

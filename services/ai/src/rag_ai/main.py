from __future__ import annotations

import asyncio
import sys

from fastapi import FastAPI

from rag_ai.routes.health import router as health_router
from rag_ai.routes.runs import router as runs_router
from rag_ai.routes.search_test import router as search_test_router

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

app = FastAPI(title="RAG AI Service", version="0.0.0")
app.include_router(health_router)
app.include_router(runs_router)
app.include_router(search_test_router)

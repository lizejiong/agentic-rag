from __future__ import annotations

import asyncio
import logging
import sys

from fastapi import FastAPI

from rag_ai.routes.health import router as health_router
from rag_ai.routes.graph import router as graph_router
from rag_ai.routes.runs import router as runs_router
from rag_ai.routes.search_test import router as search_test_router

if sys.platform == "win32":
    selector_policy = getattr(asyncio, "WindowsSelectorEventLoopPolicy", None)
    if selector_policy is not None:
        asyncio.set_event_loop_policy(selector_policy())

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="RAG AI Service", version="0.0.0")
app.include_router(health_router)
app.include_router(graph_router)
app.include_router(runs_router)
app.include_router(search_test_router)

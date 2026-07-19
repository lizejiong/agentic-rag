from fastapi import FastAPI

from rag_ai.routes.health import router as health_router
from rag_ai.routes.runs import router as runs_router

app = FastAPI(title="RAG AI Service", version="0.0.0")
app.include_router(health_router)
app.include_router(runs_router)

from __future__ import annotations

from neo4j import AsyncGraphDatabase
from sqlalchemy.ext.asyncio import create_async_engine

from rag_ai.graph.service import GraphService
from rag_ai.models.factory import create_chat_model
from rag_ai.settings import WorkerSettings


def build_graph_service(settings: WorkerSettings) -> GraphService:
    driver = (
        AsyncGraphDatabase.driver(settings.neo4j_uri, auth=(settings.neo4j_user, settings.neo4j_password))
        if settings.neo4j_password
        else None
    )
    return GraphService(
        create_async_engine(settings.async_sqlalchemy_url, pool_pre_ping=True),
        create_chat_model(
            provider=settings.llm_provider, version=settings.llm_version,
            api_key=settings.llm_api_key or settings.openai_api_key,
            base_url=settings.llm_base_url or settings.openai_base_url,
        ),
        driver=driver, extraction_version=settings.graph_extraction_version,
    )

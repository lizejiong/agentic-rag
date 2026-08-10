from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from rag_ai.graph.repository import GraphRepository
from rag_ai.retrieval.models import AclSnapshot


def repository_with_connection(*, connect: bool = False) -> tuple[GraphRepository, AsyncMock]:
    connection = AsyncMock(spec=AsyncConnection)
    context = MagicMock()
    context.__aenter__ = AsyncMock(return_value=connection)
    context.__aexit__ = AsyncMock(return_value=False)
    engine = MagicMock(spec=AsyncEngine)
    if connect:
        engine.connect.return_value = context
    else:
        engine.begin.return_value = context
    return GraphRepository(engine), connection


def returning_ids_result(ids: list[object]) -> MagicMock:
    result = MagicMock()
    result.scalars.return_value = ids
    return result


@pytest.mark.asyncio
async def test_list_relations_types_an_optional_status_parameter() -> None:
    repository, connection = repository_with_connection(connect=True)
    result = MagicMock()
    result.mappings.return_value.all.return_value = []
    connection.execute.return_value = result

    assert await repository.list_relations(uuid4(), AclSnapshot(uuid4(), True), status=None) == []
    statement = connection.execute.await_args.args[0]
    compiled = statement.compile(dialect=postgresql.dialect())
    assert "CAST(%(status)s AS VARCHAR(24)) IS NULL" in str(compiled)


@pytest.mark.asyncio
async def test_reconcile_uses_correlated_existence_checks() -> None:
    repository, connection = repository_with_connection()
    connection.execute.side_effect = [MagicMock(), returning_ids_result([])]

    assert await repository.reconcile(uuid4()) == []
    sql = " ".join(str(connection.execute.await_args_list[0].args[0]).split())
    assert "LEFT JOIN app.documents" not in sql
    assert "NOT EXISTS ( SELECT 1 FROM app.documents d" in sql
    assert "NOT EXISTS ( SELECT 1 FROM rag.chunks c" in sql

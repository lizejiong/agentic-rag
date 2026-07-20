from pydantic import ValidationError
import pytest

from rag_ai.infrastructure.database.settings import DatabaseSettings


def test_prefers_rag_specific_database_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://atlas:secret@localhost/app")
    monkeypatch.setenv("RAG_DATABASE_URL", "postgresql://atlas:secret@localhost/rag")

    settings = DatabaseSettings(_env_file=None)

    assert settings.sqlalchemy_url == "postgresql+psycopg://atlas:secret@localhost/rag"


def test_accepts_shared_database_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("RAG_DATABASE_URL", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://atlas:secret@localhost/atlas_rag")

    settings = DatabaseSettings(_env_file=None)

    assert settings.sqlalchemy_url == "postgresql+psycopg://atlas:secret@localhost/atlas_rag"


def test_rejects_non_postgresql_database_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("RAG_DATABASE_URL", raising=False)
    monkeypatch.setenv("DATABASE_URL", "sqlite:///local.db")

    with pytest.raises(ValidationError):
        DatabaseSettings(_env_file=None)

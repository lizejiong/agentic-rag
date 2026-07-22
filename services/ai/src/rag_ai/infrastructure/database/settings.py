from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, PostgresDsn
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[6]


class DatabaseSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(Path.cwd() / ".env", PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: PostgresDsn = Field(
        validation_alias=AliasChoices("RAG_DATABASE_URL", "DATABASE_URL")
    )

    @property
    def sqlalchemy_url(self) -> str:
        value = str(self.database_url)
        return value.replace("postgresql://", "postgresql+psycopg://", 1)

    @property
    def async_sqlalchemy_url(self) -> str:
        value = str(self.database_url)
        return value.replace("postgresql://", "postgresql+psycopg_async://", 1)


@lru_cache
def get_database_settings() -> DatabaseSettings:
    return DatabaseSettings()  # type: ignore[call-arg]  # Values come from settings sources.

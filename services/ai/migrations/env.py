from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import MetaData, engine_from_config, pool, text

from rag_ai.infrastructure.database.settings import get_database_settings

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = MetaData(schema="rag")


def configure_context(connection: object | None = None) -> None:
    context.configure(
        connection=connection,
        url=None if connection is not None else get_database_settings().sqlalchemy_url,
        target_metadata=target_metadata,
        include_schemas=True,
        version_table="alembic_version",
        version_table_schema="rag",
        compare_type=True,
        literal_binds=connection is None,
        dialect_opts={"paramstyle": "named"},
    )


def run_migrations_offline() -> None:
    configure_context()

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    settings = get_database_settings()
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = settings.sqlalchemy_url

    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        connection.execute(text("CREATE SCHEMA IF NOT EXISTS rag"))
        connection.commit()
        configure_context(connection)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

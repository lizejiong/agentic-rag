"""Create durable ingestion state and worker outbox.

Revision ID: 20260721_02
Revises: 20260719_01
Create Date: 2026-07-21
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260721_02"
down_revision: str | None = "20260719_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ingestion_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("source_event_id", postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("import_id", postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_id", postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("space_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("stage", sa.String(32), nullable=False),
        sa.Column("progress", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_code", sa.String(120)),
        sa.Column("error_message", sa.Text()),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("progress >= 0 AND progress <= 100", name="ck_ingestion_progress"),
        schema="rag",
    )
    op.create_index(
        "ix_ingestion_runs_status_updated_at",
        "ingestion_runs",
        ["status", "updated_at"],
        schema="rag",
    )

    op.create_table(
        "normalized_documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("version_id", postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("space_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column(
            "metadata", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        schema="rag",
    )

    op.create_table(
        "normalized_elements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "normalized_document_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("rag.normalized_documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("element_index", sa.Integer(), nullable=False),
        sa.Column("element_type", sa.String(40), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "location", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.UniqueConstraint(
            "normalized_document_id", "element_index", name="uq_normalized_element_index"
        ),
        schema="rag",
    )

    op.create_table(
        "chunks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "normalized_document_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("rag.normalized_documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("space_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.CHAR(64), nullable=False),
        sa.Column("token_count", sa.Integer()),
        sa.Column("parent_chunk_id", postgresql.UUID(as_uuid=True)),
        sa.Column("previous_chunk_id", postgresql.UUID(as_uuid=True)),
        sa.Column("next_chunk_id", postgresql.UUID(as_uuid=True)),
        sa.Column(
            "location", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column(
            "acl_snapshot",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("version_id", "chunk_index", name="uq_version_chunk_index"),
        schema="rag",
    )
    op.create_index("ix_chunks_space_version", "chunks", ["space_id", "version_id"], schema="rag")

    op.create_table(
        "worker_outbox",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("event_type", sa.String(160), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("resource_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("resource_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("trace_id", sa.String(120), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="PENDING"),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "next_attempt_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("published_at", sa.DateTime(timezone=True)),
        sa.Column("error_code", sa.String(120)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        schema="rag",
    )
    op.create_index(
        "ix_worker_outbox_status_next_attempt",
        "worker_outbox",
        ["status", "next_attempt_at"],
        schema="rag",
    )

    op.create_table(
        "processed_events",
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("consumer", sa.String(120), nullable=False),
        sa.Column(
            "processed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("event_id", "consumer"),
        schema="rag",
    )


def downgrade() -> None:
    op.drop_table("processed_events", schema="rag")
    op.drop_index("ix_worker_outbox_status_next_attempt", table_name="worker_outbox", schema="rag")
    op.drop_table("worker_outbox", schema="rag")
    op.drop_index("ix_chunks_space_version", table_name="chunks", schema="rag")
    op.drop_table("chunks", schema="rag")
    op.drop_table("normalized_elements", schema="rag")
    op.drop_table("normalized_documents", schema="rag")
    op.drop_index("ix_ingestion_runs_status_updated_at", table_name="ingestion_runs", schema="rag")
    op.drop_table("ingestion_runs", schema="rag")

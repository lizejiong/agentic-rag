"""Add retrieval indexes: chunk embeddings and searchability flags.

Revision ID: 20260725_04
Revises: 20260722_03
Create Date: 2026-07-25
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260725_04"
down_revision: str | None = "20260722_03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Use raw SQL so the migration does not depend on pgvector's SQLAlchemy type at import time.
    op.execute(
        """
        CREATE TABLE rag.chunk_embeddings (
            id UUID PRIMARY KEY,
            chunk_id UUID NOT NULL REFERENCES rag.chunks(id) ON DELETE CASCADE,
            embedding_model VARCHAR(120) NOT NULL,
            embedding_version VARCHAR(40) NOT NULL,
            dimensions SMALLINT NOT NULL,
            embedding vector(384) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (chunk_id, embedding_model, embedding_version)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX ix_chunk_embeddings_chunk
        ON rag.chunk_embeddings (chunk_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_chunk_embeddings_vector_hnsw
        ON rag.chunk_embeddings
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
        """
    )

    op.add_column(
        "chunks",
        sa.Column(
            "is_searchable",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        schema="rag",
    )
    op.add_column(
        "chunks",
        sa.Column(
            "indexed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        schema="rag",
    )
    op.create_index(
        "ix_chunks_space_searchable",
        "chunks",
        ["space_id", "is_searchable"],
        schema="rag",
    )


def downgrade() -> None:
    op.drop_index("ix_chunks_space_searchable", table_name="chunks", schema="rag")
    op.drop_column("chunks", "indexed_at", schema="rag")
    op.drop_column("chunks", "is_searchable", schema="rag")
    op.execute("DROP INDEX IF EXISTS rag.ix_chunk_embeddings_vector_hnsw")
    op.drop_index("ix_chunk_embeddings_chunk", table_name="chunk_embeddings", schema="rag")
    op.drop_table("chunk_embeddings", schema="rag")

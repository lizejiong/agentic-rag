"""Allow chunk embeddings with configurable dimensions.

Revision ID: 20260726_05
Revises: 20260725_04
Create Date: 2026-07-26
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260726_05"
down_revision: str | None = "20260725_04"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS rag.ix_chunk_embeddings_vector_hnsw")
    op.execute(
        "ALTER TABLE rag.chunk_embeddings "
        "ALTER COLUMN embedding TYPE vector USING embedding::vector"
    )


def downgrade() -> None:
    op.execute("DELETE FROM rag.chunk_embeddings")
    op.execute(
        "ALTER TABLE rag.chunk_embeddings "
        "ALTER COLUMN embedding TYPE vector(384) USING embedding::vector(384)"
    )
    op.execute(
        """
        CREATE INDEX ix_chunk_embeddings_vector_hnsw
        ON rag.chunk_embeddings
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
        """
    )

"""Resize chunk_embeddings vector from 384 to 1024 for BGE-M3.

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
    op.execute("ALTER TABLE rag.chunk_embeddings ALTER COLUMN embedding TYPE vector(1024)")


def downgrade() -> None:
    op.execute("ALTER TABLE rag.chunk_embeddings ALTER COLUMN embedding TYPE vector(384)")

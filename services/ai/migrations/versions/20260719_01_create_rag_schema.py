"""Create the Python-owned RAG schema boundary.

Revision ID: 20260719_01
Revises:
Create Date: 2026-07-19
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260719_01"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS rag")
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")


def downgrade() -> None:
    # The schema and extension are shared infrastructure prerequisites. Removing either
    # during a downgrade could destroy indexed documents or break the app schema.
    pass

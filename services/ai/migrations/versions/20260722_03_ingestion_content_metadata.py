"""Add normalized element metadata and chunk element references.

Revision ID: 20260722_03
Revises: 20260721_02
Create Date: 2026-07-22
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260722_03"
down_revision: str | None = "20260721_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "normalized_elements",
        sa.Column(
            "metadata",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        schema="rag",
    )
    op.add_column(
        "chunks",
        sa.Column(
            "element_ids",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        schema="rag",
    )


def downgrade() -> None:
    op.drop_column("chunks", "element_ids", schema="rag")
    op.drop_column("normalized_elements", "metadata", schema="rag")

"""Add graph-governance control plane.

Revision ID: 20260808_07
Revises: 20260726_06
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260808_07"
down_revision: str | None = "20260726_06"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE rag.graph_extraction_runs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          document_id UUID NOT NULL,
          version_id UUID NOT NULL UNIQUE,
          space_id UUID NOT NULL,
          status VARCHAR(24) NOT NULL,
          extraction_version VARCHAR(80) NOT NULL,
          error_code VARCHAR(120),
          error_message TEXT,
          started_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX ix_graph_extraction_runs_space_status
          ON rag.graph_extraction_runs (space_id, status);

        CREATE TABLE rag.graph_entities (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          space_id UUID NOT NULL,
          canonical_name VARCHAR(240) NOT NULL,
          entity_type VARCHAR(80) NOT NULL,
          status VARCHAR(24) NOT NULL,
          origin VARCHAR(16) NOT NULL,
          confidence REAL,
          revision INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (space_id, canonical_name, entity_type)
        );
        CREATE INDEX ix_graph_entities_space_status_name
          ON rag.graph_entities (space_id, status, canonical_name);

        CREATE TABLE rag.graph_relations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          space_id UUID NOT NULL,
          subject_entity_id UUID NOT NULL REFERENCES rag.graph_entities(id),
          predicate VARCHAR(120) NOT NULL,
          object_entity_id UUID NOT NULL REFERENCES rag.graph_entities(id),
          status VARCHAR(24) NOT NULL,
          origin VARCHAR(16) NOT NULL,
          confidence REAL,
          extraction_version VARCHAR(80) NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT graph_relation_distinct_entities CHECK (subject_entity_id <> object_entity_id),
          UNIQUE (space_id, subject_entity_id, predicate, object_entity_id)
        );
        CREATE INDEX ix_graph_relations_space_status ON rag.graph_relations (space_id, status);

        CREATE TABLE rag.graph_evidence (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          relation_id UUID NOT NULL REFERENCES rag.graph_relations(id) ON DELETE CASCADE,
          chunk_id UUID NOT NULL REFERENCES rag.chunks(id) ON DELETE CASCADE,
          document_id UUID NOT NULL,
          version_id UUID NOT NULL,
          quote TEXT NOT NULL,
          location JSONB NOT NULL,
          confidence REAL,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (relation_id, chunk_id)
        );
        CREATE INDEX ix_graph_evidence_version_active
          ON rag.graph_evidence (version_id, active);

        CREATE TABLE rag.graph_revisions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          space_id UUID NOT NULL,
          relation_id UUID NOT NULL REFERENCES rag.graph_relations(id) ON DELETE CASCADE,
          revision INTEGER NOT NULL,
          action VARCHAR(32) NOT NULL,
          actor_id UUID,
          snapshot JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (relation_id, revision)
        );
    """)


def downgrade() -> None:
    op.execute("DROP TABLE rag.graph_revisions")
    op.execute("DROP TABLE rag.graph_evidence")
    op.execute("DROP TABLE rag.graph_relations")
    op.execute("DROP TABLE rag.graph_entities")
    op.execute("DROP TABLE rag.graph_extraction_runs")

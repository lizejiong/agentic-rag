import { z } from 'zod';

import type { Fetcher } from '../../shared/api/request-json';
import { requestJson } from '../../shared/api/request-json';

const evidenceSchema = z.object({ chunkId: z.uuid(), documentId: z.uuid(), versionId: z.uuid(), title: z.string(), quote: z.string(), location: z.record(z.string(), z.unknown()) });
export const graphRelationSchema = z.object({ id: z.uuid(), spaceId: z.uuid(), subjectEntityId: z.uuid(), subject: z.string(), subjectType: z.string(), predicate: z.string(), objectEntityId: z.uuid(), object: z.string(), objectType: z.string(), status: z.enum(['PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'STALE']), confidence: z.number().nullable(), evidence: z.array(evidenceSchema) });
export type GraphRelation = z.infer<typeof graphRelationSchema>;

export function listGraphRelations(fetcher: Fetcher, spaceId: string, status: string, query = '') {
  return requestJson({ schema: z.object({ relations: z.array(graphRelationSchema) }), input: `/api/spaces/${spaceId}/graph/relations?status=${encodeURIComponent(status)}&q=${encodeURIComponent(query)}`, fetcher });
}

export function publishGraphRelation(fetcher: Fetcher, spaceId: string, relationId: string) {
  return requestJson({ schema: graphRelationSchema, input: `/api/spaces/${spaceId}/graph/relations/${relationId}/publish`, fetcher, init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' } });
}

export async function rejectGraphRelation(fetcher: Fetcher, spaceId: string, relationId: string) {
  const response = await fetcher(`/api/spaces/${spaceId}/graph/relations/${relationId}/reject`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (!response.ok) throw new Error(`GRAPH_REJECT_${response.status}`);
}

async function manageGraphRequest(fetcher: Fetcher, input: string, body: Record<string, unknown>) {
  const response = await fetcher(input, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`GRAPH_MANAGE_${response.status}`);
  return response.status === 204 ? undefined : response.json();
}

export function correctGraphRelation(fetcher: Fetcher, spaceId: string, relationId: string, predicate: string) {
  return manageGraphRequest(fetcher, `/api/spaces/${spaceId}/graph/relations/${relationId}/correct`, { predicate });
}

export function rollbackGraphRelation(fetcher: Fetcher, spaceId: string, relationId: string) {
  return manageGraphRequest(fetcher, `/api/spaces/${spaceId}/graph/relations/${relationId}/rollback`, {});
}

export function mergeGraphEntities(fetcher: Fetcher, spaceId: string, sourceId: string, targetEntityId: string) {
  return manageGraphRequest(fetcher, `/api/spaces/${spaceId}/graph/entities/${sourceId}/merge`, { targetEntityId });
}

export function splitGraphEntity(fetcher: Fetcher, spaceId: string, sourceId: string, entity: { name: string; entityType: string; relationIds: string[] }) {
  return manageGraphRequest(fetcher, `/api/spaces/${spaceId}/graph/entities/${sourceId}/split`, { entities: [entity] });
}

export function findGraphPaths(fetcher: Fetcher, spaceId: string, sourceId: string, targetId: string) {
  return requestJson({ schema: z.object({ paths: z.array(z.array(graphRelationSchema)) }), input: `/api/spaces/${spaceId}/graph/paths`, fetcher, init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceId, targetId, maxHops: 3 }) } });
}

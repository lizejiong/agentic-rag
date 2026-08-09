import { BadGatewayException, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/auth.types';
import { AuthorizationService } from '../authorization/authorization.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { SpacePolicy } from '../spaces/space-policy';

type GraphResponse = { relations: Array<Record<string, unknown>> };

@Injectable()
export class GraphService {
  private readonly aiServiceUrl = process.env.AI_SERVICE_URL ?? 'http://127.0.0.1:8001';

  constructor(
    private readonly spaces: SpacePolicy,
    private readonly authorization: AuthorizationService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthenticatedUser, spaceId: string, input: { status?: string; query?: string }) {
    await this.spaces.require(user, spaceId, 'VIEW');
    return this.request<GraphResponse>(`/v1/graph/spaces/${spaceId}/relations:query`, user, {
      ...input,
      limit: 50,
    });
  }

  async paths(
    user: AuthenticatedUser,
    spaceId: string,
    input: { sourceId: string; targetId: string; maxHops: number },
  ) {
    await this.spaces.require(user, spaceId, 'VIEW');
    return this.request<{ paths: Array<Array<Record<string, unknown>>> }>(
      `/v1/graph/spaces/${spaceId}/paths:query`,
      user,
      input,
    );
  }

  async publish(user: AuthenticatedUser, spaceId: string, relationId: string) {
    await this.spaces.require(user, spaceId, 'MANAGE');
    const relation = await this.request<Record<string, unknown>>(
      `/v1/graph/relations/${relationId}:publish`,
      user,
      { manage: true, spaceId },
    );
    if (relation.spaceId !== spaceId) {
      throw new BadGatewayException('GRAPH_RELATION_SPACE_MISMATCH');
    }
    await this.prisma.$transaction((transaction) =>
      this.audit.write(transaction, {
        action: 'graph.relation.publish',
        targetType: 'GRAPH_RELATION',
        targetId: relationId,
        metadata: { spaceId },
      }),
    );
    return relation;
  }

  async reject(user: AuthenticatedUser, spaceId: string, relationId: string): Promise<void> {
    await this.spaces.require(user, spaceId, 'MANAGE');
    await this.request<void>(`/v1/graph/relations/${relationId}:reject`, user, {
      manage: true,
      spaceId,
    });
    await this.prisma.$transaction((transaction) =>
      this.audit.write(transaction, {
        action: 'graph.relation.reject',
        targetType: 'GRAPH_RELATION',
        targetId: relationId,
        metadata: { spaceId },
      }),
    );
  }

  async mutate(
    user: AuthenticatedUser,
    spaceId: string,
    path: string,
    action: string,
    targetId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    await this.spaces.require(user, spaceId, 'MANAGE');
    const result = await this.request<unknown>(path, user, { ...input, manage: true, spaceId });
    await this.prisma.$transaction((transaction) =>
      this.audit.write(transaction, {
        action,
        targetType: action.includes('entity') ? 'GRAPH_ENTITY' : 'GRAPH_RELATION',
        targetId,
        metadata: { spaceId },
      }),
    );
    return result;
  }

  private async request<T>(
    path: string,
    user: AuthenticatedUser,
    body: Record<string, unknown>,
  ): Promise<T> {
    const snapshot = await this.authorization.snapshot(user);
    const response = await fetch(`${this.aiServiceUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...body,
        actorId: user.id,
        aclSnapshot: {
          userId: snapshot.userId,
          admin: snapshot.admin,
          departmentId: snapshot.departmentId,
          groupIds: snapshot.groupIds,
          spaces: snapshot.spaces,
        },
      }),
    });
    if (!response.ok) throw new BadGatewayException(`GRAPH_SERVICE_${response.status}`);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

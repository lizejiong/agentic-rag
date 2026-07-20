import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  EgressPolicy,
  SpacePermission,
  SpaceStatus,
  SubjectType,
} from '../generated/prisma/enums';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { SpacePolicy } from './space-policy';

export type SpaceSettingsInput = {
  name?: string | undefined;
  description?: string | null | undefined;
  tags?: string[] | undefined;
  defaultLanguage?: string | undefined;
  egressPolicy?: EgressPolicy | undefined;
  llmEnabled?: boolean | undefined;
  embeddingEnabled?: boolean | undefined;
  rerankerEnabled?: boolean | undefined;
  asrEnabled?: boolean | undefined;
  ttsEnabled?: boolean | undefined;
  graphExtractionEnabled?: boolean | undefined;
};

@Injectable()
export class SpacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: SpacePolicy,
  ) {}

  list(user: AuthenticatedUser) {
    return this.policy.listVisible(user);
  }

  async get(user: AuthenticatedUser, id: string) {
    const effectivePermission = await this.policy.require(user, id, 'VIEW');
    const space = await this.prisma.knowledgeSpace.findUnique({
      where: { id },
      include: {
        ...(effectivePermission === 'MANAGE'
          ? {
              grants: {
                orderBy: [{ subjectType: 'asc' as const }, { createdAt: 'asc' as const }],
              },
            }
          : {}),
      },
    });
    if (!space) {
      throw new NotFoundException('SPACE_NOT_FOUND');
    }
    return { ...space, effectivePermission };
  }

  create(user: AuthenticatedUser, input: SpaceSettingsInput & { name: string }) {
    return this.prisma.knowledgeSpace.create({
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        tags: input.tags ?? [],
        defaultLanguage: input.defaultLanguage ?? 'zh-CN',
        egressPolicy: input.egressPolicy ?? 'LOCAL_ONLY',
        llmEnabled: input.graphExtractionEnabled ? true : (input.llmEnabled ?? true),
        embeddingEnabled: input.embeddingEnabled ?? true,
        rerankerEnabled: input.rerankerEnabled ?? true,
        asrEnabled: input.asrEnabled ?? true,
        ttsEnabled: input.ttsEnabled ?? true,
        graphExtractionEnabled: input.graphExtractionEnabled ?? false,
        createdById: user.id,
      },
    });
  }

  async update(user: AuthenticatedUser, id: string, input: SpaceSettingsInput) {
    await this.policy.require(user, id, 'EDIT');
    const current = await this.prisma.knowledgeSpace.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException('SPACE_NOT_FOUND');
    }
    const graphExtractionEnabled = input.graphExtractionEnabled ?? current.graphExtractionEnabled;
    const llmEnabled = graphExtractionEnabled ? true : (input.llmEnabled ?? current.llmEnabled);

    return this.prisma.knowledgeSpace.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...('description' in input ? { description: input.description?.trim() || null } : {}),
        ...(input.tags !== undefined ? { tags: [...new Set(input.tags)] } : {}),
        ...(input.defaultLanguage !== undefined ? { defaultLanguage: input.defaultLanguage } : {}),
        ...(input.egressPolicy !== undefined ? { egressPolicy: input.egressPolicy } : {}),
        ...(input.embeddingEnabled !== undefined
          ? { embeddingEnabled: input.embeddingEnabled }
          : {}),
        ...(input.rerankerEnabled !== undefined ? { rerankerEnabled: input.rerankerEnabled } : {}),
        ...(input.asrEnabled !== undefined ? { asrEnabled: input.asrEnabled } : {}),
        ...(input.ttsEnabled !== undefined ? { ttsEnabled: input.ttsEnabled } : {}),
        graphExtractionEnabled,
        llmEnabled,
      },
    });
  }

  async setStatus(user: AuthenticatedUser, id: string, status: SpaceStatus) {
    await this.policy.require(user, id, 'MANAGE');
    return this.prisma.knowledgeSpace.update({ where: { id }, data: { status } });
  }

  async upsertGrant(
    user: AuthenticatedUser,
    spaceId: string,
    input: {
      subjectType: SubjectType;
      subjectId: string;
      permission: SpacePermission;
      expiresAt?: Date | null | undefined;
    },
  ) {
    await this.policy.require(user, spaceId, 'MANAGE');
    await this.assertSubjectExists(input.subjectType, input.subjectId);
    return this.prisma.spaceGrant.upsert({
      where: {
        spaceId_subjectType_subjectId: {
          spaceId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
        },
      },
      create: {
        spaceId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        permission: input.permission,
        ...('expiresAt' in input ? { expiresAt: input.expiresAt ?? null } : {}),
      },
      update: {
        permission: input.permission,
        ...('expiresAt' in input ? { expiresAt: input.expiresAt ?? null } : {}),
      },
    });
  }

  async deleteGrant(user: AuthenticatedUser, spaceId: string, grantId: string): Promise<void> {
    await this.policy.require(user, spaceId, 'MANAGE');
    const result = await this.prisma.spaceGrant.deleteMany({
      where: { id: grantId, spaceId },
    });
    if (result.count === 0) {
      throw new NotFoundException('SPACE_GRANT_NOT_FOUND');
    }
  }

  private async assertSubjectExists(type: SubjectType, id: string): Promise<void> {
    const exists =
      type === 'USER'
        ? await this.prisma.user.count({ where: { id } })
        : type === 'DEPARTMENT'
          ? await this.prisma.department.count({ where: { id } })
          : await this.prisma.userGroup.count({ where: { id } });
    if (exists === 0) {
      throw new BadRequestException('SPACE_GRANT_SUBJECT_NOT_FOUND');
    }
  }
}

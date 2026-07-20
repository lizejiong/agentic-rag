import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { AuthorizationRevisionService } from '../authorization/authorization-revision.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/database/prisma.service';

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revision: AuthorizationRevisionService,
  ) {}

  listDepartments() {
    return this.prisma.department.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: true } } },
    });
  }

  createDepartment(input: { name: string; description?: string | undefined }) {
    return this.withUniqueNameConflict(
      this.revision.mutate(
        (transaction) =>
          transaction.department.create({
            data: {
              name: input.name.trim(),
              description: input.description?.trim() || null,
            },
          }),
        {
          action: 'department.create',
          targetType: 'DEPARTMENT',
          targetId: (department) => department.id,
          eventType: 'organization.department.created',
          resourceId: (department) => department.id,
          payload: (department) => ({ name: department.name }),
        },
      ),
    );
  }

  async updateDepartment(
    id: string,
    input: {
      name?: string | undefined;
      description?: string | null | undefined;
    },
  ) {
    try {
      return await this.revision.mutate(
        (transaction) =>
          transaction.department.update({
            where: { id },
            data: {
              ...(input.name ? { name: input.name.trim() } : {}),
              ...('description' in input ? { description: input.description?.trim() || null } : {}),
            },
          }),
        {
          action: 'department.update',
          targetType: 'DEPARTMENT',
          targetId: id,
          eventType: 'organization.department.updated',
          resourceId: id,
          payload: { changedFields: Object.keys(input) },
        },
      );
    } catch (error) {
      this.rethrowMutationError(error);
    }
  }

  async deleteDepartment(id: string): Promise<void> {
    try {
      await this.revision.mutate(
        async (transaction) => {
          const [users, grants] = await Promise.all([
            transaction.user.count({ where: { departmentId: id } }),
            transaction.spaceGrant.count({
              where: { subjectType: 'DEPARTMENT', subjectId: id },
            }),
          ]);
          if (users > 0 || grants > 0) {
            throw new ConflictException({
              code: 'DEPARTMENT_IN_USE',
              associations: { users, spaceGrants: grants },
            });
          }
          await transaction.department.delete({ where: { id } });
        },
        {
          action: 'department.delete',
          targetType: 'DEPARTMENT',
          targetId: id,
          eventType: 'organization.department.deleted',
          resourceId: id,
        },
      );
    } catch (error) {
      this.rethrowMutationError(error);
    }
  }

  async assignDepartment(departmentId: string, userId: string): Promise<void> {
    const [department, user] = await Promise.all([
      this.prisma.department.findUnique({ where: { id: departmentId }, select: { id: true } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
    ]);
    if (!department || !user) {
      throw new NotFoundException('DEPARTMENT_OR_USER_NOT_FOUND');
    }
    await this.revision.mutate(
      (transaction) => transaction.user.update({ where: { id: userId }, data: { departmentId } }),
      {
        action: 'department.member.assign',
        targetType: 'USER',
        targetId: userId,
        eventType: 'organization.membership.changed',
        resourceId: userId,
        payload: { departmentId },
      },
    );
  }

  async removeDepartmentMember(departmentId: string, userId: string): Promise<void> {
    await this.revision.mutate(
      async (transaction) => {
        const result = await transaction.user.updateMany({
          where: { id: userId, departmentId },
          data: { departmentId: null },
        });
        if (result.count === 0) {
          throw new NotFoundException('DEPARTMENT_MEMBERSHIP_NOT_FOUND');
        }
      },
      {
        action: 'department.member.remove',
        targetType: 'USER',
        targetId: userId,
        eventType: 'organization.membership.changed',
        resourceId: userId,
        payload: { departmentId: null, previousDepartmentId: departmentId },
      },
    );
  }

  listGroups() {
    return this.prisma.userGroup.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { members: true } } },
    });
  }

  createGroup(input: { name: string; description?: string | undefined }) {
    return this.withUniqueNameConflict(
      this.revision.mutate(
        (transaction) =>
          transaction.userGroup.create({
            data: {
              name: input.name.trim(),
              description: input.description?.trim() || null,
            },
          }),
        {
          action: 'group.create',
          targetType: 'GROUP',
          targetId: (group) => group.id,
          eventType: 'organization.group.created',
          resourceId: (group) => group.id,
          payload: (group) => ({ name: group.name }),
        },
      ),
    );
  }

  async updateGroup(
    id: string,
    input: {
      name?: string | undefined;
      description?: string | null | undefined;
    },
  ) {
    try {
      return await this.revision.mutate(
        (transaction) =>
          transaction.userGroup.update({
            where: { id },
            data: {
              ...(input.name ? { name: input.name.trim() } : {}),
              ...('description' in input ? { description: input.description?.trim() || null } : {}),
            },
          }),
        {
          action: 'group.update',
          targetType: 'GROUP',
          targetId: id,
          eventType: 'organization.group.updated',
          resourceId: id,
          payload: { changedFields: Object.keys(input) },
        },
      );
    } catch (error) {
      this.rethrowMutationError(error);
    }
  }

  async deleteGroup(id: string): Promise<void> {
    try {
      await this.revision.mutate(
        async (transaction) => {
          const [members, grants] = await Promise.all([
            transaction.groupMember.count({ where: { groupId: id } }),
            transaction.spaceGrant.count({ where: { subjectType: 'GROUP', subjectId: id } }),
          ]);
          if (members > 0 || grants > 0) {
            throw new ConflictException({
              code: 'GROUP_IN_USE',
              associations: { members, spaceGrants: grants },
            });
          }
          await transaction.userGroup.delete({ where: { id } });
        },
        {
          action: 'group.delete',
          targetType: 'GROUP',
          targetId: id,
          eventType: 'organization.group.deleted',
          resourceId: id,
        },
      );
    } catch (error) {
      this.rethrowMutationError(error);
    }
  }

  async addGroupMember(groupId: string, userId: string): Promise<void> {
    const [group, user] = await Promise.all([
      this.prisma.userGroup.findUnique({ where: { id: groupId }, select: { id: true } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
    ]);
    if (!group || !user) {
      throw new NotFoundException('GROUP_OR_USER_NOT_FOUND');
    }
    await this.revision.mutate(
      (transaction) =>
        transaction.groupMember.upsert({
          where: { groupId_userId: { groupId, userId } },
          create: { groupId, userId },
          update: {},
        }),
      {
        action: 'group.member.add',
        targetType: 'USER',
        targetId: userId,
        eventType: 'organization.membership.changed',
        resourceId: userId,
        payload: { groupId, member: true },
      },
    );
  }

  async removeGroupMember(groupId: string, userId: string): Promise<void> {
    await this.revision.mutate(
      async (transaction) => {
        const result = await transaction.groupMember.deleteMany({
          where: { groupId, userId },
        });
        if (result.count === 0) {
          throw new NotFoundException('GROUP_MEMBERSHIP_NOT_FOUND');
        }
      },
      {
        action: 'group.member.remove',
        targetType: 'USER',
        targetId: userId,
        eventType: 'organization.membership.changed',
        resourceId: userId,
        payload: { groupId, member: false },
      },
    );
  }

  private async withUniqueNameConflict<T>(operation: Promise<T>): Promise<T> {
    try {
      return await operation;
    } catch (error) {
      this.rethrowMutationError(error);
    }
  }

  private rethrowMutationError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException('ORGANIZATION_NAME_ALREADY_EXISTS');
      }
      if (error.code === 'P2025') {
        throw new NotFoundException('ORGANIZATION_RESOURCE_NOT_FOUND');
      }
    }
    throw error;
  }
}

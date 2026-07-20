import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/database/prisma.service';

@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService) {}

  listDepartments() {
    return this.prisma.department.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: true } } },
    });
  }

  createDepartment(input: { name: string; description?: string | undefined }) {
    return this.withUniqueNameConflict(
      this.prisma.department.create({
        data: {
          name: input.name.trim(),
          description: input.description?.trim() || null,
        },
      }),
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
      return await this.prisma.department.update({
        where: { id },
        data: {
          ...(input.name ? { name: input.name.trim() } : {}),
          ...('description' in input ? { description: input.description?.trim() || null } : {}),
        },
      });
    } catch (error) {
      this.rethrowMutationError(error);
    }
  }

  async deleteDepartment(id: string): Promise<void> {
    const [users, grants] = await Promise.all([
      this.prisma.user.count({ where: { departmentId: id } }),
      this.prisma.spaceGrant.count({ where: { subjectType: 'DEPARTMENT', subjectId: id } }),
    ]);
    if (users > 0 || grants > 0) {
      throw new ConflictException({
        code: 'DEPARTMENT_IN_USE',
        associations: { users, spaceGrants: grants },
      });
    }
    try {
      await this.prisma.department.delete({ where: { id } });
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
    await this.prisma.user.update({ where: { id: userId }, data: { departmentId } });
  }

  async removeDepartmentMember(departmentId: string, userId: string): Promise<void> {
    const result = await this.prisma.user.updateMany({
      where: { id: userId, departmentId },
      data: { departmentId: null },
    });
    if (result.count === 0) {
      throw new NotFoundException('DEPARTMENT_MEMBERSHIP_NOT_FOUND');
    }
  }

  listGroups() {
    return this.prisma.userGroup.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { members: true } } },
    });
  }

  createGroup(input: { name: string; description?: string | undefined }) {
    return this.withUniqueNameConflict(
      this.prisma.userGroup.create({
        data: {
          name: input.name.trim(),
          description: input.description?.trim() || null,
        },
      }),
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
      return await this.prisma.userGroup.update({
        where: { id },
        data: {
          ...(input.name ? { name: input.name.trim() } : {}),
          ...('description' in input ? { description: input.description?.trim() || null } : {}),
        },
      });
    } catch (error) {
      this.rethrowMutationError(error);
    }
  }

  async deleteGroup(id: string): Promise<void> {
    const [members, grants] = await Promise.all([
      this.prisma.groupMember.count({ where: { groupId: id } }),
      this.prisma.spaceGrant.count({ where: { subjectType: 'GROUP', subjectId: id } }),
    ]);
    if (members > 0 || grants > 0) {
      throw new ConflictException({
        code: 'GROUP_IN_USE',
        associations: { members, spaceGrants: grants },
      });
    }
    try {
      await this.prisma.userGroup.delete({ where: { id } });
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
    await this.prisma.groupMember.upsert({
      where: { groupId_userId: { groupId, userId } },
      create: { groupId, userId },
      update: {},
    });
  }

  async removeGroupMember(groupId: string, userId: string): Promise<void> {
    const result = await this.prisma.groupMember.deleteMany({ where: { groupId, userId } });
    if (result.count === 0) {
      throw new NotFoundException('GROUP_MEMBERSHIP_NOT_FOUND');
    }
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

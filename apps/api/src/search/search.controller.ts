import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/current-user.decorator';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AuthorizationService } from '../authorization/authorization.service';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { z } from 'zod';

const searchRequestSchema = z.object({
  spaceIds: z.array(z.string().uuid()).max(20).min(1),
  query: z.string().trim().min(1).max(8000),
});

type SearchRequest = z.infer<typeof searchRequestSchema>;

@Controller('search')
@UseGuards(AccessTokenGuard)
export class SearchController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  @Post()
  async search(@Body() body: SearchRequest, @Req() req: AuthenticatedRequest) {
    const parsed = searchRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('INVALID_SEARCH_REQUEST');
    }
    const user = req.user;
    await Promise.all(
      parsed.data.spaceIds.map((spaceId) => this.authorization.requireSpace(user, spaceId, 'VIEW')),
    );
    const snapshot = await this.authorization.snapshot(user);

    // PostgreSQL-only keyword search across active documents in authorized spaces.
    // Full hybrid retrieval is delegated to the chat Agent; this endpoint provides
    // fast authorized document lookup for the UI search page.
    const documents = await this.prisma.document.findMany({
      where: {
        spaceId: { in: parsed.data.spaceIds },
        availability: 'ACTIVE',
        space: { status: 'ACTIVE' },
        activeVersionId: { not: null },
      },
      select: {
        id: true,
        spaceId: true,
        title: true,
        sourceType: true,
        activeVersion: {
          select: {
            id: true,
            originalFileName: true,
            detectedMimeType: true,
          },
        },
        aclEntries: { select: { subjectType: true, subjectId: true } },
      },
    });

    const authorized = documents.filter((document) => {
      if (snapshot.admin) return true;
      if (document.aclEntries.length === 0) return true;
      return document.aclEntries.some((entry) => this._matchesSubject(entry, snapshot));
    });

    const lowerQuery = parsed.data.query.toLowerCase();
    const scored = authorized
      .map((document) => ({
        documentId: document.id,
        spaceId: document.spaceId,
        title: document.title,
        fileName: document.activeVersion?.originalFileName,
        mimeType: document.activeVersion?.detectedMimeType,
        versionId: document.activeVersion?.id,
      }))
      .filter(
        (item) =>
          item.title.toLowerCase().includes(lowerQuery) ||
          (item.fileName?.toLowerCase().includes(lowerQuery) ?? false),
      );

    return {
      query: parsed.data.query,
      total: scored.length,
      results: scored.slice(0, 50),
    };
  }

  private _matchesSubject(
    entry: { subjectType: string; subjectId: string },
    snapshot: { userId: string; departmentId?: string; groupIds: string[] },
  ): boolean {
    if (entry.subjectType === 'USER') return entry.subjectId === snapshot.userId;
    if (entry.subjectType === 'DEPARTMENT') return entry.subjectId === snapshot.departmentId;
    return snapshot.groupIds.includes(entry.subjectId);
  }
}

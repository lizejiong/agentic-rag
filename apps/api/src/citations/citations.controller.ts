import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/current-user.decorator';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AuthorizationService } from '../authorization/authorization.service';
import { PrismaService } from '../infrastructure/database/prisma.service';

@Controller('citations')
@UseGuards(AccessTokenGuard)
export class CitationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  @Get(':citationId/resolve')
  async resolve(
    @Param('citationId', new ParseUUIDPipe()) citationId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    // Re-authorize using the latest ACL and document state. The citation id is
    // the chunk id persisted by the Python ingestion worker.
    const chunk = await this.prisma.$queryRaw<
      Array<{
        chunk_id: string;
        document_id: string;
        space_id: string;
        content: string;
        location: Record<string, unknown>;
        title: string;
      }>
    >`
      SELECT
        c.id AS chunk_id,
        c.document_id,
        c.space_id,
        c.content,
        c.location,
        nd.title
      FROM rag.chunks c
      JOIN rag.normalized_documents nd ON nd.id = c.normalized_document_id
      WHERE c.id = ${citationId}::uuid
      LIMIT 1
    `;

    if (!chunk || chunk.length === 0) {
      throw new NotFoundException('CITATION_NOT_FOUND');
    }

    const row = chunk[0]!;
    await this.authorization.authorizeDocument(req.user, {
      documentId: row.document_id,
      operation: 'CITATION',
    });

    return {
      citationId: row.chunk_id,
      documentId: row.document_id,
      spaceId: row.space_id,
      title: row.title,
      snippet: row.content,
      location: {
        page: row.location?.page ?? null,
        slide: row.location?.slide ?? null,
        sheet: row.location?.sheet ?? null,
        cellRange: row.location?.cellRange ?? null,
      },
      expiresAt: new Date(Date.now() + 5_000).toISOString(),
    };
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthorizationService } from '../authorization/authorization.service';
import { EvaluationService, type EvaluationOutput } from './evaluation.service';

const datasetIdSchema = z.uuid();
const createDatasetSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000).optional(),
  spaceId: z.uuid(),
});
const importCasesSchema = z.object({ content: z.string().min(1).max(1_000_000) });
const runSchema = z.object({ mode: z.enum(['retrieval', 'full']).default('full') });

@Controller('evaluations')
@UseGuards(AccessTokenGuard, AdminGuard)
export class EvaluationController {
  private readonly aiServiceUrl = process.env.AI_SERVICE_URL ?? 'http://127.0.0.1:8001';

  constructor(
    private readonly authorization: AuthorizationService,
    private readonly evaluations: EvaluationService,
  ) {}

  @Get('datasets')
  async listDatasets(@CurrentUser() user: AuthenticatedUser) {
    return { datasets: await this.evaluations.listDatasets(user) };
  }

  @Post('datasets')
  async createDataset(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    return this.evaluations.createDataset(user, createDatasetSchema.parse(input));
  }

  @Get('datasets/:datasetId')
  async getDataset(@CurrentUser() user: AuthenticatedUser, @Param('datasetId') datasetId: string) {
    return this.evaluations.getDataset(user, datasetIdSchema.parse(datasetId));
  }

  @Post('datasets/:datasetId/cases:import')
  async importCases(
    @CurrentUser() user: AuthenticatedUser,
    @Param('datasetId') datasetId: string,
    @Body() input: unknown,
  ) {
    return this.evaluations.replaceCasesFromJsonl(
      user,
      datasetIdSchema.parse(datasetId),
      importCasesSchema.parse(input).content,
    );
  }

  @Post('datasets/:datasetId/cases:preview')
  async previewCases(
    @CurrentUser() user: AuthenticatedUser,
    @Param('datasetId') datasetId: string,
    @Body() input: unknown,
  ) {
    return this.evaluations.previewCasesFromJsonl(
      user,
      datasetIdSchema.parse(datasetId),
      importCasesSchema.parse(input).content,
    );
  }

  @Delete('datasets/:datasetId')
  @HttpCode(204)
  async deleteDataset(
    @CurrentUser() user: AuthenticatedUser,
    @Param('datasetId') datasetId: string,
  ) {
    await this.evaluations.deleteDataset(user, datasetIdSchema.parse(datasetId));
  }

  @Post('datasets/:datasetId/runs')
  @HttpCode(202)
  async startRun(
    @CurrentUser() user: AuthenticatedUser,
    @Param('datasetId') datasetId: string,
    @Body() input: unknown,
  ) {
    const id = datasetIdSchema.parse(datasetId);
    const { mode } = runSchema.parse(input);
    const dataset = await this.evaluations.getDataset(user, id);
    const run = await this.evaluations.createRun(user, id, mode);
    const snapshot = await this.authorization.snapshot(user);
    void this.executeRun(run.id, mode, {
      selectedSpaceIds: [dataset.spaceId],
      aclSnapshot: {
        userId: snapshot.userId,
        admin: snapshot.admin,
        groupIds: snapshot.groupIds,
        departmentId: snapshot.departmentId,
        spaces: snapshot.spaces,
      },
      cases: dataset.cases.map((item) => ({
        id: item.id,
        question: item.question,
        expectedEvidence: item.expectedEvidence,
        referenceAnswer: item.referenceAnswer,
        expectedAnswerPoints: item.expectedAnswerPoints,
        expectNoAnswer: item.expectNoAnswer,
      })),
      mode,
    });
    return run;
  }

  private async executeRun(
    runId: string,
    mode: 'retrieval' | 'full',
    payload: Record<string, unknown>,
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), mode === 'full' ? 600_000 : 120_000);
    try {
      const response = await fetch(`${this.aiServiceUrl}/v1/retrieval/evaluate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) throw new HttpException('EVALUATION_SERVICE_UNAVAILABLE', 502);
      await this.evaluations.completeRun(runId, (await response.json()) as EvaluationOutput);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Evaluation run failed';
      await this.evaluations.failRun(
        runId,
        error instanceof DOMException && error.name === 'AbortError'
          ? 'EVALUATION_TIMEOUT'
          : message,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  @Get('datasets/:datasetId/runs')
  async listRuns(@CurrentUser() user: AuthenticatedUser, @Param('datasetId') datasetId: string) {
    return { runs: await this.evaluations.listRuns(user, datasetIdSchema.parse(datasetId)) };
  }

  @Get('runs/:runId')
  async getRun(@CurrentUser() user: AuthenticatedUser, @Param('runId') runId: string) {
    return this.evaluations.getRun(user, datasetIdSchema.parse(runId));
  }
}

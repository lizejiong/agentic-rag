import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';

import type { AuthenticatedUser } from '../auth/auth.types';
import type { Prisma } from '../generated/prisma/client';
import { SpacePolicy } from '../spaces/space-policy';
import { PrismaService } from '../infrastructure/database/prisma.service';

const evidenceSchema = z.object({
  document: z.string().min(1),
  anchor: z.string(),
  quote: z.string().min(1),
});
const caseSchema = z.object({
  id: z.string().min(1).optional(),
  question: z.string().min(1),
  expectedEvidence: z.array(evidenceSchema),
  referenceAnswer: z.string(),
  expectedAnswerPoints: z.array(z.string()),
  expectNoAnswer: z.boolean().optional(),
});

export type EvaluationCaseInput = z.infer<typeof caseSchema>;

@Injectable()
export class EvaluationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spacePolicy: SpacePolicy,
  ) {}

  async createDataset(
    user: AuthenticatedUser,
    input: { name: string; description?: string | undefined; spaceId: string },
  ) {
    await this.spacePolicy.require(user, input.spaceId, 'MANAGE');
    return this.prisma.evaluationDataset.create({
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        spaceId: input.spaceId,
        createdById: user.id,
      },
      include: { _count: { select: { cases: true, runs: true } } },
    });
  }

  async listDatasets(user: AuthenticatedUser) {
    const visible = await this.spacePolicy.listVisible(user);
    const manageableSpaceIds = new Set(
      visible.filter((space) => space.effectivePermission === 'MANAGE').map((space) => space.id),
    );
    const datasets = await this.prisma.evaluationDataset.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { cases: true, runs: true } } },
    });
    return datasets.filter((dataset) => manageableSpaceIds.has(dataset.spaceId));
  }

  async getDataset(user: AuthenticatedUser, datasetId: string) {
    const dataset = await this.prisma.evaluationDataset.findUnique({
      where: { id: datasetId },
      include: { cases: { orderBy: { position: 'asc' } }, _count: { select: { runs: true } } },
    });
    if (!dataset) throw new NotFoundException('EVALUATION_DATASET_NOT_FOUND');
    await this.spacePolicy.require(user, dataset.spaceId, 'MANAGE');
    return dataset;
  }

  async replaceCasesFromJsonl(user: AuthenticatedUser, datasetId: string, content: string) {
    const dataset = await this.getDataset(user, datasetId);
    await this.requireNoActiveRun(dataset.id);
    const cases = this.parseJsonl(content);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.evaluationCase.deleteMany({ where: { datasetId: dataset.id } });
      await transaction.evaluationCase.createMany({
        data: cases.map((item, index) => ({
          datasetId: dataset.id,
          position: index + 1,
          question: item.question,
          referenceAnswer: item.referenceAnswer,
          expectedEvidence: item.expectedEvidence,
          expectedAnswerPoints: item.expectedAnswerPoints,
          expectNoAnswer: item.expectNoAnswer ?? false,
        })),
      });
    });
    return this.getDataset(user, dataset.id);
  }

  async previewCasesFromJsonl(user: AuthenticatedUser, datasetId: string, content: string) {
    const dataset = await this.getDataset(user, datasetId);
    return {
      incomingCaseCount: this.parseJsonl(content).length,
      existingCaseCount: dataset.cases.length,
    };
  }

  async deleteDataset(user: AuthenticatedUser, datasetId: string) {
    const dataset = await this.getDataset(user, datasetId);
    await this.requireNoActiveRun(dataset.id);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.evaluationRun.deleteMany({ where: { datasetId: dataset.id } });
      await transaction.evaluationDataset.delete({ where: { id: dataset.id } });
    });
  }

  async createRun(user: AuthenticatedUser, datasetId: string, mode: 'retrieval' | 'full') {
    const dataset = await this.getDataset(user, datasetId);
    if (!dataset.cases.length) throw new BadRequestException('EVALUATION_CASES_REQUIRED');
    await this.requireNoActiveRun(dataset.id);
    return this.prisma.evaluationRun.create({
      data: {
        datasetId: dataset.id,
        spaceId: dataset.spaceId,
        createdById: user.id,
        mode: mode === 'full' ? 'FULL' : 'RETRIEVAL',
      },
    });
  }

  async completeRun(runId: string, output: EvaluationOutput) {
    return this.prisma.$transaction(async (transaction) => {
      const run = await transaction.evaluationRun.findUniqueOrThrow({
        where: { id: runId },
        include: { dataset: { include: { cases: { orderBy: { position: 'asc' } } } } },
      });
      const casesByQuestion = new Map(run.dataset.cases.map((item) => [item.question, item]));
      await transaction.evaluationRunResult.createMany({
        data: output.results.map((result, index) => {
          const sourceCase = casesByQuestion.get(result.question);
          return {
            runId,
            caseId: sourceCase?.id ?? null,
            position: sourceCase?.position ?? index + 1,
            question: result.question,
            effectiveQuery: result.effectiveQuery,
            expectNoAnswer: result.expectNoAnswer,
            stages: result.stages as Prisma.InputJsonValue,
            trace: result.trace as Prisma.InputJsonValue,
            referenceAnswer: sourceCase?.referenceAnswer ?? null,
            expectedEvidence: sourceCase?.expectedEvidence ?? [],
            expectedAnswerPoints: sourceCase?.expectedAnswerPoints ?? [],
            answer: result.answer,
            citations: result.citations as Prisma.InputJsonValue,
            answerPointCoverage: result.answerPointCoverage,
            citationEvidencePrecision: result.citationEvidencePrecision,
            refusalCorrect: result.refusalCorrect,
            error: result.error,
            elapsedMs: result.elapsedMs,
          };
        }),
      });
      return transaction.evaluationRun.update({
        where: { id: runId },
        data: {
          status: 'COMPLETED',
          summary: output.summary as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
        include: { results: { orderBy: { position: 'asc' } } },
      });
    });
  }

  async failRun(runId: string, error: string) {
    return this.prisma.evaluationRun.update({
      where: { id: runId },
      data: { status: 'FAILED', error, completedAt: new Date() },
    });
  }

  async listRuns(user: AuthenticatedUser, datasetId: string) {
    const dataset = await this.getDataset(user, datasetId);
    return this.prisma.evaluationRun.findMany({
      where: { datasetId: dataset.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  async getRun(user: AuthenticatedUser, runId: string) {
    const run = await this.prisma.evaluationRun.findUnique({
      where: { id: runId },
      include: { results: { orderBy: { position: 'asc' } } },
    });
    if (!run) throw new NotFoundException('EVALUATION_RUN_NOT_FOUND');
    await this.spacePolicy.require(user, run.spaceId, 'MANAGE');
    return run;
  }

  private parseJsonl(content: string): EvaluationCaseInput[] {
    const lines = content.split(/\r?\n/).filter((line) => line.trim());
    if (!lines.length) throw new BadRequestException('EVALUATION_CASES_REQUIRED');
    return lines.map((line, index) => {
      try {
        return caseSchema.parse(JSON.parse(line) as unknown);
      } catch (error) {
        throw new BadRequestException(
          `EVALUATION_CASE_INVALID_LINE_${index + 1}: ${error instanceof Error ? error.message : 'invalid JSONL'}`,
        );
      }
    });
  }

  private async requireNoActiveRun(datasetId: string) {
    const activeRun = await this.prisma.evaluationRun.findFirst({
      where: { datasetId, status: 'RUNNING' },
      select: { id: true },
    });
    if (activeRun) throw new ConflictException('EVALUATION_RUN_IN_PROGRESS');
  }
}

export type EvaluationOutput = {
  summary: Record<string, unknown>;
  results: Array<{
    question: string;
    effectiveQuery: string;
    expectNoAnswer: boolean;
    stages: Record<string, unknown>;
    trace: Record<string, unknown>;
    answer: string | null;
    citations: unknown;
    answerPointCoverage: number | null;
    citationEvidencePrecision: number | null;
    refusalCorrect: boolean | null;
    error: string | null;
    elapsedMs: number;
  }>;
};

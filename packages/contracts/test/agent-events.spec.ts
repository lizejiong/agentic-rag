import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { agentEventSchema, chatRequestSchema } from '../src/agent-events';

const runRequest = {
  requestId: '00000000-0000-4000-8000-000000000001',
  traceId: 'trace-fixture',
  actorId: 'actor-fixture',
  question: 'test question',
  selectedSpaceIds: [],
};

function canonicalHistorySummary(topics: string[]): string {
  return `此前已授权的用户话题：\n${topics.map((topic) => `- ${topic}`).join('\n')}`;
}

describe('agent event fixture', () => {
  it('accepts the canonical ordered event sequence', () => {
    const fixture = readFileSync(
      new URL('../fixtures/agent-events.jsonl', import.meta.url),
      'utf8',
    );
    const events = fixture
      .trim()
      .split('\n')
      .map((line) => agentEventSchema.parse(JSON.parse(line)));

    expect(events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(events.at(-1)?.type).toBe('run.completed');
    expect(events.some((event) => event.type === 'retrieval.summary')).toBe(true);
    expect(events.some((event) => event.type === 'run.status' && event.status === 'understanding')).toBe(true);
    const retrieval = events.find((event) => event.type === 'retrieval.summary');
    expect(retrieval).toMatchObject({
      type: 'retrieval.summary',
      summary: { originalQuery: 'test', query: 'test', contextualized: false, attempt: 1 },
    });
  });

  it('rejects unknown event fields', () => {
    expect(() =>
      agentEventSchema.parse({
        requestId: '00000000-0000-4000-8000-000000000001',
        traceId: 'trace-fixture',
        seq: 0,
        occurredAt: '2026-07-18T00:00:00.000Z',
        type: 'run.started',
        unexpected: true,
      }),
    ).toThrow();
  });

  it('defaults history summary and accepts 4000 Unicode code points', () => {
    expect(chatRequestSchema.parse(runRequest).historySummary).toBe('');
    const summary = '😀'.repeat(4000);
    expect(chatRequestSchema.parse({ ...runRequest, historySummary: summary }).historySummary).toBe(
      summary,
    );
  });

  it('rejects history summaries over 4000 Unicode code points and unknown fields', () => {
    expect(() =>
      chatRequestSchema.parse({ ...runRequest, historySummary: '😀'.repeat(4001) }),
    ).toThrow();
    expect(() => chatRequestSchema.parse({ ...runRequest, unexpected: true })).toThrow();
  });

  it('bounds canonical history summaries without changing noncanonical compatibility', () => {
    expect(() =>
      chatRequestSchema.parse({
        ...runRequest,
        historySummary: canonicalHistorySummary(Array.from({ length: 20 }, () => 'topic')),
      }),
    ).not.toThrow();
    expect(() =>
      chatRequestSchema.parse({
        ...runRequest,
        historySummary: canonicalHistorySummary(Array.from({ length: 21 }, () => 'topic')),
      }),
    ).toThrow();
    expect(() =>
      chatRequestSchema.parse({
        ...runRequest,
        historySummary: canonicalHistorySummary(['😀'.repeat(240)]),
      }),
    ).not.toThrow();
    expect(() =>
      chatRequestSchema.parse({
        ...runRequest,
        historySummary: canonicalHistorySummary(['😀'.repeat(241)]),
      }),
    ).toThrow();
    expect(() =>
      chatRequestSchema.parse({ ...runRequest, historySummary: 'legacy noncanonical summary' }),
    ).not.toThrow();
  });
});

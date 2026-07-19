import type { AgentEvent, RagUIMessage } from '@rag/contracts';
import type { UIMessageStreamWriter } from 'ai';

import { AiStreamMapper } from './ai-stream.mapper';

type Chunk = Parameters<UIMessageStreamWriter<RagUIMessage>['write']>[0];

const BASE = {
  requestId: '00000000-0000-4000-8000-000000000001',
  traceId: 'trace',
  occurredAt: '2026-07-18T00:00:00.000Z',
} as const;

describe('AiStreamMapper', () => {
  it('maps text, status, and citation without exposing internal ACL data', () => {
    const chunks: Chunk[] = [];
    const mapper = new AiStreamMapper((chunk) => chunks.push(chunk));
    const events: AgentEvent[] = [
      { ...BASE, type: 'run.started', seq: 0 },
      {
        ...BASE,
        type: 'run.status',
        seq: 1,
        status: 'retrieving',
      },
      { ...BASE, type: 'text.delta', seq: 2, text: '答案' },
      { ...BASE, type: 'text.delta', seq: 3, text: '正文' },
      {
        ...BASE,
        type: 'citation',
        seq: 4,
        citationId: '00000000-0000-4000-8000-000000000002',
        title: '文档',
        snippet: '证据',
        location: { page: 1 },
      },
      { ...BASE, type: 'run.completed', seq: 5, finishReason: 'stop' },
    ];

    for (const event of events) {
      mapper.write(event);
    }

    expect(chunks.filter((chunk) => chunk.type === 'text-start')).toHaveLength(1);
    expect(chunks).toContainEqual({
      type: 'data-citation',
      id: '00000000-0000-4000-8000-000000000002',
      data: {
        citationId: '00000000-0000-4000-8000-000000000002',
        title: '文档',
        snippet: '证据',
        location: { page: 1 },
      },
    });
    expect(chunks.at(-1)).toEqual({ type: 'finish', finishReason: 'stop' });
    expect(JSON.stringify(chunks)).not.toContain('acl');
  });

  it('maps cancellation to status and an other finish reason', () => {
    const chunks: Chunk[] = [];
    const mapper = new AiStreamMapper((chunk) => chunks.push(chunk));

    mapper.write({
      ...BASE,
      type: 'run.completed',
      seq: 0,
      finishReason: 'cancelled',
    });

    expect(chunks).toEqual([
      {
        type: 'data-agent-status',
        id: `status-${BASE.requestId}`,
        data: { status: 'cancelled', seq: 0 },
        transient: true,
      },
      { type: 'finish', finishReason: 'other' },
    ]);
  });

  it('closes active text and emits an error terminal sequence', () => {
    const chunks: Chunk[] = [];
    const mapper = new AiStreamMapper((chunk) => chunks.push(chunk));
    mapper.write({ ...BASE, type: 'text.delta', seq: 0, text: '部分答案' });
    mapper.write({
      ...BASE,
      type: 'run.failed',
      seq: 1,
      code: 'UPSTREAM_ERROR',
      message: 'AI stream failed',
      retryable: true,
    });

    expect(chunks.slice(-3)).toEqual([
      { type: 'text-end', id: 'answer' },
      { type: 'error', errorText: 'AI stream failed' },
      { type: 'finish', finishReason: 'error' },
    ]);
    expect(() => mapper.write({ ...BASE, type: 'run.started', seq: 2 })).toThrow('terminal event');
  });
});

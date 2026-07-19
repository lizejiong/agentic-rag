import type { AgentEvent, RunRequest } from '@rag/contracts';

import { PythonAiClient } from './python-ai.client';

const REQUEST: RunRequest = {
  requestId: '00000000-0000-4000-8000-000000000001',
  traceId: 'trace-test',
  actorId: 'actor-test',
  question: '测试问题',
  selectedSpaceIds: [],
};

function event(seq: number): AgentEvent {
  return {
    requestId: REQUEST.requestId,
    traceId: REQUEST.traceId,
    seq,
    occurredAt: '2026-07-18T00:00:00.000Z',
    type: 'text.delta',
    text: `chunk-${seq}`,
  };
}

function ndjsonResponse(records: unknown[]): Response {
  const body = `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

async function collect(source: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const records: AgentEvent[] = [];
  for await (const record of source) {
    records.push(record);
  }
  return records;
}

describe('PythonAiClient', () => {
  const originalUrl = process.env.AI_SERVICE_URL;

  beforeEach(() => {
    process.env.AI_SERVICE_URL = 'http://ai.test';
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (originalUrl === undefined) {
      delete process.env.AI_SERVICE_URL;
    } else {
      process.env.AI_SERVICE_URL = originalUrl;
    }
  });

  it('streams strictly validated events in sequence', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(ndjsonResponse([event(0), event(1)]));
    const client = new PythonAiClient();

    await expect(collect(client.run(REQUEST, new AbortController().signal))).resolves.toEqual([
      event(0),
      event(1),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ai.test/v1/agent/runs',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects schema-invalid events', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(ndjsonResponse([{ ...event(0), unexpected: true }]));
    const client = new PythonAiClient();

    await expect(collect(client.run(REQUEST, new AbortController().signal))).rejects.toThrow();
  });

  it('rejects missing, duplicate, or out-of-order sequence numbers', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(ndjsonResponse([event(0), event(2)]));
    const client = new PythonAiClient();

    await expect(collect(client.run(REQUEST, new AbortController().signal))).rejects.toThrow(
      'Non-monotonic AI event sequence',
    );
  });

  it('uses the DELETE cancellation contract', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 202 }));
    const client = new PythonAiClient();

    await client.cancel(REQUEST.requestId);

    expect(fetchMock).toHaveBeenCalledWith(`http://ai.test/v1/agent/runs/${REQUEST.requestId}`, {
      method: 'DELETE',
    });
  });

  it('best-effort cancels upstream when the signal is aborted', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(ndjsonResponse([event(0), event(1)]))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    const client = new PythonAiClient();
    const controller = new AbortController();
    const iterator = client.run(REQUEST, controller.signal)[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: event(0),
    });
    controller.abort();
    await iterator.return?.();

    expect(fetchMock).toHaveBeenLastCalledWith(
      `http://ai.test/v1/agent/runs/${REQUEST.requestId}`,
      { method: 'DELETE' },
    );
  });
});

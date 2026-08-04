import { Injectable, Logger } from '@nestjs/common';
import { agentEventSchema, type AgentEvent } from '@rag/contracts';

import type { AiEventSource, RunRequestInput } from './ai-event-source';
import { parseNdjson } from './ndjson';

@Injectable()
export class PythonAiClient implements AiEventSource {
  private readonly logger = new Logger(PythonAiClient.name);
  private readonly baseUrl = process.env.AI_SERVICE_URL ?? 'http://127.0.0.1:8001';

  async *run(request: RunRequestInput, signal: AbortSignal): AsyncIterable<AgentEvent> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/agent/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`AI service failed with ${response.status}`);
      }

      let expectedSeq = 0;
      for await (const value of parseNdjson(response.body)) {
        const parsed = agentEventSchema.safeParse(value);
        if (!parsed.success) {
          this.logger.error(
            `Invalid AI event at seq ${expectedSeq}: ${parsed.error.message}`,
            JSON.stringify(value).slice(0, 500),
          );
          yield {
            requestId:
              ((value as Record<string, unknown>).requestId as string) ?? request.requestId,
            traceId: ((value as Record<string, unknown>).traceId as string) ?? request.traceId,
            seq: expectedSeq,
            occurredAt: new Date().toISOString(),
            type: 'run.failed' as const,
            code: 'INVALID_AI_EVENT',
            message: `AI service returned an unrecognised event at seq ${expectedSeq}`,
            retryable: false,
          };
          return;
        }
        const event = parsed.data;
        if (event.seq !== expectedSeq) {
          throw new Error('Non-monotonic AI event sequence');
        }
        expectedSeq += 1;
        yield event;
      }
    } finally {
      if (signal.aborted) {
        await this.cancel(request.requestId).catch(() => undefined);
      }
    }
  }

  async cancel(requestId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/v1/agent/runs/${requestId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`AI cancellation failed with ${response.status}`);
    }
  }
}

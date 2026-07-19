import { Injectable } from '@nestjs/common';
import { agentEventSchema, type AgentEvent, type RunRequest } from '@rag/contracts';

import type { AiEventSource } from './ai-event-source';
import { parseNdjson } from './ndjson';

@Injectable()
export class PythonAiClient implements AiEventSource {
  private readonly baseUrl = process.env.AI_SERVICE_URL ?? 'http://127.0.0.1:8001';

  async *run(request: RunRequest, signal: AbortSignal): AsyncIterable<AgentEvent> {
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
        const event = agentEventSchema.parse(value);
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

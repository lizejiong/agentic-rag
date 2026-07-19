import type { AgentEvent, RunRequest } from '@rag/contracts';

export interface AiEventSource {
  run(request: RunRequest, signal: AbortSignal): AsyncIterable<AgentEvent>;
  cancel(requestId: string): Promise<void>;
}

export const AI_EVENT_SOURCE = Symbol('AI_EVENT_SOURCE');

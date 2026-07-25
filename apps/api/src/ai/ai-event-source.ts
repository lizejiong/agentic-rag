import type { AgentEvent, ChatRequest } from '@rag/contracts';

export type RunRequestInput = ChatRequest;

export interface AiEventSource {
  run(request: RunRequestInput, signal: AbortSignal): AsyncIterable<AgentEvent>;
  cancel(requestId: string): Promise<void>;
}

export const AI_EVENT_SOURCE = Symbol('AI_EVENT_SOURCE');

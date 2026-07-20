export type OutboxEnvelope<T extends Record<string, unknown>> = {
  eventId: string;
  type: string;
  taskId?: string;
  resourceId: string;
  resourceVersion: number;
  attempt: number;
  traceId: string;
  occurredAt: string;
  payload: T;
};

export type EnqueueOutboxInput<T extends Record<string, unknown>> = {
  type: string;
  taskId?: string;
  resourceId: string;
  resourceVersion: number;
  payload: T;
};

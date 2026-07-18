import type { UIMessage } from 'ai';

import type { AgentEvent } from './agent-events';

type AgentStatus = Extract<AgentEvent, { type: 'run.status' }>['status'];
type AgentCitation = Extract<AgentEvent, { type: 'citation' }>;

export type RagUIDataParts = {
  'agent-status': {
    status: AgentStatus | 'cancelled';
    seq: AgentEvent['seq'];
  };
  citation: Pick<AgentCitation, 'citationId' | 'title' | 'snippet' | 'location'>;
};

export type RagUIMessage = UIMessage<never, RagUIDataParts>;

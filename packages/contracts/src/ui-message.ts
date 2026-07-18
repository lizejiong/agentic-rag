import type { UIMessage } from 'ai';

export type RagUIDataParts = {
  'agent-status': {
    status: 'understanding' | 'retrieving' | 'ranking' | 'answering' | 'cancelled';
    seq: number;
  };
  citation: {
    citationId: string;
    title: string;
    snippet: string;
    location: {
      page?: number;
      slide?: number;
      sheet?: string;
      cellRange?: string;
    };
  };
};

export type RagUIMessage = UIMessage<never, RagUIDataParts>;

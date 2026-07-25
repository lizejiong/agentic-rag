import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MessagePart } from './message-part';

describe('MessagePart', () => {
  it('renders a citation without exposing internal storage data', () => {
    render(
      <MessagePart
        part={{
          type: 'data-citation',
          id: '00000000-0000-4000-8000-000000000001',
          data: {
            citationId: '00000000-0000-4000-8000-000000000001',
            chunkId: '00000000-0000-4000-8000-000000000002',
            documentId: '00000000-0000-4000-8000-000000000003',
            title: '制度文档',
            snippet: '证据摘要',
            location: { page: 2 },
          },
        }}
      />,
    );

    const trigger = screen.getByRole('button', { name: /制度文档/ });
    expect(trigger).toHaveTextContent('第 2 页');
    expect(screen.queryByText('证据摘要')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByText('证据摘要')).toBeInTheDocument();
    expect(screen.queryByText(/MinIO|ACL/i)).not.toBeInTheDocument();
  });

  it('renders streamed text', () => {
    render(<MessagePart part={{ type: 'text', text: '流式答案' }} />);

    expect(screen.getByText('流式答案')).toBeInTheDocument();
  });

  it('renders an agent status badge', () => {
    render(
      <MessagePart
        part={{ type: 'data-agent-status', data: { status: 'retrieving', seq: 5 } }}
      />,
    );

    expect(screen.getByText('检索资料')).toBeInTheDocument();
  });

  it('renders a retrieval summary card', () => {
    render(
      <MessagePart
        part={{
          type: 'data-retrieval-summary',
          data: {
            query: 'test query',
            vectorTopK: 50,
            lexicalTopK: 50,
            rrfK: 60,
            rrfTopK: 30,
            rerankTopK: 10,
            rerankerEnabled: false,
            paths: [
              {
                path: 'vector',
                spaceId: 's1',
                candidatesReturned: 42,
                candidatesAfterAcl: 38,
              },
              {
                path: 'lexical',
                spaceId: 's1',
                candidatesReturned: 30,
                candidatesAfterAcl: 25,
              },
            ],
            rrfCandidateCount: 15,
            finalCandidateCount: 10,
            embeddingModel: 'mock-embedding',
            embeddingVersion: 'mock-1',
            rerankerModel: '',
            rerankerVersion: '',
            elapsedMs: 250,
          },
        }}
      />,
    );

    expect(screen.getByText(/10 条证据/)).toBeInTheDocument();
    expect(screen.getByText(/mock-embedding/)).toBeInTheDocument();
  });

  it('returns null for unknown data part types', () => {
    const { container } = render(
      <MessagePart
        part={
          // @ts-expect-error testing unknown type
          { type: 'data-unknown', data: {} }
        }
      />,
    );

    expect(container.innerHTML).toBe('');
  });
});

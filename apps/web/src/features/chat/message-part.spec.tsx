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
});

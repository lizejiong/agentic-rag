import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RagUIMessage } from '@rag/contracts';

import { ConversationView } from './conversation-view';

afterEach(cleanup);

beforeEach(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
});

const userMessage: RagUIMessage = {
  id: 'user-1',
  role: 'user',
  parts: [{ type: 'text', text: '请说明报销流程' }],
};

describe('ConversationView', () => {
  it('shows live activity as a left-aligned assistant message before the answer exists', () => {
    render(<ConversationView messages={[userMessage]} busy agentStatus="retrieving" />);

    const activity = screen.getByRole('status');
    expect(activity).toHaveTextContent('正在检索知识库');
    expect(activity.closest('article')).toHaveAttribute('data-role', 'assistant');
    expect(activity).toHaveAttribute('data-compact', 'false');
  });

  it('weakens activity once the assistant answer begins', () => {
    const assistantMessage: RagUIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: '报销需要在出差结束后提交。' }],
    };

    render(<ConversationView messages={[userMessage, assistantMessage]} busy agentStatus="answering" />);

    const activity = screen.getByRole('status');
    expect(activity).toHaveTextContent('正在组织回答');
    expect(activity).toHaveAttribute('data-compact', 'true');
    expect(activity.closest('article')).toHaveAttribute('data-role', 'assistant');
  });

  it('removes activity after the request completes', () => {
    render(<ConversationView messages={[userMessage]} agentStatus="retrieving" />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatComposer } from './chat-composer';

afterEach(cleanup);

function renderComposer(options?: { hasSelectedSpaces?: boolean }) {
  const onSend = vi.fn();
  render(
    <ChatComposer
      busy={false}
      agentStatus={undefined}
      error={undefined}
      spaceError={undefined}
      spacesLoading={false}
      hasSelectedSpaces={options?.hasSelectedSpaces ?? true}
      onSend={onSend}
      onStop={vi.fn()}
    />,
  );
  return { onSend, input: screen.getByLabelText('向企业知识库提问') };
}

describe('ChatComposer', () => {
  it('sends with Enter but keeps Shift+Enter for a new line', () => {
    const { input, onSend } = renderComposer();
    fireEvent.change(input, { target: { value: '  检索这个问题  ' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('检索这个问题');
  });

  it('does not allow submission without a selected knowledge space', () => {
    const { input, onSend } = renderComposer({ hasSelectedSpaces: false });
    fireEvent.change(input, { target: { value: '不能发送' } });

    expect(screen.getByRole('button', { name: /发送/ })).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });
});

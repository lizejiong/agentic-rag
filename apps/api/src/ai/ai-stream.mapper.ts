import type { AgentEvent, RagUIMessage } from '@rag/contracts';
import type { UIMessageStreamWriter } from 'ai';

type WriteChunk = UIMessageStreamWriter<RagUIMessage>['write'];

export class AiStreamMapper {
  private textStarted = false;
  private terminal = false;

  constructor(private readonly writeChunk: WriteChunk) {}

  write(event: AgentEvent): void {
    if (this.terminal) {
      throw new Error('Cannot write an event after a terminal event');
    }

    switch (event.type) {
      case 'run.started':
        this.writeChunk({ type: 'start' });
        return;
      case 'run.status':
        this.writeChunk({
          type: 'data-agent-status',
          id: `status-${event.requestId}`,
          data: { status: event.status, seq: event.seq },
          transient: true,
        });
        return;
      case 'text.delta':
        if (!this.textStarted) {
          this.writeChunk({ type: 'text-start', id: 'answer' });
          this.textStarted = true;
        }
        this.writeChunk({
          type: 'text-delta',
          id: 'answer',
          delta: event.text,
        });
        return;
      case 'citation':
        this.writeChunk({
          type: 'data-citation',
          id: event.citationId,
          data: {
            citationId: event.citationId,
            title: event.title,
            snippet: event.snippet,
            location: event.location,
          },
        });
        return;
      case 'run.completed':
        this.closeText();
        if (event.finishReason === 'cancelled') {
          this.writeChunk({
            type: 'data-agent-status',
            id: `status-${event.requestId}`,
            data: { status: 'cancelled', seq: event.seq },
            transient: true,
          });
        }
        this.writeChunk({
          type: 'finish',
          finishReason: event.finishReason === 'cancelled' ? 'other' : 'stop',
        });
        this.terminal = true;
        return;
      case 'run.failed':
        this.closeText();
        this.writeChunk({ type: 'error', errorText: event.message });
        this.writeChunk({ type: 'finish', finishReason: 'error' });
        this.terminal = true;
    }
  }

  private closeText(): void {
    if (this.textStarted) {
      this.writeChunk({ type: 'text-end', id: 'answer' });
      this.textStarted = false;
    }
  }
}

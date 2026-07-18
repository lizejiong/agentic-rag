import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { agentEventSchema } from '../src/agent-events';

describe('agent event fixture', () => {
  it('accepts the canonical ordered event sequence', () => {
    const fixture = readFileSync(
      new URL('../fixtures/agent-events.jsonl', import.meta.url),
      'utf8',
    );
    const events = fixture
      .trim()
      .split('\n')
      .map((line) => agentEventSchema.parse(JSON.parse(line)));

    expect(events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(events.at(-1)?.type).toBe('run.completed');
  });
});

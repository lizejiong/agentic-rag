import { collectNdjson } from './ndjson';

function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

describe('collectNdjson', () => {
  const encoder = new TextEncoder();

  it('parses records split across chunks and UTF-8 code points', async () => {
    const bytes = encoder.encode('{"text":"知识"}\n{"seq":1}\n');
    const splitInsideChineseCharacter = bytes.indexOf(0xe7) + 1;
    const stream = streamFromChunks([
      bytes.slice(0, splitInsideChineseCharacter),
      bytes.slice(splitInsideChineseCharacter, 18),
      bytes.slice(18),
    ]);

    await expect(collectNdjson(stream, 64 * 1024)).resolves.toEqual([{ text: '知识' }, { seq: 1 }]);
  });

  it('rejects an unterminated record at the cap', async () => {
    const stream = streamFromChunks([encoder.encode('x'.repeat(16))]);

    await expect(collectNdjson(stream, 16)).rejects.toThrow('NDJSON buffer exceeded');
  });

  it('rejects a terminated record whose bytes including newline reach the cap', async () => {
    const stream = streamFromChunks([encoder.encode(`${'x'.repeat(15)}\n`)]);

    await expect(collectNdjson(stream, 16)).rejects.toThrow('NDJSON buffer exceeded');
  });

  it('accepts a large chunk made of individually small records', async () => {
    const stream = streamFromChunks([
      encoder.encode(
        `${Array.from({ length: 100 }, (_, seq) => JSON.stringify({ seq })).join('\n')}\n`,
      ),
    ]);

    await expect(collectNdjson(stream, 32)).resolves.toHaveLength(100);
  });

  it('releases the reader lock after invalid JSON', async () => {
    const stream = streamFromChunks([encoder.encode('not-json\n')]);

    await expect(collectNdjson(stream, 64)).rejects.toBeInstanceOf(SyntaxError);
    expect(stream.locked).toBe(false);
  });
});

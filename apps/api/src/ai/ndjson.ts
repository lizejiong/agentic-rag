function assertRecordSize(record: string, maxBytes: number, terminated: boolean): void {
  const delimiterBytes = terminated ? 1 : 0;
  if (Buffer.byteLength(record, 'utf8') + delimiterBytes >= maxBytes) {
    throw new Error('NDJSON buffer exceeded');
  }
}

export async function* parseNdjson(
  stream: ReadableStream<Uint8Array>,
  maxBufferBytes = 64 * 1024,
): AsyncGenerator<unknown> {
  if (!Number.isSafeInteger(maxBufferBytes) || maxBufferBytes <= 1) {
    throw new RangeError('maxBufferBytes must be an integer greater than 1');
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });

      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const record = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        assertRecordSize(record, maxBufferBytes, true);

        const line = record.trim();
        if (line) {
          yield JSON.parse(line) as unknown;
        }
        newline = buffer.indexOf('\n');
      }

      assertRecordSize(buffer, maxBufferBytes, false);
      if (done) {
        break;
      }
    }

    const tail = buffer.trim();
    if (tail) {
      yield JSON.parse(tail) as unknown;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function collectNdjson(
  stream: ReadableStream<Uint8Array>,
  maxBufferBytes = 64 * 1024,
): Promise<unknown[]> {
  const records: unknown[] = [];
  for await (const record of parseNdjson(stream, maxBufferBytes)) {
    records.push(record);
  }
  return records;
}

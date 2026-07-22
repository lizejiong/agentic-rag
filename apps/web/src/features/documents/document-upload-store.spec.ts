import { describe, expect, it } from 'vitest';

import { runWithConcurrency, validateSelectedFiles } from './document-upload-store';

describe('document upload queue', () => {
  it('validates batch count, extension, and per-format size limits', () => {
    expect(validateSelectedFiles([])).toContain('至少');
    expect(validateSelectedFiles([new File(['x'], 'unsafe.exe')])).toContain('不支持');
    const hugeText = new File(['x'], 'huge.txt');
    Object.defineProperty(hugeText, 'size', { value: 100 * 1024 * 1024 + 1 });
    expect(validateSelectedFiles([hugeText])).toContain('超出');
    expect(validateSelectedFiles([new File(['hello'], 'notes.md')])).toBeUndefined();
  });

  it('never runs more than three uploads concurrently', async () => {
    let active = 0;
    let maximum = 0;
    const operation = async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    };
    await runWithConcurrency([1, 2, 3, 4, 5], 3, operation);
    expect(maximum).toBe(3);
  });
});

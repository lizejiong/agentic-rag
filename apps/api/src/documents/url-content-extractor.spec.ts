import { UrlContentExtractor } from './url-content-extractor';

describe('UrlContentExtractor', () => {
  const extractor = new UrlContentExtractor();

  it('extracts readable HTML, metadata, canonical URL, and Markdown', () => {
    const paragraph = '这是用于知识库检索的正文内容。'.repeat(80);
    const html = `<!doctype html><html><head><title>原始标题</title><link rel="canonical" href="/canonical"><meta name="author" content="Atlas"></head><body><article><h1>产品指南</h1><p>${paragraph}</p></article></body></html>`;
    const result = extractor.extract({
      body: Buffer.from(html),
      contentType: 'text/html; charset=utf-8',
      finalUrl: 'https://example.com/posts/1',
      fetchedAt: new Date('2026-07-22T00:00:00.000Z'),
    });

    expect(result.title).toBe('原始标题');
    expect(result.markdown).toContain(paragraph.slice(0, 30));
    expect(result.canonicalUrl).toBe('https://example.com/canonical');
    expect(result.author).toBe('Atlas');
  });

  it('keeps plain text as normalized Markdown content', () => {
    const result = extractor.extract({
      body: Buffer.from('第一段\r\n\r\n第二段'),
      contentType: 'text/plain; charset=utf-8',
      finalUrl: 'https://example.com/notes',
      fetchedAt: new Date(),
    });
    expect(result.markdown).toBe('第一段\n\n第二段');
    expect(result.title).toBe('example.com');
  });

  it('rejects HTML without readable page content', () => {
    expect(() =>
      extractor.extract({
        body: Buffer.from('<html><body><script>app()</script></body></html>'),
        contentType: 'text/html',
        finalUrl: 'https://example.com/app',
        fetchedAt: new Date(),
      }),
    ).toThrow('No readable page content was found');
  });
});

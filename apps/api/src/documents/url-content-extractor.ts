import { Readability } from '@mozilla/readability';
import { Injectable } from '@nestjs/common';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';

import { UrlCaptureError } from './url-capture.error';
import type { UrlFetchResult } from './url-http-fetcher';

export interface ExtractedUrlContent {
  title: string;
  markdown: string;
  canonicalUrl: string | null;
  author: string | null;
  publishedAt: Date | null;
  siteName: string | null;
  excerpt: string | null;
}

@Injectable()
export class UrlContentExtractor {
  private readonly turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
  });

  extract(input: UrlFetchResult): ExtractedUrlContent {
    const decoded = this.decode(input.body, input.contentType).replaceAll('\0', '');
    if (input.contentType.toLowerCase().startsWith('text/plain')) {
      const text = this.normalize(decoded);
      if (!text) this.empty();
      return {
        title: new URL(input.finalUrl).hostname,
        markdown: text,
        canonicalUrl: null,
        author: null,
        publishedAt: null,
        siteName: null,
        excerpt: null,
      };
    }

    const { document } = parseHTML(decoded);
    Object.defineProperty(document, 'documentURI', { value: input.finalUrl, configurable: true });
    const canonicalUrl = this.canonical(
      document.querySelector('link[rel~="canonical"]')?.getAttribute('href'),
      input.finalUrl,
    );
    const article = new Readability(document.cloneNode(true) as unknown as Document, {
      maxElemsToParse: 200_000,
    }).parse();
    if (!article?.content || !article.textContent?.trim()) this.empty();
    const title = (this.normalizeInline(article.title) || new URL(input.finalUrl).hostname).slice(
      0,
      300,
    );
    const body = this.normalize(this.turndown.turndown(article.content));
    if (!body) this.empty();
    const markdown = this.limit(`# ${title}\n\n${body}`);
    return {
      title,
      markdown,
      canonicalUrl,
      author: this.normalizeInline(article.byline),
      publishedAt: this.date(article.publishedTime),
      siteName: this.normalizeInline(article.siteName),
      excerpt: this.normalizeInline(article.excerpt),
    };
  }

  private decode(body: Buffer, contentType: string): string {
    const headerCharset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1];
    const sample = body.subarray(0, 8192).toString('latin1');
    const metaCharset = /<meta[^>]+charset\s*=\s*["']?([^\s"'/>;]+)/i.exec(sample)?.[1];
    const charset = (headerCharset ?? metaCharset ?? 'utf-8').toLowerCase();
    try {
      return new TextDecoder(charset, { fatal: true }).decode(body);
    } catch (error) {
      throw new UrlCaptureError(
        'URL_CHARSET_UNSUPPORTED',
        'The page character encoding could not be decoded.',
        false,
        { cause: error },
      );
    }
  }

  private canonical(value: string | null | undefined, baseUrl: string): string | null {
    if (!value) return null;
    try {
      const url = new URL(value, baseUrl);
      const normalized = url.toString();
      return (url.protocol === 'http:' || url.protocol === 'https:') && normalized.length <= 2048
        ? normalized
        : null;
    } catch {
      return null;
    }
  }

  private date(value: string | null | undefined): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date;
  }

  private normalize(value: string): string {
    return this.limit(
      value
        .replaceAll('\r\n', '\n')
        .replaceAll('\r', '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
    );
  }

  private normalizeInline(value: string | null | undefined): string | null {
    const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
    return normalized ? normalized.slice(0, 500) : null;
  }

  private limit(value: string): string {
    if (value.length > 10_000_000) {
      throw new UrlCaptureError(
        'URL_CONTENT_TOO_LARGE',
        'The extracted page text exceeds the character limit.',
        false,
      );
    }
    return value;
  }

  private empty(): never {
    throw new UrlCaptureError(
      'URL_CONTENT_EMPTY',
      'No readable page content was found. The page may require JavaScript or authentication.',
      false,
    );
  }
}

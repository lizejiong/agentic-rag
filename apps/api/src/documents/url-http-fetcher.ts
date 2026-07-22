import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';

import { Inject, Injectable, Optional } from '@nestjs/common';

import { UrlAddressPolicy } from './url-address-policy';
import { UrlCaptureError } from './url-capture.error';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_CONTENT_TYPES = new Set(['text/html', 'application/xhtml+xml', 'text/plain']);

export interface UrlFetchResult {
  body: Buffer;
  contentType: string;
  finalUrl: string;
  fetchedAt: Date;
}

export interface UrlFetchOptions {
  maxBytes: number;
  maxRedirects: number;
  timeoutMilliseconds: number;
}

export const URL_FETCH_OPTIONS = Symbol('URL_FETCH_OPTIONS');

@Injectable()
export class UrlHttpFetcher {
  private readonly maxBytes: number;
  private readonly maxRedirects: number;
  private readonly timeoutMilliseconds: number;

  constructor(
    private readonly addressPolicy: UrlAddressPolicy,
    @Optional() @Inject(URL_FETCH_OPTIONS) options?: Partial<UrlFetchOptions>,
  ) {
    this.maxBytes = options?.maxBytes ?? 20 * 1024 * 1024;
    this.maxRedirects = options?.maxRedirects ?? 5;
    this.timeoutMilliseconds = options?.timeoutMilliseconds ?? 30_000;
  }

  async fetch(sourceUrl: string): Promise<UrlFetchResult> {
    const deadline = Date.now() + this.timeoutMilliseconds;
    let nextUrl = sourceUrl;
    for (let redirectCount = 0; redirectCount <= this.maxRedirects; redirectCount += 1) {
      const resolved = await this.addressPolicy.resolve(nextUrl);
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new UrlCaptureError(
          'URL_FETCH_TIMEOUT',
          'The page did not respond before the timeout.',
          true,
        );
      }
      const response = await this.request(resolved.url, resolved.addresses[0]!, remaining);
      const statusCode = response.statusCode ?? 0;
      if (REDIRECT_STATUSES.has(statusCode)) {
        if (redirectCount === this.maxRedirects) {
          throw new UrlCaptureError(
            'URL_REDIRECT_LIMIT_EXCEEDED',
            'The page exceeded the redirect limit.',
            false,
          );
        }
        const location = response.headers.location;
        response.resume();
        if (!location) {
          throw new UrlCaptureError(
            'URL_REDIRECT_INVALID',
            'The page returned a redirect without a location.',
            false,
          );
        }
        nextUrl = new URL(location, resolved.url).toString();
        continue;
      }
      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        throw new UrlCaptureError(
          'URL_HTTP_STATUS',
          `The page returned HTTP ${statusCode}.`,
          statusCode >= 500,
        );
      }
      const contentTypeHeader = response.headers['content-type'] ?? '';
      const contentType = contentTypeHeader.split(';', 1)[0]!.trim().toLowerCase();
      if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
        response.resume();
        throw new UrlCaptureError(
          'URL_CONTENT_TYPE_NOT_ALLOWED',
          'The URL did not return an HTML or text page.',
          false,
        );
      }
      const encoding = response.headers['content-encoding'];
      if (encoding && encoding.toLowerCase() !== 'identity') {
        response.resume();
        throw new UrlCaptureError(
          'URL_CONTENT_ENCODING_NOT_ALLOWED',
          'The page returned an unsupported content encoding.',
          false,
        );
      }
      const declaredLength = Number(response.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > this.maxBytes) {
        response.resume();
        throw new UrlCaptureError(
          'URL_RESPONSE_TOO_LARGE',
          'The page exceeds the 20 MB response limit.',
          false,
        );
      }
      const body = await this.readBody(response);
      return {
        body,
        contentType: contentTypeHeader,
        finalUrl: resolved.url.toString(),
        fetchedAt: new Date(),
      };
    }
    throw new UrlCaptureError(
      'URL_REDIRECT_LIMIT_EXCEEDED',
      'The page exceeded the redirect limit.',
      false,
    );
  }

  private request(
    url: URL,
    address: { address: string; family: number },
    timeout: number,
  ): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
      const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
        if (options.all) {
          callback(null, [address]);
        } else {
          callback(null, address.address, address.family);
        }
      };
      const options: RequestOptions = {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
          'accept-encoding': 'identity',
          'user-agent': 'AtlasRAG-URL-Capture/1.0',
        },
        lookup: pinnedLookup,
      };
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(options, resolve);
      request.setTimeout(timeout, () => request.destroy(new Error('URL_FETCH_TIMEOUT')));
      request.once('error', (error) => {
        const code =
          error.message === 'URL_FETCH_TIMEOUT' ? 'URL_FETCH_TIMEOUT' : 'URL_FETCH_FAILED';
        reject(
          new UrlCaptureError(
            code,
            code === 'URL_FETCH_TIMEOUT'
              ? 'The page did not respond before the timeout.'
              : 'The page could not be fetched.',
            true,
            { cause: error },
          ),
        );
      });
      request.end();
    });
  }

  private readBody(response: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > this.maxBytes) {
          reject(
            new UrlCaptureError(
              'URL_RESPONSE_TOO_LARGE',
              'The page exceeds the 20 MB response limit.',
              false,
            ),
          );
          response.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.once('end', () => resolve(Buffer.concat(chunks, size)));
      response.once('aborted', () =>
        reject(
          new UrlCaptureError('URL_FETCH_FAILED', 'The page response ended unexpectedly.', true),
        ),
      );
      response.once('error', (error) =>
        reject(
          new UrlCaptureError('URL_FETCH_FAILED', 'The page response could not be read.', true, {
            cause: error,
          }),
        ),
      );
    });
  }
}

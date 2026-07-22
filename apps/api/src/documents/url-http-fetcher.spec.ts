import { createServer, type Server } from 'node:http';

import type { UrlAddressPolicy } from './url-address-policy';
import { UrlHttpFetcher } from './url-http-fetcher';

describe('UrlHttpFetcher', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = createServer((request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(302, { location: '/page' }).end();
        return;
      }
      if (request.url === '/large') {
        response.writeHead(200, { 'content-type': 'text/plain' }).end('01234567890');
        return;
      }
      response
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end('<main>Hello</main>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS_MISSING');
    baseUrl = `http://capture.example:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  function policy() {
    return {
      resolve: jest.fn((value: string) =>
        Promise.resolve({
          url: new URL(value),
          addresses: [{ address: '127.0.0.1', family: 4 }],
        }),
      ),
    };
  }

  it('pins the resolved address and validates every redirect hop', async () => {
    const addressPolicy = policy();
    const result = await new UrlHttpFetcher(addressPolicy as unknown as UrlAddressPolicy, {
      maxBytes: 1024,
      maxRedirects: 5,
      timeoutMilliseconds: 5_000,
    }).fetch(`${baseUrl}/redirect`);

    expect(result.body.toString()).toContain('Hello');
    expect(result.finalUrl).toBe(`${baseUrl}/page`);
    expect(addressPolicy.resolve).toHaveBeenCalledTimes(2);
  });

  it('enforces the streaming body limit', async () => {
    await expect(
      new UrlHttpFetcher(policy() as unknown as UrlAddressPolicy, {
        maxBytes: 10,
        maxRedirects: 5,
        timeoutMilliseconds: 5_000,
      }).fetch(`${baseUrl}/large`),
    ).rejects.toMatchObject({
      code: 'URL_RESPONSE_TOO_LARGE',
    });
  });
});

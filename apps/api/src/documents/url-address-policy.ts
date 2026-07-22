import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';

import { Inject, Injectable, Optional } from '@nestjs/common';
import ipaddr from 'ipaddr.js';

import { UrlCaptureError } from './url-capture.error';

export interface ResolvedUrl {
  url: URL;
  addresses: LookupAddress[];
}

export type DnsLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<LookupAddress[]>;

export const URL_DNS_LOOKUP = Symbol('URL_DNS_LOOKUP');

@Injectable()
export class UrlAddressPolicy {
  private readonly dnsLookup: DnsLookup;

  constructor(@Optional() @Inject(URL_DNS_LOOKUP) dnsLookup?: DnsLookup) {
    this.dnsLookup = dnsLookup ?? lookup;
  }

  async resolve(input: string | URL): Promise<ResolvedUrl> {
    const url = this.parse(input);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
      throw new UrlCaptureError(
        'URL_ADDRESS_BLOCKED',
        'The URL does not resolve to a public address.',
        false,
      );
    }

    let addresses: LookupAddress[];
    try {
      addresses = await this.dnsLookup(hostname, { all: true, verbatim: true });
    } catch (error) {
      throw new UrlCaptureError('URL_DNS_FAILED', 'The URL hostname could not be resolved.', true, {
        cause: error,
      });
    }
    if (addresses.length === 0) {
      throw new UrlCaptureError(
        'URL_DNS_FAILED',
        'The URL hostname did not resolve to an address.',
        true,
      );
    }
    if (addresses.some(({ address }) => !this.isPublicAddress(address))) {
      throw new UrlCaptureError(
        'URL_ADDRESS_BLOCKED',
        'The URL does not resolve exclusively to public addresses.',
        false,
      );
    }
    return { url, addresses };
  }

  private parse(input: string | URL): URL {
    let url: URL;
    try {
      url = new URL(input);
    } catch (error) {
      throw new UrlCaptureError('URL_INVALID', 'The URL is invalid.', false, { cause: error });
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new UrlCaptureError(
        'URL_PROTOCOL_NOT_ALLOWED',
        'Only HTTP and HTTPS URLs are supported.',
        false,
      );
    }
    if (url.username || url.password) {
      throw new UrlCaptureError(
        'URL_CREDENTIALS_NOT_ALLOWED',
        'URLs containing credentials are not supported.',
        false,
      );
    }
    url.hash = '';
    if (url.toString().length > 2048) {
      throw new UrlCaptureError('URL_TOO_LONG', 'The URL exceeds the 2048 character limit.', false);
    }
    return url;
  }

  private isPublicAddress(address: string): boolean {
    try {
      let parsed = ipaddr.parse(address);
      if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) {
        parsed = parsed.toIPv4Address();
      }
      return parsed.range() === 'unicast';
    } catch {
      return false;
    }
  }
}

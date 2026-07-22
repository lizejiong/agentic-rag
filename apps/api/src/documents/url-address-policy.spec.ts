import { UrlAddressPolicy } from './url-address-policy';
import { UrlCaptureError } from './url-capture.error';

describe('UrlAddressPolicy', () => {
  it('accepts a hostname only when all resolved addresses are public', async () => {
    const lookup = jest.fn().mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);
    const result = await new UrlAddressPolicy(lookup).resolve('https://example.com/page#part');

    expect(result.url.toString()).toBe('https://example.com/page');
    expect(result.addresses).toHaveLength(2);
  });

  it.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:192.168.1.2'])(
    'rejects blocked address %s',
    async (address) => {
      const family = address.includes(':') ? 6 : 4;
      const policy = new UrlAddressPolicy(jest.fn().mockResolvedValue([{ address, family }]));
      await expect(policy.resolve('https://blocked.example')).rejects.toMatchObject({
        code: 'URL_ADDRESS_BLOCKED',
      } satisfies Partial<UrlCaptureError>);
    },
  );

  it('rejects a mixed public and private DNS answer', async () => {
    const policy = new UrlAddressPolicy(
      jest.fn().mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ]),
    );
    await expect(policy.resolve('https://example.com')).rejects.toMatchObject({
      code: 'URL_ADDRESS_BLOCKED',
    });
  });

  it('rejects credentials before DNS resolution', async () => {
    const lookup = jest.fn();
    await expect(
      new UrlAddressPolicy(lookup).resolve('https://user:secret@example.com'),
    ).rejects.toMatchObject({
      code: 'URL_CREDENTIALS_NOT_ALLOWED',
    });
    expect(lookup).not.toHaveBeenCalled();
  });
});

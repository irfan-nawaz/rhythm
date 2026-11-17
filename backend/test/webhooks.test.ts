import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';

// Production rules: no private addresses.
process.env.WEBHOOK_ALLOW_PRIVATE = 'false';
const { assertWebhookUrl, sign } = await import('../src/webhooks.js');

describe('assertWebhookUrl (SSRF protection)', () => {
  const refused = [
    'http://example.com/hook', // plain http
    'https://127.0.0.1/hook', // loopback
    'https://localhost/hook', // resolves to loopback
    'https://169.254.169.254/latest/meta-data', // cloud metadata service
    'https://10.0.0.5/hook', // private network
    'https://192.168.29.10/hook', // a home LAN
    'https://[::1]/hook', // IPv6 loopback
    'https://[::ffff:192.168.1.1]/hook', // IPv4 hidden inside IPv6
    'https://user:pass@example.com/hook', // credentials before the host
    'not a url',
  ];
  for (const url of refused) {
    it(`refuses ${url}`, async () => {
      await assert.rejects(assertWebhookUrl(url));
    });
  }

  it('accepts a public https address', async () => {
    const url = await assertWebhookUrl('https://93.184.216.34/hook');
    assert.equal(url.hostname, '93.184.216.34');
  });
});

describe('sign', () => {
  it('is an HMAC-SHA256 of the exact body, prefixed with sha256=', () => {
    const body = '{"hello":"world"}';
    const expected = createHmac('sha256', 'whsec_test').update(body).digest('hex');
    assert.equal(sign('whsec_test', body), `sha256=${expected}`);
  });
});

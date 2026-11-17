import { createHmac, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { config } from './config.js';

// Outgoing webhooks. Two things make them safe to offer:
//
// 1. Signing. Every delivery carries X-Rhythm-Signature: sha256=<hex>, an
//    HMAC of the raw body with the webhook's secret. The receiver recomputes
//    it to prove the request came from Rhythm and wasn't changed on the way.
//
// 2. SSRF protection. A webhook URL makes *our* server send a request to
//    wherever the user says. Without a check, someone could point it at
//    internal addresses (the database, the cloud metadata service at
//    169.254.169.254) and probe your private network. So private, loopback
//    and link-local addresses are refused, checked again at delivery time in
//    case DNS has started pointing somewhere else.

const privateRanges = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
] as const) {
  privateRanges.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
] as const) {
  privateRanges.addSubnet(net, prefix, 'ipv6');
}

function isPrivateAddress(address: string): boolean {
  // An IPv4 address written inside IPv6 (::ffff:192.168.1.1) is checked as IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return privateRanges.check(mapped[1], 'ipv4');
  return privateRanges.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4');
}

/** Throws with a readable reason if the URL isn't allowed as a webhook target. */
export async function assertWebhookUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('That is not a valid URL');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && config.webhookAllowPrivate)) {
    throw new Error('Webhook URLs must start with https://');
  }
  if (url.username || url.password) throw new Error("Put credentials in the webhook's path or query, not before the host");
  if (config.webhookAllowPrivate) return url;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error('Webhooks to private or local network addresses are not allowed');
  }
  return url;
}

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

export function sign(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export interface WebhookTarget {
  id: string;
  url: string;
  secret: string;
}

export interface WebhookPayload {
  id: string;
  type: 'reminder' | 'test';
  title: string;
  body: string;
  url: string;
  createdAt: string;
}

/** POST one signed delivery. Resolves with the HTTP status; throws on network errors and timeouts. */
export async function deliverWebhook(target: WebhookTarget, payload: WebhookPayload): Promise<number> {
  await assertWebhookUrl(target.url);
  const text = `${payload.title}: ${payload.body}`;
  // `text` and `content` make the same payload work as a Slack or Discord message.
  const body = JSON.stringify({ ...payload, text, content: text });
  const res = await fetch(target.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Rhythm-Webhooks/1.0',
      'x-rhythm-delivery': payload.id,
      'x-rhythm-signature': sign(target.secret, body),
    },
    body,
    redirect: 'manual', // a redirect could lead to a private address
    signal: AbortSignal.timeout(5000),
  });
  return res.status;
}

import { createHash, randomBytes } from 'node:crypto';
import type {} from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { cached, invalidate } from '../../cache.js';
import { config } from '../../config.js';
import { sql } from '../../db.js';

// Sessions: a random token in an httpOnly cookie, its SHA-256 hash in Postgres,
// and a short-lived copy in the cache so most requests never touch the
// database to find out who you are. Any API replica can serve any request.
//
// The session is resolved in a Fastify onRequest hook, before Nest runs, so
// the rate limiter can count requests per user rather than per IP address.

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  timezone: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export const SESSION_COOKIE = 'rhythm_sid';
const CACHE_TTL_SECONDS = 300;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const userCacheKey = (userId: string) => `user:${userId}`;

export async function createSession(req: FastifyRequest, reply: FastifyReply, userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_DAYS * 24 * 3600 * 1000);
  await sql`
    insert into sessions (id, user_id, expires_at, user_agent, ip)
    values (${hashToken(token)}, ${userId}, ${expiresAt}, ${req.headers['user-agent'] ?? null}, ${req.ip})`;
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE,
    path: '/',
    expires: expiresAt,
  });
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies[SESSION_COOKIE];
  if (token) {
    const id = hashToken(token);
    await sql`delete from sessions where id = ${id}`;
    await invalidate(`session:${id}`);
  }
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

async function resolveSession(token: string): Promise<SessionUser | null> {
  const id = hashToken(token);
  const userId = await cached<string | null>(`session:${id}`, CACHE_TTL_SECONDS, async () => {
    const [row] = await sql<{ userId: string }[]>`
      select user_id from sessions where id = ${id} and expires_at > now()`;
    return row?.userId ?? null;
  });
  if (!userId) return null;
  return cached<SessionUser | null>(userCacheKey(userId), CACHE_TTL_SECONDS, async () => {
    const [user] = await sql<SessionUser[]>`select id, email, name, timezone from users where id = ${userId}`;
    return user ?? null;
  });
}

/** Adds request.user (or null) to every request. */
export function registerSessionHook(fastify: FastifyInstance): void {
  fastify.decorateRequest('user', null);
  fastify.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    req.user = token ? await resolveSession(token) : null;
  });
}

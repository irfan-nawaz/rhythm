import { cookies, headers } from 'next/headers';
import type { Me } from './api';

/**
 * Server-side calls from this Next.js server to the API. They go over the
 * private network (API_INTERNAL_URL, e.g. http://api:4000 inside Kubernetes),
 * not through the public load balancer, and forward the visitor's cookie.
 *
 * process.env is read here at request time, not at build time, so the same
 * build can point at a different API in each environment.
 */
function apiUrl(): string {
  return process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
}

/** The signed-in user, or null if signed out. Throws if the API can't be reached. */
export async function getMe(): Promise<Me | null> {
  const cookieHeader = (await cookies()).toString();
  if (!cookieHeader.includes('rhythm_sid=')) return null;

  // Pass the load balancer's request id along, so one id follows the request
  // through the Next.js logs and the API logs.
  const requestId = (await headers()).get('x-request-id');
  const res = await fetch(`${apiUrl()}/api/me`, {
    headers: { cookie: cookieHeader, ...(requestId ? { 'x-request-id': requestId } : {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`The API answered ${res.status}`);
  const body = (await res.json()) as { user: Me };
  return body.user;
}

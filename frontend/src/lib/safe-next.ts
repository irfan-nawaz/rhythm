/**
 * Where to go after signing in, from ?next=. Only paths on this site: a link
 * like /login?next=https://evil.example must not send someone off-site
 * straight after they've typed their password.
 */
export function safeNext(value: string | string[] | undefined): string | undefined {
  const next = Array.isArray(value) ? value[0] : value;
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || next.length > 200) return undefined;
  return next;
}

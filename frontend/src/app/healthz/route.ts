// Liveness and readiness for the Next.js server itself. It deliberately
// doesn't call the API: if the API is down, restarting the frontend won't help.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
}

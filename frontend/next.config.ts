import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Loads translations from src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin();

// Where this Next.js server reaches the NestJS API over the private network.
// Server components read process.env.API_INTERNAL_URL at request time (see
// src/lib/server-api.ts), so one built image works in every environment.
const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  // Builds .next/standalone: Next's own server.js plus only the node_modules it
  // needs, for small container images. Copy public/ and .next/static in next
  // to it, or serve those two folders from the CDN.
  output: 'standalone',
  poweredByHeader: false,

  // Browsers call /api/* on the same origin as the pages, so the session
  // cookie needs no cross-site settings. In production the load balancer
  // should send /api/* straight to the API; this rewrite is the fallback that
  // makes local development work, with Next.js proxying the request.
  // Note: rewrites are resolved when the app is built.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        // The service worker must never be cached, or phones keep an old one.
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);

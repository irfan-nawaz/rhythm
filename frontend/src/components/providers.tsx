'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useEffect, useState, type ReactNode } from 'react';
import { Toaster } from '@/components/ui/sonner';

export const THEMES = ['light', 'dark', 'kids', 'large'] as const;

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // Refetch when you come back to the app, so Today is always current.
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
        },
      }),
  );

  useEffect(() => {
    // The service worker only shows push notifications; it doesn't cache
    // pages, so a new deploy is never hidden behind an old cached copy.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {});
    }
  }, []);

  return (
    // next-themes sets data-theme on <html> before the page paints, so there's
    // no flash of the wrong theme. "system" follows the device's dark mode.
    <ThemeProvider attribute="data-theme" themes={[...THEMES]} defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster position="top-center" />
      </QueryClientProvider>
    </ThemeProvider>
  );
}

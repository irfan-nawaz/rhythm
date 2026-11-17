import '@fontsource-variable/atkinson-hyperlegible-next';
// Atkinson has no Devanagari. Browsers download these files only when a page
// shows Hindi text (unicode-range), so English readers never pay for them.
import '@fontsource-variable/noto-sans-devanagari';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: { default: 'Rhythm', template: '%s | Rhythm' },
  description: 'Daily routines, chores, workouts and meals for you and your family.',
  appleWebApp: { capable: true, title: 'Rhythm', statusBarStyle: 'default' },
  // The tab icon is src/app/favicon.ico (Next adds the link tag for it).
  icons: { apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#14172e' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    // suppressHydrationWarning: next-themes sets data-theme before React loads.
    <html lang={locale} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useTheme } from 'next-themes';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { api, type Me } from '@/lib/api';
import { LOCALE_COOKIE } from '@/i18n/config';

const MeContext = createContext<Me | null>(null);

export function setLocaleCookie(locale: string) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * The server layout fetched the user; this keeps it fresh on the client, and
 * applies the theme and language saved to their account. That's how a new
 * phone picks up your settings the first time you sign in.
 */
export function MeProvider({ me, children }: { me: Me; children: ReactNode }) {
  const router = useRouter();
  const locale = useLocale();
  const { theme, setTheme } = useTheme();
  const { data } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ user: Me }>('/api/me').then((r) => r.user),
    initialData: me,
  });

  useEffect(() => {
    if (data.theme && theme && data.theme !== theme) setTheme(data.theme);
    // only when the saved preference changes, not on every local switch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.theme]);

  useEffect(() => {
    if (data.locale && data.locale !== locale) {
      setLocaleCookie(data.locale);
      router.refresh(); // re-render server components in the new language
    }
  }, [data.locale, locale, router]);

  return <MeContext value={data}>{children}</MeContext>;
}

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe must be used inside MeProvider');
  return me;
}

import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { defaultLocale, isLocale, LOCALE_COOKIE } from './config';

type Messages = Record<string, unknown>;

/** Untranslated keys fall back to English. */
function withFallback(base: Messages, override: Messages): Messages {
  const result: Messages = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const fallback = base[key];
    result[key] =
      value && typeof value === 'object' && fallback && typeof fallback === 'object'
        ? withFallback(fallback as Messages, value as Messages)
        : value;
  }
  return result;
}

// The language comes from a cookie (set from each person's saved preference),
// not from the URL, so links stay the same in every language.
export default getRequestConfig(async () => {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(fromCookie) ? fromCookie : defaultLocale;
  const english = (await import('../../messages/en.json')).default as Messages;
  const messages = locale === 'en' ? english : withFallback(english, (await import(`../../messages/${locale}.json`)).default);
  return { locale, messages };
});

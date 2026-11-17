// Languages Rhythm can show. To add one: add its code here, add a column in
// the backend's users.locale check, and add messages/<code>.json. Any key a
// language doesn't translate yet falls back to English.
export const locales = ['en', 'hi'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';
export const LOCALE_COOKIE = 'rhythm_locale';

export function isLocale(value: string | undefined): value is Locale {
  return locales.includes(value as Locale);
}

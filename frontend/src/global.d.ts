// Types every translation key against the English catalogue, so a typo in
// t('...') or a key missing from messages/en.json fails the type check
// instead of showing a raw key to someone at runtime.

import type messages from '../messages/en.json';
import type { Locale } from './i18n/config';

declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}

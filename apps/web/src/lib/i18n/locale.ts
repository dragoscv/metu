import en from './messages/en.json';
import ro from './messages/ro.json';

export const LOCALES = ['en', 'ro'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'metu_locale';

export const MESSAGES: Record<Locale, typeof en> = { en, ro };

export const LOCALE_LABELS: Record<Locale, { label: string; flag: string }> = {
  en: { label: 'English', flag: '🇬🇧' },
  ro: { label: 'Română', flag: '🇷🇴' },
};

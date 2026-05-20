import { cookies } from 'next/headers';
import { MESSAGES, LOCALES, LOCALE_COOKIE, DEFAULT_LOCALE, type Locale } from './locale';

export async function getLocale(): Promise<Locale> {
  const c = await cookies();
  const v = c.get(LOCALE_COOKIE)?.value;
  return (LOCALES as readonly string[]).includes(v ?? '') ? (v as Locale) : DEFAULT_LOCALE;
}

export async function getMessages(locale?: Locale) {
  const l = locale ?? (await getLocale());
  return MESSAGES[l];
}

import { en, type MessageKey } from './en.js';

/**
 * Supported UI locales. The product currently ships English only.
 * To add a locale: create a dictionary with the same keys (typed as Record<MessageKey, string>),
 * add its code to `Locale`, `LOCALES` and `DICTS`, and extend `normalizeLocale`.
 */
export type Locale = 'en';
export const LOCALES: Locale[] = ['en'];
export const DEFAULT_LOCALE: Locale = 'en';
/** Native display name of each locale (for language pickers). */
export const LOCALE_LABELS: Record<Locale, string> = { en: 'English' };
const DICTS: Record<Locale, Record<MessageKey, string>> = { en };

export function t(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  let s: string = DICTS[locale]?.[key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}
export function translator(locale: Locale) { return (key: MessageKey, vars?: Record<string, string | number>) => t(locale, key, vars); }
export function normalizeLocale(v: string | undefined | null): Locale {
  const code = (v ?? '').toLowerCase().slice(0, 2);
  return (LOCALES as string[]).includes(code) ? (code as Locale) : DEFAULT_LOCALE;
}
export type { MessageKey };
export { en };

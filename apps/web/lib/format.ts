import { formatMoney, countryName } from '@globalhub/shared';
export { formatMoney, countryName };
export function fmtDate(d: string | Date | null | undefined, locale = 'en') {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(locale === 'en' ? 'en-US' : locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function fmtDay(d: string | Date | null | undefined, locale = 'en') {
  if (!d) return '—';
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(locale === 'en' ? 'en-US' : locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

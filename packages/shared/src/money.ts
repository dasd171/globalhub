/** Currency exponents (number of minor-unit digits). Default 2. */
const EXPONENTS: Record<string, number> = { JPY: 0, KRW: 0, VND: 0, CLP: 0, BHD: 3, KWD: 3 };

export function currencyExponent(currency: string): number {
  return EXPONENTS[currency.toUpperCase()] ?? 2;
}

/** Convert a decimal string ("12.34") to integer minor units without floating point math. */
export function toMinor(amount: string | number, currency: string): number {
  const exp = currencyExponent(currency);
  const s = typeof amount === 'number' ? amount.toFixed(exp) : amount.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid amount: ${amount}`);
  const negative = s.startsWith('-');
  const [intPart, frac = ''] = s.replace('-', '').split('.');
  if (frac.length > exp) throw new Error(`Too many decimal places for ${currency}: ${amount}`);
  const minor = BigInt(intPart) * 10n ** BigInt(exp) + BigInt((frac + '0'.repeat(exp)).slice(0, exp) || '0');
  const n = Number(negative ? -minor : minor);
  if (!Number.isSafeInteger(n)) throw new Error('Amount out of range');
  return n;
}

/** Format minor units as a decimal string ("1234" USD -> "12.34"). */
export function fromMinor(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  if (exp === 0) return String(minor);
  const negative = minor < 0;
  const abs = Math.abs(minor).toString().padStart(exp + 1, '0');
  return `${negative ? '-' : ''}${abs.slice(0, -exp)}.${abs.slice(-exp)}`;
}

export function formatMoney(minor: number | null | undefined, currency: string, locale = 'en'): string {
  if (minor === null || minor === undefined) return '—';
  const exp = currencyExponent(currency);
  try {
    return new Intl.NumberFormat(locale === 'en' ? 'en-US' : locale, {
      style: 'currency', currency, minimumFractionDigits: exp, maximumFractionDigits: exp,
    }).format(Number(fromMinor(minor, currency)));
  } catch {
    return `${fromMinor(minor, currency)} ${currency}`;
  }
}

/** Integer multiply with overflow check. */
export function mulMinor(unitMinor: number, qty: number): number {
  const r = unitMinor * qty;
  if (!Number.isSafeInteger(r)) throw new Error('Amount overflow');
  return r;
}

export function sumMinor(values: number[]): number {
  const r = values.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(r)) throw new Error('Amount overflow');
  return r;
}

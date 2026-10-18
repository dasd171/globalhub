/** Small built-in country table (ISO 3166-1 alpha-2, English short names). Extend as needed. */
export const COUNTRIES: Record<string, { en: string; aliases?: string[] }> = {
  JP: { en: 'Japan' },
  US: { en: 'United States', aliases: ['usa', 'america', 'united states of america', 'u.s.'] },
  GB: { en: 'United Kingdom', aliases: ['uk', 'england', 'britain'] },
  DE: { en: 'Germany' },
  FR: { en: 'France' },
  ES: { en: 'Spain' },
  IT: { en: 'Italy' },
  NL: { en: 'Netherlands' },
  CA: { en: 'Canada' },
  AU: { en: 'Australia' },
  KR: { en: 'South Korea', aliases: ['korea'] },
  SG: { en: 'Singapore' },
  MY: { en: 'Malaysia' },
  TH: { en: 'Thailand' },
  VN: { en: 'Vietnam' },
  IN: { en: 'India' },
  AE: { en: 'United Arab Emirates', aliases: ['uae', 'dubai'] },
  SA: { en: 'Saudi Arabia' },
  BR: { en: 'Brazil' },
  MX: { en: 'Mexico' },
  RU: { en: 'Russia' },
  ZA: { en: 'South Africa' },
  NG: { en: 'Nigeria' },
  NZ: { en: 'New Zealand' },
  PH: { en: 'Philippines' },
  ID: { en: 'Indonesia' },
  PL: { en: 'Poland' },
  TR: { en: 'Turkey' },
  HK: { en: 'Hong Kong' },
};

export function countryName(code: string | null | undefined, locale = 'en'): string {
  if (!code) return '—';
  const c = COUNTRIES[code.toUpperCase()];
  if (!c) return code.toUpperCase();
  void locale;
  return c.en;
}

export function findCountryInText(text: string): string | null {
  const lower = ` ${text.toLowerCase()} `;
  for (const [code, c] of Object.entries(COUNTRIES)) {
    const names = [c.en.toLowerCase(), ...(c.aliases ?? [])];
    for (const n of names) {
      const re = new RegExp(`[^a-z]${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z]`);
      if (re.test(lower)) return code;
    }
  }
  return null;
}

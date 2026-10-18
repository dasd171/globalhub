import Link from 'next/link';
import type { ReactNode } from 'react';
import { t, type Locale, type MessageKey } from '@globalhub/i18n';
import { formatMoney } from '@/lib/format';

const STOCK_COLORS: Record<string, string> = { IN_STOCK: 'bg-green-100 text-green-800', LOW_STOCK: 'bg-amber-100 text-amber-800', MADE_TO_ORDER: 'bg-blue-100 text-blue-800', ON_REQUEST: 'bg-purple-100 text-purple-800', OUT_OF_STOCK: 'bg-gray-200 text-gray-700', UNVERIFIED: 'bg-gray-100 text-gray-600 ring-1 ring-gray-300' };
export function StockBadge({ status, locale }: { status: string; locale: Locale }) {
  return <span className={`badge ${STOCK_COLORS[status] ?? 'bg-gray-100'}`}>{t(locale, `stock.${status}` as MessageKey)}</span>;
}
export function VerifyBadge({ status, locale }: { status: string; locale: Locale }) {
  const strong = status === 'BUSINESS_VERIFIED' || status === 'ADMIN_REVIEWED';
  return <span className={`badge ${strong ? 'bg-emerald-100 text-emerald-800' : status === 'SUSPENDED' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-600'}`}>{strong ? '✓ ' : ''}{t(locale, `verify.${status}` as MessageKey)}</span>;
}
export function TrustBadge({ level, locale }: { level: string; locale: Locale }) {
  return <span className={`badge ${level === 'ADMIN_REVIEWED' || level === 'BUSINESS_VERIFIED' ? 'bg-emerald-100 text-emerald-800' : level === 'DOMAIN_VERIFIED' ? 'bg-sky-100 text-sky-800' : 'bg-gray-100 text-gray-600'}`}>{t(locale, `trust.${level}` as MessageKey)}</span>;
}
export function DemoBadge({ locale }: { locale: Locale }) { return <span className="badge bg-yellow-200 text-yellow-900" title={t(locale, 'common.demoData')}>{t(locale, 'common.demo')}</span>; }
export function StatusPill({ status }: { status: string }) { return <span className="badge bg-gray-100 font-mono text-[11px] text-ink-700">{status}</span>; }
export function Money({ minor, currency, locale }: { minor: number | null | undefined; currency: string | null | undefined; locale: Locale }) {
  return <span className="tabular-nums">{minor == null || !currency ? '—' : formatMoney(minor, currency, locale)}</span>;
}

export function Placeholder({ label }: { label?: string }) {
  return (
    <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 text-gray-400" aria-label={label ?? 'No image'}>
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m3 16 5-5 4 4 3-3 6 6" /><circle cx="15.5" cy="8.5" r="1.5" /></svg>
    </div>
  );
}

export function ProductCard({ p, locale }: { p: any; locale: Locale }) {
  const img = p.images?.[0]?.url;
  const tiers = (p.priceTiers ?? []).filter((x: any) => x.unitPriceMinor != null).map((x: any) => x.unitPriceMinor);
  const from = tiers.length ? Math.min(...tiers) : p.basePriceMinor;
  return (
    <Link href={`/products/${p.id}`} className="card group flex flex-col gap-3 p-3 transition hover:shadow-md">
      {img ? <img src={img} alt={p.title} className="aspect-[4/3] w-full rounded-lg object-cover" loading="lazy" /> : <Placeholder />}
      <div className="flex flex-wrap gap-1"><StockBadge status={p.stockStatus} locale={locale} />{p.isDemo && <DemoBadge locale={locale} />}</div>
      <h3 className="line-clamp-2 text-sm font-medium group-hover:text-brand-600">{p.title}</h3>
      <div className="mt-auto text-sm">
        {from != null ? <><span className="font-semibold"><Money minor={from} currency={p.currency} locale={locale} /></span> <span className="muted">{t(locale, 'common.from')}</span></> : <span className="muted">{t(locale, 'common.priceOnRequest')}</span>}
        <div className="muted">{t(locale, 'common.moq')}: {p.moq}</div>
        <div className="mt-1 flex items-center gap-1 truncate text-xs text-ink-500">{p.supplier?.companyName} <VerifyBadge status={p.supplier?.verificationStatus ?? 'UNVERIFIED'} locale={locale} /></div>
      </div>
    </Link>
  );
}

export function Empty({ children }: { children: ReactNode }) { return <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-ink-500">{children}</div>; }
export function ErrorBox({ error }: { error: { status: number; message: string } }) {
  return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error.status === 401 ? 'Please sign in to view this page.' : error.message} {error.status === 401 && <Link className="underline" href="/login">Sign in</Link>}</div>;
}
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><h1 className="h1">{title}</h1>{subtitle && <p className="mt-1 muted max-w-2xl">{subtitle}</p>}</div>{actions}</div>;
}
export function SideNav({ items, active }: { items: { href: string; label: string }[]; active?: string }) {
  return (
    <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Section">
      {items.map((i) => <Link key={i.href} href={i.href} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${active === i.href ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-700 hover:bg-gray-100'}`}>{i.label}</Link>)}
    </nav>
  );
}
export function Pagination({ page, totalPages, baseHref }: { page: number; totalPages: number; baseHref: string }) {
  if (totalPages <= 1) return null;
  const sep = baseHref.includes('?') ? '&' : '?';
  return (
    <div className="mt-6 flex items-center justify-center gap-3 text-sm">
      {page > 1 && <Link className="btn-secondary" href={`${baseHref}${sep}page=${page - 1}`}>←</Link>}
      <span className="muted">{page} / {totalPages}</span>
      {page < totalPages && <Link className="btn-secondary" href={`${baseHref}${sep}page=${page + 1}`}>→</Link>}
    </div>
  );
}

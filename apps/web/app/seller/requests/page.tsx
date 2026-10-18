import Link from 'next/link';
import { t } from '@globalhub/i18n';
import { getLocale, load } from '@/lib/server';
import { PageHeader, StatusPill, Money, Empty, ErrorBox, Pagination } from '@/components/ui';
import { countryName, fmtDay } from '@/lib/format';
export default async function Hall({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const sp = await searchParams;
  const locale = await getLocale();
  const res = await load<any>(`/buying-requests/open?page=${sp.page ?? 1}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ''}`);
  return (
    <div><PageHeader title={t(locale, 'seller.hall')} subtitle="Open buying requests from buyers worldwide. Buyer identities are not shown." actions={<form><input name="q" defaultValue={sp.q} className="input" placeholder={t(locale, 'common.search')} /></form>} />
      {res.error ? <ErrorBox error={res.error} /> : !res.data.items.length ? <Empty>{t(locale, 'common.none')}</Empty> : (
        <><ul className="space-y-3">{res.data.items.map((r: any) => (
          <li key={r.id} className="card">
            <div className="flex flex-wrap items-center justify-between gap-2"><Link className="font-semibold hover:underline" href={`/seller/requests/${r.id}`}>{r.title}</Link><div className="flex gap-2">{r.originNode && <span className="badge bg-indigo-100 text-indigo-800">{r.originNode.displayName}</span>}{r.productId && <span className="badge bg-purple-100 text-purple-800">For your product</span>}{r.myQuoteStatus && <StatusPill status={`my quote: ${r.myQuoteStatus}`} />}</div></div>
            <p className="muted mt-1">{r.quantity} {r.unit} → {countryName(r.destinationCountry, locale)} · {r.buyerLabel} · {r.quoteCount} quotes · {fmtDay(r.createdAt, locale)}{r.targetUnitPriceMinor != null && <> · Target <Money minor={r.targetUnitPriceMinor} currency={r.currency} locale={locale} /></>}</p>
          </li>
        ))}</ul><Pagination page={res.data.page} totalPages={res.data.totalPages} baseHref={`/seller/requests${sp.q ? `?q=${encodeURIComponent(sp.q)}` : ''}`} /></>
      )}
    </div>
  );
}

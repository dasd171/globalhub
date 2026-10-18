import Link from 'next/link';
import { t } from '@globalhub/i18n';
import { SUPPLIER_TYPES, STOCK_STATUSES } from '@globalhub/shared';
import { getLocale, load } from '@/lib/server';
import { ProductCard, Empty, ErrorBox, Pagination, TrustBadge, StockBadge, Money } from '@/components/ui';

type SP = Record<string, string | undefined>;
export default async function Products({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const locale = await getLocale();
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
  if (!qs.get('sort')) qs.set('sort', sp.q ? 'relevance' : 'newest');
  const [res, cats] = await Promise.all([load<any>(`/products?${qs}`), load<any[]>('/categories')]);
  const base = `/products?${new URLSearchParams([...qs].filter(([k]) => k !== 'page'))}`;
  const sel = (name: string, opts: { v: string; l: string }[], label: string) => (
    <div><label className="label" htmlFor={name}>{label}</label><select id={name} name={name} defaultValue={sp[name] ?? ''} className="input"><option value="">—</option>{opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select></div>
  );
  return (
    <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
      <aside>
        <form className="card space-y-4" action="/products">
          <h2 className="h2">{t(locale, 'products.filters')}</h2>
          <div><label className="label" htmlFor="q">{t(locale, 'products.keyword')}</label><input id="q" name="q" defaultValue={sp.q} className="input" /></div>
          {sel('category', (cats.data ?? []).map((c) => ({ v: c.slug, l: c.nameEn })), t(locale, 'products.category'))}
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label" htmlFor="minPrice">Min</label><input id="minPrice" name="minPrice" type="number" min={0} defaultValue={sp.minPrice} className="input" /></div>
            <div><label className="label" htmlFor="maxPrice">Max</label><input id="maxPrice" name="maxPrice" type="number" min={0} defaultValue={sp.maxPrice} className="input" /></div>
          </div>
          <p className="-mt-2 text-xs text-ink-500">{t(locale, 'products.minPrice').replace(/^.*?\(/, '(')}</p>
          {sel('currency', ['USD', 'CNY', 'EUR', 'JPY'].map((c) => ({ v: c, l: c })), t(locale, 'common.currency'))}
          {sel('supplierType', SUPPLIER_TYPES.map((s) => ({ v: s, l: s.replace(/_/g, ' ').toLowerCase() })), t(locale, 'products.supplierType'))}
          <div><label className="label" htmlFor="maxMoq">{t(locale, 'products.maxMoq')}</label><input id="maxMoq" name="maxMoq" type="number" min={1} defaultValue={sp.maxMoq} className="input" /></div>
          <div><label className="label" htmlFor="destination">{t(locale, 'common.destination')}</label><input id="destination" name="destination" maxLength={2} placeholder="JP" defaultValue={sp.destination} className="input uppercase" /></div>
          <div><label className="label" htmlFor="shipsFrom">{t(locale, 'common.shipsFrom')}</label><input id="shipsFrom" name="shipsFrom" placeholder="City or country" defaultValue={sp.shipsFrom} className="input" /></div>
          {sel('stockStatus', STOCK_STATUSES.map((s) => ({ v: s, l: t(locale, `stock.${s}`) })), t(locale, 'products.stockStatus'))}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="customizable" value="true" defaultChecked={sp.customizable === 'true'} /> {t(locale, 'products.customizable')}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="verifiedOnly" value="true" defaultChecked={sp.verifiedOnly === 'true'} /> {t(locale, 'products.verifiedOnly')}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="includeRemote" value="true" defaultChecked={sp.includeRemote === 'true'} /> {t(locale, 'products.includeRemote')}</label>
          {sel('sort', [{ v: 'relevance', l: 'Relevance' }, { v: 'newest', l: 'Newest' }, { v: 'price_asc', l: 'Price ↑' }, { v: 'price_desc', l: 'Price ↓' }, { v: 'moq_asc', l: 'MOQ ↑' }], t(locale, 'products.sort'))}
          <button className="btn-primary w-full">{t(locale, 'common.filter')}</button>
        </form>
      </aside>
      <section>
        <h1 className="h1 mb-1">{t(locale, 'products.title')}</h1>
        {res.error ? <ErrorBox error={res.error} /> : (
          <>
            <p className="muted mb-4" data-testid="result-count">{t(locale, 'products.results', { n: res.data.total })}</p>
            {res.data.items.length ? (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">{res.data.items.map((p: any) => (
                <div key={p.id}><ProductCard p={p} locale={locale} />{res.data.matchInfo?.[p.id] && <p className="mt-1 text-xs text-ink-500">{res.data.matchInfo[p.id].reasons.slice(0, 2).join(' · ')}</p>}</div>
              ))}</div>
            ) : <Empty>{t(locale, 'products.noResults')} <Link href="/requests/new" className="text-brand-600 underline">{t(locale, 'products.postInstead')}</Link></Empty>}
            <Pagination page={res.data.page} totalPages={res.data.totalPages} baseHref={base} />
            {res.data.remote?.length > 0 && (
              <div className="mt-10">
                <h2 className="h2 mb-1">{t(locale, 'products.remoteResults')}</h2>
                <p className="muted mb-3">{t(locale, 'common.remoteNotice')}</p>
                <div className="grid gap-3 md:grid-cols-2">{res.data.remote.map((r: any) => (
                  <Link key={r.id} href={`/remote/${r.id}`} className="card flex flex-col gap-2 p-4 hover:shadow-md" data-testid="remote-result">
                    <div className="flex flex-wrap items-center gap-2 text-xs"><span className="badge bg-indigo-100 text-indigo-800">{t(locale, 'common.remote')}: {r.node.displayName}</span><TrustBadge level={r.node.trustLevel} locale={locale} /><StockBadge status={r.stockStatus} locale={locale} /></div>
                    <span className="font-medium">{r.title}</span>
                    <span className="text-sm">{r.priceFromMinor != null ? <Money minor={r.priceFromMinor} currency={r.currency} locale={locale} /> : t(locale, 'common.priceOnRequest')} · {t(locale, 'common.moq')} {r.moq}</span>
                  </Link>
                ))}</div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

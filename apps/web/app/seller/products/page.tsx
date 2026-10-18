import Link from 'next/link';
import { t } from '@globalhub/i18n';
import { getLocale, load } from '@/lib/server';
import { PageHeader, StockBadge, StatusPill, Money, Empty, ErrorBox, Pagination } from '@/components/ui';
import { fmtDay } from '@/lib/format';
export default async function SellerProducts({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page } = await searchParams;
  const locale = await getLocale();
  const res = await load<any>(`/seller/products?page=${page ?? 1}`);
  return (
    <div><PageHeader title={t(locale, 'seller.products')} actions={<Link href="/seller/products/new" className="btn-primary">{t(locale, 'seller.newProduct')}</Link>} />
      {res.error ? <ErrorBox error={res.error} /> : !res.data.items.length ? <Empty>{t(locale, 'common.none')}</Empty> : (
        <><div className="card overflow-x-auto p-0"><table className="table"><thead><tr><th>Product</th><th>SKU / stock</th><th>{t(locale, 'common.price')}</th><th>{t(locale, 'common.moq')}</th><th>{t(locale, 'common.status')}</th></tr></thead>
          <tbody>{res.data.items.map((p: any) => <tr key={p.id}><td><Link className="font-medium hover:underline" href={`/seller/products/${p.id}`}>{p.titleEn ?? p.titleZh}</Link><div className="text-xs text-ink-500">{p.titleEn}</div></td>
            <td className="text-xs">{p.variants.map((v: any) => <div key={v.id}><span className="font-mono">{v.sku}</span> · {v.onHand - v.reserved}/{v.onHand} · {v.verifiedAt ? fmtDay(v.verifiedAt, locale) : 'unverified'}</div>)}</td>
            <td><Money minor={p.basePriceMinor} currency={p.currency} locale={locale} /></td><td>{p.moq}</td><td><StatusPill status={p.status} /> <StockBadge status={p.stockStatus} locale={locale} /></td></tr>)}</tbody></table></div>
          <Pagination page={res.data.page} totalPages={res.data.totalPages} baseHref="/seller/products" /></>
      )}
    </div>
  );
}

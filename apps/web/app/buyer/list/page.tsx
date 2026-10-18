import Link from 'next/link';
import { t } from '@globalhub/i18n';
import { getLocale, load } from '@/lib/server';
import { PageHeader, Money, StockBadge, Empty, ErrorBox } from '@/components/ui';
import { ActionButton } from '@/components/ActionButton';
export default async function List() {
  const locale = await getLocale();
  const res = await load<any>('/users/me/sourcing-list');
  if (res.error) return <ErrorBox error={res.error} />;
  return (
    <div><PageHeader title={t(locale, 'buyer.list')} subtitle="Shortlist products, then request quotes or order from each supplier." />
      {!res.data.items.length ? <Empty>{t(locale, 'common.none')}</Empty> : (
        <div className="card overflow-x-auto p-0"><table className="table"><thead><tr><th>Product</th><th>Store</th><th>{t(locale, 'common.quantity')}</th><th>{t(locale, 'common.price')}</th><th>{t(locale, 'common.moq')}</th><th /></tr></thead>
          <tbody>{res.data.items.map((i: any) => <tr key={i.id}><td><Link className="hover:underline" href={`/products/${i.product.id}`}>{i.product.titleEn ?? i.product.titleZh}</Link> <StockBadge status={i.product.stockStatus} locale={locale} /></td><td className="text-xs">{i.product.store.name}</td><td>{i.quantity}</td><td><Money minor={i.product.basePriceMinor} currency={i.product.currency} locale={locale} /></td><td>{i.product.moq}{i.quantity < i.product.moq && <span className="ml-1 text-xs text-red-700">below MOQ</span>}</td><td><ActionButton action={`/users/me/sourcing-list/${i.product.id}`} method="DELETE" label="✕" variant="ghost" /></td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

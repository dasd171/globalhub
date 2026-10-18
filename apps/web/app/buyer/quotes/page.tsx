import Link from 'next/link';
import { t } from '@globalhub/i18n';
import { getLocale, load } from '@/lib/server';
import { PageHeader, StatusPill, Money, Empty, ErrorBox } from '@/components/ui';
import { fmtDay } from '@/lib/format';
export default async function Quotes() {
  const locale = await getLocale();
  const res = await load<any[]>('/quotes/received');
  return (
    <div><PageHeader title={t(locale, 'buyer.quotes')} />
      {res.error ? <ErrorBox error={res.error} /> : !res.data.length ? <Empty>{t(locale, 'common.none')}</Empty> : (
        <div className="card overflow-x-auto p-0"><table className="table"><thead><tr><th>Request</th><th>{t(locale, 'common.supplier')}</th><th>{t(locale, 'quote.unitPrice')}</th><th>{t(locale, 'common.moq')}</th><th>{t(locale, 'quote.validUntil')}</th><th>{t(locale, 'common.status')}</th></tr></thead>
          <tbody>{res.data.map((q: any) => <tr key={q.id}><td><Link className="hover:underline" href={`/buyer/requests/${q.buyingRequest.id}`}>{q.buyingRequest.title}</Link></td><td>{q.supplier.companyName}</td><td><Money minor={q.unitPriceMinor} currency={q.currency} locale={locale} /></td><td>{q.moq}</td><td>{fmtDay(q.validUntil, locale)}</td><td><StatusPill status={q.status} /></td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

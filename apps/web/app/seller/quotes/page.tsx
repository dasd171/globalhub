import Link from 'next/link';
import { t } from '@globalhub/i18n';
import { getLocale, load } from '@/lib/server';
import { PageHeader, StatusPill, Money, Empty, ErrorBox } from '@/components/ui';
import { ActionButton } from '@/components/ActionButton';
import { fmtDay } from '@/lib/format';
export default async function MyQuotes() {
  const locale = await getLocale();
  const res = await load<any[]>('/quotes/mine');
  return (
    <div><PageHeader title={t(locale, 'seller.quotes')} />
      {res.error ? <ErrorBox error={res.error} /> : !res.data.length ? <Empty>{t(locale, 'common.none')}</Empty> : (
        <div className="card overflow-x-auto p-0"><table className="table"><thead><tr><th>Request</th><th>{t(locale, 'quote.unitPrice')}</th><th>{t(locale, 'common.moq')}</th><th>{t(locale, 'quote.validUntil')}</th><th>{t(locale, 'common.status')}</th><th /></tr></thead>
          <tbody>{res.data.map((q: any) => <tr key={q.id}><td><Link className="hover:underline" href={`/seller/requests/${q.buyingRequest?.id}`}>{q.buyingRequest?.title}</Link></td><td><Money minor={q.unitPriceMinor} currency={q.currency} locale={locale} /></td><td>{q.moq}</td><td>{fmtDay(q.validUntil, locale)}</td><td><StatusPill status={q.status} /></td><td>{['SUBMITTED', 'VIEWED', 'DRAFT'].includes(q.status) && <ActionButton action={`/quotes/${q.id}/withdraw`} label="Withdraw" variant="ghost" />}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

import Link from 'next/link';
import { t } from '@globalhub/i18n';
import { getLocale, load } from '@/lib/server';
import { PageHeader, StatusPill, Empty, ErrorBox } from '@/components/ui';
import { fmtDay, countryName } from '@/lib/format';

export default async function MyRequests() {
  const locale = await getLocale();
  const res = await load<any>('/buying-requests/mine?pageSize=50');
  return (
    <div>
      <PageHeader title={t(locale, 'buyer.requests')} actions={<Link href="/requests/new" className="btn-primary">{t(locale, 'nav.post')}</Link>} />
      {res.error ? <ErrorBox error={res.error} /> : res.data.items.length === 0 ? <Empty>{t(locale, 'common.none')}</Empty> : (
        <div className="card overflow-x-auto p-0"><table className="table"><thead><tr><th>{t(locale, 'request.field.title')}</th><th>{t(locale, 'common.quantity')}</th><th>{t(locale, 'common.destination')}</th><th>{t(locale, 'common.status')}</th><th>{t(locale, 'request.quotes')}</th><th /></tr></thead>
          <tbody>{res.data.items.map((r: any) => <tr key={r.id}><td><Link className="font-medium hover:underline" href={`/buyer/requests/${r.id}`}>{r.title}</Link><div className="text-xs text-ink-500">{fmtDay(r.createdAt, locale)} · {r.visibility}</div></td><td>{r.quantity} {r.unit}</td><td>{countryName(r.destinationCountry, locale)}</td><td><StatusPill status={r.status} /></td><td>{r.quoteCount}</td><td /></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

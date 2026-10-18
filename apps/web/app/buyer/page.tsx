import Link from 'next/link';
import { t } from '@globalhub/i18n';
import { getLocale, getMe, load } from '@/lib/server';
import { PageHeader, StatusPill } from '@/components/ui';

export default async function BuyerHome() {
  const locale = await getLocale();
  const me = (await getMe())!;
  const [reqs, orders] = await Promise.all([load<any>('/buying-requests/mine?pageSize=5'), load<any>('/orders?pageSize=5')]);
  return (
    <div className="space-y-6">
      <PageHeader title={`${t(locale, 'buyer.title')} · ${me.displayName}`} actions={<Link href="/requests/new" className="btn-primary">{t(locale, 'nav.post')}</Link>} />
      {!me.emailVerified && <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">Your email is not verified yet. Check your inbox.</p>}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="card"><h2 className="h2 mb-2">{t(locale, 'buyer.requests')}</h2><ul className="space-y-1 text-sm">{(reqs.data?.items ?? []).map((r: any) => <li key={r.id}><Link className="hover:underline" href={`/buyer/requests/${r.id}`}>{r.title}</Link> <StatusPill status={r.status} /> · {r.quoteCount} quotes</li>)}</ul></div>
        <div className="card"><h2 className="h2 mb-2">{t(locale, 'buyer.orders')}</h2><ul className="space-y-1 text-sm">{(orders.data?.items ?? []).map((o: any) => <li key={o.id}><Link className="hover:underline" href={`/buyer/orders/${o.id}`}>{o.orderNumber}</Link> <StatusPill status={o.status} /></li>)}</ul></div>
      </div>
    </div>
  );
}

import Link from 'next/link';
import { t } from '@globalhub/i18n';
import { getLocale, load } from '@/lib/server';
import { PageHeader, Empty, ErrorBox, StatusPill } from '@/components/ui';
export default async function Disputes() {
  const locale = await getLocale();
  const res = await load<any[]>('/disputes?scope=mine');
  if (res.error) return <ErrorBox error={res.error} />;
  return (
    <div><PageHeader title={t(locale, 'buyer.disputes')} subtitle="Refund requests are made from the order page. Disputes are reviewed by moderators." />
      {!res.data.length ? <Empty>{t(locale, 'common.none')}</Empty> : <ul className="card divide-y p-0">{res.data.map((d) => <li key={d.id} className="p-4 text-sm"><Link className="font-mono hover:underline" href={`/buyer/orders/${d.orderId}`}>{d.order.orderNumber}</Link> <StatusPill status={d.status} /><p>{d.reason}</p>{d.resolution && <p className="text-xs text-ink-500">Resolution: {d.resolution}</p>}</li>)}</ul>}
    </div>
  );
}

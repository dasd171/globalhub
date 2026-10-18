import Link from 'next/link';
import { load } from '@/lib/server';
import { ErrorBox, PageHeader, StatusPill } from '@/components/ui';
export default async function Disputes() {
  const res = await load<any[]>('/disputes?scope=all');
  if (res.error) return <ErrorBox error={res.error} />;
  return (
    <div><PageHeader title="Disputes" subtitle="Open the order to read evidence and resolve." />
      <ul className="card divide-y p-0">{res.data.map((d) => <li key={d.id} className="p-4 text-sm"><Link className="font-mono hover:underline" href={`/buyer/orders/${d.orderId}`}>{d.order.orderNumber}</Link> <StatusPill status={d.status} /> <StatusPill status={d.order.status} /><p>{d.reason}</p><p className="text-xs text-ink-500">{d.evidence.length} statements</p></li>)}</ul>
    </div>
  );
}

import { load } from '@/lib/server';
import { ErrorBox, PageHeader, StatusPill } from '@/components/ui';
import { ActionButton } from '@/components/ActionButton';
export default async function Requests() {
  const res = await load<any[]>('/admin/buying-requests');
  if (res.error) return <ErrorBox error={res.error} />;
  return (
    <div><PageHeader title="Buying requests (moderation)" />
      <div className="card overflow-x-auto p-0"><table className="table"><thead><tr><th>Title</th><th>Qty</th><th>Visibility</th><th>Status</th><th>Quotes</th><th /></tr></thead>
        <tbody>{res.data.map((r) => <tr key={r.id}><td>{r.title}{r.originNodeId && <span className="badge ml-1 bg-indigo-100">remote</span>}</td><td>{r.quantity} → {r.destinationCountry}</td><td>{r.visibility}</td><td><StatusPill status={r.status} /></td><td>{r._count.quotes}</td><td>{r.status === 'OPEN' && <ActionButton action={`/admin/buying-requests/${r.id}`} method="PATCH" body={{ status: 'CANCELLED' }} label="Remove" variant="ghost" confirm="Remove this request?" />}</td></tr>)}</tbody></table></div>
    </div>
  );
}

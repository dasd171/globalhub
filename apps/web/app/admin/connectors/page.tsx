import { load } from '@/lib/server';
import { ErrorBox, PageHeader, StatusPill } from '@/components/ui';
import { ActionButton } from '@/components/ActionButton';
export default async function Connectors() {
  const res = await load<any[]>('/admin/connectors');
  if (res.error) return <ErrorBox error={res.error} />;
  return (
    <div><PageHeader title="Connectors" />
      <div className="card overflow-x-auto p-0"><table className="table"><thead><tr><th>Name</th><th>Store</th><th>Capabilities</th><th>Status</th><th /></tr></thead>
        <tbody>{res.data.map((c) => <tr key={c.id}><td>{c.name} <span className="badge bg-gray-100">{c.type}</span></td><td className="text-xs">{c.store.name}</td><td className="text-xs">{c.capabilities.join(', ')}</td><td><StatusPill status={c.status} />{c.lastError && <div className="text-xs text-red-700">{c.lastError}</div>}</td><td>{c.status !== 'DISABLED' ? <ActionButton action={`/admin/connectors/${c.id}`} method="PATCH" body={{ status: 'DISABLED' }} label="Disable" variant="ghost" /> : <ActionButton action={`/admin/connectors/${c.id}`} method="PATCH" body={{ status: 'ACTIVE' }} label="Enable" variant="ghost" />}</td></tr>)}</tbody></table></div>
    </div>
  );
}

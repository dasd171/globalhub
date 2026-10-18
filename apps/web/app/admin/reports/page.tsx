import { load } from '@/lib/server';
import { ErrorBox, PageHeader, StatusPill } from '@/components/ui';
import { ActionButton } from '@/components/ActionButton';
import { fmtDate } from '@/lib/format';
export default async function Reports() {
  const res = await load<any[]>('/admin/reports');
  if (res.error) return <ErrorBox error={res.error} />;
  return (
    <div><PageHeader title="Reports" />
      <div className="card overflow-x-auto p-0"><table className="table"><thead><tr><th>Target</th><th>Reason</th><th>Reporter</th><th>Status</th><th /></tr></thead>
        <tbody>{res.data.map((r) => <tr key={r.id}><td className="text-xs">{r.targetType}<div className="font-mono">{r.targetId}</div></td><td>{r.reason}</td><td className="text-xs">{r.reporter.displayName}<div>{fmtDate(r.createdAt)}</div></td><td><StatusPill status={r.status} /></td><td>{r.status === 'OPEN' && <div className="flex gap-1"><ActionButton action={`/admin/reports/${r.id}`} method="PATCH" body={{ status: 'ACTIONED' }} label="Actioned" variant="ghost" /><ActionButton action={`/admin/reports/${r.id}`} method="PATCH" body={{ status: 'DISMISSED' }} label="Dismiss" variant="ghost" /></div>}</td></tr>)}</tbody></table></div>
    </div>
  );
}

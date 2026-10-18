import { load } from '@/lib/server';
import { ErrorBox, PageHeader, Pagination } from '@/components/ui';
import { fmtDate } from '@/lib/format';
export default async function Audit({ searchParams }: { searchParams: Promise<{ action?: string; page?: string }> }) {
  const sp = await searchParams;
  const [res, risk] = await Promise.all([load<any>(`/admin/audit-logs?page=${sp.page ?? 1}${sp.action ? `&action=${encodeURIComponent(sp.action)}` : ''}`), load<any[]>('/admin/risk-events')]);
  if (res.error) return <ErrorBox error={res.error} />;
  return (
    <div className="space-y-6"><PageHeader title="Audit log & risk events" actions={<form><input name="action" defaultValue={sp.action} className="input" placeholder="action prefix, e.g. admin." /></form>} />
      <div className="card"><h2 className="h2 mb-2">Risk events</h2><ul className="text-xs">{(risk.data ?? []).slice(0, 30).map((r: any) => <li key={r.id}>{fmtDate(r.createdAt)} · <span className="font-mono text-red-700">{r.action}</span> · {JSON.stringify(r.metadata)}</li>)}</ul></div>
      <div className="card overflow-x-auto p-0"><table className="table text-xs"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Metadata</th><th>IP / request</th></tr></thead>
        <tbody>{res.data.items.map((l: any) => <tr key={l.id}><td>{fmtDate(l.createdAt)}</td><td>{l.actor?.email ?? 'system'}</td><td className="font-mono">{l.action}</td><td>{l.targetType} {l.targetId?.slice(0, 8)}</td><td className="max-w-xs truncate">{JSON.stringify(l.metadata)}</td><td>{l.ip} {l.requestId?.slice(0, 8)}</td></tr>)}</tbody></table></div>
      <Pagination page={res.data.page} totalPages={res.data.totalPages} baseHref={`/admin/audit${sp.action ? `?action=${sp.action}` : ''}`} />
    </div>
  );
}

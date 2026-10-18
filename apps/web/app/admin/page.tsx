import { load } from '@/lib/server';
import { ErrorBox, PageHeader } from '@/components/ui';
export default async function Dashboard() {
  const res = await load<any>('/admin/dashboard');
  if (res.error) return <ErrorBox error={res.error} />;
  const d = res.data;
  return (
    <div className="space-y-6"><PageHeader title="Dashboard" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{Object.entries(d.counts).map(([k, v]) => <div key={k} className="card"><p className="muted">{k}</p><p className="text-2xl font-bold">{String(v)}</p></div>)}</div>
      <div className="card"><h2 className="h2 mb-2">Orders by status</h2><div className="flex flex-wrap gap-2 text-sm">{Object.entries(d.ordersByStatus).map(([k, v]) => <span key={k} className="badge bg-gray-100">{k}: {String(v)}</span>)}</div></div>
      <div className="card text-sm"><h2 className="h2 mb-2">System health</h2><p>Database: {d.health.database ? '✓' : '✗'} · Redis: {d.health.redis ? '✓' : '✗'} · Worker: {d.health.worker.alive ? `✓ (${d.health.worker.lastHeartbeat})` : '✗ not reporting'}</p>{d.health.worker.queues && <pre className="mt-2 text-xs">{JSON.stringify(d.health.worker.queues, null, 2)}</pre>}</div>
    </div>
  );
}

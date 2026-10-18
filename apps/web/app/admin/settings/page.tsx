import { load } from '@/lib/server';
import { ErrorBox, PageHeader } from '@/components/ui';
import { ApiForm } from '@/components/ApiForm';
import { ActionButton } from '@/components/ActionButton';
const JOBS = ['expire-quotes', 'release-reservations', 'deliver-emails', 'federation-outbox', 'federation-sync', 'federation-heartbeat', 'federation-housekeeping'];
export default async function Settings() {
  const [s, sys] = await Promise.all([load<any>('/admin/settings'), load<any>('/admin/system')]);
  if (s.error) return <ErrorBox error={s.error} />;
  return (
    <div className="space-y-6"><PageHeader title="Settings & system" subtitle="Secrets and providers are configured via environment variables only — never in the database or UI." />
      <div className="card text-sm"><h2 className="h2 mb-2">Environment (read-only)</h2><dl className="grid grid-cols-2 gap-1">{Object.entries(s.data.environment).map(([k, v]) => <div key={k} className="contents"><dt className="muted">{k}</dt><dd className="font-mono text-xs">{String(v)}</dd></div>)}</dl></div>
      <div className="card"><h2 className="h2 mb-2">Editable settings</h2>{Object.entries(s.data.editable).map(([k, v]) => <ApiForm key={k} action={`/admin/settings/${k}`} method="PUT" className="mb-2 flex items-end gap-2" submitLabel="Save" fields={[{ name: 'value', label: k, defaultValue: v == null ? '' : String(v) }]} />)}</div>
      {sys.data && <div className="card text-sm"><h2 className="h2 mb-2">Health & queues</h2><pre className="overflow-auto text-xs">{JSON.stringify(sys.data, null, 2)}</pre>
        <h3 className="mt-3 font-medium">Run a job now</h3><div className="mt-2 flex flex-wrap gap-2">{JOBS.map((j) => <ActionButton key={j} action={`/admin/jobs/${j}/run`} label={j} variant="ghost" />)}</div></div>}
    </div>
  );
}

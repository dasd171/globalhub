import { t } from '@globalhub/i18n';
import { getLocale, load } from '@/lib/server';
import { PageHeader, StatusPill } from '@/components/ui';
import { ApiForm } from '@/components/ApiForm';
import { ActionButton } from '@/components/ActionButton';
import { fmtDate } from '@/lib/format';
export default async function Connectors() {
  const locale = await getLocale();
  const [profile, list] = await Promise.all([load<any>('/seller/profile'), load<any[]>('/connectors')]);
  const stores = profile.data?.stores ?? [];
  return (
    <div className="space-y-6"><PageHeader title={t(locale, 'seller.connectors')} subtitle="Connect your ERP via the GlobalHub Connector HTTP contract. Capabilities are discovered from your system — unsupported operations are never faked." />
      {(list.data ?? []).map((c: any) => (
        <div key={c.id} className="card text-sm"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{c.name}</span><span className="badge bg-gray-100">{c.type}</span><StatusPill status={c.status} /></div>
          <div className="mt-2 flex flex-wrap gap-1">{Object.entries(c.capabilityMatrix).map(([k, v]) => <span key={k} className={`badge ${v ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500 line-through'}`}>{k}</span>)}</div>
          <p className="mt-2 text-xs text-ink-500">Last sync: {fmtDate(c.lastSyncAt, locale)}{c.lastError ? ` · Error: ${c.lastError}` : ''}</p>
          <div className="mt-2 flex gap-2">{c.capabilityMatrix.getInventory && <ActionButton action={`/connectors/${c.id}/sync-inventory`} label="Sync inventory" />}<ActionButton action={`/connectors/${c.id}`} method="DELETE" label="Delete" variant="ghost" confirm="Delete connector?" /></div></div>
      ))}
      {stores.length > 0 && <div className="card"><h2 className="h2 mb-3">Add connector</h2>
        <ApiForm action="/connectors" submitLabel="Connect" fields={[
          { name: 'storeId', label: 'Store', type: 'select', required: true, options: stores.map((s: any) => ({ value: s.id, label: s.name })), half: true },
          { name: 'type', label: 'Type', type: 'select', required: true, options: [{ value: 'http-json', label: 'HTTP JSON (your ERP)' }, { value: 'mock', label: 'Mock (demo)' }], half: true },
          { name: 'name', label: 'Name', required: true, half: true }, { name: 'config.baseUrl', label: 'Base URL (https)', type: 'url', half: true },
          { name: 'secret', label: 'API key (encrypted at rest)', type: 'password' },
        ]} /></div>}
    </div>
  );
}

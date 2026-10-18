import { t } from '@globalhub/i18n';
import { getLocale, load, getMe } from '@/lib/server';
import { TrustBadge, ErrorBox, PageHeader, StatusPill } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { ApiForm } from '@/components/ApiForm';
import { ActionButton } from '@/components/ActionButton';

export default async function Network() {
  const locale = await getLocale();
  const [res, me] = await Promise.all([load<any>('/nodes'), getMe()]);
  const isNodeAdmin = !!me && (me.roles.includes('NODE_ADMIN') || me.roles.includes('PLATFORM_ADMIN'));
  return (
    <div>
      <PageHeader title={t(locale, 'network.title')} subtitle={t(locale, 'network.desc')} />
      {res.error ? <ErrorBox error={res.error} /> : (
        <>
          {!res.data.federationEnabled && <p className="mb-4 rounded bg-gray-100 p-3 text-sm">{t(locale, 'network.disabled')}</p>}
          <div className="card overflow-x-auto p-0">
            <table className="table">
              <thead><tr><th>Node</th><th>URL</th><th>{t(locale, 'network.trust')}</th><th>{t(locale, 'common.status')}</th><th>{t(locale, 'network.lastSeen')}</th><th>{t(locale, 'network.listings')}</th>{isNodeAdmin && <th />}</tr></thead>
              <tbody>{res.data.nodes.map((n: any) => (
                <tr key={n.id}>
                  <td><div className="font-medium">{n.displayName}{n.isLocal && <span className="badge ml-2 bg-brand-50 text-brand-700">{t(locale, 'network.local')}</span>}</div><div className="font-mono text-xs text-ink-500">{n.nodeId} · {n.protocolVersion}</div></td>
                  <td className="font-mono text-xs">{n.publicUrl}</td>
                  <td><TrustBadge level={n.trustLevel} locale={locale} /></td>
                  <td><StatusPill status={n.status} /></td>
                  <td className="text-xs">{fmtDate(n.lastHeartbeatAt, locale)}</td>
                  <td>{n._count.listings}</td>
                  {isNodeAdmin && <td>{!n.isLocal && <ActionButton action={`/nodes/${n.id}/sync`} body={{ kind: 'products' }} label="Sync" />}</td>}
                </tr>
              ))}</tbody>
            </table>
          </div>
          {isNodeAdmin && res.data.federationEnabled && (
            <div className="card mt-6 max-w-xl">
              <h2 className="h2 mb-3">Add a node</h2>
              <ApiForm action="/nodes/discover" className="grid gap-3" submitLabel="Discover" fields={[{ name: 'url', label: 'Node public URL', type: 'url', required: true, placeholder: 'https://node.example.com' }]} />
              <p className="mt-2 text-xs text-ink-500">New nodes start as UNVERIFIED. Raise trust only after you have checked who operates them.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

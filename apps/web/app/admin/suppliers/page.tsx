import { load, getLocale } from '@/lib/server';
import { ErrorBox, PageHeader, VerifyBadge } from '@/components/ui';
import { ApiForm } from '@/components/ApiForm';
import { VERIFICATION_STATUSES } from '@globalhub/shared';
export default async function Suppliers() {
  const locale = await getLocale();
  const [res, agents] = await Promise.all([load<any[]>('/admin/suppliers'), load<any>('/agents?pageSize=100')]);
  if (res.error) return <ErrorBox error={res.error} />;
  return (
    <div className="space-y-6"><PageHeader title="Suppliers & agents" subtitle="Business verification requires submitted business details and a verified email. Review documents before raising status." />
      <div className="card overflow-x-auto p-0"><table className="table"><thead><tr><th>Supplier</th><th>Business details</th><th>Status</th><th>Set status</th></tr></thead>
        <tbody>{res.data.map((s) => <tr key={s.id}><td>{s.companyName}<div className="text-xs text-ink-500">{s.user.email} · email {s.user.emailVerifiedAt ? '✓' : '✗'} · {s._count.stores} stores · {s._count.orders} orders</div></td>
          <td className="text-xs">{s.businessDetails ? <pre className="whitespace-pre-wrap">{JSON.stringify(s.businessDetails, null, 1)}</pre> : '—'}</td><td><VerifyBadge status={s.verificationStatus} locale={locale} /></td>
          <td><ApiForm action={`/admin/suppliers/${s.id}/verification`} className="flex flex-col gap-1" submitLabel="Apply" fields={[{ name: 'status', type: 'select', required: true, defaultValue: s.verificationStatus, options: VERIFICATION_STATUSES.map((v) => ({ value: v, label: v })) }, { name: 'note', placeholder: 'Note to supplier' }]} /></td></tr>)}</tbody></table></div>
      <div className="card overflow-x-auto p-0"><table className="table"><thead><tr><th>Agent</th><th>Status</th><th>Set status</th></tr></thead>
        <tbody>{(agents.data?.items ?? []).map((a: any) => <tr key={a.id}><td>{a.displayName}<div className="text-xs text-ink-500">{a.serviceRegions.join(', ')}</div></td><td><VerifyBadge status={a.verificationStatus} locale={locale} /></td><td><ApiForm action={`/admin/agents/${a.id}/verification`} className="flex gap-1" submitLabel="Apply" fields={[{ name: 'status', type: 'select', required: true, defaultValue: a.verificationStatus, options: ['UNVERIFIED', 'BUSINESS_VERIFIED', 'ADMIN_REVIEWED', 'SUSPENDED'].map((v) => ({ value: v, label: v })) }]} /></td></tr>)}</tbody></table></div>
    </div>
  );
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AGENT_SERVICES } from '@globalhub/shared';
import { t } from '@globalhub/i18n';
import { getLocale, getMe, load } from '@/lib/server';
import { PageHeader, StatusPill, Money, VerifyBadge } from '@/components/ui';
import { ApiForm } from '@/components/ApiForm';

export default async function AgentCenter() {
  const me = await getMe();
  if (!me) redirect('/login?next=/agent');
  const locale = await getLocale();
  const [profile, tasks, hall] = await Promise.all([load<any>('/agents/me'), load<any[]>('/agents/me/tasks'), load<any>('/buying-requests/open?pageSize=10')]);
  const p = profile.data;
  return (
    <div className="space-y-6">
      <PageHeader title={t(locale, 'agent.title')} actions={p && <VerifyBadge status={p.verificationStatus} locale={locale} />} />
      <div className="card"><h2 className="h2 mb-3">{t(locale, 'agent.profile')}</h2>
        <ApiForm action="/agents/me" method="PUT" submitLabel={t(locale, 'common.save')} fields={[
          { name: 'displayName', label: 'Display name', required: true, defaultValue: p?.displayName ?? me.displayName, half: true },
          { name: 'serviceRegions', label: 'Service regions (comma separated)', type: 'list', required: true, defaultValue: p?.serviceRegions?.join(', ') ?? '' },
          { name: 'languages', label: 'Languages', type: 'list', required: true, defaultValue: p?.languages?.join(', ') ?? 'en' },
          { name: 'services', label: `Services (comma separated: ${AGENT_SERVICES.join(', ')})`, type: 'list', required: true, defaultValue: p?.services?.join(', ') ?? 'LOCAL_SOURCING, INSPECTION' },
          { name: 'feeStructure', label: 'Fee structure', type: 'textarea', required: true, defaultValue: p?.feeStructure },
          { name: 'capabilities', label: 'Capabilities', type: 'textarea', defaultValue: p?.capabilities ?? '' },
          { name: 'currency', label: 'Currency', type: 'select', required: true, defaultValue: p?.currency ?? 'USD', options: ['USD', 'CNY', 'EUR'].map((c) => ({ value: c, label: c })), half: true },
          { name: 'maxOrderValueMinor', label: 'Max order value', type: 'money', currencyField: 'currency', half: true },
        ]} />
        <p className="mt-2 text-xs text-ink-500">Agents are shown as verified only after an administrator reviews them.</p></div>
      {p && <>
        <div className="card"><h2 className="h2 mb-2">Open buying requests (you can quote / source)</h2>
          <ul className="divide-y text-sm">{(hall.data?.items ?? []).map((r: any) => <li key={r.id} className="py-2"><Link className="hover:underline" href={`/seller/requests/${r.id}`}>{r.title}</Link> <span className="muted">· {r.quantity} {r.unit} → {r.destinationCountry}</span></li>)}</ul></div>
        <div className="card"><h2 className="h2 mb-2">{t(locale, 'agent.tasks')}</h2>
          <table className="table"><thead><tr><th>Task</th><th>Type</th><th>Linked</th><th>Fee</th><th>Status</th><th>Update</th></tr></thead>
            <tbody>{(tasks.data ?? []).map((tk: any) => <tr key={tk.id}><td>{tk.title}<div className="text-xs text-ink-500">{tk.notes}</div>{tk.supplierContact && <div className="text-xs">Supplier contact: {tk.supplierContact}</div>}</td><td className="text-xs">{tk.type}</td><td className="text-xs">{tk.buyingRequest?.title ?? tk.order?.orderNumber ?? '—'}</td><td><Money minor={tk.feeMinor} currency={tk.currency} locale={locale} /></td><td><StatusPill status={tk.status} /></td>
              <td><ApiForm action={`/agents/me/tasks/${tk.id}`} method="PATCH" className="flex gap-1" submitLabel="✓" fields={[{ name: 'status', type: 'select', required: true, defaultValue: tk.status, options: ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((s) => ({ value: s, label: s })) }]} /></td></tr>)}</tbody></table>
          <details className="mt-3"><summary className="cursor-pointer text-sm text-brand-600">+ New task (sourcing record, supplier contact, sample, inspection, warehousing, logistics)</summary>
            <ApiForm action="/agents/me/tasks" submitLabel="Create" resetOnSuccess fields={[
              { name: 'type', label: 'Type', type: 'select', required: true, options: ['SOURCING', 'SUPPLIER_CONTACT', 'SAMPLE', 'INSPECTION', 'WAREHOUSING', 'LOGISTICS'].map((s) => ({ value: s, label: s })), half: true },
              { name: 'title', label: 'Title', required: true, half: true }, { name: 'buyingRequestId', label: 'Buying request ID (optional)', half: true }, { name: 'supplierContact', label: 'Supplier contact record', half: true },
              { name: 'currency', label: 'Currency', type: 'select', required: true, defaultValue: 'USD', options: ['USD', 'CNY'].map((c) => ({ value: c, label: c })), half: true }, { name: 'feeMinor', label: 'Service fee', type: 'money', currencyField: 'currency', half: true },
              { name: 'notes', label: 'Notes', type: 'textarea' },
            ]} /></details></div>
      </>}
    </div>
  );
}

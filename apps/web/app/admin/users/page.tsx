import { load } from '@/lib/server';
import { ErrorBox, PageHeader, StatusPill, Pagination } from '@/components/ui';
import { ActionButton } from '@/components/ActionButton';
import { ApiForm } from '@/components/ApiForm';
export default async function Users({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const sp = await searchParams;
  const res = await load<any>(`/admin/users?page=${sp.page ?? 1}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ''}`);
  if (res.error) return <ErrorBox error={res.error} />;
  return (
    <div><PageHeader title="Users" actions={<form><input name="q" defaultValue={sp.q} className="input" placeholder="email / name" /></form>} />
      <div className="card overflow-x-auto p-0"><table className="table"><thead><tr><th>User</th><th>Roles</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{res.data.items.map((u: any) => <tr key={u.id}><td>{u.displayName}<div className="text-xs text-ink-500">{u.email} {u.emailVerified ? '✓' : ''}</div></td><td className="text-xs">{u.roles.join(', ')}</td><td><StatusPill status={u.status} /></td>
          <td className="space-y-1">{u.status === 'ACTIVE' ? <ActionButton action={`/admin/users/${u.id}`} method="PATCH" body={{ status: 'DISABLED' }} label="Disable" variant="ghost" confirm="Disable user and revoke sessions?" /> : <ActionButton action={`/admin/users/${u.id}`} method="PATCH" body={{ status: 'ACTIVE' }} label="Enable" variant="ghost" />}
            <ApiForm action={`/admin/users/${u.id}`} method="PATCH" className="flex gap-1" submitLabel="+ role" fields={[{ name: 'addRoles.0', type: 'select', required: true, options: ['BUYER', 'SUPPLIER', 'AGENT', 'MODERATOR', 'NODE_ADMIN', 'PLATFORM_ADMIN'].map((r) => ({ value: r, label: r })) }]} /></td></tr>)}</tbody></table></div>
      <Pagination page={res.data.page} totalPages={res.data.totalPages} baseHref={`/admin/users${sp.q ? `?q=${sp.q}` : ''}`} />
    </div>
  );
}

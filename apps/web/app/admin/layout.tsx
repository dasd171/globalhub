import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getMe } from '@/lib/server';
import { SideNav } from '@/components/ui';
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/login?next=/admin');
  if (!['PLATFORM_ADMIN', 'MODERATOR', 'NODE_ADMIN'].some((r) => me.roles.includes(r))) return <p className="card">Forbidden.</p>;
  return (
    <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
      <div><p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-500">Admin</p>
        <SideNav items={[['/admin', 'Dashboard'], ['/admin/users', 'Users'], ['/admin/suppliers', 'Suppliers & agents'], ['/admin/products', 'Products'], ['/admin/requests', 'Buying requests'], ['/admin/orders', 'Orders'], ['/admin/disputes', 'Disputes'], ['/admin/reports', 'Reports'], ['/network', 'Nodes'], ['/admin/categories', 'Categories'], ['/admin/connectors', 'Connectors'], ['/admin/settings', 'Settings & system'], ['/admin/audit', 'Audit & risk']].map(([href, label]) => ({ href, label }))} /></div>
      <div>{children}<p className="mt-8 text-xs text-ink-500">Every admin action is checked on the server and written to the audit log.</p></div>
    </div>
  );
}

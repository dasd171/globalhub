import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { t } from '@globalhub/i18n';
import { getLocale, getMe } from '@/lib/server';
import { SideNav } from '@/components/ui';

export default async function SellerLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/login?next=/seller');
  const locale = await getLocale();
  if (!me.roles.includes('SUPPLIER') && !me.roles.includes('AGENT') && !me.roles.includes('PLATFORM_ADMIN')) return <p className="card">This area is for supplier accounts. Register a supplier account to sell on GlobalHub.</p>;
  const L = (k: Parameters<typeof t>[1]) => t(locale, k);
  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <div><p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-500">{L('seller.title')}</p>
        <SideNav items={[{ href: '/seller', label: L('seller.analytics') }, { href: '/seller/setup', label: L('seller.profile') }, { href: '/seller/products', label: L('seller.products') }, { href: '/seller/products/new', label: L('seller.newProduct') }, { href: '/seller/requests', label: L('seller.hall') }, { href: '/seller/quotes', label: L('seller.quotes') }, { href: '/seller/orders', label: L('seller.orders') }, { href: '/seller/import', label: L('seller.import') }, { href: '/seller/connectors', label: L('seller.connectors') }, { href: '/messages', label: L('nav.messages') }]} /></div>
      <div>{children}</div>
    </div>
  );
}

import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { t } from '@globalhub/i18n';
import { getLocale, getMe } from '@/lib/server';
import { SideNav } from '@/components/ui';

export default async function BuyerLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/login?next=/buyer');
  const locale = await getLocale();
  const L = (k: Parameters<typeof t>[1]) => t(locale, k);
  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <div><p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-500">{L('buyer.title')}</p>
        <SideNav items={[{ href: '/buyer', label: '🏠' }, { href: '/buyer/requests', label: L('buyer.requests') }, { href: '/buyer/quotes', label: L('buyer.quotes') }, { href: '/buyer/orders', label: L('buyer.orders') }, { href: '/buyer/list', label: L('buyer.list') }, { href: '/messages', label: L('nav.messages') }, { href: '/buyer/addresses', label: L('buyer.addresses') }, { href: '/buyer/disputes', label: L('buyer.disputes') }, { href: '/buyer/favorites', label: L('buyer.favorites') }, { href: '/buyer/settings', label: L('buyer.settings') }]} /></div>
      <div>{children}</div>
    </div>
  );
}

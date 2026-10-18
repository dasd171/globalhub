import './globals.css';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getLocale, getMe, load } from '@/lib/server';
import { t } from '@globalhub/i18n';
import { LogoutButton } from '@/components/LogoutButton';

export const metadata = { title: 'GlobalHub — Open-Source Global Sourcing Network', description: 'Find products, suppliers and sourcing agents worldwide on an open, self-hostable network.' };
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const me = await getMe();
  const mode = await load<{ isDemo: boolean; banner: string | null }>('/payments/mode');
  const unread = me ? await load<{ unread: number }>('/notifications?unread=true') : null;
  const has = (r: string) => !!me?.roles.includes(r);
  return (
    <html lang={locale}>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">Skip to content</a>
        {mode.data?.isDemo && <div className="bg-yellow-300 px-4 py-1 text-center text-xs font-semibold text-yellow-950" data-testid="demo-banner">{mode.data.banner} · {t(locale, 'common.demoData')}</div>}
        <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 text-lg font-bold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 text-white">G</span>GlobalHub</Link>
            <nav className="flex flex-wrap gap-1 text-sm" aria-label="Main">
              <Link className="btn-ghost" href="/products">{t(locale, 'nav.products')}</Link>
              <Link className="btn-ghost" href="/suppliers">{t(locale, 'nav.suppliers')}</Link>
              <Link className="btn-ghost" href="/agents">{t(locale, 'nav.agents')}</Link>
              <Link className="btn-ghost" href="/requests/new">{t(locale, 'nav.post')}</Link>
              <Link className="btn-ghost" href="/network">{t(locale, 'nav.network')}</Link>
            </nav>
            <div className="ml-auto flex items-center gap-2">
              {me ? (
                <>
                  <Link className="btn-ghost" href="/notifications" aria-label={t(locale, 'nav.notifications')}>🔔{unread?.data?.unread ? <span className="badge bg-brand-500 text-white">{unread.data.unread}</span> : null}</Link>
                  <Link className="btn-ghost" href="/messages">{t(locale, 'nav.messages')}</Link>
                  <Link className="btn-ghost" href="/buyer">{t(locale, 'nav.buyer')}</Link>
                  {has('SUPPLIER') && <Link className="btn-ghost" href="/seller">{t(locale, 'nav.seller')}</Link>}
                  {has('AGENT') && <Link className="btn-ghost" href="/agent">{t(locale, 'nav.agent')}</Link>}
                  {(has('PLATFORM_ADMIN') || has('MODERATOR') || has('NODE_ADMIN')) && <Link className="btn-ghost" href="/admin">{t(locale, 'nav.admin')}</Link>}
                  <LogoutButton label={t(locale, 'nav.logout')} />
                </>
              ) : (
                <>
                  <Link className="btn-ghost" href="/login">{t(locale, 'nav.login')}</Link>
                  <Link className="btn-primary" href="/register">{t(locale, 'nav.register')}</Link>
                </>
              )}
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto min-h-[70vh] max-w-7xl px-4 py-8">{children}</main>
        <footer className="border-t border-gray-200 bg-white">
          <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-4 px-4 py-6 text-xs text-ink-500">
            <p>GlobalHub · {t(locale, 'brand.tagline')} · {t(locale, 'footer.license')}</p>
            <p className="max-w-xl">{t(locale, 'footer.disclaimer')}</p>
            <p><a className="underline" href="/api/docs">API docs</a></p>
          </div>
        </footer>
      </body>
    </html>
  );
}

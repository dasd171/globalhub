import Link from 'next/link';
import { t } from '@globalhub/i18n';
import { getLocale, load } from '@/lib/server';
import { PageHeader, VerifyBadge } from '@/components/ui';

export default async function SellerHome() {
  const locale = await getLocale();
  const [profile, products, orders, quotes] = await Promise.all([load<any>('/seller/profile'), load<any>('/seller/products?pageSize=100'), load<any>('/orders?as=supplier&pageSize=100'), load<any[]>('/quotes/mine')]);
  if (!profile.data) return <div className="card"><p className="mb-3">Set up your supplier profile and store first.</p><Link href="/seller/setup" className="btn-primary">{t(locale, 'seller.profile')}</Link></div>;
  const by = (s: string) => (orders.data?.items ?? []).filter((o: any) => o.status === s).length;
  const stat = (label: string, v: number | string, href?: string) => <div className="card"><p className="muted">{label}</p><p className="text-2xl font-bold">{href ? <Link href={href} className="hover:underline">{v}</Link> : v}</p></div>;
  return (
    <div className="space-y-6">
      <PageHeader title={profile.data.companyName} actions={<VerifyBadge status={profile.data.verificationStatus} locale={locale} />} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stat('Products', products.data?.total ?? 0, '/seller/products')}
        {stat('Awaiting your confirmation', by('PENDING_SUPPLIER_CONFIRMATION'), '/seller/orders')}
        {stat('Paid — to process', by('PAID'), '/seller/orders')}
        {stat('Open quotes', (quotes.data ?? []).filter((q: any) => ['SUBMITTED', 'VIEWED'].includes(q.status)).length, '/seller/quotes')}
        {stat('Quotes accepted', (quotes.data ?? []).filter((q: any) => q.status === 'ACCEPTED').length)}
        {stat('Completed orders', by('COMPLETED'))}
        {stat('Unverified stock items', (products.data?.items ?? []).filter((p: any) => p.stockStatus === 'UNVERIFIED').length, '/seller/products')}
        {stat('Stores', profile.data.stores.length, '/seller/setup')}
      </div>
      <p className="text-xs text-ink-500">Analytics are computed from your real orders and quotes on this node.</p>
    </div>
  );
}

import { t } from '@globalhub/i18n';
import { getLocale, load } from '@/lib/server';
import { VerifyBadge, DemoBadge, ErrorBox, ProductCard, Empty } from '@/components/ui';
import { ActionButton } from '@/components/ActionButton';

export default async function Supplier({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const res = await load<any>(`/suppliers/${id}`);
  if (res.error) return <ErrorBox error={res.error} />;
  const s = res.data;
  const products = await load<any>(`/products?pageSize=24&sort=newest&supplierId=${id}`);
  const mine = products.data?.items ?? [];
  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex flex-wrap items-center gap-2"><h1 className="h1">{s.companyName}</h1><VerifyBadge status={s.verificationStatus} locale={locale} />{s.isDemo && <DemoBadge locale={locale} />}</div>
        <p className="mt-2 text-sm">{[s.city, s.province].filter(Boolean).join(', ')} · {String(s.supplierType).replace(/_/g, ' ').toLowerCase()}</p>
        {s.description && <p className="mt-3 text-sm text-ink-700">{s.description}</p>}
        <p className="mt-3 text-sm">{s.reputation.reviewCount ? `★ ${Number(s.reputation.averageRating).toFixed(1)} (${s.reputation.reviewCount})` : t(locale, 'product.noReviews')} · {s.reputation.completedOrders} completed orders</p>
        <div className="mt-3"><ActionButton action="/users/me/favorites" body={{ supplierId: s.id }} label="☆ Favorite" /></div>
      </div>
      <h2 className="h2">{t(locale, 'products.title')}</h2>
      {mine.length ? <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{mine.map((p: any) => <ProductCard key={p.id} p={p} locale={locale} />)}</div> : <Empty>{t(locale, 'common.none')}</Empty>}
    </div>
  );
}

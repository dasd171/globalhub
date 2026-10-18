import Link from 'next/link';
import { t } from '@globalhub/i18n';
import { getLocale, load, getMe } from '@/lib/server';
import { StockBadge, VerifyBadge, DemoBadge, Money, Placeholder, ErrorBox } from '@/components/ui';
import { countryName, fmtDate } from '@/lib/format';
import { ProductActions } from './ProductActions';

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const [res, me, addresses] = await Promise.all([load<any>(`/products/${id}?locale=${locale}`), getMe(), load<any[]>('/users/me/addresses')]);
  if (res.error) return <ErrorBox error={res.error} />;
  const p = res.data;
  const desc = p.descriptionEn || p.descriptionZh;
  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
      <div className="space-y-4">
        {p.images?.length ? <img src={p.images[0].url} alt={p.title} className="w-full rounded-xl object-cover" /> : <Placeholder label="No product image" />}
        <div className="card">
          <h2 className="h2 mb-2">{t(locale, 'product.description')}</h2>
          {p.translationStatus === 'MACHINE' && <p className="mb-2 text-xs text-amber-700">{t(locale, 'product.translationMachine')}</p>}
          <p className="whitespace-pre-line text-sm text-ink-700">{desc || '—'}</p>
        </div>
        <div className="card">
          <h2 className="h2 mb-2">{t(locale, 'product.specs')}</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {p.compliance.material && <><dt className="muted">Material</dt><dd>{p.compliance.material}</dd></>}
            {Object.entries(p.specs ?? {}).map(([k, v]) => <div key={k} className="contents"><dt className="muted">{k}</dt><dd>{String(v)}</dd></div>)}
            <dt className="muted">SKU</dt><dd className="font-mono text-xs">{p.variants.map((v: any) => v.sku).join(', ')}</dd>
          </dl>
        </div>
        <div className="card text-sm">
          <h2 className="h2 mb-2">{t(locale, 'product.compliance')}</h2>
          <ul className="space-y-1">
            {p.compliance.hsCode && <li>HS code: <span className="font-mono">{p.compliance.hsCode}</span></li>}
            <li>Origin: {countryName(p.compliance.originCountry, locale)}</li>
            {p.compliance.containsBattery && <li className="text-amber-700">⚠ {t(locale, 'product.battery')}</li>}
            {p.compliance.dangerousGoods && <li className="text-red-700">⚠ {t(locale, 'product.dg')}</li>}
            {p.compliance.requiredDocuments?.length > 0 && <li>Documents: {p.compliance.requiredDocuments.join(', ')}</li>}
            {p.compliance.restrictedCountries?.length > 0 && <li>{t(locale, 'product.restricted')}: {p.compliance.restrictedCountries.join(', ')}</li>}
            {p.compliance.complianceNotes && <li className="muted">{p.compliance.complianceNotes}</li>}
            <li className="muted">Export/import rules depend on the product and destination. Check with your forwarder or customs broker.</li>
          </ul>
        </div>
      </div>
      <div className="space-y-4">
        <div className="card space-y-3">
          <div className="flex flex-wrap gap-2"><StockBadge status={p.stockStatus} locale={locale} />{p.isDemo && <DemoBadge locale={locale} />}{p.customizable && <span className="badge bg-blue-50 text-blue-700">OEM/ODM</span>}</div>
          <h1 className="text-2xl font-bold" data-testid="product-title">{p.title}</h1>
          {p.isDemo && <p className="rounded bg-yellow-50 p-2 text-xs text-yellow-900">{t(locale, 'common.demoData')}</p>}
          {p.priceTiers.length > 0 ? (
            <table className="table"><caption className="text-left text-sm font-medium">{t(locale, 'product.tiers')}</caption><tbody>{p.priceTiers.map((tier: any) => (
              <tr key={tier.minQty}><td>{tier.minQty}{tier.maxQty ? `–${tier.maxQty}` : '+'}</td><td className="text-right font-semibold">{tier.unitPriceMinor == null ? t(locale, 'product.tierAsk') : <Money minor={tier.unitPriceMinor} currency={p.currency} locale={locale} />}</td></tr>
            ))}</tbody></table>
          ) : <p className="text-xl font-semibold">{p.basePriceMinor != null ? <Money minor={p.basePriceMinor} currency={p.currency} locale={locale} /> : t(locale, 'common.priceOnRequest')}</p>}
          <dl className="grid grid-cols-2 gap-1 text-sm">
            <dt className="muted">{t(locale, 'common.moq')}</dt><dd>{p.moq}</dd>
            <dt className="muted">{t(locale, 'product.verifiedAt')}</dt><dd>{p.inventoryVerifiedAt ? fmtDate(p.inventoryVerifiedAt, locale) : '—'}</dd>
            <dt className="muted">{t(locale, 'product.leadTime')}</dt><dd>{p.leadTimeDays != null ? t(locale, 'product.days', { n: p.leadTimeDays }) : '—'}</dd>
            <dt className="muted">{t(locale, 'common.shipsFrom')}</dt><dd>{p.shipsFrom ?? '—'}</dd>
            <dt className="muted">{t(locale, 'common.shipsTo')}</dt><dd>{p.shipsTo.length ? p.shipsTo.join(', ') : t(locale, 'common.anywhere')}</dd>
            <dt className="muted">{t(locale, 'product.shipping')}</dt><dd>{p.shippingMethods.join(', ') || '—'}</dd>
          </dl>
          {p.stockStatus === 'UNVERIFIED' && <p className="text-xs text-amber-700">{t(locale, 'product.unverifiedWarn')}</p>}
          <p className="text-xs text-ink-500">{t(locale, 'product.fees')}</p>
        </div>
        <ProductActions product={{ id: p.id, moq: p.moq, currency: p.currency, variants: p.variants, stockStatus: p.stockStatus }} loggedIn={!!me} addresses={addresses.data ?? []} locale={locale} />
        <div className="card text-sm">
          <h2 className="h2 mb-2">{t(locale, 'product.reputation')}</h2>
          <p className="flex flex-wrap items-center gap-2"><Link className="font-medium hover:underline" href={`/suppliers/${p.supplier.id}`}>{p.supplier.companyName}</Link><VerifyBadge status={p.supplier.verificationStatus} locale={locale} />{p.supplier.isDemo && <DemoBadge locale={locale} />}</p>
          <p className="muted mt-1">{[p.supplier.city, p.supplier.province].filter(Boolean).join(', ')} · {String(p.supplier.supplierType).replace(/_/g, ' ').toLowerCase()}</p>
          <p className="mt-2">{p.reputation.reviewCount > 0 ? `★ ${Number(p.reputation.averageRating).toFixed(1)} · ${t(locale, 'product.reviews', { n: p.reputation.reviewCount })}` : t(locale, 'product.noReviews')}</p>
        </div>
      </div>
    </div>
  );
}

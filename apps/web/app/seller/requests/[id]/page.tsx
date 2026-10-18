import { getLocale, load } from '@/lib/server';
import { ErrorBox, StatusPill, Money } from '@/components/ui';
import { ApiForm } from '@/components/ApiForm';
import { ActionButton } from '@/components/ActionButton';
import { countryName, fmtDay } from '@/lib/format';

export default async function SellerRequest({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const r = await load<any>(`/buying-requests/${id}`);
  if (r.error) return <ErrorBox error={r.error} />;
  const req = r.data;
  const [mine, products] = await Promise.all([load<any[]>(`/buying-requests/${id}/quotes`), load<any>('/seller/products?pageSize=100')]);
  const active = (mine.data ?? []).find((q: any) => ['DRAFT', 'SUBMITTED', 'VIEWED'].includes(q.status));
  const s = req.structured ?? {};
  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-xl font-bold">{req.title}</h1><StatusPill status={req.status} /></div>
        <p className="muted">{req.buyerLabel} · {req.quantity} {req.unit} → {countryName(req.destinationCountry, locale)} · Closes {fmtDay(req.expiresAt, locale)}</p>
        {req.originNode && <p className="mt-1 text-xs text-indigo-700">From remote node {req.originNode.displayName} (trust: {req.originNode.trustLevel}). Your quote will be sent back to that node.</p>}
        <p className="mt-3 whitespace-pre-line text-sm">{req.description}</p>
        <ul className="mt-3 grid gap-x-6 text-sm sm:grid-cols-2">
          <li>Requirements: {(s.requirements ?? []).join(', ') || '—'}</li><li>Services: {(s.requestedServices ?? []).join(', ') || '—'}</li>
          <li>Target price: {req.targetUnitPriceMinor != null ? <Money minor={req.targetUnitPriceMinor} currency={req.currency} locale={locale} /> : 'Not specified'}</li><li>Samples {req.needsSample ? '✓' : '✗'} · Inspection {req.needsInspection ? '✓' : '✗'} · OEM {req.oemOdm ? '✓' : '✗'}</li>
          {req.qualityRequirements && <li>Quality: {req.qualityRequirements}</li>}{req.specifications && <li>Specifications: {req.specifications}</li>}
        </ul>
        {req.externalRefs?.length > 0 && <p className="mt-2 text-xs">Reference links (provided by buyer): {req.externalRefs.map((x: any) => <a key={x.id} className="mr-2 text-brand-600 underline" href={x.url} rel="noopener noreferrer nofollow" target="_blank">{new URL(x.url).hostname}</a>)}</p>}
      </div>
      {active ? (
        <div className="card text-sm"><h2 className="h2 mb-2">My quote</h2><p><StatusPill status={active.status} /> <Money minor={active.unitPriceMinor} currency={active.currency} locale={locale} /> × MOQ {active.moq} · Valid until {fmtDay(active.validUntil, locale)}</p>
          <div className="mt-2 flex gap-2">{active.status === 'DRAFT' && <ActionButton action={`/quotes/${active.id}/submit`} label="Submit" variant="primary" />}<ActionButton action={`/quotes/${active.id}/withdraw`} label="Withdraw" confirm="Withdraw this quote?" /></div></div>
      ) : req.status === 'OPEN' ? (
        <div className="card"><h2 className="h2 mb-1">Submit a quote</h2><p className="mb-3 text-xs text-ink-500">If international shipping is not known yet, leave it empty and choose “Not yet confirmed”. Only enter amounts you can stand behind.</p>
          <ApiForm action="/quotes" submitLabel="Submit quote" redirectTo="/seller/quotes" extra={{ buyingRequestId: id }} fields={[
            { name: 'productName', label: 'Product name', required: true, defaultValue: s.product ?? req.title, half: true },
            { name: 'productId', label: 'Link product (optional)', type: 'select', options: (products.data?.items ?? []).map((p: any) => ({ value: p.id, label: p.titleEn ?? p.titleZh })), half: true },
            { name: 'specifications', label: 'Specifications', type: 'textarea' },
            { name: 'currency', label: 'Currency', type: 'select', required: true, defaultValue: req.currency, options: ['USD', 'EUR', 'GBP', 'JPY', 'CNY'].map((c) => ({ value: c, label: c })), half: true },
            { name: 'unitPriceMinor', label: 'Unit price', type: 'money', currencyField: 'currency', required: true, half: true },
            { name: 'availableQty', label: 'Available qty', type: 'int', required: true, defaultValue: req.quantity, half: true }, { name: 'moq', label: 'MOQ', type: 'int', required: true, defaultValue: 1, half: true },
            { name: 'sampleFeeMinor', label: 'Sample fee', type: 'money', currencyField: 'currency', half: true }, { name: 'domesticShippingMinor', label: 'Domestic shipping', type: 'money', currencyField: 'currency', half: true },
            { name: 'internationalShippingMinor', label: 'International shipping', type: 'money', currencyField: 'currency', half: true },
            { name: 'internationalShippingSource', label: 'International shipping source', type: 'select', required: true, defaultValue: 'NOT_CONFIRMED', options: [{ value: 'NOT_CONFIRMED', label: 'Not yet confirmed' }, { value: 'SUPPLIER', label: 'Supplier-confirmed' }, { value: 'SYSTEM_ESTIMATE', label: 'Estimate' }, { value: 'THIRD_PARTY', label: 'Forwarder quote' }], half: true },
            { name: 'productionDays', label: 'Production days', type: 'int', half: true }, { name: 'shipWithinDays', label: 'Ship within days', type: 'int', half: true }, { name: 'validDays', label: 'Valid days', type: 'int', defaultValue: 14, half: true },
            { name: 'paymentTerms', label: 'Payment terms', half: true }, { name: 'qualityGuarantee', label: 'Quality guarantee', half: true }, { name: 'returnPolicy', label: 'Returns', half: true },
            { name: 'taxIncluded', label: 'Tax included', type: 'checkbox' }, { name: 'inspectionRequired', label: 'Inspection required', type: 'checkbox' },
            { name: 'notes', label: 'Notes', type: 'textarea' },
          ]} /></div>
      ) : <p className="card">This request is no longer open.</p>}
    </div>
  );
}

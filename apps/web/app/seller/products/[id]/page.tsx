import Link from 'next/link';
import { getLocale, load } from '@/lib/server';
import { ErrorBox, StockBadge, StatusPill, Money } from '@/components/ui';
import { ApiForm } from '@/components/ApiForm';
import { fmtDate } from '@/lib/format';

export default async function EditProduct({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const res = await load<any>(`/seller/products/${id}`);
  if (res.error) return <ErrorBox error={res.error} />;
  const p = res.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2"><h1 className="h1">{p.titleEn ?? p.titleZh}</h1><StatusPill status={p.status} /><StockBadge status={p.stockStatus} locale={locale} /><Link className="text-sm text-brand-600 underline" href={`/products/${p.id}`}>Public page</Link></div>
      {p.translationStatus === 'MACHINE' && <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">Some text was machine-translated. Review it and confirm.</p>}
      <div className="card"><h2 className="h2 mb-3">Inventory <span className="muted">(confirming updates the verification time)</span></h2>
        <table className="table"><thead><tr><th>SKU</th><th>On hand</th><th>Reserved</th><th>Source</th><th>Verified</th><th>Update</th></tr></thead>
          <tbody>{p.variants.map((v: any) => <tr key={v.id}><td className="font-mono text-xs">{v.sku}<div className="text-ink-500">{v.name}</div></td><td>{v.inventory?.onHand ?? 0}</td><td>{v.inventory?.reserved ?? 0}</td><td className="text-xs">{v.inventory?.source}</td><td className="text-xs">{fmtDate(v.inventory?.verifiedAt, locale)}</td>
            <td><ApiForm action={`/variants/${v.id}/inventory`} method="PUT" className="flex gap-2" submitLabel="Confirm" extra={{ source: 'MANUAL' }} fields={[{ name: 'onHand', type: 'int', required: true, defaultValue: v.inventory?.onHand ?? 0, min: 0 }]} /></td></tr>)}</tbody></table>
        <details className="mt-3"><summary className="cursor-pointer text-sm text-brand-600">+ Add SKU</summary>
          <ApiForm action={`/products/${p.id}/variants`} submitLabel="Add" fields={[{ name: 'sku', label: 'SKU', required: true, half: true }, { name: 'name', label: 'Name', required: true, half: true }, { name: 'priceMinor', label: `Price (${p.currency})`, type: 'money', currency: p.currency, half: true }, { name: 'stock', label: 'Stock', type: 'int', half: true }]} /></details>
      </div>
      <div className="card"><h2 className="h2 mb-3">Details & price</h2>
        <ApiForm action={`/products/${p.id}`} method="PATCH" submitLabel="Save" fields={[
          { name: 'titleEn', label: 'Product title', required: true, defaultValue: p.titleEn ?? '' },
          { name: 'descriptionEn', label: 'Description', type: 'textarea', defaultValue: p.descriptionEn ?? '' },
          { name: 'basePriceMinor', label: `Base price (${p.currency})`, type: 'money', currency: p.currency, defaultValue: p.basePriceMinor != null ? (p.basePriceMinor / (p.currency === 'JPY' ? 1 : 100)).toString() : '', half: true },
          { name: 'moq', label: 'MOQ', type: 'int', defaultValue: p.moq, half: true }, { name: 'leadTimeDays', label: 'Processing days', type: 'int', defaultValue: p.leadTimeDays ?? '', half: true },
          { name: 'status', label: 'Status', type: 'select', required: true, defaultValue: p.status, options: ['ACTIVE', 'DRAFT', 'ARCHIVED'].map((s) => ({ value: s, label: s })), half: true },
          { name: 'shipsTo', label: 'Ships to (ISO codes)', type: 'countries', defaultValue: p.shipsTo.join(' '), half: true },
          { name: 'isPublic', label: 'Publish to federation', type: 'checkbox', defaultValue: p.isPublic },
          ...(p.translationStatus === 'MACHINE' ? [{ name: 'translationConfirmed', label: 'I reviewed the machine-translated text', type: 'checkbox' as const }] : []),
        ]} />
        {p.priceTiers.length > 0 && <p className="mt-3 text-xs text-ink-500">Tiers: {p.priceTiers.map((t: any) => `${t.minQty}${t.maxQty ? `–${t.maxQty}` : '+'}: ${t.unitPriceMinor == null ? 'ask' : ''}`).join(' · ')} {p.priceTiers.filter((t: any) => t.unitPriceMinor != null).map((t: any) => <Money key={t.minQty} minor={t.unitPriceMinor} currency={p.currency} locale={locale} />)}</p>}
      </div>
    </div>
  );
}

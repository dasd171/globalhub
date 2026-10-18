'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toMinor } from '@globalhub/shared';
import { browserApi } from '@/lib/browser';

type Tier = { minQty: string; maxQty: string; price: string };
type Variant = { sku: string; name: string; price: string; stock: string; weight: string; attrs: string };

export function ProductForm({ stores, categories }: { stores: { id: string; name: string }[]; categories: { id: string; name: string }[] }) {
  const router = useRouter();
  const [f, setF] = useState<Record<string, any>>({ storeId: stores[0]?.id, currency: 'USD', moq: '1', status: 'ACTIVE', stockMode: 'INVENTORY', isPublic: true });
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [variants, setVariants] = useState<Variant[]>([{ sku: '', name: 'Standard', price: '', stock: '', weight: '', attrs: '' }]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const inp = (k: string, label: string, ph?: string) => <div><label className="label" htmlFor={k}>{label}</label><input id={k} className="input" placeholder={ph} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} /></div>;
  const kv = (s: string) => Object.fromEntries((s || '').split('\n').map((l) => l.split(/[:=]/)).filter((p) => p.length >= 2 && p[0].trim()).map(([k, ...r]) => [k.trim(), r.join(':').trim()]));
  async function submit() {
    setBusy(true); setErr(null);
    try {
      const c = f.currency;
      const body = {
        storeId: f.storeId, categoryId: f.categoryId || null, titleEn: f.titleEn || undefined, descriptionEn: f.descriptionEn || undefined,
        originalLanguage: 'en', status: f.status, stockMode: f.stockMode, customizable: !!f.customizable, oemOdm: !!f.oemOdm, moq: Number(f.moq || 1), currency: c,
        basePriceMinor: f.basePrice ? toMinor(f.basePrice, c) : null, leadTimeDays: f.leadTimeDays ? Number(f.leadTimeDays) : null, shipsFrom: f.shipsFrom || undefined,
        shipsTo: (f.shipsTo || '').split(/[\s,|]+/).filter(Boolean).map((x: string) => x.toUpperCase()), shippingMethods: (f.shippingMethods || '').split(/[\s,]+/).filter(Boolean),
        specs: Object.keys(kv(f.specs)).length ? kv(f.specs) : undefined, hsCode: f.hsCode || undefined, material: f.material || undefined, intendedUse: f.intendedUse || undefined,
        containsBattery: !!f.containsBattery, dangerousGoods: !!f.dangerousGoods, requiredDocuments: (f.requiredDocuments || '').split(/,+/).map((x: string) => x.trim()).filter(Boolean),
        restrictedCountries: (f.restrictedCountries || '').split(/[\s,|]+/).filter(Boolean).map((x: string) => x.toUpperCase()), complianceNotes: f.complianceNotes || undefined, isPublic: !!f.isPublic,
        imageUrls: (f.imageUrls || '').split(/\s+/).filter(Boolean),
        priceTiers: tiers.filter((t) => t.minQty).map((t) => ({ minQty: Number(t.minQty), maxQty: t.maxQty ? Number(t.maxQty) : null, unitPriceMinor: t.price ? toMinor(t.price, c) : null })),
        variants: variants.map((v) => ({ sku: v.sku, name: v.name, priceMinor: v.price ? toMinor(v.price, c) : null, stock: v.stock === '' ? undefined : Number(v.stock), weightGrams: v.weight ? Number(v.weight) : undefined, attributes: Object.keys(kv(v.attrs)).length ? kv(v.attrs) : undefined })),
      };
      const p = await browserApi.post('/products', body);
      router.push(`/seller/products/${p.id}`);
    } catch (e: any) { setErr(e.details?.map?.((d: any) => `${d.path}: ${d.message}`).join('; ') || e.message); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-6">
      <div className="card grid gap-4 sm:grid-cols-2">
        <div><label className="label" htmlFor="storeId">Store</label><select id="storeId" className="input" value={f.storeId} onChange={(e) => set('storeId', e.target.value)}>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label className="label" htmlFor="categoryId">Category</label><select id="categoryId" className="input" value={f.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value)}><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="sm:col-span-2">{inp('titleEn', 'Product title *')}</div>
        <div className="sm:col-span-2"><label className="label" htmlFor="descriptionEn">Description</label><textarea id="descriptionEn" className="input" rows={3} value={f.descriptionEn ?? ''} onChange={(e) => set('descriptionEn', e.target.value)} /></div>
        <div><label className="label" htmlFor="currency">Currency</label><select id="currency" className="input" value={f.currency} onChange={(e) => set('currency', e.target.value)}>{['USD', 'EUR', 'GBP', 'JPY', 'CNY'].map((c) => <option key={c}>{c}</option>)}</select></div>
        {inp('basePrice', 'Base unit price', '12.50')}{inp('moq', 'MOQ')}{inp('leadTimeDays', 'Processing days')}
        <div><label className="label" htmlFor="stockMode">Stock mode</label><select id="stockMode" className="input" value={f.stockMode} onChange={(e) => set('stockMode', e.target.value)}><option value="INVENTORY">Track inventory</option><option value="MADE_TO_ORDER">Made to order</option><option value="ON_REQUEST">On request</option></select></div>
        <div><label className="label" htmlFor="status">Status</label><select id="status" className="input" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="ACTIVE">Active</option><option value="DRAFT">Draft</option></select></div>
        {inp('shipsFrom', 'Ships from', 'City, country code')}{inp('shipsTo', 'Ships to (ISO codes, blank = any)', 'JP US DE')}{inp('shippingMethods', 'Shipping methods', 'AIR_EXPRESS SEA_LCL')}{inp('imageUrls', 'Image URLs (https, space separated)')}
        <div className="sm:col-span-2"><label className="label" htmlFor="specs">Specs (key: value per line)</label><textarea id="specs" className="input" rows={3} placeholder={'material: polyester\nsize: 210x180cm'} value={f.specs ?? ''} onChange={(e) => set('specs', e.target.value)} /></div>
        <div className="flex flex-wrap gap-4 sm:col-span-2 text-sm">{[['customizable', 'Customization'], ['oemOdm', 'OEM/ODM'], ['containsBattery', 'Battery'], ['dangerousGoods', 'Dangerous goods'], ['isPublic', 'Publish to federation']].map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={!!f[k]} onChange={(e) => set(k, e.target.checked)} />{l}</label>)}</div>
        {inp('hsCode', 'HS code')}{inp('material', 'Material')}{inp('intendedUse', 'Intended use')}{inp('requiredDocuments', 'Required documents', 'MSDS, CE')}{inp('restrictedCountries', 'Cannot ship to', 'RU')}{inp('complianceNotes', 'Compliance notes')}
      </div>
      <div className="card space-y-2"><h2 className="h2">Tiered pricing <span className="muted">(leave price empty = “ask for quote”)</span></h2>
        {tiers.map((t, i) => <div key={i} className="flex gap-2">{(['minQty', 'maxQty', 'price'] as const).map((k) => <input key={k} aria-label={k} className="input" placeholder={k} value={t[k]} onChange={(e) => setTiers((ts) => ts.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />)}<button className="btn-ghost" onClick={() => setTiers((ts) => ts.filter((_, j) => j !== i))}>✕</button></div>)}
        <button className="btn-secondary" onClick={() => setTiers((ts) => [...ts, { minQty: '', maxQty: '', price: '' }])}>+ Tier</button></div>
      <div className="card space-y-2"><h2 className="h2">SKUs / variants</h2>
        <p className="text-xs text-ink-500">Entering a stock number confirms it now. Leave empty if you cannot confirm — the product will show “stock unverified”.</p>
        {variants.map((v, i) => <div key={i} className="grid gap-2 rounded border p-2 sm:grid-cols-3">{(['sku', 'name', 'price', 'stock', 'weight'] as const).map((k) => <input key={k} aria-label={k} className="input" placeholder={{ sku: 'SKU *', name: 'Name *', price: 'Price override', stock: 'Stock', weight: 'Weight g' }[k]} value={v[k]} onChange={(e) => setVariants((vs) => vs.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />)}<textarea aria-label="attributes" className="input" rows={1} placeholder="color: green" value={v.attrs} onChange={(e) => setVariants((vs) => vs.map((x, j) => (j === i ? { ...x, attrs: e.target.value } : x)))} /></div>)}
        <button className="btn-secondary" onClick={() => setVariants((vs) => [...vs, { sku: '', name: '', price: '', stock: '', weight: '', attrs: '' }])}>+ SKU</button></div>
      <div className="flex items-center gap-3"><button className="btn-primary" onClick={submit} disabled={busy}>{busy ? '…' : 'Publish'}</button>{err && <p role="alert" className="text-sm text-red-700">{err}</p>}</div>
    </div>
  );
}

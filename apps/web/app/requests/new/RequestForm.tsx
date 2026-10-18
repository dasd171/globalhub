'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { COUNTRIES, SUPPLIER_TYPES, toMinor } from '@globalhub/shared';
import { browserApi } from '@/lib/browser';

export function RequestForm({ labels, locale: _locale, categories }: { labels: Record<string, string>; locale: string; categories: { id: string; name: string }[] }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<any>(null);
  const [form, setForm] = useState<Record<string, any>>({ title: '', description: '', quantity: '', unit: 'units', destinationCountry: 'JP', currency: 'USD', visibility: 'PUBLIC', needsShippingQuote: true });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  async function analyze() {
    setError(null);
    try {
      const p = await browserApi.post('/ai/parse-request', { text });
      setParsed(p);
      setForm((f) => ({ ...f, title: f.title || p.product, description: f.description || text, quantity: f.quantity || (p.quantity ?? ''), unit: p.unit ?? f.unit, destinationCountry: p.destinationCountry ?? f.destinationCountry,
        supplierTypePreference: p.supplierType ?? f.supplierTypePreference, needsSample: p.needsSample, needsInspection: p.needsInspection, oemOdm: p.oemOdm, acceptsCustomization: p.customization,
        targetUnitPrice: p.targetUnitPrice?.amount ?? f.targetUnitPrice, currency: p.targetUnitPrice?.currency ?? f.currency }));
    } catch (e: any) { setError(e.message); }
  }

  async function submit() {
    setBusy(true); setError(null);
    try {
      const cur = form.currency;
      const body: Record<string, unknown> = {
        title: form.title, description: form.description, originalLanguage: 'en', quantity: Number(form.quantity), unit: form.unit || 'units', currency: cur,
        destinationCountry: form.destinationCountry, categoryId: form.categoryId || undefined, targetUnitPriceMinor: form.targetUnitPrice ? toMinor(String(form.targetUnitPrice), cur) : undefined,
        budgetMinMinor: form.budgetMin ? toMinor(String(form.budgetMin), cur) : undefined, budgetMaxMinor: form.budgetMax ? toMinor(String(form.budgetMax), cur) : undefined,
        qualityRequirements: form.qualityRequirements || undefined, specifications: form.specifications || undefined, acceptsCustomization: !!form.acceptsCustomization,
        deliveryBy: form.deliveryBy ? new Date(form.deliveryBy).toISOString() : undefined, needsSample: !!form.needsSample, needsInspection: !!form.needsInspection, oemOdm: !!form.oemOdm,
        needsShippingQuote: !!form.needsShippingQuote, supplierTypePreference: form.supplierTypePreference || undefined, otherRequirements: form.otherRequirements || undefined, visibility: form.visibility,
        externalRefs: form.refUrl ? [{ url: form.refUrl }] : [],
      };
      const r = await browserApi.post('/buying-requests', body);
      router.push(`/buyer/requests/${r.id}`);
    } catch (e: any) { setError(e.details?.map?.((d: any) => `${d.path}: ${d.message}`).join('; ') || e.message); } finally { setBusy(false); }
  }

  const input = (k: string, label: string, type = 'text', half = true) => (
    <div className={half ? '' : 'sm:col-span-2'}><label className="label" htmlFor={k}>{label}</label><input id={k} type={type} className="input" value={form[k] ?? ''} onChange={(e) => set(k, e.target.value)} /></div>
  );
  const check = (k: string, label: string) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form[k]} onChange={(e) => set(k, e.target.checked)} />{label}</label>;

  return (
    <div className="space-y-6">
      <div className="card space-y-3">
        <label className="label" htmlFor="free">{labels['request.describe']}</label>
        <textarea id="free" className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="I need 100 waterproof camping tents, preferably from a factory. Please quote the best available price and shipping to Japan." />
        <button type="button" className="btn-secondary" onClick={analyze} disabled={text.trim().length < 3}>{labels['request.parse']}</button>
        {parsed && (
          <div className="rounded-lg bg-gray-50 p-3 text-sm" data-testid="parsed">
            <p className="font-medium">{labels['request.structured']} <span className="muted">({parsed.parsedBy === 'ai' ? 'AI — please review' : 'rule-based — please review'})</span></p>
            <ul className="mt-1 grid gap-x-4 sm:grid-cols-2">
              <li>Product: {parsed.product}</li><li>Quantity: {parsed.quantity ?? '—'} {parsed.unit ?? ''}</li><li>Destination: {parsed.destinationCountry ?? '—'}</li>
              <li>Supplier type: {parsed.supplierType ?? '—'}</li><li>Requirements: {parsed.requirements.join(', ') || '—'}</li><li>Services: {parsed.requestedServices.join(', ') || '—'}</li>
              <li>Target price: {parsed.targetUnitPrice ? `${parsed.targetUnitPrice.amount} ${parsed.targetUnitPrice.currency}` : 'Not specified'}</li>
            </ul>
          </div>
        )}
      </div>
      <div className="card grid grid-cols-1 gap-4 sm:grid-cols-2">
        {input('title', labels['request.field.title'], 'text', false)}
        <div className="sm:col-span-2"><label className="label" htmlFor="description">{labels['request.field.description']}</label><textarea id="description" className="input" rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} /></div>
        {input('quantity', labels['request.field.quantity'], 'number')}
        {input('unit', labels['request.field.unit'])}
        <div><label className="label" htmlFor="destinationCountry">{labels['common.destination']}</label><select id="destinationCountry" className="input" value={form.destinationCountry} onChange={(e) => set('destinationCountry', e.target.value)}>{Object.entries(COUNTRIES).map(([c, n]) => <option key={c} value={c}>{n.en}</option>)}</select></div>
        <div><label className="label" htmlFor="currency">{labels['common.currency']}</label><select id="currency" className="input" value={form.currency} onChange={(e) => set('currency', e.target.value)}>{['USD', 'CNY', 'EUR', 'JPY', 'GBP'].map((c) => <option key={c}>{c}</option>)}</select></div>
        {input('targetUnitPrice', labels['request.field.target'])}
        <div><label className="label" htmlFor="categoryId">{labels['products.category']}</label><select id="categoryId" className="input" value={form.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value)}><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        {input('budgetMin', labels['request.field.budgetMin'])}
        {input('budgetMax', labels['request.field.budgetMax'])}
        {input('qualityRequirements', labels['request.field.quality'], 'text', false)}
        {input('specifications', labels['request.field.specs'], 'text', false)}
        {input('deliveryBy', labels['request.field.deliveryBy'], 'date')}
        <div><label className="label" htmlFor="supplierTypePreference">{labels['request.field.supplierType']}</label><select id="supplierTypePreference" className="input" value={form.supplierTypePreference ?? ''} onChange={(e) => set('supplierTypePreference', e.target.value)}><option value="">—</option>{SUPPLIER_TYPES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ').toLowerCase()}</option>)}</select></div>
        <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:flex-wrap sm:gap-6">{check('acceptsCustomization', labels['request.field.custom'])}{check('needsSample', labels['request.field.sample'])}{check('needsInspection', labels['request.field.inspection'])}{check('oemOdm', labels['request.field.oem'])}{check('needsShippingQuote', 'Shipping quotation')}</div>
        {input('otherRequirements', labels['request.field.other'], 'text', false)}
        {input('refUrl', labels['request.field.refUrl'], 'url', false)}
        <div><label className="label" htmlFor="visibility">{labels['request.field.visibility']}</label><select id="visibility" className="input" value={form.visibility} onChange={(e) => set('visibility', e.target.value)}><option value="PUBLIC">Public on this node</option><option value="FEDERATED">Public + federated</option><option value="PRIVATE">Private</option></select></div>
        <div className="flex items-end gap-3 sm:col-span-2"><button type="button" className="btn-primary" onClick={submit} disabled={busy} data-testid="publish-request">{busy ? '…' : labels['request.publish']}</button>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}</div>
      </div>
    </div>
  );
}

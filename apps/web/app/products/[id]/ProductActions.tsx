'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { t, type Locale } from '@globalhub/i18n';
import { COUNTRIES, formatMoney } from '@globalhub/shared';
import { browserApi } from '@/lib/browser';

export function ProductActions({ product, loggedIn, addresses, locale }: { product: { id: string; moq: number; currency: string; variants: { id: string; sku: string; name: string }[]; stockStatus: string }; loggedIn: boolean; addresses: any[]; locale: Locale }) {
  const router = useRouter();
  const [qty, setQty] = useState(product.moq);
  const [dest, setDest] = useState(addresses[0]?.country ?? 'JP');
  const [variant, setVariant] = useState(product.variants[0]?.id);
  const [addressId, setAddressId] = useState(addresses.find((a) => a.isDefault)?.id ?? addresses[0]?.id ?? '');
  const [message, setMessage] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [ship, setShip] = useState<any>(null);
  const run = async (fn: () => Promise<void>) => { setMsg({}); try { await fn(); } catch (e: any) { setMsg({ err: e.message }); } };

  if (!loggedIn) return <div className="card text-sm"><p className="mb-3">{t(locale, 'common.signInToContinue')}</p><Link className="btn-primary" href={`/login?next=/products/${product.id}`}>{t(locale, 'nav.login')}</Link></div>;
  const canOrder = product.stockStatus !== 'ON_REQUEST' && product.stockStatus !== 'OUT_OF_STOCK';
  return (
    <div className="card space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label" htmlFor="qty">{t(locale, 'common.quantity')}</label><input id="qty" className="input" type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} /></div>
        <div><label className="label" htmlFor="dest">{t(locale, 'common.destination')}</label><select id="dest" className="input" value={dest} onChange={(e) => setDest(e.target.value)}>{Object.entries(COUNTRIES).map(([c, n]) => <option key={c} value={c}>{n.en}</option>)}</select></div>
        {product.variants.length > 1 && <div className="col-span-2"><label className="label" htmlFor="variant">SKU</label><select id="variant" className="input" value={variant} onChange={(e) => setVariant(e.target.value)}>{product.variants.map((v) => <option key={v.id} value={v.id}>{v.sku} — {v.name}</option>)}</select></div>}
      </div>
      <div><label className="label" htmlFor="message">{t(locale, 'product.inquiry')}</label><textarea id="message" className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Questions about OEM, packaging, lead time…" /></div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" data-testid="request-quote" onClick={() => run(async () => { const r = await browserApi.post(`/products/${product.id}/request-quote`, { quantity: qty, destinationCountry: dest, message: message || `Please quote ${qty} units shipped to ${dest}.` }); setMsg({ ok: 'Quote request sent' }); router.push(`/buyer/requests/${r.id}`); })}>{t(locale, 'product.inquiry')}</button>
        <button className="btn-secondary" onClick={() => run(async () => { await browserApi.post('/users/me/sourcing-list', { productId: product.id, quantity: qty }); setMsg({ ok: '✓' }); })}>{t(locale, 'product.addToList')}</button>
        <button className="btn-secondary" onClick={() => run(async () => { const c = await browserApi.post('/conversations', { subject: 'PRODUCT_INQUIRY', productId: product.id, body: message || 'Hello, I have a question about this product.' }); router.push(`/messages/${c.id}`); })}>{t(locale, 'product.message')}</button>
        <button className="btn-ghost" onClick={() => run(async () => setShip(await browserApi.post(`/products/${product.id}/shipping-quote`, { quantity: qty, destinationCountry: dest })))}>{t(locale, 'product.estimate')}</button>
      </div>
      {ship && (
        <div className="rounded-lg bg-gray-50 p-3 text-xs">
          {ship.isDemo && <p className="mb-1 font-semibold text-yellow-800">DEMO estimates</p>}
          {ship.quotes.length ? <ul>{ship.quotes.map((q: any) => <li key={q.method}>{q.method}: {formatMoney(q.amountMinor, q.currency, locale)} ({q.transitDaysMin}–{q.transitDaysMax}d) — {q.dutiesNote}</li>)}</ul> : <p>{ship.note}</p>}
          <p className="mt-1 text-ink-500">{ship.note}</p>
        </div>
      )}
      {canOrder && (
        <div className="border-t pt-4">
          <label className="label" htmlFor="addr">Ship to</label>
          {addresses.length ? <select id="addr" className="input mb-2" value={addressId} onChange={(e) => setAddressId(e.target.value)}>{addresses.map((a) => <option key={a.id} value={a.id}>{a.fullName}, {a.city}, {a.country}</option>)}</select> : <p className="mb-2 text-sm"><Link className="underline" href="/buyer/addresses">Add a shipping address</Link> to order.</p>}
          <button className="btn-primary w-full" data-testid="order-now" disabled={!addressId} onClick={() => run(async () => { const o = await browserApi.post('/orders', { idempotencyKey: crypto.randomUUID(), items: [{ variantId: variant, quantity: qty }], shippingAddressId: addressId }); router.push(`/buyer/orders/${o.id}`); })}>{t(locale, 'product.order')}</button>
          <p className="mt-1 text-xs text-ink-500">The supplier confirms stock, price and shipping before you pay.</p>
        </div>
      )}
      {msg.ok && <p role="status" className="text-sm text-green-700">{msg.ok}</p>}
      {msg.err && <p role="alert" className="text-sm text-red-700">{msg.err}</p>}
    </div>
  );
}

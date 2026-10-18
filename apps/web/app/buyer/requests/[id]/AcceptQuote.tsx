'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserApi } from '@/lib/browser';

export function AcceptQuote({ quoteId, addresses, label }: { quoteId: string; addresses: any[]; label: string }) {
  const router = useRouter();
  const [addr, setAddr] = useState(addresses[0]?.id ?? '');
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      {addresses.length > 0 && <select aria-label="Shipping address" className="input py-1 text-xs" value={addr} onChange={(e) => setAddr(e.target.value)}>{addresses.map((a) => <option key={a.id} value={a.id}>{a.city}, {a.country}</option>)}</select>}
      <button className="btn-primary px-2 py-1 text-xs" data-testid="accept-quote" onClick={async () => {
        if (!confirm('Accept this quote? Other open quotes will be declined and an order draft is created for supplier confirmation.')) return;
        try { const r = await browserApi.post(`/quotes/${quoteId}/accept`, { shippingAddressId: addr || undefined }); if (r.orderId) router.push(`/buyer/orders/${r.orderId}`); else { alert(r.note); router.refresh(); } }
        catch (e: any) { setErr(e.message); }
      }}>{label}</button>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </div>
  );
}

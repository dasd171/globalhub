'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toMinor } from '@globalhub/shared';
import { browserApi } from '@/lib/browser';

const TYPES = ['DOMESTIC_SHIPPING', 'INTERNATIONAL_SHIPPING', 'PACKAGING', 'SOURCING_SERVICE', 'INSPECTION', 'INSURANCE', 'SAMPLE', 'TAX_KNOWN', 'TAX_ESTIMATED', 'OTHER'];
type Line = { type: string; label: string; amount: string; status: 'CONFIRMED' | 'ESTIMATED' | 'NOT_CONFIRMED' };

/** Supplier confirms stock/price and enters each remaining cost as confirmed, estimated or not yet confirmed. */
export function ConfirmOrderForm({ orderId, currency }: { orderId: string; currency: string }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([{ type: 'INTERNATIONAL_SHIPPING', label: 'International shipping', amount: '', status: 'NOT_CONFIRMED' }]);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const upd = (i: number, k: keyof Line, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <div className="card space-y-3">
      <h3 className="h2">Confirm order</h3>
      <p className="text-xs text-ink-500">Confirm stock, price and destination. Add each extra cost; use “not yet confirmed” when you don’t know it yet.</p>
      {lines.map((l, i) => (
        <div key={i} className="grid gap-2 rounded border p-2">
          <select aria-label="Fee type" className="input" value={l.type} onChange={(e) => upd(i, 'type', e.target.value)}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          <input aria-label="Label" className="input" value={l.label} onChange={(e) => upd(i, 'label', e.target.value)} />
          <div className="flex gap-2">
            <select aria-label="Status" className="input" value={l.status} onChange={(e) => upd(i, 'status', e.target.value)}><option value="CONFIRMED">Confirmed</option><option value="ESTIMATED">Estimate</option><option value="NOT_CONFIRMED">Not yet confirmed</option></select>
            <input aria-label={`Amount ${currency}`} className="input" placeholder={currency} disabled={l.status === 'NOT_CONFIRMED'} value={l.amount} onChange={(e) => upd(i, 'amount', e.target.value)} />
          </div>
          <button type="button" className="btn-ghost text-xs" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <button type="button" className="btn-secondary w-full" onClick={() => setLines((ls) => [...ls, { type: 'PACKAGING', label: 'Packaging', amount: '', status: 'CONFIRMED' }])}>+ Add cost</button>
      <textarea aria-label="Note" className="input" rows={2} placeholder="Note to buyer" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn-primary w-full" data-testid="confirm-order" onClick={async () => {
        setErr(null);
        try {
          const fees = lines.map((l) => ({ type: l.type, label: l.label || l.type, status: l.status, amountMinor: l.status === 'NOT_CONFIRMED' ? null : toMinor(l.amount || '0', currency) }));
          await browserApi.post(`/orders/${orderId}/confirm`, { fees, note: note || undefined });
          router.refresh();
        } catch (e: any) { setErr(e.message); }
      }}>Confirm stock & price</button>
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
    </div>
  );
}

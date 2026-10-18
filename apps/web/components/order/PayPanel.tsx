'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatMoney } from '@globalhub/shared';
import { browserApi } from '@/lib/browser';

export function PayPanel({ orderId, hasUnconfirmed, total, currency, locale, labels, isDemo }: { orderId: string; hasUnconfirmed: boolean; total: number; currency: string; locale: string; labels: Record<string, string>; isDemo: boolean }) {
  const router = useRouter();
  const [ack, setAck] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [instructions, setInstructions] = useState<string | null>(null);
  return (
    <div className="card space-y-3">
      <h3 className="h2">{labels.pay} {formatMoney(total, currency, locale)}</h3>
      {isDemo && <p className="rounded bg-yellow-100 p-2 text-xs font-semibold text-yellow-900">{labels.demo}</p>}
      {hasUnconfirmed && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />{labels.ack}</label>}
      <button className="btn-primary w-full" data-testid="pay" disabled={busy || (hasUnconfirmed && !ack)} onClick={async () => {
        setBusy(true); setErr(null);
        try {
          const p = await browserApi.post(`/orders/${orderId}/payments`, { acknowledgeUnconfirmedFees: ack });
          if (p.nextAction.type === 'redirect') { window.location.href = p.nextAction.url; return; }
          if (p.nextAction.type === 'manual_instructions') { setInstructions(p.nextAction.text); return; }
          await browserApi.post(`/orders/${orderId}/payments/demo-confirm`);
          router.refresh();
        } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
      }}>{busy ? '…' : labels.pay}</button>
      {instructions && <p className="text-sm">{instructions}</p>}
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
      <p className="text-xs text-ink-500">The order is marked paid only after the payment provider confirms it.</p>
    </div>
  );
}

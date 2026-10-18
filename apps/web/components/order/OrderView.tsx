import Link from 'next/link';
import { t, type Locale } from '@globalhub/i18n';
import { Money, StatusPill } from '@/components/ui';
import { ApiForm } from '@/components/ApiForm';
import { ActionButton } from '@/components/ActionButton';
import { fmtDate } from '@/lib/format';
import { ConfirmOrderForm } from './ConfirmOrderForm';
import { PayPanel } from './PayPanel';

const FEE_STATUS_STYLE: Record<string, string> = { CONFIRMED: 'text-ink-900', ESTIMATED: 'text-amber-700', NOT_CONFIRMED: 'text-ink-500 italic' };

export function OrderView({ o, locale }: { o: any; locale: Locale }) {
  const role: 'buyer' | 'supplier' | 'admin' = o.viewerRole;
  const can = (s: string) => o.allowedTransitions.includes(s);
  const L = (k: Parameters<typeof t>[1]) => t(locale, k);
  const openRefunds = o.refunds.filter((r: any) => ['REQUESTED', 'APPROVED'].includes(r.status));
  const openDispute = o.disputes.find((d: any) => ['OPEN', 'AWAITING_BUYER', 'AWAITING_SUPPLIER', 'UNDER_REVIEW'].includes(d.status));
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-xl font-bold">{L('order.title')} {o.orderNumber}</h1>
            <span data-testid="order-status"><StatusPill status={o.status} /></span>
          </div>
          <p className="muted mt-1">{o.supplier.companyName} → {o.buyer.displayName} · {fmtDate(o.createdAt, locale)} {o.isDemo && <span className="badge bg-yellow-200">DEMO</span>}</p>
          {o.paymentMode.isDemo && <p className="mt-2 rounded bg-yellow-100 px-3 py-1 text-xs font-semibold text-yellow-900">{L('order.demoBanner')}</p>}
          <table className="table mt-4"><thead><tr><th>{L('order.items')}</th><th>SKU</th><th className="text-right">{L('common.quantity')}</th><th className="text-right">{L('quote.unitPrice')}</th><th className="text-right">Σ</th></tr></thead>
            <tbody>{o.items.map((i: any) => <tr key={i.id}><td>{i.productId ? <Link className="hover:underline" href={`/products/${i.productId}`}>{i.title}</Link> : i.title}</td><td className="font-mono text-xs">{i.sku ?? '—'}</td><td className="text-right">{i.quantity}</td><td className="text-right"><Money minor={i.unitPriceMinor} currency={i.currency} locale={locale} /></td><td className="text-right"><Money minor={i.lineTotalMinor} currency={i.currency} locale={locale} /></td></tr>)}</tbody>
          </table>
        </div>

        <div className="card">
          <h2 className="h2 mb-2">{L('order.fees')}</h2>
          <table className="table" data-testid="fees"><tbody>
            {o.fees.map((f: any) => <tr key={f.id}><td>{f.label}<span className="ml-2 text-[11px] text-ink-500">{f.status === 'CONFIRMED' ? L('common.confirmed') : f.status === 'ESTIMATED' ? L('common.estimated') : ''} · {L(`quote.source.${f.source}` as never)}</span></td><td className={`text-right ${FEE_STATUS_STYLE[f.status]}`}>{f.status === 'NOT_CONFIRMED' ? L('common.notConfirmed') : <Money minor={f.amountMinor} currency={f.currency} locale={locale} />}</td></tr>)}
            <tr><td className="font-semibold">{L('order.total')}</td><td className="text-right font-semibold"><Money minor={o.confirmedTotalMinor} currency={o.currency} locale={locale} /></td></tr>
            {o.feeSummary.hasEstimates && <tr><td className="text-amber-700">{L('order.estimates')}</td><td className="text-right text-amber-700">+ <Money minor={o.feeSummary.estimatedTotalMinor} currency={o.currency} locale={locale} /></td></tr>}
          </tbody></table>
          {o.snapshot?.warnings?.length > 0 && <ul className="mt-2 text-xs text-amber-700">{o.snapshot.warnings.map((w: string) => <li key={w}>⚠ {w}</li>)}</ul>}
          {o.shippingAddress && <p className="mt-3 text-xs text-ink-500">Ship to: {o.shippingAddress.fullName}, {o.shippingAddress.line1}, {o.shippingAddress.city}, {o.shippingAddress.country}</p>}
        </div>

        {o.shipments.length > 0 && (
          <div className="card">
            <h2 className="h2 mb-2">{L('order.shipments')}</h2>
            {o.shipments.map((s: any) => (
              <div key={s.id} className="mb-4">
                <p className="text-sm font-medium">{s.carrier} {s.trackingNumber && <span className="font-mono">{s.trackingNumber}</span>} <StatusPill status={s.status} /> {s.isDemo && <span className="badge bg-yellow-200">DEMO</span>}</p>
                <ul className="mt-1 border-l-2 border-gray-200 pl-3 text-xs">{s.events.map((e: any) => <li key={e.id}>{fmtDate(e.occurredAt, locale)} · {e.status}{e.location ? ` · ${e.location}` : ''}{e.description ? ` — ${e.description}` : ''}</li>)}</ul>
                {(role === 'supplier' || role === 'admin') && !['DELIVERED', 'RETURNED'].includes(s.status) && (
                  <div className="mt-2"><ApiForm action={`/shipments/${s.id}/events`} submitLabel="Add tracking event" fields={[
                    { name: 'status', label: 'Status', type: 'select', required: true, options: ['PICKED_UP', 'IN_TRANSIT', 'CUSTOMS', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION', 'RETURNED'].map((v) => ({ value: v, label: v })), half: true },
                    { name: 'location', label: 'Location', half: true }, { name: 'description', label: 'Description' },
                  ]} /></div>
                )}
              </div>
            ))}
          </div>
        )}

        {(o.refunds.length > 0 || o.disputes.length > 0) && (
          <div className="card space-y-3 text-sm">
            <h2 className="h2">Refunds & disputes</h2>
            {o.refunds.map((r: any) => (
              <div key={r.id} className="rounded border p-3">
                <p><StatusPill status={r.status} /> <Money minor={r.amountMinor} currency={r.currency} locale={locale} /> — {r.reason}</p>
                {r.status === 'PROCESSED_MANUAL' && <p className="text-xs text-ink-500">Recorded manually — not processed by a payment provider.</p>}
                {(role === 'supplier' || role === 'admin') && r.status === 'REQUESTED' && <div className="mt-2 flex gap-2"><ActionButton action={`/refunds/${r.id}/decision`} body={{ decision: 'APPROVE' }} label="Approve" variant="primary" /><ActionButton action={`/refunds/${r.id}/decision`} body={{ decision: 'REJECT' }} label="Reject" /></div>}
                {(role === 'supplier' || role === 'admin') && r.status === 'APPROVED' && <div className="mt-2"><ActionButton action={`/refunds/${r.id}/decision`} body={{ decision: 'MARK_PROCESSED_MANUAL', note: 'Refunded outside the platform' }} label="Record manual refund" confirm="Only record this after the money was actually returned." /></div>}
              </div>
            ))}
            {o.disputes.map((d: any) => (
              <div key={d.id} className="rounded border p-3">
                <p><StatusPill status={d.status} /> {d.reason}</p>
                {d.resolution && <p className="text-xs">Resolution: {d.resolution}</p>}
                <ul className="mt-1 text-xs text-ink-700">{d.evidence.map((e: any) => <li key={e.id}>• {e.body}</li>)}</ul>
                {d === openDispute && role !== 'admin' && <ApiForm action={`/disputes/${d.id}/evidence`} submitLabel="Add statement" className="mt-2 grid gap-2" resetOnSuccess fields={[{ name: 'body', type: 'textarea', required: true, placeholder: 'Your response / evidence description' }]} />}
                {d === openDispute && role === 'admin' && <ApiForm action={`/disputes/${d.id}/resolve`} submitLabel="Resolve" className="mt-2 grid gap-2" fields={[{ name: 'outcome', type: 'select', required: true, options: ['RESOLVED_BUYER_FAVOR', 'RESOLVED_SUPPLIER_FAVOR', 'RESOLVED_PARTIAL', 'CLOSED'].map((v) => ({ value: v, label: v })) }, { name: 'resolution', type: 'textarea', required: true, placeholder: 'Decision and reasoning' }]} />}
              </div>
            ))}
          </div>
        )}

        <div className="card">
          <h2 className="h2 mb-2">{L('order.timeline')}</h2>
          <ol className="space-y-1 border-l-2 border-gray-200 pl-3 text-xs">{o.events.map((e: any) => <li key={e.id}><span className="text-ink-500">{fmtDate(e.createdAt, locale)}</span> · <span className="font-mono">{e.toStatus}</span>{e.note ? ` — ${e.note}` : ''}</li>)}</ol>
        </div>
      </div>

      <aside className="space-y-4">
        {role === 'buyer' && o.status === 'AWAITING_PAYMENT' && <PayPanel orderId={o.id} hasUnconfirmed={o.hasUnconfirmedFees} total={o.confirmedTotalMinor} currency={o.currency} locale={locale} labels={{ pay: L('order.pay'), ack: L('order.ackUnconfirmed'), demo: L('order.demoBanner') }} isDemo={o.paymentMode.isDemo} />}
        {role === 'supplier' && o.status === 'PENDING_SUPPLIER_CONFIRMATION' && <ConfirmOrderForm orderId={o.id} currency={o.currency} />}
        {(role === 'supplier' || role === 'admin') && o.status === 'READY_TO_SHIP' && (
          <div className="card"><h3 className="h2 mb-2">Ship</h3><ApiForm action={`/orders/${o.id}/shipments`} className="grid gap-3" submitLabel="Create shipment" fields={[
            { name: 'carrier', label: 'Carrier', required: true, placeholder: 'SF Express / DHL / …' }, { name: 'trackingNumber', label: 'Tracking number' }, { name: 'method', label: 'Method', placeholder: 'AIR_EXPRESS' },
            { name: 'weightGrams', label: 'Weight (g)', type: 'int' }, { name: 'useProvider', label: 'Use configured shipping provider (mock = DEMO tracking)', type: 'checkbox' },
          ]} /></div>
        )}
        <div className="card space-y-2">
          <h3 className="h2">Actions</h3>
          <div className="flex flex-wrap gap-2">
            {can('PROCESSING') && role !== 'buyer' && <ActionButton action={`/orders/${o.id}/transition`} body={{ to: 'PROCESSING' }} label="Start processing" variant="primary" />}
            {can('READY_TO_SHIP') && <ActionButton action={`/orders/${o.id}/transition`} body={{ to: 'READY_TO_SHIP' }} label="Ready to ship" variant="primary" />}
            {can('DELIVERED') && role === 'buyer' && <ActionButton action={`/orders/${o.id}/transition`} body={{ to: 'DELIVERED' }} label="Mark delivered" />}
            {can('COMPLETED') && <ActionButton action={`/orders/${o.id}/transition`} body={{ to: 'COMPLETED' }} label={L('order.complete')} variant="primary" />}
            {can('CANCELLED') && <ActionButton action={`/orders/${o.id}/transition`} body={{ to: 'CANCELLED', note: 'Cancelled by user' }} label={L('order.cancel')} variant="danger" confirm="Cancel this order?" />}
            {can('CANCELLATION_REQUESTED') && <ActionButton action={`/orders/${o.id}/transition`} body={{ to: 'CANCELLATION_REQUESTED' }} label="Request cancellation" />}
          </div>
          {role === 'buyer' && ['PAID', 'PROCESSING', 'DELIVERED', 'COMPLETED', 'PARTIALLY_REFUNDED', 'CANCELLATION_REQUESTED'].includes(o.status) && openRefunds.length === 0 && (
            <details className="text-sm"><summary className="cursor-pointer text-brand-600">{L('order.refund')}</summary>
              <ApiForm action={`/orders/${o.id}/refunds`} className="mt-2 grid gap-2" submitLabel={L('order.refund')} fields={[{ name: 'amountMinor', label: `Amount (${o.currency})`, type: 'money', currency: o.currency, required: true }, { name: 'reason', label: 'Reason', type: 'textarea', required: true }]} /></details>
          )}
          {role !== 'admin' && !openDispute && can('DISPUTED') && (
            <details className="text-sm"><summary className="cursor-pointer text-brand-600">{L('order.dispute')}</summary>
              <ApiForm action={`/orders/${o.id}/disputes`} className="mt-2 grid gap-2" submitLabel={L('order.dispute')} fields={[{ name: 'reason', type: 'textarea', required: true, placeholder: 'Describe the problem (min. 10 characters)' }]} /></details>
          )}
          {role === 'buyer' && o.status === 'COMPLETED' && (
            <details className="text-sm"><summary className="cursor-pointer text-brand-600">{L('order.review')}</summary>
              <ApiForm action="/reviews" className="mt-2 grid gap-2" submitLabel={L('order.review')} extra={{ orderId: o.id }} fields={[
                { name: 'target', type: 'select', required: true, options: [{ value: 'SUPPLIER', label: 'Supplier' }, { value: 'LOGISTICS', label: 'Logistics' }, ...(o.items[0]?.productId ? [{ value: 'PRODUCT', label: 'Product' }] : [])] },
                ...(o.items[0]?.productId ? [{ name: 'productId', type: 'hidden' as const, defaultValue: o.items[0].productId }] : []),
                { name: 'rating', label: 'Rating (1–5)', type: 'int', required: true, defaultValue: 5 }, { name: 'body', type: 'textarea', placeholder: 'Your experience' },
              ]} /></details>
          )}
          <Link className="text-sm text-brand-600 hover:underline" href={`/messages`}>{L('nav.messages')}</Link>
          <ActionButton action="/conversations" body={{ subject: 'ORDER', orderId: o.id, body: `Hello, regarding order ${o.orderNumber}.` }} label="Message counterpart" redirectTo="/messages" variant="ghost" />
        </div>
      </aside>
    </div>
  );
}

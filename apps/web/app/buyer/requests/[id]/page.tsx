import Link from 'next/link';
import { t } from '@globalhub/i18n';
import { getLocale, load } from '@/lib/server';
import { ErrorBox, StatusPill, Money, VerifyBadge, StockBadge, Empty } from '@/components/ui';
import { ActionButton } from '@/components/ActionButton';
import { fmtDay, countryName } from '@/lib/format';
import { AcceptQuote } from './AcceptQuote';

export default async function RequestDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const L = (k: Parameters<typeof t>[1]) => t(locale, k);
  const r = await load<any>(`/buying-requests/${id}`);
  if (r.error) return <ErrorBox error={r.error} />;
  const req = r.data;
  const [quotes, matches, summary, addresses] = await Promise.all([load<any[]>(`/buying-requests/${id}/quotes`), load<any>(`/buying-requests/${id}/matches`), load<any>(`/buying-requests/${id}/quotes/summary?locale=${locale}`), load<any[]>('/users/me/addresses')]);
  const s = req.structured ?? {};
  const src = (k: string) => <span className="text-[10px] text-ink-500">({L(`quote.source.${k}` as never)})</span>;
  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-xl font-bold">{req.title}</h1><StatusPill status={req.status} /></div>
        <p className="muted">{req.quantity} {req.unit} → {countryName(req.destinationCountry, locale)} · {req.visibility} · expires {fmtDay(req.expiresAt, locale)}</p>
        <p className="mt-3 whitespace-pre-line text-sm">{req.description}</p>
        <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm">
          <p className="font-medium">{L('request.structured')}</p>
          <ul className="mt-1 grid gap-x-6 sm:grid-cols-2">
            <li>Product: {s.product}</li><li>Quantity: {s.quantity} {s.unit}</li><li>Destination: {s.destination}</li><li>Supplier type: {s.supplierType ?? '—'}</li>
            <li>Requirements: {(s.requirements ?? []).join(', ') || '—'}</li><li>Requested services: {(s.requestedServices ?? []).join(', ') || '—'}</li>
            <li>Target price: {s.targetPrice ? <Money minor={s.targetPrice.amountMinor} currency={s.targetPrice.currency} locale={locale} /> : 'Not specified'}</li><li>Status: {req.status === 'OPEN' ? 'Open for Quotes' : req.status}</li>
          </ul>
        </div>
        {req.status === 'OPEN' && <div className="mt-3 flex gap-2"><ActionButton action={`/buying-requests/${id}/status`} method="PATCH" body={{ status: 'CLOSED' }} label="Close request" /></div>}
      </div>

      <div className="card overflow-x-auto">
        <h2 className="h2 mb-1">{L('request.compare')}</h2>
        <p className="mb-3 text-xs text-ink-500">{L('quote.disclaimer')}</p>
        {summary.data && <p className="mb-3 whitespace-pre-line rounded bg-blue-50 p-3 text-sm text-blue-900" data-testid="quote-summary">{summary.data.summary}</p>}
        {!quotes.data?.length ? <Empty>{L('request.noQuotes')}</Empty> : (
          <table className="table" data-testid="quotes-table"><thead><tr><th>{L('common.supplier')}</th><th>{L('quote.unitPrice')}</th><th>{L('common.moq')}</th><th>{L('quote.available')}</th><th>{L('quote.domestic')}</th><th>{L('quote.intl')}</th><th>{L('quote.sample')}</th><th>{L('quote.production')}</th><th>{L('quote.validUntil')}</th><th>{L('common.status')}</th><th /></tr></thead>
            <tbody>{quotes.data.map((q: any) => (
              <tr key={q.id}>
                <td><div className="font-medium">{q.supplier.companyName}</div><VerifyBadge status={q.supplier.verificationStatus} locale={locale} />{q.supplier.remoteNodeId && <span className="badge ml-1 bg-indigo-100 text-indigo-800">{L('common.remote')}</span>}<div className="mt-1 text-xs text-ink-500">{q.productName}{q.specifications ? ` · ${q.specifications}` : ''}</div></td>
                <td className="font-semibold"><Money minor={q.unitPriceMinor} currency={q.currency} locale={locale} /> {src('SUPPLIER')}</td>
                <td>{q.moq}</td><td>{q.availableQty}</td>
                <td>{q.domesticShippingMinor != null ? <Money minor={q.domesticShippingMinor} currency={q.currency} locale={locale} /> : L('common.notConfirmed')}</td>
                <td>{q.internationalShippingMinor != null ? <Money minor={q.internationalShippingMinor} currency={q.currency} locale={locale} /> : L('common.notConfirmed')} {src(q.dataSources.internationalShipping)}</td>
                <td>{q.sampleFeeMinor != null ? <Money minor={q.sampleFeeMinor} currency={q.currency} locale={locale} /> : '—'}</td>
                <td>{q.productionDays != null ? `${q.productionDays}d` : '—'}</td>
                <td>{fmtDay(q.validUntil, locale)}</td>
                <td><StatusPill status={q.status} /></td>
                <td>{['SUBMITTED', 'VIEWED'].includes(q.status) && req.status === 'OPEN' && <div className="flex flex-col gap-1"><AcceptQuote quoteId={q.id} addresses={addresses.data ?? []} label={L('request.accept')} /><ActionButton action={`/quotes/${q.id}/reject`} label={L('request.reject')} variant="ghost" /></div>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {quotes.data?.some((q: any) => q.paymentTerms || q.qualityGuarantee) && (
          <div className="mt-4 grid gap-3 md:grid-cols-2">{quotes.data.map((q: any) => <div key={q.id} className="rounded border p-3 text-xs"><p className="font-medium">{q.supplier.companyName}</p><p>{L('quote.terms')}: {q.paymentTerms ?? '—'}</p><p>{L('quote.quality')}: {q.qualityGuarantee ?? '—'}</p><p>{L('quote.returns')}: {q.returnPolicy ?? '—'}</p><p>{L('quote.tax')}: {q.taxIncluded ? '✓' : '✗'} · {L('quote.inspection')}: {q.inspectionRequired ? '✓' : '✗'}</p>{q.notes && <p className="mt-1 text-ink-500">{q.notes}</p>}</div>)}</div>
        )}
      </div>

      <div className="card">
        <h2 className="h2 mb-2">{L('request.matches')}</h2>
        {matches.data?.results?.length ? (
          <ul className="divide-y text-sm">{matches.data.results.map((m: any) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div><Link className="font-medium hover:underline" href={m.source === 'local' ? `/products/${m.id}` : `/remote/${m.id}`}>{m.title}</Link> {m.source === 'federated' && <span className="badge bg-indigo-100 text-indigo-800">{L('common.remote')}</span>} <StockBadge status={m.stockStatus} locale={locale} />
                <div className="text-xs text-ink-500">{m.reasons.join(' · ')}{m.warnings.length ? ` · ⚠ ${m.warnings.join(' · ')}` : ''}</div></div>
              <span className="badge bg-gray-100">score {m.score}</span>
            </li>
          ))}</ul>
        ) : <p className="muted">{matches.data?.suggestion ?? L('common.none')}</p>}
      </div>
    </div>
  );
}

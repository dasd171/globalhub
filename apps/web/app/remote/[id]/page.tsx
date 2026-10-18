import { t } from '@globalhub/i18n';
import { getLocale, load, getMe } from '@/lib/server';
import { ErrorBox, TrustBadge, StockBadge, Money, VerifyBadge } from '@/components/ui';
import { ApiForm } from '@/components/ApiForm';
import { fmtDate } from '@/lib/format';

export default async function RemoteListing({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const [res, me] = await Promise.all([load<any>(`/federation/listings/${id}`), getMe()]);
  if (res.error) return <ErrorBox error={res.error} />;
  const l = res.data; const d = l.data;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900">{t(locale, 'common.remoteNotice')}</div>
      <div className="card space-y-3">
        <div className="flex flex-wrap gap-2 text-xs"><span className="badge bg-indigo-100 text-indigo-800">{l.node.displayName}</span><TrustBadge level={l.node.trustLevel} locale={locale} /><StockBadge status={l.stockStatus} locale={locale} />{d.isDemo && <span className="badge bg-yellow-200">DEMO</span>}</div>
        <h1 className="text-2xl font-bold">{l.title}</h1>
        {d.summary && <p className="text-sm text-ink-700">{d.summary}</p>}
        <dl className="grid grid-cols-2 gap-1 text-sm">
          <dt className="muted">{t(locale, 'common.price')}</dt><dd>{l.priceMinor != null ? <><Money minor={l.priceMinor} currency={l.currency} locale={locale} /> {t(locale, 'common.from')}</> : t(locale, 'common.priceOnRequest')}</dd>
          <dt className="muted">{t(locale, 'common.moq')}</dt><dd>{l.moq}</dd>
          <dt className="muted">{t(locale, 'common.supplier')}</dt><dd>{d.supplier?.name} <VerifyBadge status={d.supplier?.verification ?? 'UNVERIFIED'} locale={locale} /> <span className="muted">(as claimed by node)</span></dd>
          <dt className="muted">{t(locale, 'common.shipsTo')}</dt><dd>{d.shipsTo?.length ? d.shipsTo.join(', ') : t(locale, 'common.anywhere')}</dd>
          <dt className="muted">Synced</dt><dd>{fmtDate(l.syncedAt, locale)}</dd>
        </dl>
      </div>
      {me ? (
        <div className="card">
          <h2 className="h2 mb-3">{t(locale, 'product.inquiry')}</h2>
          {l.node.capabilities.includes('rfq.receive') ? (
            <ApiForm action={`/federation/listings/${id}/request-quote`} submitLabel={t(locale, 'product.inquiry')} redirectTo="/buyer/requests" fields={[
              { name: 'quantity', label: t(locale, 'common.quantity'), type: 'int', required: true, defaultValue: l.moq ?? 1, half: true },
              { name: 'destinationCountry', label: t(locale, 'common.destination'), type: 'country', required: true, defaultValue: 'JP', half: true },
              { name: 'message', label: 'Message', type: 'textarea', required: true, placeholder: 'Describe your requirements (min. 10 characters)' },
            ]} />
          ) : <p className="muted">This node does not accept remote quote requests.</p>}
          <p className="mt-2 text-xs text-ink-500">Your identity stays on this node; the remote node only sees “Buyer via this node”.</p>
        </div>
      ) : null}
    </div>
  );
}

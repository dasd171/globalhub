import Link from 'next/link';
import { getLocale, load } from '@/lib/server';
import { VerifyBadge, DemoBadge, ErrorBox, Money } from '@/components/ui';

export default async function Agent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const res = await load<any>(`/agents/${id}`);
  if (res.error) return <ErrorBox error={res.error} />;
  const a = res.data;
  return (
    <div className="card mx-auto max-w-3xl space-y-3">
      <div className="flex flex-wrap items-center gap-2"><h1 className="h1">{a.displayName}</h1><VerifyBadge status={a.verificationStatus} locale={locale} />{a.isDemo && <DemoBadge locale={locale} />}</div>
      <dl className="grid grid-cols-[160px_1fr] gap-2 text-sm">
        <dt className="muted">Regions</dt><dd>{a.serviceRegions.join(', ')}</dd>
        <dt className="muted">Languages</dt><dd>{a.languages.join(', ')}</dd>
        <dt className="muted">Services</dt><dd>{a.services.map((s: string) => s.replace(/_/g, ' ').toLowerCase()).join(', ')}</dd>
        <dt className="muted">Fees</dt><dd className="whitespace-pre-line">{a.feeStructure}</dd>
        <dt className="muted">Capabilities</dt><dd className="whitespace-pre-line">{a.capabilities ?? '—'}</dd>
        <dt className="muted">Max order size</dt><dd>{a.maxOrderValueMinor != null ? <Money minor={a.maxOrderValueMinor} currency={a.currency} locale={locale} /> : '—'}</dd>
        <dt className="muted">Track record</dt><dd>{a.reputation.completedTasks} completed tasks · {a.reputation.reviewCount ? `★ ${Number(a.reputation.averageRating).toFixed(1)} (${a.reputation.reviewCount})` : 'no reviews yet'}</dd>
      </dl>
      <p className="text-sm">To work with an agent, <Link className="text-brand-600 underline" href="/requests/new">post a buying request</Link> — agents can quote on public requests.</p>
    </div>
  );
}

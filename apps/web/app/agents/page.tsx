import Link from 'next/link';
import { t } from '@globalhub/i18n';
import { AGENT_SERVICES } from '@globalhub/shared';
import { getLocale, load } from '@/lib/server';
import { VerifyBadge, DemoBadge, Empty, ErrorBox, PageHeader } from '@/components/ui';

export default async function Agents({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const locale = await getLocale();
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
  const res = await load<any>(`/agents?${qs}`);
  return (
    <div>
      <PageHeader title={t(locale, 'home.cta.agents')} subtitle="Agents can find factories, contact sellers that are not on GlobalHub, buy samples, inspect goods and coordinate logistics. Unreviewed agents are never shown as verified."
        actions={<form className="flex gap-2"><select name="service" defaultValue={sp.service} className="input"><option value="">All services</option>{AGENT_SERVICES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ').toLowerCase()}</option>)}</select><button className="btn-secondary">{t(locale, 'common.filter')}</button></form>} />
      {res.error ? <ErrorBox error={res.error} /> : res.data.items.length === 0 ? <Empty>{t(locale, 'common.none')}</Empty> : (
        <div className="grid gap-4 md:grid-cols-2">{res.data.items.map((a: any) => (
          <Link key={a.id} href={`/agents/${a.id}`} className="card hover:shadow-md">
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{a.displayName}</span><VerifyBadge status={a.verificationStatus} locale={locale} />{a.isDemo && <DemoBadge locale={locale} />}</div>
            <p className="muted mt-1">{a.serviceRegions.join(', ')} · {a.languages.join(', ')}</p>
            <div className="mt-2 flex flex-wrap gap-1">{a.services.map((s: string) => <span key={s} className="badge bg-gray-100">{s.replace(/_/g, ' ').toLowerCase()}</span>)}</div>
          </Link>
        ))}</div>
      )}
    </div>
  );
}

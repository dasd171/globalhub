import Link from 'next/link';
import { t } from '@globalhub/i18n';
import { getLocale, load } from '@/lib/server';
import { VerifyBadge, DemoBadge, Empty, ErrorBox, PageHeader, Pagination } from '@/components/ui';

export default async function Suppliers({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const locale = await getLocale();
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
  const res = await load<any>(`/suppliers?${qs}`);
  return (
    <div>
      <PageHeader title={t(locale, 'nav.suppliers')} actions={<form className="flex gap-2"><input name="q" defaultValue={sp.q} className="input" placeholder={t(locale, 'common.search')} /><label className="flex items-center gap-1 text-sm"><input type="checkbox" name="verifiedOnly" value="true" defaultChecked={sp.verifiedOnly === 'true'} />{t(locale, 'products.verifiedOnly')}</label><button className="btn-secondary">{t(locale, 'common.filter')}</button></form>} />
      {res.error ? <ErrorBox error={res.error} /> : res.data.items.length === 0 ? <Empty>{t(locale, 'common.none')}</Empty> : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{res.data.items.map((s: any) => (
          <Link key={s.id} href={`/suppliers/${s.id}`} className="card hover:shadow-md">
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{s.companyName}</span><VerifyBadge status={s.verificationStatus} locale={locale} />{s.isDemo && <DemoBadge locale={locale} />}</div>
            <p className="muted mt-1">{[s.city, s.province].filter(Boolean).join(', ')} · {String(s.supplierType).replace(/_/g, ' ').toLowerCase()}</p>
            {s.description && <p className="mt-2 line-clamp-2 text-sm text-ink-700">{s.description}</p>}
          </Link>
        ))}</div>
      )}
      {res.data && <Pagination page={res.data.page} totalPages={res.data.totalPages} baseHref={`/suppliers?${qs}`} />}
    </div>
  );
}

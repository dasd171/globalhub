import Link from 'next/link';
import { t } from '@globalhub/i18n';
import { getLocale, load } from '@/lib/server';
import { PageHeader, ErrorBox, VerifyBadge } from '@/components/ui';
export default async function Favorites() {
  const locale = await getLocale();
  const res = await load<any>('/users/me/favorites');
  if (res.error) return <ErrorBox error={res.error} />;
  return (
    <div className="space-y-6"><PageHeader title={t(locale, 'buyer.favorites')} />
      <div className="card"><h2 className="h2 mb-2">{t(locale, 'products.title')}</h2>{res.data.products.length ? <ul className="text-sm">{res.data.products.map((p: any) => <li key={p.id}><Link className="hover:underline" href={`/products/${p.id}`}>{p.titleEn ?? p.titleZh}</Link></li>)}</ul> : <p className="muted">{t(locale, 'common.none')}</p>}</div>
      <div className="card"><h2 className="h2 mb-2">{t(locale, 'common.supplier')}</h2>{res.data.suppliers.length ? <ul className="text-sm">{res.data.suppliers.map((s: any) => <li key={s.id}><Link className="hover:underline" href={`/suppliers/${s.id}`}>{s.companyName}</Link> <VerifyBadge status={s.verificationStatus} locale={locale} /></li>)}</ul> : <p className="muted">{t(locale, 'common.none')}</p>}</div>
    </div>
  );
}

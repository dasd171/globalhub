import Link from 'next/link';
import { t } from '@globalhub/i18n';
import { getLocale, getMe, load } from '@/lib/server';
import { PageHeader } from '@/components/ui';
import { RequestForm } from './RequestForm';

export default async function NewRequest() {
  const locale = await getLocale();
  const me = await getMe();
  const cats = await load<any[]>('/categories');
  const keys = ['request.describe', 'request.parse', 'request.structured', 'request.field.title', 'request.field.description', 'request.field.quantity', 'request.field.unit', 'request.field.target', 'request.field.budgetMin', 'request.field.budgetMax', 'request.field.quality', 'request.field.specs', 'request.field.custom', 'request.field.deliveryBy', 'request.field.sample', 'request.field.inspection', 'request.field.oem', 'request.field.supplierType', 'request.field.other', 'request.field.visibility', 'request.field.refUrl', 'request.publish', 'common.destination', 'common.currency', 'products.category'] as const;
  const labels = Object.fromEntries(keys.map((k) => [k, t(locale, k)]));
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t(locale, 'request.title')} subtitle={t(locale, 'request.subtitle')} />
      {me ? <RequestForm labels={labels} locale={locale} categories={(cats.data ?? []).map((c) => ({ id: c.id, name: c.nameEn }))} />
        : <div className="card"><p className="mb-3">{t(locale, 'common.signInToContinue')}</p><Link className="btn-primary" href="/login?next=/requests/new">{t(locale, 'nav.login')}</Link></div>}
    </div>
  );
}

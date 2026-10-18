import { SUPPLIER_TYPES } from '@globalhub/shared';
import { t } from '@globalhub/i18n';
import { getLocale, load } from '@/lib/server';
import { PageHeader, VerifyBadge } from '@/components/ui';
import { ApiForm } from '@/components/ApiForm';

export default async function Setup() {
  const locale = await getLocale();
  const p = (await load<any>('/seller/profile')).data;
  return (
    <div className="space-y-6">
      <PageHeader title={t(locale, 'seller.profile')} />
      <div className="card"><h2 className="h2 mb-3">Supplier profile</h2>
        <ApiForm action="/seller/profile" method="PUT" submitLabel={t(locale, 'common.save')} fields={[
          { name: 'companyName', label: 'Company name', required: true, defaultValue: p?.companyName, half: true },
          { name: 'supplierType', label: 'Type', type: 'select', required: true, defaultValue: p?.supplierType ?? 'MANUFACTURER', options: SUPPLIER_TYPES.map((s) => ({ value: s, label: s })), half: true },
          { name: 'province', label: 'State / province / region', defaultValue: p?.province ?? undefined, half: true }, { name: 'city', label: 'City', defaultValue: p?.city ?? undefined, half: true },
          { name: 'description', label: 'Description / service scope', type: 'textarea', defaultValue: p?.description ?? undefined },
        ]} /></div>
      {p && <div className="card"><h2 className="h2 mb-3">Stores</h2>
        <ul className="mb-4 text-sm">{p.stores.map((s: any) => <li key={s.id}>• {s.name} <span className="font-mono text-xs text-ink-500">/{s.slug}</span> · {s.shipsFrom}</li>)}</ul>
        <ApiForm action="/stores" submitLabel="Create store" resetOnSuccess fields={[{ name: 'name', label: 'Store name', required: true, half: true }, { name: 'slug', label: 'URL slug', required: true, placeholder: 'my-factory-store', half: true }, { name: 'shipsFrom', label: 'Ships from', placeholder: 'City, country code', half: true }, { name: 'description', label: 'Description', type: 'textarea' }]} /></div>}
      {p && <div className="card"><h2 className="h2 mb-1">{t(locale, 'seller.verification')} <VerifyBadge status={p.verificationStatus} locale={locale} /></h2>
        <p className="mb-3 text-xs text-ink-500">Email verification does not verify your business. Submitted details are reviewed by an administrator before you are shown as verified.</p>
        <ApiForm action="/seller/profile/business-details" submitLabel="Submit for review" fields={[{ name: 'legalName', label: 'Legal name', required: true, half: true }, { name: 'registrationNumber', label: 'Business registration no.', required: true, half: true }, { name: 'registeredAddress', label: 'Registered address', required: true, half: true }, { name: 'contactName', label: 'Contact person', required: true, half: true }]} /></div>}
    </div>
  );
}

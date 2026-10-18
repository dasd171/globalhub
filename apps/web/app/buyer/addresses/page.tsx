import { t } from '@globalhub/i18n';
import { getLocale, load } from '@/lib/server';
import { PageHeader, ErrorBox } from '@/components/ui';
import { ApiForm } from '@/components/ApiForm';
import { ActionButton } from '@/components/ActionButton';
export default async function Addresses() {
  const locale = await getLocale();
  const res = await load<any[]>('/users/me/addresses');
  if (res.error) return <ErrorBox error={res.error} />;
  return (
    <div className="space-y-6"><PageHeader title={t(locale, 'buyer.addresses')} />
      <div className="grid gap-3 md:grid-cols-2">{res.data.map((a) => <div key={a.id} className="card text-sm"><p className="font-medium">{a.fullName} {a.isDefault && <span className="badge bg-gray-100">default</span>}</p><p>{a.company}</p><p>{a.line1} {a.line2}</p><p>{a.postalCode} {a.city} {a.region}</p><p>{a.country} {a.phone}</p><div className="mt-2"><ActionButton action={`/users/me/addresses/${a.id}`} method="DELETE" label="Delete" variant="ghost" /></div></div>)}</div>
      <div className="card"><h2 className="h2 mb-3">Add address</h2>
        <ApiForm action="/users/me/addresses" submitLabel={t(locale, 'common.save')} resetOnSuccess fields={[
          { name: 'fullName', label: 'Full name', required: true, half: true }, { name: 'company', label: 'Company', half: true }, { name: 'line1', label: 'Address line 1', required: true, half: true }, { name: 'line2', label: 'Address line 2', half: true },
          { name: 'city', label: 'City', required: true, half: true }, { name: 'region', label: 'State / region', half: true }, { name: 'postalCode', label: 'Postal code', half: true }, { name: 'country', label: t(locale, 'auth.country'), type: 'country', required: true, defaultValue: 'JP', half: true },
          { name: 'phone', label: 'Phone', half: true }, { name: 'isDefault', label: 'Default address', type: 'checkbox' },
        ]} />
      </div>
    </div>
  );
}

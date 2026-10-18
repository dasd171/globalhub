import { t, LOCALES, LOCALE_LABELS } from '@globalhub/i18n';
import { getLocale, getMe } from '@/lib/server';
import { PageHeader } from '@/components/ui';
import { ApiForm } from '@/components/ApiForm';
export default async function Settings() {
  const locale = await getLocale();
  const me = (await getMe())!;
  return (
    <div className="space-y-6"><PageHeader title={t(locale, 'buyer.settings')} />
      <div className="card"><h2 className="h2 mb-3">Profile, language & currency</h2>
        <ApiForm action="/users/me" method="PATCH" submitLabel={t(locale, 'common.save')} fields={[
          { name: 'displayName', label: t(locale, 'auth.name'), defaultValue: me.displayName, half: true },
          { name: 'locale', label: 'Language', type: 'select', required: true, defaultValue: me.locale, options: LOCALES.map((l) => ({ value: l, label: LOCALE_LABELS[l] })), half: true },
          { name: 'preferredCurrency', label: t(locale, 'common.currency'), type: 'select', required: true, defaultValue: me.preferredCurrency, options: ['USD', 'CNY', 'EUR', 'JPY', 'GBP'].map((c) => ({ value: c, label: c })), half: true },
        ]} /></div>
      <div className="card"><h2 className="h2 mb-3">Account security</h2>
        <ApiForm action="/auth/change-password" submitLabel="Change password" resetOnSuccess fields={[{ name: 'currentPassword', label: 'Current password', type: 'password', required: true, half: true }, { name: 'newPassword', label: 'New password (≥10)', type: 'password', required: true, half: true }]} />
        <p className="mt-2 text-xs text-ink-500">Changing your password signs out your other sessions. Two-factor authentication is an extension point (not enabled in v1).</p></div>
      <div className="card"><h2 className="h2 mb-2">Privacy</h2>
        <p className="mb-3 text-sm"><a className="btn-secondary" href="/api/v1/users/me/export" target="_blank" rel="noreferrer">Download my data (JSON)</a></p>
        <details><summary className="cursor-pointer text-sm text-red-700">Delete my account</summary>
          <p className="my-2 text-xs text-ink-500">Personal data is anonymised. Order and payment records are kept for legal/accounting reasons without your identity.</p>
          <ApiForm action="/users/me/delete" submitLabel="Permanently delete" redirectTo="/" className="grid gap-2" fields={[{ name: 'password', label: 'Confirm password', type: 'password', required: true }]} />
        </details></div>
    </div>
  );
}

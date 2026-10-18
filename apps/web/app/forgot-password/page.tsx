import { t } from '@globalhub/i18n';
import { getLocale } from '@/lib/server';
import { ApiForm } from '@/components/ApiForm';
export default async function Forgot() {
  const locale = await getLocale();
  return (
    <div className="mx-auto max-w-md card">
      <h1 className="h1 mb-4">{t(locale, 'auth.reset')}</h1>
      <ApiForm action="/auth/forgot-password" className="grid gap-4" submitLabel={t(locale, 'common.submit')} successMessage={t(locale, 'auth.checkEmail')} showResult={process.env.NODE_ENV !== 'production'} fields={[{ name: 'email', label: t(locale, 'auth.email'), type: 'email', required: true }]} />
    </div>
  );
}

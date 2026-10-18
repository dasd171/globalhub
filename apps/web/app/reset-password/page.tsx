import { t } from '@globalhub/i18n';
import { getLocale } from '@/lib/server';
import { ApiForm } from '@/components/ApiForm';
export default async function Reset({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const locale = await getLocale();
  const { token } = await searchParams;
  return (
    <div className="mx-auto max-w-md card">
      <h1 className="h1 mb-4">{t(locale, 'auth.reset')}</h1>
      <ApiForm action="/auth/reset-password" className="grid gap-4" submitLabel={t(locale, 'auth.reset')} redirectTo="/login" extra={{ token }} fields={[{ name: 'password', label: t(locale, 'auth.newPassword'), type: 'password', required: true }]} />
    </div>
  );
}

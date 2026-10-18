import Link from 'next/link';
import { t } from '@globalhub/i18n';
import { getLocale } from '@/lib/server';
import { ActionButton } from '@/components/ActionButton';

export default async function Verify({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const locale = await getLocale();
  const { token } = await searchParams;
  return (
    <div className="mx-auto max-w-md card space-y-4">
      <h1 className="h1">{t(locale, 'auth.verify')}</h1>
      {token ? <ActionButton action="/auth/verify-email" body={{ token }} label={t(locale, 'auth.verify')} variant="primary" redirectTo="/login" /> : <p className="muted">Missing token.</p>}
      <Link href="/login" className="text-sm text-brand-600 underline">{t(locale, 'nav.login')}</Link>
    </div>
  );
}

import Link from 'next/link';
import { t } from '@globalhub/i18n';
import { getLocale } from '@/lib/server';
import { LoginForm } from './LoginForm';

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const locale = await getLocale();
  const { next } = await searchParams;
  return (
    <div className="mx-auto max-w-md card">
      <h1 className="h1 mb-6">{t(locale, 'auth.loginTitle')}</h1>
      <LoginForm next={next && next.startsWith('/') && !next.startsWith('//') ? next : '/buyer'} labels={{ email: t(locale, 'auth.email'), password: t(locale, 'auth.password'), submit: t(locale, 'nav.login') }} />
      <div className="mt-4 flex justify-between text-sm"><Link className="text-brand-600 hover:underline" href="/forgot-password">{t(locale, 'auth.forgot')}</Link><Link className="text-brand-600 hover:underline" href="/register">{t(locale, 'nav.register')}</Link></div>
    </div>
  );
}

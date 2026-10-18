import { t } from '@globalhub/i18n';
import { getLocale } from '@/lib/server';
import { RegisterForm } from './RegisterForm';

export default async function Register() {
  const locale = await getLocale();
  const L = (k: Parameters<typeof t>[1]) => t(locale, k);
  return (
    <div className="mx-auto max-w-lg card">
      <h1 className="h1 mb-6">{L('auth.registerTitle')}</h1>
      <RegisterForm locale={locale} labels={{ email: L('auth.email'), password: L('auth.password'), name: L('auth.name'), role: L('auth.role'), BUYER: L('auth.role.BUYER'), SUPPLIER: L('auth.role.SUPPLIER'), AGENT: L('auth.role.AGENT'), company: L('auth.company'), country: L('auth.country'), submit: L('nav.register'), check: L('auth.checkEmail'), dev: L('auth.devToken') }} />
    </div>
  );
}

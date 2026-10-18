'use client';
import { useState } from 'react';
import Link from 'next/link';
import { COUNTRIES } from '@globalhub/shared';
import { browserApi } from '@/lib/browser';

export function RegisterForm({ locale, labels }: { locale: string; labels: Record<string, string> }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ token?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (done) return (
    <div className="space-y-3 text-sm" role="status">
      <p>{labels.check}</p>
      {done.token && <p className="rounded bg-yellow-50 p-3">{labels.dev} <Link data-testid="dev-verify-link" className="break-all text-brand-600 underline" href={`/verify-email?token=${done.token}`}>/verify-email?token=…</Link></p>}
      <Link className="btn-primary" href="/login">{'→'}</Link>
    </div>
  );
  return (
    <form className="grid gap-4" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setError(null);
      const fd = new FormData(e.currentTarget);
      try {
        const r = await browserApi.post('/auth/register', { email: fd.get('email'), password: fd.get('password'), displayName: fd.get('displayName'), role: fd.get('role'), companyName: fd.get('companyName') || undefined, country: fd.get('country') || undefined, locale });
        setDone({ token: r.devVerificationToken });
      } catch (err: any) { setError(err.details?.map?.((d: any) => `${d.path}: ${d.message}`).join('; ') || err.message); } finally { setBusy(false); }
    }}>
      <div><label className="label" htmlFor="role">{labels.role}</label><select id="role" name="role" className="input"><option value="BUYER">{labels.BUYER}</option><option value="SUPPLIER">{labels.SUPPLIER}</option><option value="AGENT">{labels.AGENT}</option></select></div>
      <div><label className="label" htmlFor="displayName">{labels.name}</label><input id="displayName" name="displayName" required className="input" /></div>
      <div><label className="label" htmlFor="email">{labels.email}</label><input id="email" name="email" type="email" required autoComplete="email" className="input" /></div>
      <div><label className="label" htmlFor="password">{labels.password}</label><input id="password" name="password" type="password" minLength={10} required autoComplete="new-password" className="input" /><p className="mt-1 text-xs text-ink-500">≥ 10 characters</p></div>
      <div><label className="label" htmlFor="companyName">{labels.company}</label><input id="companyName" name="companyName" className="input" /></div>
      <div><label className="label" htmlFor="country">{labels.country}</label><select id="country" name="country" className="input"><option value="">—</option>{Object.entries(COUNTRIES).map(([c, n]) => <option key={c} value={c}>{n.en}</option>)}</select></div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button className="btn-primary" disabled={busy}>{busy ? '…' : labels.submit}</button>
    </form>
  );
}

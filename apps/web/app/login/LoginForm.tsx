'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserApi } from '@/lib/browser';

export function LoginForm({ next, labels }: { next: string; labels: { email: string; password: string; submit: string } }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setError(null);
      const fd = new FormData(e.currentTarget);
      try { await browserApi.post('/auth/login', { email: fd.get('email'), password: fd.get('password') }); router.push(next); router.refresh(); }
      catch (err: any) { setError(err.message); } finally { setBusy(false); }
    }}>
      <div><label className="label" htmlFor="email">{labels.email}</label><input id="email" name="email" type="email" autoComplete="email" required className="input" /></div>
      <div><label className="label" htmlFor="password">{labels.password}</label><input id="password" name="password" type="password" autoComplete="current-password" required className="input" /></div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? '…' : labels.submit}</button>
    </form>
  );
}

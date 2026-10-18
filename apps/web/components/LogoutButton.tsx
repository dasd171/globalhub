'use client';
import { useRouter } from 'next/navigation';
import { browserApi } from '@/lib/browser';
export function LogoutButton({ label }: { label: string }) {
  const router = useRouter();
  return <button type="button" className="btn-ghost" onClick={async () => { await browserApi.post('/auth/logout').catch(() => undefined); router.push('/'); router.refresh(); }}>{label}</button>;
}

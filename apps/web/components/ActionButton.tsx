'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserApi } from '@/lib/browser';

export function ActionButton({ action, method = 'POST', body, label, confirm, redirectTo, variant = 'secondary', className }: {
  action: string; method?: 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown; label: string; confirm?: string; redirectTo?: string; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" disabled={busy} className={`${variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : variant === 'ghost' ? 'btn-ghost' : 'btn-secondary'} ${className ?? ''}`}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          setBusy(true); setError(null);
          try {
            const res = await browserApi.request<any>(method, action, method === 'DELETE' ? undefined : body ?? {});
            if (redirectTo) router.push(redirectTo.replace('{id}', res?.id ?? res?.orderId ?? '')); else router.refresh();
          } catch (e: any) { setError(e?.message ?? 'Failed'); } finally { setBusy(false); }
        }}>{busy ? '…' : label}</button>
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    </span>
  );
}

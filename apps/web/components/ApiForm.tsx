'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toMinor, COUNTRIES } from '@globalhub/shared';
import { browserApi } from '@/lib/browser';

export type FieldType = 'text' | 'email' | 'password' | 'textarea' | 'number' | 'int' | 'money' | 'select' | 'checkbox' | 'date' | 'countries' | 'country' | 'kv' | 'url' | 'hidden' | 'list';
export interface FieldDef {
  name: string; label?: string; type?: FieldType; options?: { value: string; label: string }[]; required?: boolean; defaultValue?: string | number | boolean;
  placeholder?: string; help?: string; currency?: string; currencyField?: string; half?: boolean; min?: number;
}
export interface ApiFormProps {
  action: string; method?: 'POST' | 'PATCH' | 'PUT'; fields: FieldDef[]; extra?: Record<string, unknown>; submitLabel: string;
  redirectTo?: string; successMessage?: string; className?: string; resetOnSuccess?: boolean; showResult?: boolean;
}

function setPath(obj: Record<string, any>, path: string, value: unknown) {
  const parts = path.split('.');
  let cur: any = obj;
  parts.forEach((p, i) => {
    const last = i === parts.length - 1;
    const nextIsIndex = !last && /^\d+$/.test(parts[i + 1]);
    if (last) cur[p] = value;
    else { cur[p] ??= nextIsIndex ? [] : {}; cur = cur[p]; }
  });
}

/** Generic JSON form posting to the API with CSRF. Converts money (decimal → minor units), countries, key:value lists. */
export function ApiForm({ action, method = 'POST', fields, extra, submitLabel, redirectTo, successMessage, className, resetOnSuccess, showResult }: ApiFormProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [ok, setOk] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null); setDetails([]); setOk(null);
    const fd = new FormData(e.currentTarget);
    const body: Record<string, any> = { ...(extra ?? {}) };
    try {
      for (const f of fields) {
        const raw = fd.get(f.name);
        const s = typeof raw === 'string' ? raw.trim() : '';
        let v: unknown;
        switch (f.type) {
          case 'checkbox': v = fd.get(f.name) === 'on'; break;
          case 'int': case 'number': v = s === '' ? undefined : Number(s); break;
          case 'money': {
            const cur = f.currency ?? (f.currencyField ? String(fd.get(f.currencyField) ?? body[f.currencyField] ?? 'USD') : 'USD');
            v = s === '' ? undefined : toMinor(s, cur); break;
          }
          case 'countries': v = s ? s.split(/[\s,;|]+/).filter(Boolean).map((c) => c.toUpperCase()) : []; break;
          case 'list': v = s ? s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean) : []; break;
          case 'kv': v = s ? Object.fromEntries(s.split('\n').map((l) => l.split(/[:=]/)).filter((p) => p.length >= 2 && p[0].trim()).map(([k, ...r]) => [k.trim(), r.join(':').trim()])) : undefined; break;
          case 'date': v = s ? new Date(s).toISOString() : undefined; break;
          default: v = s === '' ? undefined : s;
        }
        if (v !== undefined) setPath(body, f.name, v);
      }
      const res = await browserApi.request<any>(method, action, body);
      setOk(successMessage ?? 'Saved');
      if (showResult) setResult(res);
      if (resetOnSuccess) e.currentTarget?.reset();
      if (redirectTo) router.push(redirectTo.replace('{id}', res?.id ?? res?.orderId ?? res?.buyingRequestId ?? ''));
      else router.refresh();
    } catch (err: any) {
      setError(err?.message ?? 'Request failed');
      if (Array.isArray(err?.details)) setDetails(err.details.map((d: any) => (d.path ? `${d.path}: ${d.message}` : d.message ?? JSON.stringify(d))));
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={onSubmit} className={className ?? 'grid grid-cols-1 gap-4 sm:grid-cols-2'} noValidate>
      {fields.map((f) => <Field key={f.name} f={f} />)}
      <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? '…' : submitLabel}</button>
        {ok && <span role="status" className="text-sm text-green-700">{ok}</span>}
        {error && <span role="alert" className="text-sm text-red-700">{error}</span>}
      </div>
      {details.length > 0 && <ul className="sm:col-span-2 list-disc pl-5 text-sm text-red-700">{details.map((d) => <li key={d}>{d}</li>)}</ul>}
      {showResult && result !== null && <pre className="sm:col-span-2 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">{JSON.stringify(result, null, 2)}</pre>}
    </form>
  );
}

function Field({ f }: { f: FieldDef }) {
  const id = `f-${f.name.replace(/\./g, '-')}`;
  const span = f.half ? '' : f.type === 'textarea' || f.type === 'kv' || f.type === 'list' ? 'sm:col-span-2' : '';
  if (f.type === 'hidden') return <input type="hidden" name={f.name} defaultValue={String(f.defaultValue ?? '')} />;
  if (f.type === 'checkbox') return (
    <label className={`flex items-center gap-2 text-sm ${span}`} htmlFor={id}>
      <input id={id} name={f.name} type="checkbox" defaultChecked={!!f.defaultValue} className="h-4 w-4 rounded border-gray-300 text-brand-500" /> {f.label}
    </label>
  );
  return (
    <div className={span}>
      {f.label && <label className="label" htmlFor={id}>{f.label}{f.required && <span className="text-brand-500"> *</span>}</label>}
      {f.type === 'textarea' || f.type === 'kv' || f.type === 'list' ? (
        <textarea id={id} name={f.name} rows={f.type === 'textarea' ? 4 : 3} className="input" placeholder={f.placeholder} defaultValue={f.defaultValue as string | undefined} required={f.required} />
      ) : f.type === 'select' || f.type === 'country' ? (
        <select id={id} name={f.name} className="input" defaultValue={f.defaultValue as string | undefined} required={f.required}>
          {!f.required && <option value="">—</option>}
          {(f.type === 'country' ? Object.entries(COUNTRIES).map(([v, c]) => ({ value: v, label: c.en })) : f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input id={id} name={f.name} className="input" placeholder={f.placeholder} defaultValue={f.defaultValue as string | undefined} required={f.required}
          type={f.type === 'money' || f.type === 'number' ? 'text' : f.type === 'int' ? 'number' : f.type === 'countries' ? 'text' : f.type ?? 'text'}
          inputMode={f.type === 'money' ? 'decimal' : f.type === 'int' ? 'numeric' : undefined} min={f.min} step={f.type === 'int' ? 1 : undefined} />
      )}
      {f.help && <p className="mt-1 text-xs text-ink-500">{f.help}</p>}
    </div>
  );
}

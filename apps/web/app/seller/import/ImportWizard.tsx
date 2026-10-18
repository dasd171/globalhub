'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserApi } from '@/lib/browser';

const FIELDS = ['', 'sku', 'title_en', 'description_en', 'category', 'price', 'currency', 'stock', 'moq', 'specs', 'image_urls', 'ships_from', 'ships_to', 'status'];
const SAMPLE = 'sku,title_en,price,currency,stock,moq,category,ships_to,status,specs\nTENT-001,Waterproof camping tent,99.00,USD,120,10,tents,JP|US,ACTIVE,material:polyester|size:210x180cm\n';

export function ImportWizard({ stores }: { stores: { id: string; name: string }[] }) {
  const router = useRouter();
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '');
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('upload.csv');
  const [preview, setPreview] = useState<any>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => { setErr(null); try { await fn(); } catch (e: any) { setErr(e.message); } };
  if (!stores.length) return <p className="card">Create a store first.</p>;
  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="label" htmlFor="store">Store</label><select id="store" className="input" value={storeId} onChange={(e) => setStoreId(e.target.value)}>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label className="label" htmlFor="file">CSV file</label><input id="file" type="file" accept=".csv,text/csv" className="text-sm" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 5_000_000) { setErr('File too large (max 5 MB)'); return; } setFilename(f.name); setCsv(await f.text()); setPreview(null); }} /></div>
        <a className="text-sm text-brand-600 underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE)}`} download="globalhub-template.csv">Download template</a>
      </div>
      <textarea aria-label="CSV content" className="input font-mono text-xs" rows={6} value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); }} placeholder={SAMPLE} />
      <button className="btn-secondary" data-testid="import-preview" disabled={!csv} onClick={() => run(async () => { const p = await browserApi.post('/imports/preview', { storeId, filename, csv, mapping: Object.keys(mapping).length ? mapping : undefined }); setPreview(p); setMapping(p.mapping); })}>Preview</button>
      {preview && (
        <div className="space-y-3">
          <p className="text-sm" data-testid="import-summary">{preview.validRows} valid / {preview.totalRows} rows · {preview.errors.length} errors</p>
          <div className="grid gap-2 sm:grid-cols-3">{preview.headers.map((h: string) => <label key={h} className="text-xs">{h} → <select className="input py-1 text-xs" value={mapping[h] ?? ''} onChange={(e) => setMapping((m) => { const n = { ...m }; if (e.target.value) n[h] = e.target.value; else delete n[h]; return n; })}>{FIELDS.map((f) => <option key={f} value={f}>{f || '(ignore)'}</option>)}</select></label>)}</div>
          {preview.errors.length > 0 && <div className="max-h-48 overflow-auto rounded bg-red-50 p-3 text-xs text-red-800" data-testid="import-errors">{preview.errors.map((e: any, i: number) => <div key={i}>Row {e.rowNumber}{e.field ? ` [${e.field}]` : ''}: {e.message}</div>)}</div>}
          {preview.sample?.length > 0 && <table className="table text-xs"><thead><tr><th>Row</th><th>SKU</th><th>Title</th><th>Price</th><th>Stock</th><th>MOQ</th></tr></thead><tbody>{preview.sample.map((r: any) => <tr key={r.rowNumber}><td>{r.rowNumber}</td><td>{r.sku}</td><td>{r.titleZh ?? r.titleEn}</td><td>{r.priceMinor ?? '—'} {r.currency}</td><td>{r.stock ?? 'unverified'}</td><td>{r.moq}</td></tr>)}</tbody></table>}
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => run(async () => { const p = await browserApi.post('/imports/preview', { storeId, filename, csv, mapping }); setPreview(p); })}>Re-check with mapping</button>
            <button className="btn-primary" data-testid="import-commit" disabled={!preview.validRows} onClick={() => run(async () => { const r = await browserApi.post(`/imports/${preview.jobId}/commit`, { publish: true }); setDone(`Imported ${r.created} products`); setPreview(null); router.refresh(); })}>Import {preview.validRows} valid rows</button>
          </div>
          {preview.errors.length > 0 && <p className="text-xs text-ink-500">Rows with errors are skipped. Fix them and import again — existing SKUs are detected as duplicates.</p>}
        </div>
      )}
      {done && <p role="status" className="text-sm text-green-700" data-testid="import-done">{done}</p>}
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
    </div>
  );
}

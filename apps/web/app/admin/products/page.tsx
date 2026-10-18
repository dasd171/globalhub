import Link from 'next/link';
import { load } from '@/lib/server';
import { ErrorBox, PageHeader, StatusPill, Pagination } from '@/components/ui';
import { ActionButton } from '@/components/ActionButton';
export default async function Products({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const sp = await searchParams;
  const res = await load<any>(`/admin/products?page=${sp.page ?? 1}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ''}`);
  if (res.error) return <ErrorBox error={res.error} />;
  return (
    <div><PageHeader title="Products" actions={<form><input name="q" defaultValue={sp.q} className="input" placeholder="search" /></form>} />
      <div className="card overflow-x-auto p-0"><table className="table"><thead><tr><th>Product</th><th>Store</th><th>Status</th><th /></tr></thead>
        <tbody>{res.data.items.map((p: any) => <tr key={p.id}><td><Link className="hover:underline" href={`/products/${p.id}`}>{p.titleEn ?? p.titleZh}</Link>{p.isDemo && <span className="badge ml-1 bg-yellow-200">DEMO</span>}</td><td className="text-xs">{p.store.name}</td><td><StatusPill status={p.status} /> <StatusPill status={p.stockStatus} /></td><td>{p.status === 'ACTIVE' ? <ActionButton action={`/admin/products/${p.id}`} method="PATCH" body={{ status: 'ARCHIVED' }} label="Take down" variant="ghost" confirm="Archive this product?" /> : <ActionButton action={`/admin/products/${p.id}`} method="PATCH" body={{ status: 'ACTIVE' }} label="Restore" variant="ghost" />}</td></tr>)}</tbody></table></div>
      <Pagination page={res.data.page} totalPages={res.data.totalPages} baseHref="/admin/products" />
    </div>
  );
}

import { load } from '@/lib/server';
import { PageHeader } from '@/components/ui';
import { ApiForm } from '@/components/ApiForm';
export default async function Categories() {
  const res = await load<any[]>('/categories');
  const cats = res.data ?? [];
  return (
    <div className="space-y-6"><PageHeader title="Categories" />
      <div className="card"><ul className="grid gap-1 text-sm sm:grid-cols-2">{cats.map((c) => <li key={c.id}>{c.parentId ? '↳ ' : ''}<span className="font-mono text-xs">{c.slug}</span> — {c.nameEn} ({c._count.products})</li>)}</ul></div>
      <div className="card"><h2 className="h2 mb-3">Add / update</h2><ApiForm action="/admin/categories" submitLabel="Save" fields={[{ name: 'slug', label: 'Slug', required: true, half: true }, { name: 'nameEn', label: 'Name', required: true, half: true }, { name: 'parentId', label: 'Parent', type: 'select', options: cats.filter((c) => !c.parentId).map((c) => ({ value: c.id, label: c.nameEn })), half: true }]} /></div>
    </div>
  );
}

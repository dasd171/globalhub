import { t } from '@globalhub/i18n';
import { getLocale, load } from '@/lib/server';
import { PageHeader } from '@/components/ui';
import { ProductForm } from './ProductForm';
export default async function NewProduct() {
  const locale = await getLocale();
  const [profile, cats] = await Promise.all([load<any>('/seller/profile'), load<any[]>('/categories')]);
  const stores = profile.data?.stores ?? [];
  return (
    <div><PageHeader title={t(locale, 'seller.newProduct')} subtitle="Enter the product as buyers should see it. Fields marked * are required." />
      {stores.length ? <ProductForm stores={stores.map((s: any) => ({ id: s.id, name: s.name }))} categories={(cats.data ?? []).map((c: any) => ({ id: c.id, name: c.nameEn }))} /> : <p className="card">Create a store first (Store & profile).</p>}
    </div>
  );
}

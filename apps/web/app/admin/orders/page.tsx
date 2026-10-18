import { getLocale, load } from '@/lib/server';
import { ErrorBox, PageHeader } from '@/components/ui';
import { OrderTable } from '@/components/order/OrderTable';
export default async function Orders({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page } = await searchParams;
  const locale = await getLocale();
  const res = await load<any>(`/orders?as=admin&page=${page ?? 1}`);
  return <div><PageHeader title="Orders" />{res.error ? <ErrorBox error={res.error} /> : <OrderTable data={res.data} base="/buyer/orders" locale={locale} />}</div>;
}

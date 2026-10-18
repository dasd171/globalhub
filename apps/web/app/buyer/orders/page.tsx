import { t } from '@globalhub/i18n';
import { getLocale, load } from '@/lib/server';
import { PageHeader, ErrorBox } from '@/components/ui';
import { OrderTable } from '@/components/order/OrderTable';
export default async function Orders({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page } = await searchParams;
  const locale = await getLocale();
  const res = await load<any>(`/orders?as=buyer&page=${page ?? 1}`);
  return <div><PageHeader title={t(locale, 'buyer.orders')} />{res.error ? <ErrorBox error={res.error} /> : <OrderTable data={res.data} base="/buyer/orders" locale={locale} />}</div>;
}

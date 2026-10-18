import { getLocale, load } from '@/lib/server';
import { ErrorBox } from '@/components/ui';
import { OrderView } from '@/components/order/OrderView';
export default async function BuyerOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const res = await load<any>(`/orders/${id}`);
  return res.error ? <ErrorBox error={res.error} /> : <OrderView o={res.data} locale={locale} />;
}

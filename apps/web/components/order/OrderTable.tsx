import Link from 'next/link';
import type { Locale } from '@globalhub/i18n';
import { Money, StatusPill, Empty, Pagination } from '@/components/ui';
import { fmtDay } from '@/lib/format';
export function OrderTable({ data, base, locale }: { data: any; base: string; locale: Locale }) {
  if (!data.items.length) return <Empty>—</Empty>;
  return (
    <>
      <div className="card overflow-x-auto p-0"><table className="table"><thead><tr><th>Order</th><th>Items</th><th>Counterparty</th><th>Total (confirmed)</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>{data.items.map((o: any) => <tr key={o.id}><td><Link className="font-mono text-xs font-medium hover:underline" href={`${base}/${o.id}`}>{o.orderNumber}</Link>{o.isDemo && <span className="badge ml-1 bg-yellow-200">DEMO</span>}</td><td className="text-xs">{o.items.map((i: any) => `${i.title} ×${i.quantity}`).join(', ')}</td><td className="text-xs">{o.supplier.companyName} / {o.buyer.displayName}</td><td><Money minor={o.confirmedTotalMinor} currency={o.currency} locale={locale} />{o.hasUnconfirmedFees && <span className="ml-1 text-xs text-ink-500">+ ?</span>}</td><td><StatusPill status={o.status} /></td><td className="text-xs">{fmtDay(o.createdAt, locale)}</td></tr>)}</tbody></table></div>
      <Pagination page={data.page} totalPages={data.totalPages} baseHref={base} />
    </>
  );
}

import Link from 'next/link';
import { t } from '@globalhub/i18n';
import { getLocale, load } from '@/lib/server';
import { ErrorBox, Empty, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ActionButton';
import { fmtDate } from '@/lib/format';

export default async function Notifications() {
  const locale = await getLocale();
  const res = await load<any>('/notifications');
  if (res.error) return <ErrorBox error={res.error} />;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t(locale, 'nav.notifications')} actions={<ActionButton action="/notifications/read" label="Mark all read" />} />
      {res.data.items.length === 0 ? <Empty>{t(locale, 'common.none')}</Empty> : (
        <ul className="card divide-y p-0">{res.data.items.map((n: any) => (
          <li key={n.id} className={`p-4 ${n.readAt ? '' : 'bg-brand-50/40'}`}>
            <div className="flex justify-between gap-4"><span className="font-medium">{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</span><span className="text-xs text-ink-500">{fmtDate(n.createdAt, locale)}</span></div>
            <p className="text-sm text-ink-700">{n.body}</p>
            <p className="mt-1 text-xs text-ink-500">Email: {n.emailStatus === 'NOT_CONFIGURED' ? 'not configured on this node (not sent)' : n.emailStatus.toLowerCase().replace('_', ' ')}</p>
          </li>
        ))}</ul>
      )}
    </div>
  );
}

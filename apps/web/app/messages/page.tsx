import Link from 'next/link';
import { t } from '@globalhub/i18n';
import { getLocale, load } from '@/lib/server';
import { ErrorBox, Empty, PageHeader } from '@/components/ui';
import { fmtDate } from '@/lib/format';

export default async function Messages() {
  const locale = await getLocale();
  const res = await load<any>('/conversations');
  if (res.error) return <ErrorBox error={res.error} />;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t(locale, 'nav.messages')} subtitle={`${res.data.totalUnread} unread`} />
      {res.data.items.length === 0 ? <Empty>{t(locale, 'common.none')}</Empty> : (
        <ul className="card divide-y p-0">{res.data.items.map((c: any) => (
          <li key={c.id}><Link href={`/messages/${c.id}`} className="flex justify-between gap-4 p-4 hover:bg-gray-50">
            <div><div className="font-medium">{c.participants.map((p: any) => p.displayName).join(', ')} <span className="badge bg-gray-100 text-[10px]">{c.subject.replace(/_/g, ' ').toLowerCase()}</span></div><p className="line-clamp-1 text-sm text-ink-500">{c.lastMessage?.body}</p></div>
            <div className="text-right text-xs text-ink-500">{fmtDate(c.lastMessage?.createdAt, locale)}{c.unread > 0 && <div className="badge mt-1 bg-brand-500 text-white">{c.unread}</div>}</div>
          </Link></li>
        ))}</ul>
      )}
    </div>
  );
}

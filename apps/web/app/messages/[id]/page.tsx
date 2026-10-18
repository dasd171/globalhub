import { getLocale, load, getMe } from '@/lib/server';
import { ErrorBox } from '@/components/ui';
import { ApiForm } from '@/components/ApiForm';
import { ActionButton } from '@/components/ActionButton';
import { fmtDate } from '@/lib/format';
import { AutoRefresh } from '@/components/AutoRefresh';

export default async function Conversation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const [res, me] = await Promise.all([load<any>(`/conversations/${id}/messages`), getMe()]);
  if (res.error) return <ErrorBox error={res.error} />;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <AutoRefresh seconds={10} />
      <div className="card space-y-3">
        {res.data.messages.map((m: any) => {
          const mine = m.sender.id === me?.id;
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : ''}`}>
              <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${mine ? 'bg-brand-500 text-white' : 'bg-gray-100'}`}>
                <div className="text-[11px] opacity-75">{m.sender.displayName} · {fmtDate(m.createdAt, locale)}{mine && m.readByOthers ? ' · ✓ read' : ''}</div>
                <p className="whitespace-pre-line">{m.body}</p>
                {!mine && <div className="mt-1 flex gap-2 text-[11px]"><ActionButton action="/reports" body={{ targetType: 'MESSAGE', targetId: m.id, reason: 'Reported from conversation' }} label="Report" variant="ghost" confirm="Report this message?" /><ActionButton action={`/users/${m.sender.id}/block`} label="Block" variant="ghost" confirm="Block this user?" /></div>}
              </div>
            </div>
          );
        })}
      </div>
      <ApiForm action={`/conversations/${id}/messages`} className="grid gap-2" submitLabel="Send" resetOnSuccess fields={[{ name: 'body', type: 'textarea', required: true, placeholder: 'Write a message…' }]} />
    </div>
  );
}

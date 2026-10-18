import type { Prisma } from '@globalhub/database';
import type { Core } from '../context.js';

/**
 * Create an in-app notification. If an email provider is configured the row is marked QUEUED
 * and the worker delivers it (Postgres is the durable outbox). Without a provider the status is
 * NOT_CONFIGURED — we never claim an email was sent.
 */
export async function notify(core: Core, n: { userId: string; type: string; title: string; body: string; link?: string; email?: boolean }, tx?: Prisma.TransactionClient) {
  const db = tx ?? core.prisma;
  const wantsEmail = n.email !== false;
  return db.notification.create({
    data: {
      userId: n.userId, type: n.type, title: n.title.slice(0, 200), body: n.body.slice(0, 2000), link: n.link,
      emailStatus: !wantsEmail ? 'NOT_REQUESTED' : core.email.name === 'none' ? 'NOT_CONFIGURED' : 'QUEUED',
    },
  });
}

/** Deliver queued emails (called by the worker). Returns counts. */
export async function deliverQueuedEmails(core: Core, limit = 50) {
  const rows = await core.prisma.notification.findMany({ where: { emailStatus: 'QUEUED' }, take: limit, include: { user: { select: { email: true, status: true } } }, orderBy: { createdAt: 'asc' } });
  let sent = 0; let failed = 0;
  for (const r of rows) {
    if (r.user.status !== 'ACTIVE') { await core.prisma.notification.update({ where: { id: r.id }, data: { emailStatus: 'NOT_REQUESTED' } }); continue; }
    const res = await core.email.send({ to: r.user.email, subject: r.title, text: `${r.body}${r.link ? `\n\n${core.config.APP_BASE_URL}${r.link}` : ''}` });
    await core.prisma.notification.update({ where: { id: r.id }, data: { emailStatus: res.status } });
    if (res.status === 'SENT') sent++; else failed++;
  }
  return { processed: rows.length, sent, failed };
}

export async function listNotifications(core: Core, userId: string, unreadOnly = false) {
  const [items, unread] = await Promise.all([
    core.prisma.notification.findMany({ where: { userId, ...(unreadOnly ? { readAt: null } : {}) }, orderBy: { createdAt: 'desc' }, take: 100 }),
    core.prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { items, unread };
}

export async function markNotificationsRead(core: Core, userId: string, ids?: string[]) {
  const r = await core.prisma.notification.updateMany({ where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
  return { updated: r.count };
}

import type { Prisma } from '@globalhub/database';
import type { Core, RequestMeta } from '../context.js';
import { redact } from '../crypto.js';

export async function audit(core: Core, entry: { actorId?: string | null; action: string; targetType?: string; targetId?: string; metadata?: Record<string, unknown>; meta?: RequestMeta }, tx?: Prisma.TransactionClient) {
  const db = tx ?? core.prisma;
  await db.auditLog.create({
    data: {
      actorId: entry.actorId ?? null, action: entry.action, targetType: entry.targetType, targetId: entry.targetId,
      metadata: entry.metadata ? (redact(entry.metadata) as Prisma.InputJsonValue) : undefined, ip: entry.meta?.ip, requestId: entry.meta?.requestId,
    },
  });
}

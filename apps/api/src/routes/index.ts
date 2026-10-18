import { z } from 'zod';
import { admin, type Core } from '@globalhub/core';
import { AppError } from '@globalhub/shared';
import type { Api } from './helpers.js';
import { authRoutes } from './auth.js';
import { catalogRoutes } from './catalog.js';
import { sourcingRoutes } from './sourcing.js';
import { orderRoutes } from './orders.js';
import { federationRoutes } from './federation.js';
import { adminRoutes } from './admin.js';

const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf', csv: 'text/csv' };

export function registerRoutes(api: Api, core: Core) {
  api.get('/health', { config: { rateLimit: false }, schema: { tags: ['system'] } }, async () => admin.systemHealth(core));
  api.get('/health/live', { config: { rateLimit: false }, schema: { tags: ['system'] } }, async () => ({ ok: true }));

  /**
   * File download. Product images are public; RFQ/dispute attachments require the viewer to
   * be allowed to see the parent record.
   */
  api.get('/files/:prefix/:name', { schema: { tags: ['files'], params: z.object({ prefix: z.enum(['products', 'rfq', 'evidence']), name: z.string().regex(/^[0-9a-f-]{36}\.[a-z]{2,5}$/) }) } }, async (req, reply) => {
    const key = `${req.params.prefix}/${req.params.name}`;
    if (req.params.prefix === 'rfq') {
      const att = await core.prisma.buyingRequestAttachment.findFirst({ where: { storageKey: key }, include: { buyingRequest: true } });
      if (!att) throw new AppError('NOT_FOUND', 'File not found');
      const { requests } = await import('@globalhub/core');
      await requests.getBuyingRequest(core, req.actor, att.buyingRequestId); // throws if not visible
    } else if (req.params.prefix === 'evidence') {
      if (!req.actor) throw new AppError('NOT_FOUND', 'File not found');
      const ev = await core.prisma.disputeEvidence.findFirst({ where: { storageKey: key }, include: { dispute: true } });
      if (!ev) throw new AppError('NOT_FOUND', 'File not found');
      const { orders } = await import('@globalhub/core');
      await orders.loadOrderFor(core, req.actor, ev.dispute.orderId);
    }
    const buf = await core.storage.get(key).catch(() => { throw new AppError('NOT_FOUND', 'File not found'); });
    const ext = req.params.name.split('.').pop()!;
    return reply.header('content-type', MIME[ext] ?? 'application/octet-stream').header('x-content-type-options', 'nosniff').header('content-disposition', ext === 'pdf' || ext === 'csv' ? 'attachment' : 'inline').send(buf);
  });

  authRoutes(api, core);
  catalogRoutes(api, core);
  sourcingRoutes(api, core);
  orderRoutes(api, core);
  federationRoutes(api, core);
  adminRoutes(api, core);
}

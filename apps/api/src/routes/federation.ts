import { z } from 'zod';
import { federation, type Core } from '@globalhub/core';
import { AppError } from '@globalhub/shared';
import { type Api, actor, meta } from './helpers.js';

export function federationRoutes(api: Api, core: Core) {
  const fedLimit = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };
  // Public network status (no private data).
  api.get('/nodes', { schema: { tags: ['nodes'] } }, async () => ({ federationEnabled: core.config.FEDERATION_ENABLED, localNodeId: core.config.NODE_ID, nodes: await federation.listNodes(core) }));

  api.get('/federation/node-info', { ...fedLimit, schema: { tags: ['federation'] } }, async () => federation.localNodeInfo(core));
  api.get('/federation/catalog/:kind', { ...fedLimit, schema: { tags: ['federation'], params: z.object({ kind: z.enum(['products', 'suppliers']) }), querystring: z.object({ cursor: z.string().max(64).optional(), limit: z.coerce.number().int().min(1).max(100).default(100) }) } },
    async (req, reply) => {
      const page = await federation.serveCatalog(core, req.params.kind, req.query.cursor, req.query.limit);
      const body = JSON.stringify(page);
      const headers = federation.signResponse(core, `/api/v1/federation/catalog/${req.params.kind}`, body);
      for (const [k, v] of Object.entries(headers)) reply.header(k, v);
      return reply.type('application/json').send(body);
    });
  const inbound = async (req: { method: string; url: string; rawBody?: string; headers: Record<string, string | string[] | undefined> }) => {
    const raw = req.rawBody ?? '';
    if (raw.length > 256_000) throw new AppError('BAD_REQUEST', 'Payload too large');
    return federation.verifyInbound(core, req.method, req.url.split('?')[0], raw, req.headers);
  };
  api.post('/federation/inbox/rfq', { ...fedLimit, schema: { tags: ['federation'] } }, async (req) => federation.receiveRfq(core, await inbound(req), req.body));
  api.post('/federation/inbox/quote', { ...fedLimit, schema: { tags: ['federation'] } }, async (req) => federation.receiveQuote(core, await inbound(req), req.body));
  api.post('/federation/heartbeat', { ...fedLimit, schema: { tags: ['federation'] } }, async (req) => { const n = await inbound(req); return { ok: true, nodeId: n.nodeId }; });

  // Node operator actions
  api.post('/nodes/discover', { schema: { tags: ['nodes'], body: z.object({ url: z.string().url().max(300) }) } }, async (req, reply) => reply.status(201).send(await federation.discoverNode(core, actor(req), req.body.url, meta(req))));
  api.post('/nodes/:id/sync', { schema: { tags: ['nodes'], params: z.object({ id: z.string().uuid() }), body: z.object({ kind: z.enum(['products', 'suppliers']).default('products') }) } }, async (req) => {
    const a = actor(req);
    if (!a.roles.includes('NODE_ADMIN') && !a.roles.includes('PLATFORM_ADMIN')) throw new AppError('FORBIDDEN', 'Node admin only');
    return federation.pullCatalog(core, req.params.id, req.body.kind);
  });
  api.patch('/nodes/:id', { schema: { tags: ['nodes'], params: z.object({ id: z.string().uuid() }), body: z.object({ status: z.enum(['ACTIVE', 'STALE', 'BANNED']).optional(), trustLevel: z.enum(['UNVERIFIED', 'DOMAIN_VERIFIED', 'BUSINESS_VERIFIED', 'ADMIN_REVIEWED']).optional() }) } },
    async (req) => federation.adminUpdateNode(core, actor(req), req.params.id, req.body, meta(req)));
  api.post('/federation/listings/:id/request-quote', { schema: { tags: ['federation'], params: z.object({ id: z.string().uuid() }), body: z.object({ quantity: z.number().int().min(1), destinationCountry: z.string().regex(/^[A-Z]{2}$/), message: z.string().trim().min(10).max(5000), currency: z.string().regex(/^[A-Z]{3}$/).optional() }) } },
    async (req, reply) => reply.status(201).send(await federation.sendRemoteRfq(core, actor(req), req.params.id, req.body, meta(req))));
  api.get('/federation/listings/:id', { schema: { tags: ['federation'], params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const l = await core.prisma.federatedListing.findUnique({ where: { id: req.params.id }, include: { node: { select: { nodeId: true, displayName: true, trustLevel: true, publicUrl: true, status: true, capabilities: true } } } });
    if (!l || l.removed) throw new AppError('NOT_FOUND', 'Listing not found');
    return { ...l, notice: 'Listed on a remote node. Data is provided by that node and not verified by this node.' };
  });
}

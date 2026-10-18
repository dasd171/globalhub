import { z } from 'zod';
import { createOrderSchema, supplierConfirmSchema, orderTransitionSchema, shipmentSchema, shipmentEventSchema, refundRequestSchema, refundDecisionSchema, disputeSchema, disputeEvidenceSchema, disputeResolveSchema, reviewSchema, conversationSchema, messageSchema, reportSchema, paginationQuery, ORDER_STATUSES } from '@globalhub/shared';
import { orders, payments, fulfilment, social, type Core } from '@globalhub/core';
import { type Api, actor, meta } from './helpers.js';

const idParam = z.object({ id: z.string().uuid() });

export function orderRoutes(api: Api, core: Core) {
  api.post('/orders', { schema: { tags: ['orders'], body: createOrderSchema } }, async (req, reply) => {
    const r = await orders.createOrder(core, actor(req), req.body, meta(req));
    return reply.status('idempotentReplay' in r && r.idempotentReplay ? 200 : 201).send(r);
  });
  api.get('/orders', { schema: { tags: ['orders'], querystring: paginationQuery.extend({ as: z.enum(['buyer', 'supplier', 'admin']).default('buyer'), status: z.enum(ORDER_STATUSES).optional() }) } }, async (req) => orders.listOrders(core, actor(req), req.query));
  api.get('/orders/:id', { schema: { tags: ['orders'], params: idParam } }, async (req) => orders.getOrder(core, actor(req), req.params.id));
  api.post('/orders/:id/confirm', { schema: { tags: ['orders'], params: idParam, body: supplierConfirmSchema } }, async (req) => orders.supplierConfirmOrder(core, actor(req), req.params.id, req.body, meta(req)));
  api.post('/orders/:id/transition', { schema: { tags: ['orders'], params: idParam, body: orderTransitionSchema } }, async (req) => orders.transitionOrder(core, actor(req), req.params.id, req.body.to, req.body.note, meta(req)));

  api.post('/orders/:id/payments', { schema: { tags: ['payments'], params: idParam, body: z.object({ acknowledgeUnconfirmedFees: z.boolean().default(false) }) } }, async (req) => payments.startPayment(core, actor(req), req.params.id, req.body));
  api.post('/orders/:id/payments/demo-confirm', { schema: { tags: ['payments'], params: idParam } }, async (req) => payments.demoConfirmPayment(core, actor(req), req.params.id));
  api.post('/orders/:id/payments/manual', { schema: { tags: ['payments'], params: idParam, body: z.object({ reference: z.string().trim().min(3).max(200) }) } }, async (req) => payments.recordManualPayment(core, actor(req), req.params.id, req.body.reference, meta(req)));
  api.post('/payments/webhooks/:provider', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } }, schema: { tags: ['payments'], params: z.object({ provider: z.string().max(30) }) } },
    async (req) => payments.handlePaymentWebhook(core, req.params.provider, req.rawBody ?? '', req.headers, meta(req)));
  api.get('/payments/mode', { schema: { tags: ['payments'] } }, async () => ({ provider: core.payment.name, isDemo: core.payment.isDemo, banner: core.payment.isDemo ? 'DEMO PAYMENT — NO REAL MONEY MOVED' : null, enabled: core.payment.name !== 'mock' || core.config.mockPaymentsAllowed }));

  api.post('/orders/:id/shipments', { schema: { tags: ['shipments'], params: idParam, body: shipmentSchema } }, async (req, reply) => reply.status(201).send(await fulfilment.createShipment(core, actor(req), req.params.id, req.body, meta(req))));
  api.post('/shipments/:id/events', { schema: { tags: ['shipments'], params: idParam, body: shipmentEventSchema } }, async (req) => fulfilment.addShipmentEvent(core, actor(req), req.params.id, req.body, meta(req)));

  api.post('/orders/:id/refunds', { schema: { tags: ['refunds'], params: idParam, body: refundRequestSchema } }, async (req, reply) => reply.status(201).send(await fulfilment.requestRefund(core, actor(req), req.params.id, req.body.amountMinor, req.body.reason, meta(req))));
  api.post('/refunds/:id/decision', { schema: { tags: ['refunds'], params: idParam, body: refundDecisionSchema } }, async (req) => fulfilment.decideRefund(core, actor(req), req.params.id, req.body.decision, req.body.note, meta(req)));

  api.post('/orders/:id/disputes', { schema: { tags: ['disputes'], params: idParam, body: disputeSchema } }, async (req, reply) => reply.status(201).send(await fulfilment.openDispute(core, actor(req), req.params.id, req.body.reason, meta(req))));
  api.get('/disputes', { schema: { tags: ['disputes'], querystring: z.object({ scope: z.enum(['mine', 'all']).default('mine') }) } }, async (req) => fulfilment.listDisputes(core, actor(req), req.query.scope));
  api.post('/disputes/:id/evidence', { schema: { tags: ['disputes'], params: idParam, body: disputeEvidenceSchema } }, async (req, reply) => reply.status(201).send(await fulfilment.addDisputeEvidence(core, actor(req), req.params.id, req.body.body, req.body.storageKey)));
  api.post('/disputes/:id/resolve', { schema: { tags: ['disputes'], params: idParam, body: disputeResolveSchema } }, async (req) => fulfilment.resolveDispute(core, actor(req), req.params.id, req.body, meta(req)));

  api.post('/reviews', { schema: { tags: ['reviews'], body: reviewSchema } }, async (req, reply) => reply.status(201).send(await fulfilment.createReview(core, actor(req), req.body)));
  api.get('/reviews', { schema: { tags: ['reviews'], querystring: z.object({ productId: z.string().uuid().optional(), supplierId: z.string().uuid().optional() }) } }, async (req) => fulfilment.listReviews(core, req.query));

  api.get('/conversations', { schema: { tags: ['messages'] } }, async (req) => social.listConversations(core, actor(req)));
  api.post('/conversations', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { tags: ['messages'], body: conversationSchema } }, async (req, reply) => reply.status(201).send(await social.startConversation(core, actor(req), req.body)));
  api.get('/conversations/:id/messages', { schema: { tags: ['messages'], params: idParam, querystring: z.object({ after: z.coerce.date().optional() }) } }, async (req) => social.getMessages(core, actor(req), req.params.id, req.query.after));
  api.post('/conversations/:id/messages', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { tags: ['messages'], params: idParam, body: messageSchema } }, async (req, reply) => reply.status(201).send(await social.sendMessage(core, actor(req), req.params.id, req.body)));
  api.post('/reports', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['moderation'], body: reportSchema } }, async (req, reply) => reply.status(201).send(await social.createReport(core, actor(req), req.body)));
}

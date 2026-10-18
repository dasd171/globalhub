import type { z } from 'zod';
import { AppError, notFound, forbidden, assertRefundTransition, type shipmentSchema, type shipmentEventSchema, type disputeResolveSchema, type OrderStatus } from '@globalhub/shared';
import type { Core, Actor, RequestMeta } from '../context.js';
import { requirePermission, has } from './guards.js';
import { audit } from './audit.js';
import { notify } from './notifications.js';
import { loadOrderFor, moveOrder, getOrder } from './orders.js';

// ───────────── Shipping ─────────────

export async function quoteShipping(core: Core, input: { productId: string; quantity: number; destinationCountry: string; insured?: boolean }) {
  const p = await core.prisma.product.findUnique({ where: { id: input.productId }, include: { variants: true, restrictions: true } });
  if (!p || p.status !== 'ACTIVE') throw notFound('Product');
  if (p.restrictions.some((r) => r.country === input.destinationCountry && r.blocked)) throw new AppError('BAD_REQUEST', `This product cannot be shipped to ${input.destinationCountry}`);
  const w = p.variants.find((v) => v.weightGrams)?.weightGrams;
  if (!w) return { provider: core.shipping.name, isDemo: core.shipping.isDemo, quotes: [], note: 'Supplier has not provided package weight — shipping must be quoted by the supplier.' };
  const quotes = await core.shipping.quote({ origin: p.shipsFrom ?? p.originCountry ?? 'UNKNOWN', destinationCountry: input.destinationCountry, weightGrams: w * input.quantity, quantity: input.quantity, insured: input.insured, containsBattery: p.containsBattery, dangerousGoods: p.dangerousGoods });
  return { provider: core.shipping.name, isDemo: core.shipping.isDemo, quotes, note: 'Estimates only — not final. Duties and taxes are not yet confirmed.' };
}

export async function createShipment(core: Core, actor: Actor, orderId: string, input: z.infer<typeof shipmentSchema>, meta?: RequestMeta) {
  requirePermission(actor, 'order:fulfil');
  const { order, role } = await loadOrderFor(core, actor, orderId);
  if (role !== 'supplier' && role !== 'admin') throw forbidden('Only the supplier can ship');
  if (order.status !== 'READY_TO_SHIP') throw new AppError('INVALID_STATE_TRANSITION', `Order must be READY_TO_SHIP (is ${order.status})`);
  let { carrier, trackingNumber } = input;
  let isDemo = false;
  let provider = 'manual';
  if (input.useProvider) {
    const r = await core.shipping.createShipment({ orderId, carrier, method: input.method });
    carrier = r.carrier; trackingNumber = r.trackingNumber; isDemo = core.shipping.isDemo; provider = core.shipping.name;
  }
  const shipment = await core.prisma.$transaction(async (tx) => {
    const s = await tx.shipment.create({ data: { orderId, provider, carrier, trackingNumber, method: input.method, weightGrams: input.weightGrams, insured: input.insured, isDemo, status: 'LABEL_CREATED', events: { create: { status: 'LABEL_CREATED', description: isDemo ? 'DEMO shipment created' : 'Shipment created by supplier', source: isDemo ? 'SYSTEM_ESTIMATE' : 'SUPPLIER', occurredAt: new Date() } } } });
    await moveOrder(tx, orderId, 'READY_TO_SHIP', 'SHIPPED', role === 'admin' ? 'admin' : 'supplier', actor.id, `Shipped via ${carrier}${trackingNumber ? ` (${trackingNumber})` : ''}`);
    await audit(core, { actorId: actor.id, action: 'shipment.created', targetType: 'Shipment', targetId: s.id, meta }, tx);
    await notify(core, { userId: order.buyerId, type: 'shipment.created', title: `Order ${order.orderNumber} shipped`, body: `Carrier: ${carrier}${trackingNumber ? `, tracking ${trackingNumber}` : ''}${isDemo ? ' (DEMO)' : ''}`, link: `/buyer/orders/${orderId}` }, tx);
    return s;
  });
  return shipment;
}

const SHIP_TO_ORDER: Partial<Record<string, OrderStatus>> = { PICKED_UP: 'IN_TRANSIT', IN_TRANSIT: 'IN_TRANSIT', CUSTOMS: 'IN_TRANSIT', OUT_FOR_DELIVERY: 'IN_TRANSIT', DELIVERED: 'DELIVERED' };

export async function addShipmentEvent(core: Core, actor: Actor, shipmentId: string, input: z.infer<typeof shipmentEventSchema>, meta?: RequestMeta) {
  const s = await core.prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!s) throw notFound('Shipment');
  const { order, role } = await loadOrderFor(core, actor, s.orderId);
  if (role !== 'supplier' && role !== 'admin') throw forbidden('Only the supplier can update tracking');
  await core.prisma.$transaction(async (tx) => {
    await tx.shipmentEvent.create({ data: { shipmentId, status: input.status, location: input.location, description: input.description, occurredAt: input.occurredAt ?? new Date(), source: 'SUPPLIER' } });
    await tx.shipment.update({ where: { id: shipmentId }, data: { status: input.status } });
    const target = SHIP_TO_ORDER[input.status];
    const current = (await tx.order.findUniqueOrThrow({ where: { id: order.id } })).status;
    if (target && target !== current && (current === 'SHIPPED' || (current === 'IN_TRANSIT' && target === 'DELIVERED'))) {
      await moveOrder(tx, order.id, current, target, role === 'admin' ? 'admin' : 'supplier', actor.id, `Tracking: ${input.status}${input.location ? ` @ ${input.location}` : ''}`);
      await notify(core, { userId: order.buyerId, type: 'shipment.update', title: `Order ${order.orderNumber}: ${target.replace(/_/g, ' ').toLowerCase()}`, body: input.description ?? input.status, link: `/buyer/orders/${order.id}` }, tx);
    }
    await audit(core, { actorId: actor.id, action: 'shipment.event', targetType: 'Shipment', targetId: shipmentId, metadata: { status: input.status }, meta }, tx);
  });
  return getOrder(core, actor, order.id);
}

// ───────────── Refunds ─────────────

const REFUNDABLE: OrderStatus[] = ['PAID', 'PROCESSING', 'DELIVERED', 'PARTIALLY_REFUNDED', 'COMPLETED', 'DISPUTED', 'CANCELLATION_REQUESTED', 'REFUND_REQUESTED'];

async function refundedSoFar(core: Core, orderId: string) {
  const r = await core.prisma.refund.aggregate({ where: { orderId, status: { in: ['PROCESSED_MANUAL', 'PROCESSED_PROVIDER', 'APPROVED', 'REQUESTED'] } }, _sum: { amountMinor: true } });
  return r._sum.amountMinor ?? 0;
}

export async function requestRefund(core: Core, actor: Actor, orderId: string, amountMinor: number, reason: string, meta?: RequestMeta) {
  const { order, role } = await loadOrderFor(core, actor, orderId);
  if (role !== 'buyer') throw forbidden('Only the buyer can request a refund');
  if (!REFUNDABLE.includes(order.status)) throw new AppError('INVALID_STATE_TRANSITION', `Refunds cannot be requested for ${order.status} orders`);
  const paid = await core.prisma.payment.findFirst({ where: { orderId, status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] } } });
  if (!paid) throw new AppError('BAD_REQUEST', 'No confirmed payment on this order');
  if (amountMinor + (await refundedSoFar(core, orderId)) > paid.amountMinor) throw new AppError('VALIDATION_FAILED', 'Refund exceeds the paid amount');
  const refund = await core.prisma.$transaction(async (tx) => {
    const r = await tx.refund.create({ data: { orderId, paymentId: paid.id, requestedById: actor.id, amountMinor, currency: paid.currency, reason } });
    if (['PAID', 'DELIVERED'].includes(order.status)) await moveOrder(tx, orderId, order.status, 'REFUND_REQUESTED', 'buyer', actor.id, reason);
    const sup = await tx.supplierProfile.findUniqueOrThrow({ where: { id: order.supplierId } });
    await notify(core, { userId: sup.userId, type: 'refund.requested', title: `Refund requested on ${order.orderNumber}`, body: reason, link: `/seller/orders/${orderId}` }, tx);
    await audit(core, { actorId: actor.id, action: 'refund.requested', targetType: 'Refund', targetId: r.id, metadata: { amountMinor }, meta }, tx);
    return r;
  });
  return refund;
}

/**
 * Supplier/admin decision. APPROVE calls the payment provider; the refund is only marked
 * PROCESSED_PROVIDER when the provider reports success. With no provider refund support the
 * refund stays APPROVED until someone records a manual refund — never shown as automatic.
 */
export async function decideRefund(core: Core, actor: Actor, refundId: string, decision: 'APPROVE' | 'REJECT' | 'MARK_PROCESSED_MANUAL', note: string | undefined, meta?: RequestMeta) {
  const refund = await core.prisma.refund.findUnique({ where: { id: refundId }, include: { payment: true } });
  if (!refund) throw notFound('Refund');
  const { order, role } = await loadOrderFor(core, actor, refund.orderId);
  if (role === 'buyer') throw forbidden('The buyer cannot decide a refund');
  const actorKind = role === 'admin' ? 'admin' : 'supplier';

  if (decision === 'REJECT') {
    assertRefundTransition(refund.status, 'REJECTED', actorKind);
    await core.prisma.$transaction(async (tx) => {
      await tx.refund.update({ where: { id: refundId }, data: { status: 'REJECTED', resolutionNote: note } });
      if (order.status === 'REFUND_REQUESTED') {
        const ev = await tx.orderEvent.findFirst({ where: { orderId: order.id, toStatus: 'REFUND_REQUESTED' }, orderBy: { createdAt: 'desc' } });
        const back: OrderStatus = ev?.fromStatus === 'DELIVERED' ? 'COMPLETED' : 'PROCESSING';
        await moveOrder(tx, order.id, 'REFUND_REQUESTED', back, 'supplier', actor.id, `Refund rejected: ${note ?? ''}`);
      }
      await notify(core, { userId: order.buyerId, type: 'refund.rejected', title: 'Refund request rejected', body: note ?? 'The supplier rejected the refund request. You can open a dispute.', link: `/buyer/orders/${order.id}` }, tx);
      await audit(core, { actorId: actor.id, action: 'refund.rejected', targetType: 'Refund', targetId: refundId, meta }, tx);
    });
    return core.prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
  }

  if (decision === 'APPROVE') {
    assertRefundTransition(refund.status, 'APPROVED', actorKind);
    await core.prisma.refund.update({ where: { id: refundId }, data: { status: 'APPROVED', resolutionNote: note } });
    await audit(core, { actorId: actor.id, action: 'refund.approved', targetType: 'Refund', targetId: refundId, meta });
    if (refund.payment && refund.payment.provider === core.payment.name && core.payment.name !== 'manual' && refund.payment.providerRef) {
      const r = await core.payment.refund(refund.payment.providerRef, refund.amountMinor, refund.currency);
      if (r.status === 'succeeded') await finalizeRefund(core, refundId, 'PROCESSED_PROVIDER', r.refundRef, actor.id);
    }
    return core.prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
  }

  assertRefundTransition(refund.status === 'REQUESTED' ? 'APPROVED' : refund.status, 'PROCESSED_MANUAL', actorKind);
  await finalizeRefund(core, refundId, 'PROCESSED_MANUAL', null, actor.id, note);
  return core.prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
}

async function finalizeRefund(core: Core, refundId: string, status: 'PROCESSED_PROVIDER' | 'PROCESSED_MANUAL', providerRef: string | null, actorId: string, note?: string) {
  await core.prisma.$transaction(async (tx) => {
    const refund = await tx.refund.update({ where: { id: refundId }, data: { status, providerRef, resolutionNote: note } });
    const order = await tx.order.findUniqueOrThrow({ where: { id: refund.orderId } });
    const payment = refund.paymentId ? await tx.payment.findUnique({ where: { id: refund.paymentId } }) : null;
    const done = await tx.refund.aggregate({ where: { orderId: order.id, status: { in: ['PROCESSED_MANUAL', 'PROCESSED_PROVIDER'] } }, _sum: { amountMinor: true } });
    const full = payment ? (done._sum.amountMinor ?? 0) >= payment.amountMinor : false;
    if (payment) await tx.payment.update({ where: { id: payment.id }, data: { status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
    const target: OrderStatus = full ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    if (['REFUND_REQUESTED', 'DISPUTED', 'PARTIALLY_REFUNDED'].includes(order.status) && order.status !== target) {
      await moveOrder(tx, order.id, order.status, target, 'system', actorId, status === 'PROCESSED_MANUAL' ? 'Refund recorded manually (outside the payment provider)' : `Refund confirmed by ${payment?.provider}${payment?.isDemo ? ' — DEMO, no real money moved' : ''}`);
    }
    await notify(core, { userId: order.buyerId, type: 'refund.processed', title: `Refund ${status === 'PROCESSED_MANUAL' ? 'recorded' : 'processed'} for ${order.orderNumber}`, body: status === 'PROCESSED_MANUAL' ? 'The supplier recorded a manual refund. Contact them if you have not received it.' : 'The payment provider confirmed the refund.', link: `/buyer/orders/${order.id}` }, tx);
    await audit(core, { actorId, action: `refund.${status.toLowerCase()}`, targetType: 'Refund', targetId: refundId }, tx);
  });
}

// ───────────── Disputes ─────────────

export async function openDispute(core: Core, actor: Actor, orderId: string, reason: string, meta?: RequestMeta) {
  requirePermission(actor, 'dispute:open');
  const { order, role } = await loadOrderFor(core, actor, orderId);
  if (role === 'admin') throw forbidden('Admins resolve disputes; participants open them');
  const open = await core.prisma.dispute.findFirst({ where: { orderId, status: { in: ['OPEN', 'AWAITING_BUYER', 'AWAITING_SUPPLIER', 'UNDER_REVIEW'] } } });
  if (open) throw new AppError('CONFLICT', 'A dispute is already open for this order');
  return core.prisma.$transaction(async (tx) => {
    await moveOrder(tx, orderId, order.status, 'DISPUTED', role, actor.id, reason);
    const d = await tx.dispute.create({ data: { orderId, openedById: actor.id, reason, status: role === 'buyer' ? 'AWAITING_SUPPLIER' : 'AWAITING_BUYER' } });
    const sup = await tx.supplierProfile.findUniqueOrThrow({ where: { id: order.supplierId } });
    await notify(core, { userId: role === 'buyer' ? sup.userId : order.buyerId, type: 'dispute.opened', title: `Dispute opened on ${order.orderNumber}`, body: reason, link: `/${role === 'buyer' ? 'seller' : 'buyer'}/orders/${orderId}` }, tx);
    await audit(core, { actorId: actor.id, action: 'dispute.opened', targetType: 'Dispute', targetId: d.id, meta }, tx);
    return d;
  });
}

export async function addDisputeEvidence(core: Core, actor: Actor, disputeId: string, body: string, storageKey?: string) {
  const d = await core.prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!d) throw notFound('Dispute');
  const { role } = await loadOrderFor(core, actor, d.orderId);
  if (['RESOLVED_BUYER_FAVOR', 'RESOLVED_SUPPLIER_FAVOR', 'RESOLVED_PARTIAL', 'CLOSED'].includes(d.status)) throw new AppError('BAD_REQUEST', 'Dispute is closed');
  const ev = await core.prisma.disputeEvidence.create({ data: { disputeId, authorId: actor.id, body, storageKey } });
  const next = role === 'buyer' ? 'AWAITING_SUPPLIER' : role === 'supplier' ? 'UNDER_REVIEW' : d.status;
  await core.prisma.dispute.update({ where: { id: disputeId }, data: { status: next } });
  return ev;
}

export async function resolveDispute(core: Core, actor: Actor, disputeId: string, input: z.infer<typeof disputeResolveSchema>, meta?: RequestMeta) {
  requirePermission(actor, 'dispute:resolve');
  const d = await core.prisma.dispute.findUnique({ where: { id: disputeId }, include: { order: { include: { payments: true } } } });
  if (!d) throw notFound('Dispute');
  if (['RESOLVED_BUYER_FAVOR', 'RESOLVED_SUPPLIER_FAVOR', 'RESOLVED_PARTIAL', 'CLOSED'].includes(d.status)) throw new AppError('BAD_REQUEST', 'Already resolved');
  await core.prisma.$transaction(async (tx) => {
    await tx.dispute.update({ where: { id: disputeId }, data: { status: input.outcome, resolution: input.resolution, resolvedById: actor.id } });
    if (input.outcome === 'RESOLVED_SUPPLIER_FAVOR' || input.outcome === 'CLOSED') {
      if (d.order.status === 'DISPUTED') await moveOrder(tx, d.orderId, 'DISPUTED', d.order.paidAt ? 'COMPLETED' : 'CANCELLED', 'admin', actor.id, `Dispute resolved: ${input.resolution}`);
    } else {
      // Buyer favour / partial: create an APPROVED refund for processing (provider or manual).
      const paid = d.order.payments.find((p) => p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED');
      if (paid) await tx.refund.create({ data: { orderId: d.orderId, paymentId: paid.id, requestedById: actor.id, amountMinor: input.outcome === 'RESOLVED_BUYER_FAVOR' ? paid.amountMinor : Math.floor(paid.amountMinor / 2), currency: paid.currency, reason: `Dispute resolution: ${input.resolution}`, status: 'APPROVED' } });
    }
    const sup = await tx.supplierProfile.findUniqueOrThrow({ where: { id: d.order.supplierId } });
    for (const uid of [d.order.buyerId, sup.userId]) await notify(core, { userId: uid, type: 'dispute.resolved', title: `Dispute resolved on ${d.order.orderNumber}`, body: input.resolution, link: `/buyer/orders/${d.orderId}` }, tx);
    await audit(core, { actorId: actor.id, action: 'dispute.resolved', targetType: 'Dispute', targetId: disputeId, metadata: { outcome: input.outcome }, meta }, tx);
  });
  return core.prisma.dispute.findUniqueOrThrow({ where: { id: disputeId }, include: { evidence: true } });
}

export async function listDisputes(core: Core, actor: Actor, scope: 'mine' | 'all') {
  if (scope === 'all') { requirePermission(actor, 'dispute:resolve'); return core.prisma.dispute.findMany({ include: { order: { select: { orderNumber: true, status: true } }, evidence: true }, orderBy: { createdAt: 'desc' }, take: 200 }); }
  const s = await core.prisma.supplierProfile.findUnique({ where: { userId: actor.id } });
  return core.prisma.dispute.findMany({ where: { order: { OR: [{ buyerId: actor.id }, ...(s ? [{ supplierId: s.id }] : [])] } }, include: { order: { select: { orderNumber: true, status: true } }, evidence: true }, orderBy: { createdAt: 'desc' } });
}

// ───────────── Reviews ─────────────

export async function createReview(core: Core, actor: Actor, input: { orderId: string; target: 'PRODUCT' | 'SUPPLIER' | 'AGENT' | 'LOGISTICS'; productId?: string; rating: number; body?: string }) {
  requirePermission(actor, 'review:create');
  const order = await core.prisma.order.findUnique({ where: { id: input.orderId }, include: { items: true } });
  if (!order || order.buyerId !== actor.id) throw notFound('Order');
  if (order.status !== 'COMPLETED' && order.status !== 'PARTIALLY_REFUNDED') throw new AppError('BAD_REQUEST', 'Reviews are only allowed after a completed order');
  if (input.target === 'PRODUCT' && (!input.productId || !order.items.some((i) => i.productId === input.productId))) throw new AppError('BAD_REQUEST', 'Product is not part of this order');
  let agentId: string | undefined;
  if (input.target === 'AGENT') {
    const task = await core.prisma.agentTask.findFirst({ where: { orderId: order.id } });
    if (!task) throw new AppError('BAD_REQUEST', 'No sourcing agent was involved in this order');
    agentId = task.agentId;
  }
  try {
    return await core.prisma.review.create({ data: { orderId: order.id, authorId: actor.id, target: input.target, productId: input.target === 'PRODUCT' ? input.productId : undefined, supplierId: input.target === 'SUPPLIER' || input.target === 'LOGISTICS' ? order.supplierId : undefined, agentId, rating: input.rating, body: input.body, isDemo: order.isDemo } });
  } catch { throw new AppError('CONFLICT', 'You already reviewed this'); }
}

export async function listReviews(core: Core, q: { productId?: string; supplierId?: string }) {
  return core.prisma.review.findMany({ where: { status: 'PUBLISHED', ...(q.productId ? { productId: q.productId } : {}), ...(q.supplierId ? { supplierId: q.supplierId } : {}) }, include: { author: { select: { displayName: true } } }, orderBy: { createdAt: 'desc' }, take: 50 });
}

export async function moderateReview(core: Core, actor: Actor, id: string, status: 'PUBLISHED' | 'HIDDEN', meta?: RequestMeta) {
  if (!has(actor, 'moderation:content')) throw forbidden();
  const r = await core.prisma.review.update({ where: { id }, data: { status } });
  await audit(core, { actorId: actor.id, action: 'moderation.review', targetType: 'Review', targetId: id, metadata: { status }, meta });
  return r;
}

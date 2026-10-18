import type { z } from 'zod';
import { AppError, notFound, forbidden, assertQuoteTransition, type quoteSchema } from '@globalhub/shared';
import type { Core, Actor, RequestMeta } from '../context.js';
import { requirePermission, isAdmin } from './guards.js';
import { audit } from './audit.js';
import { notify } from './notifications.js';
import { createOrderFromQuoteTx } from './orders.js';
import { enqueueQuoteReturn } from './federation.js';

/** Sourcing agents quote through a supplier profile so quotes/orders share one model. */
async function quotingProfile(core: Core, actor: Actor) {
  const s = await core.prisma.supplierProfile.findUnique({ where: { userId: actor.id } });
  if (s) { if (s.verificationStatus === 'SUSPENDED') throw forbidden('Supplier account is suspended'); return s; }
  const agent = await core.prisma.agentProfile.findUnique({ where: { userId: actor.id } });
  if (!agent) throw new AppError('FORBIDDEN', 'Create a supplier or sourcing-agent profile before quoting');
  return core.prisma.supplierProfile.create({ data: { userId: actor.id, companyName: agent.displayName, supplierType: 'OTHER', description: 'Sourcing agent', verificationStatus: agent.verificationStatus === 'SUSPENDED' ? 'SUSPENDED' : 'UNVERIFIED', isPublic: false } });
}

export async function submitQuote(core: Core, actor: Actor, input: z.infer<typeof quoteSchema>, meta?: RequestMeta) {
  requirePermission(actor, 'quote:submit');
  const supplier = await quotingProfile(core, actor);
  if (!input.buyingRequestId) throw new AppError('BAD_REQUEST', 'Quotes are submitted against a buying request');
  const req = await core.prisma.buyingRequest.findUnique({ where: { id: input.buyingRequestId } });
  if (!req) throw notFound('Buying request');
  if (req.buyerId === actor.id) throw new AppError('BAD_REQUEST', 'You cannot quote on your own request');
  if (req.visibility === 'PRIVATE' && req.targetSupplierId !== supplier.id) throw notFound('Buying request');
  if (req.targetSupplierId && req.targetSupplierId !== supplier.id) throw notFound('Buying request');
  if (req.status !== 'OPEN' || (req.expiresAt && req.expiresAt < new Date())) throw new AppError('BAD_REQUEST', 'This request is no longer open for quotes');
  const active = await core.prisma.quote.findFirst({ where: { buyingRequestId: req.id, supplierId: supplier.id, status: { in: ['DRAFT', 'SUBMITTED', 'VIEWED'] } } });
  if (active) throw new AppError('CONFLICT', 'You already have an active quote on this request. Withdraw it to submit a new one.');
  if (input.productId) {
    const p = await core.prisma.product.findUnique({ where: { id: input.productId }, include: { store: true } });
    if (!p || p.store.supplierId !== supplier.id) throw new AppError('BAD_REQUEST', 'Linked product must belong to your store');
  }
  const { validDays, submit, ...data } = input;
  const q = await core.prisma.quote.create({
    data: { ...data, supplierId: supplier.id, submitterId: actor.id, status: submit ? 'SUBMITTED' : 'DRAFT', submittedAt: submit ? new Date() : null, validUntil: new Date(Date.now() + validDays * 86400_000) },
  });
  await audit(core, { actorId: actor.id, action: 'quote.created', targetType: 'Quote', targetId: q.id, metadata: { status: q.status }, meta });
  if (submit) await afterSubmit(core, q.id);
  return q;
}

async function afterSubmit(core: Core, quoteId: string) {
  const q = await core.prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, include: { buyingRequest: true, supplier: true } });
  if (q.buyingRequest?.originNodeId) await enqueueQuoteReturn(core, q.id); // relay to the buyer's node
  else if (q.buyingRequest?.buyerId) await notify(core, { userId: q.buyingRequest.buyerId, type: 'quote.new', title: 'New quote received', body: `${q.supplier.companyName} quoted on "${q.buyingRequest.title}".`, link: `/buyer/requests/${q.buyingRequestId}` });
}

export async function submitDraftQuote(core: Core, actor: Actor, quoteId: string) {
  const q = await core.prisma.quote.findUnique({ where: { id: quoteId } });
  if (!q || q.submitterId !== actor.id) throw notFound('Quote');
  assertQuoteTransition(q.status, 'SUBMITTED');
  await core.prisma.quote.update({ where: { id: quoteId }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
  await afterSubmit(core, quoteId);
  return core.prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
}

/**
 * Quotes on a request. The buyer sees every submitted quote; a supplier sees only their own.
 * Other suppliers' prices are never exposed.
 */
export async function listQuotesForRequest(core: Core, actor: Actor, requestId: string) {
  const req = await core.prisma.buyingRequest.findUnique({ where: { id: requestId } });
  if (!req) throw notFound('Buying request');
  const include = { supplier: { select: { id: true, companyName: true, supplierType: true, verificationStatus: true, isDemo: true, remoteNodeId: true } }, items: true } as const;
  if (req.buyerId === actor.id || isAdmin(actor)) {
    const quotes = await core.prisma.quote.findMany({ where: { buyingRequestId: requestId, status: { not: 'DRAFT' } }, include, orderBy: { unitPriceMinor: 'asc' } });
    if (req.buyerId === actor.id) {
      const unseen = quotes.filter((q) => q.status === 'SUBMITTED').map((q) => q.id);
      if (unseen.length) await core.prisma.quote.updateMany({ where: { id: { in: unseen }, status: 'SUBMITTED' }, data: { status: 'VIEWED', viewedAt: new Date() } });
    }
    return quotes.map((q) => ({ ...q, status: q.status === 'SUBMITTED' && req.buyerId === actor.id ? 'VIEWED' : q.status, dataSources: dataSources(q) }));
  }
  const s = await core.prisma.supplierProfile.findUnique({ where: { userId: actor.id } });
  if (!s) throw notFound('Buying request');
  const mine = await core.prisma.quote.findMany({ where: { buyingRequestId: requestId, supplierId: s.id }, include });
  return mine.map((q) => ({ ...q, dataSources: dataSources(q) }));
}

/** Label where each number came from so buyers can tell supplier data from estimates. */
function dataSources(q: { internationalShippingSource: string; domesticShippingMinor: number | null; sampleFeeMinor: number | null }) {
  return {
    unitPrice: 'SUPPLIER', domesticShipping: q.domesticShippingMinor == null ? 'NOT_CONFIRMED' : 'SUPPLIER', sampleFee: q.sampleFeeMinor == null ? 'NOT_CONFIRMED' : 'SUPPLIER',
    internationalShipping: q.internationalShippingSource,
  };
}

export async function listMyQuotes(core: Core, actor: Actor) {
  const s = await core.prisma.supplierProfile.findUnique({ where: { userId: actor.id } });
  if (!s) return [];
  return core.prisma.quote.findMany({ where: { supplierId: s.id }, include: { buyingRequest: { select: { id: true, title: true, status: true, destinationCountry: true, quantity: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
}

/** Quotes the buyer received across all their requests. */
export async function listReceivedQuotes(core: Core, actor: Actor) {
  return core.prisma.quote.findMany({
    where: { buyingRequest: { buyerId: actor.id }, status: { not: 'DRAFT' } },
    include: { buyingRequest: { select: { id: true, title: true } }, supplier: { select: { companyName: true, verificationStatus: true } } }, orderBy: { createdAt: 'desc' }, take: 200,
  });
}

export async function acceptQuote(core: Core, actor: Actor, quoteId: string, opts: { shippingAddressId?: string; idempotencyKey?: string } = {}, meta?: RequestMeta) {
  requirePermission(actor, 'quote:accept');
  const q = await core.prisma.quote.findUnique({ where: { id: quoteId }, include: { buyingRequest: true } });
  if (!q || !q.buyingRequest || q.buyingRequest.buyerId !== actor.id) throw notFound('Quote');
  if (q.validUntil < new Date()) throw new AppError('BAD_REQUEST', 'This quote has expired');
  assertQuoteTransition(q.status, 'ACCEPTED');
  const address = opts.shippingAddressId ? await core.prisma.shippingAddress.findFirst({ where: { id: opts.shippingAddressId, userId: actor.id } }) : null;
  if (opts.shippingAddressId && !address) throw notFound('Shipping address');
  const result = await core.prisma.$transaction(async (tx) => {
    const upd = await tx.quote.updateMany({ where: { id: quoteId, status: { in: ['SUBMITTED', 'VIEWED'] } }, data: { status: 'ACCEPTED', decidedAt: new Date() } });
    if (upd.count !== 1) throw new AppError('CONFLICT', 'Quote status changed; reload');
    const others = await tx.quote.findMany({ where: { buyingRequestId: q.buyingRequestId, id: { not: quoteId }, status: { in: ['SUBMITTED', 'VIEWED'] } }, include: { supplier: true } });
    await tx.quote.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { status: 'REJECTED', decidedAt: new Date() } });
    await tx.buyingRequest.update({ where: { id: q.buyingRequestId! }, data: { status: 'FULFILLED' } });
    await audit(core, { actorId: actor.id, action: 'quote.accepted', targetType: 'Quote', targetId: quoteId, meta }, tx);
    for (const o of others) if (!o.supplier.remoteNodeId) await notify(core, { userId: o.supplier.userId, type: 'quote.rejected', title: 'Quote not selected', body: `The buyer selected another quote for "${q.buyingRequest!.title}".` }, tx);
    if (q.remoteNodeId) return { orderId: null as string | null };
    const orderId = await createOrderFromQuoteTx(core, tx, quoteId, actor.id, opts.idempotencyKey ?? `quote-${quoteId}`, address);
    return { orderId };
  });
  return { quote: await core.prisma.quote.findUniqueOrThrow({ where: { id: quoteId } }), orderId: result.orderId, note: result.orderId ? undefined : 'Remote quote accepted. Complete the order on the supplier’s node.' };
}

export async function rejectQuote(core: Core, actor: Actor, quoteId: string) {
  const q = await core.prisma.quote.findUnique({ where: { id: quoteId }, include: { buyingRequest: true, supplier: true } });
  if (!q || q.buyingRequest?.buyerId !== actor.id) throw notFound('Quote');
  assertQuoteTransition(q.status, 'REJECTED');
  const u = await core.prisma.quote.update({ where: { id: quoteId }, data: { status: 'REJECTED', decidedAt: new Date() } });
  if (!q.supplier.remoteNodeId) await notify(core, { userId: q.supplier.userId, type: 'quote.rejected', title: 'Quote declined', body: `Your quote on "${q.buyingRequest!.title}" was declined.` });
  return u;
}

export async function withdrawQuote(core: Core, actor: Actor, quoteId: string) {
  const q = await core.prisma.quote.findUnique({ where: { id: quoteId } });
  if (!q || q.submitterId !== actor.id) throw notFound('Quote');
  assertQuoteTransition(q.status, 'WITHDRAWN');
  return core.prisma.quote.update({ where: { id: quoteId }, data: { status: 'WITHDRAWN', decidedAt: new Date() } });
}

export async function summarizeQuotes(core: Core, actor: Actor, requestId: string) {
  const quotes = await listQuotesForRequest(core, actor, requestId);
  const text = await core.ai.summarizeQuotes(quotes.map((q) => ({ id: q.id, supplierName: q.supplier.companyName, currency: q.currency, unitPriceMinor: q.unitPriceMinor, moq: q.moq, availableQty: q.availableQty, productionDays: q.productionDays, internationalShippingMinor: q.internationalShippingMinor, internationalShippingSource: q.internationalShippingSource, validUntil: q.validUntil })));
  return { summary: text, provider: core.ai.name, advisory: true };
}

/** Maintenance job: expire quotes and buying requests past their validity. */
export async function expireQuotesAndRequests(core: Core, now = new Date()) {
  const q = await core.prisma.quote.updateMany({ where: { status: { in: ['SUBMITTED', 'VIEWED', 'DRAFT'] }, validUntil: { lt: now } }, data: { status: 'EXPIRED' } });
  const r = await core.prisma.buyingRequest.updateMany({ where: { status: 'OPEN', expiresAt: { lt: now } }, data: { status: 'EXPIRED' } });
  return { quotesExpired: q.count, requestsExpired: r.count };
}

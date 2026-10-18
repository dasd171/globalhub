import { randomBytes } from 'node:crypto';
import type { z } from 'zod';
import { Prisma, type PrismaClient } from '@globalhub/database';
import {
  AppError, notFound, forbidden, assertOrderTransition, allowedOrderTransitions, priceForQuantity, assertMoq, mulMinor, summarizeFees,
  type createOrderSchema, type supplierConfirmSchema, type OrderStatus, type OrderActor, type FeeLine,
} from '@globalhub/shared';
import type { Core, Actor, RequestMeta } from '../context.js';
import { requirePermission, requireActor, isAdmin, pageResult, paginate } from './guards.js';
import { audit } from './audit.js';
import { notify } from './notifications.js';
import { refreshProductStock } from './catalog.js';

type Tx = Prisma.TransactionClient;
const PENDING_RESERVATION_HOURS = 48;
const PAYMENT_RESERVATION_HOURS = 72;

export const orderNumber = () => `GH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(4).toString('hex').toUpperCase()}`;

/**
 * Atomic reservation: a single conditional UPDATE guarantees we never reserve more than
 * on-hand stock even under concurrent orders (the row lock serialises competing updates,
 * and a CHECK constraint backs it up at the database level).
 */
export async function reserveStock(tx: Tx, variantId: string, qty: number, orderId: string, hours: number) {
  const updated = await tx.$executeRaw`UPDATE "Inventory" SET "reserved" = "reserved" + ${qty}, "updatedAt" = now() WHERE "variantId" = ${variantId}::uuid AND "verifiedAt" IS NOT NULL AND "onHand" - "reserved" >= ${qty}`;
  if (updated !== 1) throw new AppError('INSUFFICIENT_STOCK', 'Not enough confirmed stock for this quantity', { variantId, requested: qty });
  await tx.inventoryReservation.create({ data: { variantId, orderId, quantity: qty, expiresAt: new Date(Date.now() + hours * 3600_000) } });
}

export async function releaseReservations(tx: Tx, orderId: string) {
  const res = await tx.inventoryReservation.findMany({ where: { orderId, status: 'ACTIVE' } });
  for (const r of res) {
    await tx.$executeRaw`UPDATE "Inventory" SET "reserved" = GREATEST(0, "reserved" - ${r.quantity}), "updatedAt" = now() WHERE "variantId" = ${r.variantId}::uuid`;
    await tx.inventoryReservation.update({ where: { id: r.id }, data: { status: 'RELEASED' } });
  }
  return res.length;
}

export async function consumeReservations(tx: Tx, orderId: string) {
  const res = await tx.inventoryReservation.findMany({ where: { orderId, status: 'ACTIVE' } });
  for (const r of res) {
    const n = await tx.$executeRaw`UPDATE "Inventory" SET "reserved" = "reserved" - ${r.quantity}, "onHand" = "onHand" - ${r.quantity}, "updatedAt" = now() WHERE "variantId" = ${r.variantId}::uuid AND "reserved" >= ${r.quantity} AND "onHand" >= ${r.quantity}`;
    if (n !== 1) throw new AppError('CONFLICT', 'Inventory inconsistency while consuming reservation');
    await tx.inventoryReservation.update({ where: { id: r.id }, data: { status: 'CONSUMED' } });
  }
  return res;
}

async function recordTransition(tx: Tx, orderId: string, from: OrderStatus | null, to: OrderStatus, actorId: string | null, note?: string) {
  await tx.orderEvent.create({ data: { orderId, fromStatus: from, toStatus: to, actorId, note } });
}

/** Optimistic status change: only succeeds if the order is still in `from` (prevents double transitions). */
export async function moveOrder(tx: Tx, orderId: string, from: OrderStatus, to: OrderStatus, actor: OrderActor, actorId: string | null, note?: string, extra: Prisma.OrderUpdateManyMutationInput = {}) {
  assertOrderTransition(from, to, actor);
  const r = await tx.order.updateMany({ where: { id: orderId, status: from }, data: { status: to, ...extra } });
  if (r.count !== 1) throw new AppError('CONFLICT', 'Order status changed concurrently; reload and retry');
  await recordTransition(tx, orderId, from, to, actorId, note);
}

async function saveFees(tx: Tx, orderId: string, currency: string, lines: FeeLine[]) {
  const s = summarizeFees(lines);
  await tx.orderFee.deleteMany({ where: { orderId } });
  await tx.orderFee.createMany({ data: lines.map((l) => ({ orderId, type: l.type, label: l.label, amountMinor: l.amountMinor, currency, status: l.status, source: l.source })) });
  return s;
}

function addressSnapshot(a: { fullName: string; company: string | null; line1: string; line2: string | null; city: string; region: string | null; postalCode: string | null; country: string; phone: string | null } | null) {
  return a ? { fullName: a.fullName, company: a.company, line1: a.line1, line2: a.line2, city: a.city, region: a.region, postalCode: a.postalCode, country: a.country, phone: a.phone } : null;
}

export async function createOrder(core: Core, actor: Actor, input: z.infer<typeof createOrderSchema>, meta?: RequestMeta) {
  requirePermission(actor, 'order:create');
  const existing = await core.prisma.order.findUnique({ where: { buyerId_idempotencyKey: { buyerId: actor.id, idempotencyKey: input.idempotencyKey } } });
  if (existing) return { ...(await getOrder(core, actor, existing.id)), idempotentReplay: true };

  const address = input.shippingAddressId ? await core.prisma.shippingAddress.findFirst({ where: { id: input.shippingAddressId, userId: actor.id } }) : null;
  if (input.shippingAddressId && !address) throw notFound('Shipping address');

  if (input.quoteId) {
    const quote = await core.prisma.quote.findUnique({ where: { id: input.quoteId }, include: { buyingRequest: true, supplier: true } });
    if (!quote || quote.buyingRequest?.buyerId !== actor.id) throw notFound('Quote');
    if (quote.status !== 'ACCEPTED') throw new AppError('BAD_REQUEST', 'Accept the quote before ordering');
    const id = await core.prisma.$transaction((tx) => createOrderFromQuoteTx(core, tx, quote.id, actor.id, input.idempotencyKey, address, input.terms));
    return getOrder(core, actor, id);
  }

  const items = input.items!;
  const variants = await core.prisma.productVariant.findMany({ where: { id: { in: items.map((i) => i.variantId) } }, include: { inventory: true, product: { include: { priceTiers: true, restrictions: true, store: { include: { supplier: true } } } } } });
  if (variants.length !== new Set(items.map((i) => i.variantId)).size) throw notFound('Variant');
  const stores = new Set(variants.map((v) => v.product.storeId));
  if (stores.size !== 1) throw new AppError('BAD_REQUEST', 'All items in one order must come from the same store');
  const product0 = variants[0].product;
  const supplier = product0.store.supplier;
  if (supplier.userId === actor.id) throw new AppError('BAD_REQUEST', 'You cannot order from your own store');
  if (supplier.verificationStatus === 'SUSPENDED') throw new AppError('FORBIDDEN', 'Supplier is suspended');

  // Group quantities per product for MOQ + tier pricing.
  const perProduct = new Map<string, number>();
  for (const it of items) { const v = variants.find((x) => x.id === it.variantId)!; perProduct.set(v.productId, (perProduct.get(v.productId) ?? 0) + it.quantity); }
  const warnings: string[] = [];
  const lines = items.map((it) => {
    const v = variants.find((x) => x.id === it.variantId)!;
    const p = v.product;
    if (p.status !== 'ACTIVE') throw new AppError('BAD_REQUEST', `Product ${p.titleEn ?? p.id} is not available`);
    if (p.stockStatus === 'ON_REQUEST') throw new AppError('BAD_REQUEST', 'This product is priced on request — request a quote instead');
    if (p.stockStatus === 'OUT_OF_STOCK') throw new AppError('INSUFFICIENT_STOCK', 'Product is out of stock');
    const dest = address?.country;
    if (dest && p.restrictions.some((r) => r.country === dest && r.blocked)) throw new AppError('BAD_REQUEST', `Product cannot be shipped to ${dest}`);
    if (dest && p.shipsTo.length > 0 && !p.shipsTo.includes(dest)) throw new AppError('BAD_REQUEST', `Supplier does not ship this product to ${dest}`);
    const totalQty = perProduct.get(p.id)!;
    assertMoq(totalQty, p.moq);
    let unit = v.priceMinor;
    if (unit == null) {
      const tp = priceForQuantity(totalQty, p.priceTiers, p.basePriceMinor);
      if (tp.kind === 'on_request') throw new AppError('BAD_REQUEST', 'Price for this quantity is on request — request a quote');
      unit = tp.unitPriceMinor;
    }
    const needsReservation = p.stockStatus !== 'MADE_TO_ORDER';
    if (needsReservation && !v.inventory?.verifiedAt) warnings.push(`Stock for ${v.sku} is not verified — supplier must confirm`);
    return { v, p, qty: it.quantity, unit, total: mulMinor(unit, it.quantity), needsReservation: needsReservation && !!v.inventory?.verifiedAt };
  });
  const currencies = new Set(lines.map((l) => l.p.currency));
  if (currencies.size !== 1) throw new AppError('BAD_REQUEST', 'Items use different currencies');
  const currency = product0.currency;
  const subtotal = lines.reduce((a, l) => a + l.total, 0);
  const feeLines: FeeLine[] = [
    { type: 'PRODUCT', label: 'Products', amountMinor: subtotal, status: 'CONFIRMED', source: 'SUPPLIER' },
    { type: 'INTERNATIONAL_SHIPPING', label: 'International shipping', amountMinor: null, status: 'NOT_CONFIRMED', source: 'NOT_CONFIRMED' },
    { type: 'TAX_ESTIMATED', label: 'Import duties & taxes', amountMinor: null, status: 'NOT_CONFIRMED', source: 'NOT_CONFIRMED' },
  ];

  try {
    const orderId = await core.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          orderNumber: orderNumber(), buyerId: actor.id, supplierId: supplier.id, storeId: product0.storeId, status: 'DRAFT', currency,
          subtotalMinor: subtotal, confirmedTotalMinor: subtotal, hasUnconfirmedFees: true, idempotencyKey: input.idempotencyKey,
          shippingAddressId: address?.id, shippingAddress: addressSnapshot(address) ?? undefined, destinationCountry: address?.country, terms: input.terms,
          isDemo: lines.some((l) => l.p.isDemo),
          snapshot: {
            supplier: { id: supplier.id, name: supplier.companyName, verification: supplier.verificationStatus },
            store: { id: product0.store.id, name: product0.store.name },
            items: lines.map((l) => ({ productId: l.p.id, variantId: l.v.id, title: l.p.titleEn ?? l.p.titleZh, sku: l.v.sku, specs: l.v.attributes, quantity: l.qty, unitPriceMinor: l.unit, currency, leadTimeDays: l.p.leadTimeDays })),
            terms: input.terms ?? null, warnings, createdAt: new Date().toISOString(),
          },
          items: { create: lines.map((l) => ({ productId: l.p.id, variantId: l.v.id, title: (l.p.titleEn ?? l.p.titleZh ?? '').slice(0, 300), sku: l.v.sku, specs: (l.v.attributes ?? undefined) as Prisma.InputJsonValue, quantity: l.qty, unitPriceMinor: l.unit, currency, lineTotalMinor: l.total })) },
        },
      });
      await recordTransition(tx, order.id, null, 'DRAFT', actor.id, 'Order draft created');
      await saveFees(tx, order.id, currency, feeLines);
      for (const l of lines) if (l.needsReservation) await reserveStock(tx, l.v.id, l.qty, order.id, PENDING_RESERVATION_HOURS);
      await moveOrder(tx, order.id, 'DRAFT', 'PENDING_SUPPLIER_CONFIRMATION', 'buyer', actor.id, 'Submitted to supplier');
      for (const pid of new Set(lines.map((l) => l.p.id))) await refreshProductStock(tx, pid);
      await audit(core, { actorId: actor.id, action: 'order.created', targetType: 'Order', targetId: order.id, metadata: { subtotal, currency }, meta }, tx);
      await notify(core, { userId: supplier.userId, type: 'order.new', title: 'New order awaiting your confirmation', body: `Order ${order.orderNumber}: please confirm stock, price and shipping.`, link: `/seller/orders/${order.id}` }, tx);
      return order.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return { ...(await getOrder(core, actor, orderId)), warnings };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const o = await core.prisma.order.findUnique({ where: { buyerId_idempotencyKey: { buyerId: actor.id, idempotencyKey: input.idempotencyKey } } });
      if (o) return { ...(await getOrder(core, actor, o.id)), idempotentReplay: true };
    }
    throw e;
  }
}

const SOURCE_TO_STATUS = { SUPPLIER: 'CONFIRMED', SYSTEM_ESTIMATE: 'ESTIMATED', THIRD_PARTY: 'ESTIMATED', NOT_CONFIRMED: 'NOT_CONFIRMED' } as const;

export async function createOrderFromQuoteTx(core: Core, tx: Tx, quoteId: string, buyerId: string, idempotencyKey: string, address: Parameters<typeof addressSnapshot>[0] & { id?: string } | null, terms?: string) {
  const q = await tx.quote.findUniqueOrThrow({ where: { id: quoteId }, include: { supplier: true, buyingRequest: true } });
  if (q.remoteNodeId) throw new AppError('NOT_SUPPORTED', 'This quote came from a remote node. Place the order on the supplier’s node; cross-node orders are not supported yet.');
  const qty = Math.max(q.moq, Math.min(q.availableQty, q.buyingRequest?.quantity ?? q.availableQty));
  const subtotal = mulMinor(q.unitPriceMinor, qty);
  const lines: FeeLine[] = [{ type: 'PRODUCT', label: 'Products', amountMinor: subtotal, status: 'CONFIRMED', source: 'SUPPLIER' }];
  if (q.domesticShippingMinor != null) lines.push({ type: 'DOMESTIC_SHIPPING', label: 'Domestic shipping', amountMinor: q.domesticShippingMinor, status: 'CONFIRMED', source: 'SUPPLIER' });
  lines.push({ type: 'INTERNATIONAL_SHIPPING', label: 'International shipping', amountMinor: q.internationalShippingMinor, status: SOURCE_TO_STATUS[q.internationalShippingSource], source: q.internationalShippingSource });
  if (q.buyingRequest?.needsSample && q.sampleFeeMinor != null) lines.push({ type: 'SAMPLE', label: 'Samples', amountMinor: q.sampleFeeMinor, status: 'CONFIRMED', source: 'SUPPLIER' });
  if (!q.taxIncluded) lines.push({ type: 'TAX_ESTIMATED', label: 'Import duties & taxes', amountMinor: null, status: 'NOT_CONFIRMED', source: 'NOT_CONFIRMED' });
  const sum = summarizeFees(lines);
  const order = await tx.order.create({
    data: {
      orderNumber: orderNumber(), buyerId, supplierId: q.supplierId, quoteId: q.id, status: 'DRAFT', currency: q.currency, subtotalMinor: subtotal,
      confirmedTotalMinor: sum.confirmedTotalMinor, hasUnconfirmedFees: sum.hasUnconfirmed, idempotencyKey, shippingAddressId: address?.id,
      shippingAddress: addressSnapshot(address) ?? undefined, destinationCountry: address?.country ?? q.buyingRequest?.destinationCountry, terms,
      isDemo: q.supplier.isDemo,
      snapshot: {
        supplier: { id: q.supplier.id, name: q.supplier.companyName, verification: q.supplier.verificationStatus },
        quote: { id: q.id, paymentTerms: q.paymentTerms, qualityGuarantee: q.qualityGuarantee, returnPolicy: q.returnPolicy, productionDays: q.productionDays, shipWithinDays: q.shipWithinDays, validUntil: q.validUntil, taxIncluded: q.taxIncluded, inspectionRequired: q.inspectionRequired },
        items: [{ title: q.productName, specs: q.specifications, quantity: qty, unitPriceMinor: q.unitPriceMinor, currency: q.currency }],
        terms: terms ?? null, createdAt: new Date().toISOString(),
      },
      items: { create: [{ productId: q.productId, title: q.productName.slice(0, 300), specs: q.specifications ? { specifications: q.specifications } : undefined, quantity: qty, unitPriceMinor: q.unitPriceMinor, currency: q.currency, lineTotalMinor: subtotal }] },
    },
  });
  await recordTransition(tx, order.id, null, 'DRAFT', buyerId, `Created from accepted quote ${q.id}`);
  await saveFees(tx, order.id, q.currency, lines);
  await moveOrder(tx, order.id, 'DRAFT', 'PENDING_SUPPLIER_CONFIRMATION', 'buyer', buyerId, 'Submitted to supplier');
  const supplierUser = q.supplier.userId;
  await notify(core, { userId: supplierUser, type: 'order.new', title: 'Your quote was accepted', body: `Order ${order.orderNumber} is waiting for your confirmation.`, link: `/seller/orders/${order.id}` }, tx);
  return order.id;
}

type OrderRole = 'buyer' | 'supplier' | 'admin';
async function roleOnOrder(db: PrismaClient | Tx, actor: Actor, order: { buyerId: string; supplierId: string }): Promise<OrderRole | null> {
  if (order.buyerId === actor.id) return 'buyer';
  const s = await db.supplierProfile.findUnique({ where: { userId: actor.id }, select: { id: true } });
  if (s && s.id === order.supplierId) return 'supplier';
  if (isAdmin(actor) || actor.roles.includes('MODERATOR')) return 'admin';
  return null;
}

/** Load an order the actor may see. Non-participants get 404 (no existence leak). */
export async function loadOrderFor(core: Core, actor: Actor, orderId: string) {
  requireActor(actor);
  const o = await core.prisma.order.findUnique({ where: { id: orderId } });
  if (!o) throw notFound('Order');
  const role = await roleOnOrder(core.prisma, actor, o);
  if (!role) throw notFound('Order');
  return { order: o, role };
}

export async function getOrder(core: Core, actor: Actor, orderId: string) {
  const { role } = await loadOrderFor(core, actor, orderId);
  const o = await core.prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: true, fees: true, events: { orderBy: { createdAt: 'asc' } }, payments: true, refunds: true, shipments: { include: { events: { orderBy: { occurredAt: 'asc' } } } }, disputes: { include: { evidence: true } }, supplier: { select: { id: true, companyName: true, verificationStatus: true, userId: true } }, buyer: { select: { id: true, displayName: true } } },
  });
  const sum = summarizeFees(o.fees.map((f) => ({ type: f.type, label: f.label, amountMinor: f.amountMinor, status: f.status, source: f.source })));
  const actorKind: OrderActor = role === 'admin' ? 'admin' : role;
  return {
    ...o,
    viewerRole: role,
    allowedTransitions: allowedOrderTransitions(o.status, actorKind).filter((s) => s !== 'PAID'),
    feeSummary: { confirmedTotalMinor: sum.confirmedTotalMinor, estimatedTotalMinor: sum.estimatedTotalMinor, hasUnconfirmed: sum.hasUnconfirmed, hasEstimates: sum.hasEstimates },
    paymentMode: { provider: core.payment.name, isDemo: core.payment.isDemo },
  };
}

export async function listOrders(core: Core, actor: Actor, q: { page: number; pageSize: number; as: 'buyer' | 'supplier' | 'admin'; status?: OrderStatus }) {
  requireActor(actor);
  let where: Prisma.OrderWhereInput;
  if (q.as === 'supplier') {
    const s = await core.prisma.supplierProfile.findUnique({ where: { userId: actor.id } });
    if (!s) throw forbidden('No supplier profile');
    where = { supplierId: s.id };
  } else if (q.as === 'admin') {
    requirePermission(actor, 'admin:orders');
    where = {};
  } else where = { buyerId: actor.id };
  if (q.status) where.status = q.status;
  const [items, total] = await Promise.all([
    core.prisma.order.findMany({ where, include: { items: true, supplier: { select: { companyName: true } }, buyer: { select: { displayName: true } } }, orderBy: { createdAt: 'desc' }, ...paginate(q.page, q.pageSize) }),
    core.prisma.order.count({ where }),
  ]);
  return pageResult(items, total, q.page, q.pageSize);
}

/** Supplier confirms stock/price/shipping and sets remaining fees → AWAITING_PAYMENT. */
export async function supplierConfirmOrder(core: Core, actor: Actor, orderId: string, input: z.infer<typeof supplierConfirmSchema>, meta?: RequestMeta) {
  requirePermission(actor, 'order:fulfil');
  const { order, role } = await loadOrderFor(core, actor, orderId);
  if (role !== 'supplier') throw forbidden('Only the supplier can confirm this order');
  if (order.status !== 'PENDING_SUPPLIER_CONFIRMATION') throw new AppError('INVALID_STATE_TRANSITION', `Order is ${order.status}`);
  await core.prisma.$transaction(async (tx) => {
    const items = await tx.orderItem.findMany({ where: { orderId }, include: { variant: { include: { inventory: true, product: true } } } });
    const reserved = await tx.inventoryReservation.findMany({ where: { orderId, status: 'ACTIVE' } });
    for (const it of items) {
      if (!it.variant || it.variant.product.stockStatus === 'MADE_TO_ORDER') continue;
      if (!reserved.some((r) => r.variantId === it.variantId)) await reserveStock(tx, it.variant.id, it.quantity, orderId, PAYMENT_RESERVATION_HOURS); // unverified stock must now be confirmed
    }
    await tx.inventoryReservation.updateMany({ where: { orderId, status: 'ACTIVE' }, data: { expiresAt: new Date(Date.now() + PAYMENT_RESERVATION_HOURS * 3600_000) } });
    const existing = await tx.orderFee.findMany({ where: { orderId } });
    const keep: FeeLine[] = existing.filter((f) => f.type === 'PRODUCT' || (f.type === 'SAMPLE' && !input.fees.some((n) => n.type === 'SAMPLE'))).map((f) => ({ type: f.type, label: f.label, amountMinor: f.amountMinor, status: f.status, source: f.source }));
    const provided: FeeLine[] = input.fees.map((f) => ({ type: f.type, label: f.label, amountMinor: f.status === 'NOT_CONFIRMED' ? null : f.amountMinor, status: f.status, source: f.status === 'NOT_CONFIRMED' ? 'NOT_CONFIRMED' : f.status === 'ESTIMATED' ? 'SYSTEM_ESTIMATE' : 'SUPPLIER' }));
    if (!provided.some((f) => f.type === 'INTERNATIONAL_SHIPPING')) {
      const prev = existing.find((f) => f.type === 'INTERNATIONAL_SHIPPING');
      provided.push(prev ? { type: prev.type, label: prev.label, amountMinor: prev.amountMinor, status: prev.status, source: prev.source } : { type: 'INTERNATIONAL_SHIPPING', label: 'International shipping', amountMinor: null, status: 'NOT_CONFIRMED', source: 'NOT_CONFIRMED' });
    }
    if (!provided.some((f) => f.type === 'TAX_ESTIMATED' || f.type === 'TAX_KNOWN')) provided.push({ type: 'TAX_ESTIMATED', label: 'Import duties & taxes', amountMinor: null, status: 'NOT_CONFIRMED', source: 'NOT_CONFIRMED' });
    const s = await saveFees(tx, orderId, order.currency, [...keep, ...provided]);
    await moveOrder(tx, orderId, 'PENDING_SUPPLIER_CONFIRMATION', 'AWAITING_PAYMENT', 'supplier', actor.id, input.note ?? 'Supplier confirmed stock, price and shipping', {
      confirmedTotalMinor: s.confirmedTotalMinor, hasUnconfirmedFees: s.hasUnconfirmed, supplierConfirmedAt: new Date(),
    });
    for (const pid of new Set(items.map((i) => i.variant?.productId).filter(Boolean) as string[])) await refreshProductStock(tx, pid);
    await audit(core, { actorId: actor.id, action: 'order.supplier_confirmed', targetType: 'Order', targetId: orderId, meta }, tx);
    await notify(core, { userId: order.buyerId, type: 'order.confirmed', title: 'Supplier confirmed your order', body: `Order ${order.orderNumber} is ready for payment. Review the full cost breakdown first.`, link: `/buyer/orders/${orderId}` }, tx);
  });
  return getOrder(core, actor, orderId);
}

/** Generic, rule-checked status change by a participant. */
export async function transitionOrder(core: Core, actor: Actor, orderId: string, to: OrderStatus, note?: string, meta?: RequestMeta) {
  const { order, role } = await loadOrderFor(core, actor, orderId);
  if (to === 'PAID') throw new AppError('INVALID_STATE_TRANSITION', 'Orders are marked paid only by a verified payment confirmation');
  if (['REFUNDED', 'PARTIALLY_REFUNDED'].includes(to)) throw new AppError('INVALID_STATE_TRANSITION', 'Refund states are set by the refund workflow');
  if (to === 'DISPUTED') throw new AppError('BAD_REQUEST', 'Use the dispute endpoint to open a dispute');
  if (to === 'REFUND_REQUESTED' && role === 'buyer') throw new AppError('BAD_REQUEST', 'Use the refund endpoint to request a refund');
  if (to === 'AWAITING_PAYMENT') throw new AppError('BAD_REQUEST', 'Use the supplier confirmation endpoint');
  if (to === 'SHIPPED') throw new AppError('BAD_REQUEST', 'Create a shipment to mark the order shipped');
  const actorKind: OrderActor = role === 'admin' ? 'admin' : role;
  await core.prisma.$transaction(async (tx) => {
    await moveOrder(tx, orderId, order.status, to, actorKind, actor.id, note, {
      ...(to === 'COMPLETED' ? { completedAt: new Date(), buyerConfirmedAt: role === 'buyer' ? new Date() : undefined } : {}),
      ...(to === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
    });
    if (to === 'CANCELLED') {
      await releaseReservations(tx, orderId);
      const items = await tx.orderItem.findMany({ where: { orderId }, select: { productId: true } });
      for (const pid of new Set(items.map((i) => i.productId).filter(Boolean) as string[])) await refreshProductStock(tx, pid);
    }
    await audit(core, { actorId: actor.id, action: role === 'admin' ? 'admin.order_transition' : 'order.transition', targetType: 'Order', targetId: orderId, metadata: { from: order.status, to, note }, meta }, tx);
    const sup = await tx.supplierProfile.findUniqueOrThrow({ where: { id: order.supplierId } });
    const target = role === 'buyer' ? sup.userId : order.buyerId;
    await notify(core, { userId: target, type: 'order.status', title: `Order ${order.orderNumber}: ${to.replace(/_/g, ' ').toLowerCase()}`, body: note ?? `Status changed from ${order.status} to ${to}.`, link: role === 'buyer' ? `/seller/orders/${orderId}` : `/buyer/orders/${orderId}` }, tx);
  });
  return getOrder(core, actor, orderId);
}

/** Maintenance: release expired reservations and cancel orders that were never confirmed/paid. */
export async function expireReservations(core: Core, now = new Date()) {
  const expired = await core.prisma.inventoryReservation.findMany({ where: { status: 'ACTIVE', expiresAt: { lt: now } }, select: { orderId: true }, distinct: ['orderId'] });
  let cancelled = 0;
  for (const { orderId } of expired) {
    await core.prisma.$transaction(async (tx) => {
      const o = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      await releaseReservations(tx, orderId);
      if (o.status === 'PENDING_SUPPLIER_CONFIRMATION' || o.status === 'AWAITING_PAYMENT') {
        await moveOrder(tx, orderId, o.status, 'CANCELLED', 'system', null, 'Reservation expired', { cancelledAt: now });
        await notify(core, { userId: o.buyerId, type: 'order.expired', title: `Order ${o.orderNumber} expired`, body: 'The stock reservation expired before the order was confirmed and paid.', link: `/buyer/orders/${orderId}` }, tx);
        cancelled++;
      }
      const items = await tx.orderItem.findMany({ where: { orderId }, select: { productId: true } });
      for (const pid of new Set(items.map((i) => i.productId).filter(Boolean) as string[])) await refreshProductStock(tx, pid);
    });
  }
  return { ordersAffected: expired.length, cancelled };
}

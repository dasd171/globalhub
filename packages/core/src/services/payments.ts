import { Prisma } from '@globalhub/database';
import { AppError, forbidden } from '@globalhub/shared';
import type { Core, Actor, RequestMeta } from '../context.js';
import { MockPaymentProvider, DEMO_PAYMENT_BANNER, type VerifiedPaymentEvent } from '../providers/payment.js';
import { loadOrderFor, moveOrder, consumeReservations, getOrder } from './orders.js';
import { audit } from './audit.js';
import { notify } from './notifications.js';

export async function startPayment(core: Core, actor: Actor, orderId: string, opts: { acknowledgeUnconfirmedFees?: boolean } = {}) {
  const { order, role } = await loadOrderFor(core, actor, orderId);
  if (role !== 'buyer') throw forbidden('Only the buyer can pay');
  if (order.status !== 'AWAITING_PAYMENT') throw new AppError('INVALID_STATE_TRANSITION', `Order is ${order.status}, not awaiting payment`);
  if (core.payment.name === 'mock' && !core.config.mockPaymentsAllowed) throw new AppError('PAYMENT_ERROR', 'Mock payments are disabled in this environment');
  if (order.hasUnconfirmedFees && !opts.acknowledgeUnconfirmedFees) {
    throw new AppError('BAD_REQUEST', 'Some costs are not yet confirmed. Confirm you understand they will be settled separately (acknowledgeUnconfirmedFees=true).');
  }
  const idempotencyKey = `pay_${orderId}`;
  const existing = await core.prisma.payment.findUnique({ where: { idempotencyKey } });
  if (existing && existing.status === 'SUCCEEDED') throw new AppError('CONFLICT', 'Order already paid');
  const amount = order.confirmedTotalMinor;
  const created = await core.payment.createPayment({ orderId, orderNumber: order.orderNumber, amountMinor: amount, currency: order.currency, idempotencyKey, returnUrl: `${core.config.APP_BASE_URL}/buyer/orders/${orderId}` });
  const payment = existing
    ? await core.prisma.payment.update({ where: { id: existing.id }, data: { providerRef: created.providerRef, amountMinor: amount } })
    : await core.prisma.payment.create({ data: { orderId, provider: core.payment.name, providerRef: created.providerRef, amountMinor: amount, currency: order.currency, isDemo: core.payment.isDemo, idempotencyKey } });
  await audit(core, { actorId: actor.id, action: 'payment.started', targetType: 'Payment', targetId: payment.id, metadata: { amount, currency: order.currency, provider: core.payment.name } });
  return { paymentId: payment.id, amountMinor: amount, currency: order.currency, provider: core.payment.name, isDemo: core.payment.isDemo, banner: core.payment.isDemo ? DEMO_PAYMENT_BANNER : null, nextAction: created.nextAction };
}

/**
 * Demo-only: simulate the provider calling our webhook. Goes through the exact same signed
 * webhook verification path; the browser itself never marks an order paid.
 */
export async function demoConfirmPayment(core: Core, actor: Actor, orderId: string) {
  if (!(core.payment instanceof MockPaymentProvider) || !core.config.mockPaymentsAllowed) throw new AppError('NOT_SUPPORTED', 'Demo payments are not enabled');
  const { order, role } = await loadOrderFor(core, actor, orderId);
  if (role !== 'buyer') throw forbidden();
  const payment = await core.prisma.payment.findUnique({ where: { idempotencyKey: `pay_${orderId}` } });
  if (!payment || !payment.providerRef) throw new AppError('BAD_REQUEST', 'Start the payment first');
  const { body, signature } = core.payment.buildSignedEvent({ type: 'payment.succeeded', providerRef: payment.providerRef, amountMinor: payment.amountMinor, currency: payment.currency, orderId: order.id });
  const r = await handlePaymentWebhook(core, 'mock', body, { 'x-mock-signature': signature });
  return { ...r, banner: DEMO_PAYMENT_BANNER, order: await getOrder(core, actor, orderId) };
}

/**
 * Verified webhook processing. Checks signature, event uniqueness, payment/order ownership,
 * amount, currency and current order state before marking anything paid. Idempotent.
 */
export async function handlePaymentWebhook(core: Core, provider: string, rawBody: string, headers: Record<string, string | string[] | undefined>, meta?: RequestMeta) {
  if (provider !== core.payment.name) throw new AppError('BAD_REQUEST', 'Unknown payment provider');
  let event: VerifiedPaymentEvent;
  try { event = core.payment.verifyWebhook(rawBody, headers); }
  catch (e) { await audit(core, { action: 'risk.webhook_signature_invalid', metadata: { provider }, meta }); throw e; }

  try {
    await core.prisma.webhookEvent.create({ data: { provider, eventId: event.eventId, type: event.type, payload: event.raw as Prisma.InputJsonValue } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { duplicate: true, processed: false };
    throw e;
  }

  const finish = (status: string, error?: string) => core.prisma.webhookEvent.update({ where: { provider_eventId: { provider, eventId: event.eventId } }, data: { status, error, processedAt: new Date() } });
  if (event.type !== 'payment.succeeded' && event.type !== 'payment.failed') { await finish('IGNORED'); return { duplicate: false, processed: false }; }

  const payment = await core.prisma.payment.findUnique({ where: { provider_providerRef: { provider, providerRef: event.providerRef } }, include: { order: true } });
  const reject = async (reason: string) => { await finish('REJECTED', reason); await audit(core, { action: 'risk.webhook_rejected', metadata: { provider, eventId: event.eventId, reason }, meta }); throw new AppError('BAD_REQUEST', reason); };
  if (!payment) return reject('Unknown payment reference');
  if (event.orderId && event.orderId !== payment.orderId) return reject('Order mismatch');
  if (event.amountMinor !== payment.amountMinor) return reject('Amount mismatch');
  if (event.currency.toUpperCase() !== payment.currency) return reject('Currency mismatch');

  if (event.type === 'payment.failed') {
    await core.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', rawStatus: 'failed' } });
    await finish('PROCESSED');
    return { duplicate: false, processed: true };
  }
  if (payment.order.status !== 'AWAITING_PAYMENT') { await finish('IGNORED', `Order in state ${payment.order.status}`); return { duplicate: false, processed: false }; }

  await core.prisma.$transaction(async (tx) => {
    const p = await tx.payment.updateMany({ where: { id: payment.id, status: { not: 'SUCCEEDED' } }, data: { status: 'SUCCEEDED', rawStatus: 'succeeded' } });
    if (p.count !== 1) return;
    await moveOrder(tx, payment.orderId, 'AWAITING_PAYMENT', 'PAID', 'system', null, payment.isDemo ? `${DEMO_PAYMENT_BANNER} (provider ${provider})` : `Payment confirmed by ${provider}`, { paidAt: new Date() });
    await consumeReservations(tx, payment.orderId);
    const sup = await tx.supplierProfile.findUniqueOrThrow({ where: { id: payment.order.supplierId } });
    await notify(core, { userId: sup.userId, type: 'order.paid', title: `Order ${payment.order.orderNumber} paid${payment.isDemo ? ' (DEMO)' : ''}`, body: payment.isDemo ? DEMO_PAYMENT_BANNER : 'Payment confirmed. Please arrange production/shipping.', link: `/seller/orders/${payment.orderId}` }, tx);
    await notify(core, { userId: payment.order.buyerId, type: 'order.paid', title: `Payment received for ${payment.order.orderNumber}${payment.isDemo ? ' (DEMO)' : ''}`, body: payment.isDemo ? DEMO_PAYMENT_BANNER : 'Your payment was confirmed by the payment provider.', link: `/buyer/orders/${payment.orderId}` }, tx);
  });
  await finish('PROCESSED');
  await audit(core, { action: 'payment.succeeded', targetType: 'Payment', targetId: payment.id, metadata: { provider, demo: payment.isDemo }, meta });
  return { duplicate: false, processed: true };
}

/** Manual (bank transfer) mode: supplier or admin records that funds were received. Audited, never automatic. */
export async function recordManualPayment(core: Core, actor: Actor, orderId: string, reference: string, meta?: RequestMeta) {
  if (core.payment.name !== 'manual') throw new AppError('NOT_SUPPORTED', 'Manual payment confirmation is only available with PAYMENT_PROVIDER=manual');
  const { order, role } = await loadOrderFor(core, actor, orderId);
  if (role !== 'supplier' && role !== 'admin') throw forbidden();
  if (order.status !== 'AWAITING_PAYMENT') throw new AppError('INVALID_STATE_TRANSITION', `Order is ${order.status}`);
  await core.prisma.$transaction(async (tx) => {
    await tx.payment.upsert({ where: { idempotencyKey: `pay_${orderId}` }, update: { status: 'SUCCEEDED', rawStatus: `manual:${reference}` }, create: { orderId, provider: 'manual', providerRef: `manual_${orderId}`, amountMinor: order.confirmedTotalMinor, currency: order.currency, status: 'SUCCEEDED', idempotencyKey: `pay_${orderId}`, rawStatus: `manual:${reference}` } });
    await moveOrder(tx, orderId, 'AWAITING_PAYMENT', 'PAID', 'system', actor.id, `Manual payment recorded (ref ${reference})`, { paidAt: new Date() });
    await consumeReservations(tx, orderId);
    await audit(core, { actorId: actor.id, action: 'payment.manual_recorded', targetType: 'Order', targetId: orderId, metadata: { reference }, meta }, tx);
  });
  return getOrder(core, actor, orderId);
}

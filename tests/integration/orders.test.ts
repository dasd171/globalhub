import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MockPaymentProvider, orders as orderSvc, maintenanceJobs } from '@globalhub/core';
import { createTestEnv, Client, signUp, supplierWithProduct, addAddress, makeAdmin, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await createTestEnv(); });
afterAll(async () => { await env.app.close(); await env.prisma.$disconnect(); });

async function placeOrder(buyer: Client, variantId: string, quantity: number, addressId?: string) {
  return buyer.post('/orders', { idempotencyKey: randomUUID(), items: [{ variantId, quantity }], shippingAddressId: addressId });
}
async function inventory(variantId: string) { return env.prisma.inventory.findUniqueOrThrow({ where: { variantId } }); }

describe('scenario 3: confirm stock → order → mock payment → shipping → complete', () => {
  it('runs the full fulfilment flow with snapshots, reservations and demo labelling', async () => {
    const { supplier, product } = await supplierWithProduct(env, { stock: 20, price: 1500, tiers: [{ minQty: 1, maxQty: 9, unitPriceMinor: 1500 }, { minQty: 10, maxQty: null, unitPriceMinor: 1200 }] });
    const vid = product.variants[0].id;
    const buyer = await signUp(env, 'BUYER');
    const addr = await addAddress(buyer);
    const o = await placeOrder(buyer, vid, 10, addr);
    expect(o.status).toBe(201);
    expect(o.body.status).toBe('PENDING_SUPPLIER_CONFIRMATION');
    expect(o.body.items[0]).toMatchObject({ quantity: 10, unitPriceMinor: 1200, lineTotalMinor: 12000 });
    expect(o.body.snapshot.items[0].unitPriceMinor).toBe(1200);
    expect((await inventory(vid))).toMatchObject({ onHand: 20, reserved: 10 });

    // Price change after ordering must not alter the order.
    await supplier.patch(`/products/${product.id}`, { priceTiers: [{ minQty: 1, maxQty: null, unitPriceMinor: 9999 }] });
    expect((await buyer.get(`/orders/${o.body.id}`)).body.subtotalMinor).toBe(12000);

    // Buyer cannot pay before supplier confirmation; buyer cannot confirm for the supplier.
    expect((await buyer.post(`/orders/${o.body.id}/payments`, { acknowledgeUnconfirmedFees: true })).status).toBe(409);
    expect((await buyer.post(`/orders/${o.body.id}/confirm`, { fees: [] })).status).toBe(403);
    expect((await buyer.post(`/orders/${o.body.id}/transition`, { to: 'PAID' })).status).toBe(409);

    const conf = await supplier.post(`/orders/${o.body.id}/confirm`, { fees: [
      { type: 'INTERNATIONAL_SHIPPING', label: 'Air express to JP', amountMinor: 4500, status: 'CONFIRMED' },
      { type: 'PACKAGING', label: 'Export carton', amountMinor: 300, status: 'CONFIRMED' },
      { type: 'TAX_ESTIMATED', label: 'JP import consumption tax', amountMinor: 1680, status: 'ESTIMATED' },
    ] });
    expect(conf.status).toBe(200);
    expect(conf.body.status).toBe('AWAITING_PAYMENT');
    expect(conf.body.confirmedTotalMinor).toBe(12000 + 4500 + 300);
    expect(conf.body.feeSummary).toMatchObject({ estimatedTotalMinor: 1680, hasUnconfirmed: false });

    const pay = await buyer.post(`/orders/${o.body.id}/payments`, {});
    expect(pay.body).toMatchObject({ provider: 'mock', isDemo: true, banner: 'DEMO PAYMENT — NO REAL MONEY MOVED', amountMinor: 16800 });
    const paid = await buyer.post(`/orders/${o.body.id}/payments/demo-confirm`);
    expect(paid.body.order.status).toBe('PAID');
    expect(paid.body.order.payments[0]).toMatchObject({ status: 'SUCCEEDED', isDemo: true });
    expect(await inventory(vid)).toMatchObject({ onHand: 10, reserved: 0 });

    expect((await supplier.post(`/orders/${o.body.id}/transition`, { to: 'PROCESSING' })).body.status).toBe('PROCESSING');
    expect((await supplier.post(`/orders/${o.body.id}/shipments`, { carrier: 'X' })).status).toBe(409); // not ready yet
    await supplier.post(`/orders/${o.body.id}/transition`, { to: 'READY_TO_SHIP' });
    const sh = await supplier.post(`/orders/${o.body.id}/shipments`, { carrier: 'mock', useProvider: true, weightGrams: 20000 });
    expect(sh.status).toBe(201);
    expect(sh.body.isDemo).toBe(true);
    expect(sh.body.trackingNumber).toMatch(/^DEMO/);
    await supplier.post(`/shipments/${sh.body.id}/events`, { status: 'IN_TRANSIT', location: 'Rotterdam hub' });
    expect((await buyer.get(`/orders/${o.body.id}`)).body.status).toBe('IN_TRANSIT');
    expect((await buyer.post(`/shipments/${sh.body.id}/events`, { status: 'DELIVERED' })).status).toBe(403);
    await supplier.post(`/shipments/${sh.body.id}/events`, { status: 'DELIVERED', location: 'Tokyo' });
    const done = await buyer.post(`/orders/${o.body.id}/transition`, { to: 'COMPLETED' });
    expect(done.body.status).toBe('COMPLETED');
    expect(done.body.events.map((e: any) => e.toStatus)).toEqual(['DRAFT', 'PENDING_SUPPLIER_CONFIRMATION', 'AWAITING_PAYMENT', 'PAID', 'PROCESSING', 'READY_TO_SHIP', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED']);

    // Reviews only for completed orders; one per target.
    const rv = await buyer.post('/reviews', { orderId: o.body.id, target: 'SUPPLIER', rating: 5, body: 'Great' });
    expect(rv.status).toBe(201);
    expect((await buyer.post('/reviews', { orderId: o.body.id, target: 'SUPPLIER', rating: 4 })).status).toBe(409);
    const stranger = await signUp(env, 'BUYER');
    expect((await stranger.post('/reviews', { orderId: o.body.id, target: 'SUPPLIER', rating: 1 })).status).toBe(404);
  });

  it('enforces MOQ, idempotency and destination restrictions', async () => {
    const { product } = await supplierWithProduct(env, { stock: 50, moq: 5, shipsTo: ['US'] });
    const vid = product.variants[0].id;
    const buyer = await signUp(env, 'BUYER');
    expect((await placeOrder(buyer, vid, 2)).status).toBe(422);
    const jp = await addAddress(buyer, 'JP');
    expect((await placeOrder(buyer, vid, 5, jp)).status).toBe(400);
    const us = await addAddress(buyer, 'US');
    const key = randomUUID();
    const a = await buyer.post('/orders', { idempotencyKey: key, items: [{ variantId: vid, quantity: 5 }], shippingAddressId: us });
    const b = await buyer.post('/orders', { idempotencyKey: key, items: [{ variantId: vid, quantity: 5 }], shippingAddressId: us });
    expect(a.status).toBe(201); expect(b.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    expect((await inventory(vid)).reserved).toBe(5);
  });

  it('cancellation and reservation expiry release stock', async () => {
    const { product } = await supplierWithProduct(env, { stock: 10 });
    const vid = product.variants[0].id;
    const buyer = await signUp(env, 'BUYER');
    const o1 = await placeOrder(buyer, vid, 4);
    expect((await buyer.post(`/orders/${o1.body.id}/transition`, { to: 'CANCELLED', note: 'changed mind' })).body.status).toBe('CANCELLED');
    expect((await inventory(vid)).reserved).toBe(0);
    const o2 = await placeOrder(buyer, vid, 3);
    await env.prisma.inventoryReservation.updateMany({ where: { orderId: o2.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const r = await maintenanceJobs['release-reservations'](env.core);
    expect(r.cancelled).toBe(1);
    expect((await env.prisma.order.findUniqueOrThrow({ where: { id: o2.body.id } })).status).toBe('CANCELLED');
    expect((await inventory(vid)).reserved).toBe(0);
  });
});

describe('scenario 6: users cannot access other users’ orders', () => {
  it('denies non-participants and enforces role on actions', async () => {
    const { product } = await supplierWithProduct(env, { stock: 10 });
    const buyerA = await signUp(env, 'BUYER');
    const buyerB = await signUp(env, 'BUYER');
    const otherSupplier = await signUp(env, 'SUPPLIER');
    const o = await placeOrder(buyerA, product.variants[0].id, 1);
    for (const c of [buyerB, otherSupplier]) {
      expect((await c.get(`/orders/${o.body.id}`)).status).toBe(404);
      expect((await c.post(`/orders/${o.body.id}/transition`, { to: 'CANCELLED' })).status).toBe(404);
      expect((await c.post(`/orders/${o.body.id}/payments`, {})).status).toBe(404);
    }
    expect((await new Client(env.app).get(`/orders/${o.body.id}`)).status).toBe(401);
    expect((await buyerB.get('/orders')).body.items).toHaveLength(0);
    expect((await buyerB.get('/orders?as=admin')).status).toBe(403);
    const admin = await makeAdmin(env);
    expect((await admin.get(`/orders/${o.body.id}`)).status).toBe(200);
    expect((await admin.get('/admin/users')).status).toBe(200);
    expect((await buyerB.get('/admin/users')).status).toBe(403);
    expect((await buyerB.get('/admin/audit-logs')).status).toBe(403);
  });
});

describe('scenario 7: duplicate payment webhooks', () => {
  it('processes a webhook once, rejects forged/mismatched events', async () => {
    const { supplier, product } = await supplierWithProduct(env, { stock: 10, price: 1000 });
    const buyer = await signUp(env, 'BUYER');
    const o = await placeOrder(buyer, product.variants[0].id, 2);
    await supplier.post(`/orders/${o.body.id}/confirm`, { fees: [{ type: 'INTERNATIONAL_SHIPPING', label: 'Ship', amountMinor: 500, status: 'CONFIRMED' }] });
    const noAck = await buyer.post(`/orders/${o.body.id}/payments`, {});
    expect(noAck.status).toBe(400); // duties not yet confirmed → buyer must acknowledge
    const pay = await buyer.post(`/orders/${o.body.id}/payments`, { acknowledgeUnconfirmedFees: true });
    const payment = await env.prisma.payment.findUniqueOrThrow({ where: { id: pay.body.paymentId } });
    const provider = env.core.payment as MockPaymentProvider;
    const send = (body: string, signature: string) => env.app.inject({ method: 'POST', url: '/api/v1/payments/webhooks/mock', headers: { 'content-type': 'application/json', 'x-mock-signature': signature }, payload: body });

    const forged = provider.buildSignedEvent({ type: 'payment.succeeded', providerRef: payment.providerRef!, amountMinor: payment.amountMinor, currency: 'USD', orderId: o.body.id });
    expect((await send(forged.body, 'f'.repeat(64))).statusCode).toBe(401);
    const wrongAmount = provider.buildSignedEvent({ type: 'payment.succeeded', providerRef: payment.providerRef!, amountMinor: 1, currency: 'USD', orderId: o.body.id });
    expect((await send(wrongAmount.body, wrongAmount.signature)).statusCode).toBe(400);
    const wrongCurrency = provider.buildSignedEvent({ type: 'payment.succeeded', providerRef: payment.providerRef!, amountMinor: payment.amountMinor, currency: 'EUR', orderId: o.body.id });
    expect((await send(wrongCurrency.body, wrongCurrency.signature)).statusCode).toBe(400);
    expect((await env.prisma.order.findUniqueOrThrow({ where: { id: o.body.id } })).status).toBe('AWAITING_PAYMENT');

    const good = provider.buildSignedEvent({ type: 'payment.succeeded', providerRef: payment.providerRef!, amountMinor: payment.amountMinor, currency: 'USD', orderId: o.body.id, eventId: 'evt_dup_1' });
    const results = await Promise.all([send(good.body, good.signature), send(good.body, good.signature), send(good.body, good.signature)]);
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(results.filter((r) => r.json().processed).length).toBe(1);
    expect(results.filter((r) => r.json().duplicate).length).toBe(2);
    // A different event id for the same payment does not advance the order twice either.
    const again = provider.buildSignedEvent({ type: 'payment.succeeded', providerRef: payment.providerRef!, amountMinor: payment.amountMinor, currency: 'USD', orderId: o.body.id, eventId: 'evt_dup_2' });
    expect((await send(again.body, again.signature)).json().processed).toBe(false);
    expect(await env.prisma.orderEvent.count({ where: { orderId: o.body.id, toStatus: 'PAID' } })).toBe(1);
    expect(await env.prisma.webhookEvent.count({ where: { provider: 'mock', eventId: 'evt_dup_1' } })).toBe(1);
    expect((await env.prisma.inventory.findUniqueOrThrow({ where: { variantId: product.variants[0].id } }))).toMatchObject({ onHand: 8, reserved: 0 });
  });
});

describe('scenario 8: concurrent purchases of limited stock', () => {
  it('never oversells', async () => {
    const { product } = await supplierWithProduct(env, { stock: 5 });
    const vid = product.variants[0].id;
    const buyers = await Promise.all(Array.from({ length: 12 }, () => signUp(env, 'BUYER')));
    const actors = await Promise.all(buyers.map(async (b) => ({ id: b.user!.id, roles: ['BUYER'] as const, status: 'ACTIVE' })));
    const results = await Promise.allSettled(actors.map((a) => orderSvc.createOrder(env.core, a as never, { idempotencyKey: randomUUID(), items: [{ variantId: vid, quantity: 1 }] })));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toBe(5);
    expect(failed.every((f) => f.reason.code === 'INSUFFICIENT_STOCK')).toBe(true);
    expect(await inventory(vid)).toMatchObject({ onHand: 5, reserved: 5 });
    expect(await env.prisma.inventoryReservation.count({ where: { variantId: vid, status: 'ACTIVE' } })).toBe(5);
    // Over-asking in a single order also fails.
    expect((await placeOrder(buyers[0], vid, 1)).status).toBe(409);
  });
});

describe('refunds and disputes', () => {
  async function paidOrder() {
    const { supplier, product } = await supplierWithProduct(env, { stock: 10, price: 1000 });
    const buyer = await signUp(env, 'BUYER');
    const o = await placeOrder(buyer, product.variants[0].id, 3);
    await supplier.post(`/orders/${o.body.id}/confirm`, { fees: [{ type: 'INTERNATIONAL_SHIPPING', label: 'Ship', amountMinor: 1000, status: 'CONFIRMED' }] });
    await buyer.post(`/orders/${o.body.id}/payments`, { acknowledgeUnconfirmedFees: true });
    await buyer.post(`/orders/${o.body.id}/payments/demo-confirm`);
    return { supplier, buyer, orderId: o.body.id as string };
  }

  it('refund request → supplier approval → provider refund (demo) → REFUNDED', async () => {
    const { supplier, buyer, orderId } = await paidOrder();
    expect((await buyer.post(`/orders/${orderId}/refunds`, { amountMinor: 99999, reason: 'too much' })).status).toBe(422);
    const r = await buyer.post(`/orders/${orderId}/refunds`, { amountMinor: 4000, reason: 'Wrong colour delivered' });
    expect(r.status).toBe(201);
    expect((await buyer.get(`/orders/${orderId}`)).body.status).toBe('REFUND_REQUESTED');
    expect((await buyer.post(`/refunds/${r.body.id}/decision`, { decision: 'APPROVE' })).status).toBe(403);
    const d = await supplier.post(`/refunds/${r.body.id}/decision`, { decision: 'APPROVE' });
    expect(d.body.status).toBe('PROCESSED_PROVIDER');
    const o = await buyer.get(`/orders/${orderId}`);
    expect(o.body.status).toBe('REFUNDED');
    expect(o.body.payments[0].status).toBe('REFUNDED');
    expect(o.body.events.at(-1).note).toMatch(/DEMO/);
  });

  it('rejected refund returns the order; dispute resolved by admin creates an approved refund', async () => {
    const { supplier, buyer, orderId } = await paidOrder();
    const r = await buyer.post(`/orders/${orderId}/refunds`, { amountMinor: 1000, reason: 'Changed my mind' });
    await supplier.post(`/refunds/${r.body.id}/decision`, { decision: 'REJECT', note: 'Custom goods' });
    expect((await buyer.get(`/orders/${orderId}`)).body.status).toBe('PROCESSING');
    const disp = await buyer.post(`/orders/${orderId}/disputes`, { reason: 'Supplier refuses refund for defective goods' });
    expect(disp.status).toBe(201);
    expect((await buyer.post(`/orders/${orderId}/disputes`, { reason: 'Second dispute attempt here' })).status).toBe(409);
    await supplier.post(`/disputes/${disp.body.id}/evidence`, { body: 'Photos show goods were fine' });
    expect((await buyer.post(`/disputes/${disp.body.id}/resolve`, { outcome: 'RESOLVED_BUYER_FAVOR', resolution: 'self-resolve' })).status).toBe(403);
    const admin = await makeAdmin(env);
    const res = await admin.post(`/disputes/${disp.body.id}/resolve`, { outcome: 'RESOLVED_BUYER_FAVOR', resolution: 'Evidence supports buyer' });
    expect(res.body.status).toBe('RESOLVED_BUYER_FAVOR');
    const refund = await env.prisma.refund.findFirstOrThrow({ where: { orderId, status: 'APPROVED' } });
    const manual = await admin.post(`/refunds/${refund.id}/decision`, { decision: 'MARK_PROCESSED_MANUAL', note: 'Bank transfer ref 123' });
    expect(manual.body.status).toBe('PROCESSED_MANUAL');
    expect((await buyer.get(`/orders/${orderId}`)).body.status).toBe('REFUNDED');
    const audit = await admin.get('/admin/audit-logs?action=dispute');
    expect(audit.body.items.some((a: any) => a.action === 'dispute.resolved')).toBe(true);
  });
});

describe('shipping quotes', () => {
  it('returns DEMO estimates clearly labelled', async () => {
    const { product } = await supplierWithProduct(env);
    const q = await new Client(env.app).post(`/products/${product.id}/shipping-quote`, { quantity: 10, destinationCountry: 'JP' });
    expect(q.body.isDemo).toBe(true);
    expect(q.body.quotes[0]).toMatchObject({ source: 'SYSTEM_ESTIMATE', isDemo: true });
    expect(q.body.quotes[0].dutiesNote).toMatch(/not yet confirmed/);
  });
});

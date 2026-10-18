import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestEnv, Client, signUp, supplierWithProduct, addAddress, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await createTestEnv(); });
afterAll(async () => { await env.app.close(); await env.prisma.$disconnect(); });

const rfq = {
  title: 'Waterproof camping tents', description: 'I need 100 waterproof camping tents, preferably from a factory. Please quote the best available price and shipping to Japan.',
  quantity: 100, destinationCountry: 'JP', currency: 'USD', needsShippingQuote: true,
};
const quoteBody = (requestId: string, price: number) => ({
  buyingRequestId: requestId, productName: '4-person tent', specifications: '3000mm PU', availableQty: 500, currency: 'USD', unitPriceMinor: price, moq: 50,
  sampleFeeMinor: 3000, domesticShippingMinor: 2000, internationalShippingMinor: null, internationalShippingSource: 'NOT_CONFIRMED', productionDays: 15, shipWithinDays: 20,
  validDays: 14, paymentTerms: '30% deposit', qualityGuarantee: '1 year', returnPolicy: 'Defects replaced', taxIncluded: false, inspectionRequired: true,
});

describe('scenario 1: register → search → view → inquiry', () => {
  it('lets a new buyer find a product and request a quote', async () => {
    const { product, supplier } = await supplierWithProduct(env, { titleEn: 'Inflatable kayak' });
    const buyer = await signUp(env, 'BUYER');
    const s = await buyer.get('/products?q=kayak');
    const found = s.body.items.find((p: any) => p.id === product.id);
    expect(found).toBeDefined();
    const d = await buyer.get(`/products/${found.id}`);
    expect(d.body.title).toBe('Inflatable kayak');
    const inq = await buyer.post(`/products/${product.id}/request-quote`, { quantity: 20, destinationCountry: 'JP', message: 'Please quote 20 units with shipping' });
    expect(inq.status).toBe(201);
    expect(inq.body.visibility).toBe('PRIVATE');
    // Only the targeted supplier sees it.
    expect((await supplier.get(`/buying-requests/${inq.body.id}`)).status).toBe(200);
    const stranger = await signUp(env, 'SUPPLIER');
    expect((await stranger.get(`/buying-requests/${inq.body.id}`)).status).toBe(404);
    const notes = await supplier.get('/notifications');
    expect(notes.body.items.some((n: any) => n.type === 'rfq.new' && n.emailStatus === 'NOT_CONFIGURED')).toBe(true);
  });
});

describe('scenario 2: buying request → quotes → accept', () => {
  it('parses, structures, collects competing quotes and creates an order on acceptance', async () => {
    const buyer = await signUp(env, 'BUYER');
    const r = await buyer.post('/buying-requests', rfq);
    expect(r.status).toBe(201);
    expect(r.body.structured).toMatchObject({ quantity: 100, destination: 'JP', supplierType: 'MANUFACTURER', status: 'Open for Quotes' });
    expect(r.body.structured.requirements).toEqual(expect.arrayContaining(['waterproof', 'bulk purchase']));
    expect(r.body.structured.requestedServices).toContain('shipping quotation');
    expect(r.body.translatedZh).toBeNull(); // no automatic machine translation
    expect(r.body.translationStatus).toBe('ORIGINAL');

    const s1 = await signUp(env, 'SUPPLIER');
    const s2 = await signUp(env, 'SUPPLIER');
    const hall = await s1.get('/buying-requests/open');
    expect(hall.body.items.map((i: any) => i.id)).toContain(r.body.id);
    expect(JSON.stringify(hall.body)).not.toContain(buyer.user!.email); // no buyer identity leak

    const q1 = await s1.post('/quotes', quoteBody(r.body.id, 1800));
    const q2 = await s2.post('/quotes', quoteBody(r.body.id, 1650));
    expect(q1.status).toBe(201); expect(q2.status).toBe(201);
    expect((await s1.post('/quotes', quoteBody(r.body.id, 1700))).status).toBe(409); // one active quote per supplier
    expect((await buyer.post('/quotes', quoteBody(r.body.id, 1))).status).toBe(403); // buyers cannot quote

    // Suppliers only see their own quote; buyer sees all with data-source labels.
    const s1view = await s1.get(`/buying-requests/${r.body.id}/quotes`);
    expect(s1view.body).toHaveLength(1);
    expect(s1view.body[0].unitPriceMinor).toBe(1800);
    const bview = await buyer.get(`/buying-requests/${r.body.id}/quotes`);
    expect(bview.body.map((q: any) => q.unitPriceMinor)).toEqual([1650, 1800]);
    expect(bview.body[0].dataSources.internationalShipping).toBe('NOT_CONFIRMED');
    expect(bview.body[0].status).toBe('VIEWED');

    const summary = await buyer.get(`/buying-requests/${r.body.id}/quotes/summary`);
    expect(summary.body.advisory).toBe(true);
    expect(summary.body.summary).toMatch(/lowest unit price/);

    const addressId = await addAddress(buyer);
    const acc = await buyer.post(`/quotes/${q2.body.id}/accept`, { shippingAddressId: addressId });
    expect(acc.status).toBe(200);
    expect(acc.body.quote.status).toBe('ACCEPTED');
    expect(acc.body.orderId).toBeTruthy();
    expect((await env.prisma.quote.findUniqueOrThrow({ where: { id: q1.body.id } })).status).toBe('REJECTED');
    expect((await env.prisma.buyingRequest.findUniqueOrThrow({ where: { id: r.body.id } })).status).toBe('FULFILLED');

    const order = await buyer.get(`/orders/${acc.body.orderId}`);
    expect(order.body.status).toBe('PENDING_SUPPLIER_CONFIRMATION');
    expect(order.body.quoteId).toBe(q2.body.id);
    expect(order.body.subtotalMinor).toBe(1650 * 100);
    const intl = order.body.fees.find((f: any) => f.type === 'INTERNATIONAL_SHIPPING');
    expect(intl).toMatchObject({ status: 'NOT_CONFIRMED', amountMinor: null });
    expect(order.body.hasUnconfirmedFees).toBe(true);
    expect((await s1.get(`/orders/${acc.body.orderId}`)).status).toBe(404); // losing supplier can't see

    // Expired quotes cannot be accepted.
    const r2 = await buyer.post('/buying-requests', { ...rfq, title: 'Second' });
    const q3 = await s1.post('/quotes', quoteBody(r2.body.id, 1000));
    await env.prisma.quote.update({ where: { id: q3.body.id }, data: { validUntil: new Date(Date.now() - 1000) } });
    expect((await buyer.post(`/quotes/${q3.body.id}/accept`, {})).status).toBe(400);
  });

  it('matches products for a request with explainable reasons', async () => {
    await supplierWithProduct(env, { titleEn: 'Waterproof camping tent 4p', moq: 10 });
    const buyer = await signUp(env, 'BUYER');
    const r = await buyer.post('/buying-requests', rfq);
    const m = await buyer.get(`/buying-requests/${r.body.id}/matches`);
    expect(m.body.results.length).toBeGreaterThan(0);
    expect(m.body.results[0].reasons.length).toBeGreaterThan(0);
    expect(typeof m.body.results[0].score).toBe('number');
  });

  it('natural-language finder runs a real database query', async () => {
    await supplierWithProduct(env, { titleEn: 'USB-C hub with HDMI and Ethernet', moq: 10 });
    const r = await new Client(env.app).post('/ai/find-products', { text: 'Find 200 USB-C hubs with HDMI and Ethernet, suitable for laptops, shipped to Japan.' });
    expect(r.body.parsed.quantity).toBe(200);
    expect(r.body.parsed.destinationCountry).toBe('JP');
    expect(r.body.items.some((p: any) => p.title.includes('USB-C hub'))).toBe(true);
    const none = await new Client(env.app).post('/ai/find-products', { text: 'zzqx unobtainium widgets' });
    expect(none.body.total).toBe(0);
    expect(none.body.postRequestSuggested).toBe(true);
  });

  it('expires quotes and requests via the maintenance job', async () => {
    const buyer = await signUp(env, 'BUYER');
    const s = await signUp(env, 'SUPPLIER');
    const r = await buyer.post('/buying-requests', rfq);
    const q = await s.post('/quotes', quoteBody(r.body.id, 999));
    await env.prisma.quote.update({ where: { id: q.body.id }, data: { validUntil: new Date(Date.now() - 1) } });
    await env.prisma.buyingRequest.update({ where: { id: r.body.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    const { maintenanceJobs } = await import('@globalhub/core');
    const res = await maintenanceJobs['expire-quotes'](env.core);
    expect(res.quotesExpired).toBeGreaterThanOrEqual(1);
    expect((await env.prisma.quote.findUniqueOrThrow({ where: { id: q.body.id } })).status).toBe('EXPIRED');
  });
});

describe('messaging', () => {
  it('product inquiry conversation with unread counts, read state and blocking', async () => {
    const { product, supplier } = await supplierWithProduct(env);
    const buyer = await signUp(env, 'BUYER');
    const conv = await buyer.post('/conversations', { subject: 'PRODUCT_INQUIRY', productId: product.id, body: 'Is OEM available?' });
    expect(conv.status).toBe(201);
    const list = await supplier.get('/conversations');
    expect(list.body.totalUnread).toBe(1);
    const msgs = await supplier.get(`/conversations/${conv.body.id}/messages`);
    expect(msgs.body.messages[0].body).toBe('Is OEM available?');
    expect((await supplier.get('/conversations')).body.totalUnread).toBe(0);
    await supplier.post(`/conversations/${conv.body.id}/messages`, { body: 'Yes, MOQ 500' });
    const stranger = await signUp(env, 'BUYER');
    expect((await stranger.get(`/conversations/${conv.body.id}/messages`)).status).toBe(404);
    await supplier.post(`/users/${buyer.user!.id}/block`);
    expect((await buyer.post(`/conversations/${conv.body.id}/messages`, { body: 'hello?' })).status).toBe(403);
    const rep = await buyer.post('/reports', { targetType: 'MESSAGE', targetId: msgs.body.messages[0].id, reason: 'spam test' });
    expect(rep.status).toBe(201);
  });
});

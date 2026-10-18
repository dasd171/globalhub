import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateNodeKeyPair, signRequest } from '@globalhub/federation';
import { federation, maintenanceJobs } from '@globalhub/core';
import { createTestEnv, signUp, supplierWithProduct, Client, DB_A, DB_B, type TestEnv } from './helpers.js';

const PORT_A = 4701; const PORT_B = 4702;
const keyA = generateNodeKeyPair('ka1'); const keyB = generateNodeKeyPair('kb1');
const nodeEnv = (id: string, port: number, key: ReturnType<typeof generateNodeKeyPair>) => ({
  FEDERATION_ENABLED: 'true', NODE_ID: id, NODE_NAME: `Test ${id}`, NODE_PUBLIC_URL: `http://127.0.0.1:${port}`, NODE_KEY_ID: key.keyId,
  NODE_PRIVATE_KEY: Buffer.from(key.privateKeyPem).toString('base64'), NODE_PUBLIC_SCOPES: 'products,suppliers,rfq_inbox', FEDERATION_ALLOW_PRIVATE_NETWORK: 'true',
});

let A: TestEnv; let B: TestEnv;
beforeAll(async () => {
  A = await createTestEnv(nodeEnv('node-a', PORT_A, keyA), DB_A);
  B = await createTestEnv(nodeEnv('node-b', PORT_B, keyB), DB_B);
  await federation.ensureLocalNode(A.core); await federation.ensureLocalNode(B.core);
  await A.app.listen({ port: PORT_A, host: '127.0.0.1' });
  await B.app.listen({ port: PORT_B, host: '127.0.0.1' });
});
afterAll(async () => { await A.app.close(); await B.app.close(); await A.prisma.$disconnect(); await B.prisma.$disconnect(); });

describe('scenario 5: two nodes exchange public catalogs and RFQs', () => {
  it('discovers, syncs signed catalogs, searches remote products, sends RFQ and receives a quote back', async () => {
    // Node B has a supplier with one public and one private product.
    const { supplier: supplierB, product: pub } = await supplierWithProduct(B, { titleEn: 'Federated bamboo cutting board', stock: 200, price: 450 });
    const priv = await supplierB.post('/products', { storeId: pub.store.id, titleEn: 'Secret prototype board', currency: 'USD', status: 'ACTIVE', isPublic: false, variants: [{ sku: 'PRIV-1', name: 'x', stock: 5 }] });
    expect(priv.status).toBe(201);

    const info = await new Client(B.app).get('/federation/node-info');
    expect(info.body).toMatchObject({ nodeId: 'node-b', protocol: 'globalhub-fed/1' });
    expect(info.body.capabilities).toContain('rfq.receive');

    // Admin on A discovers B. Without https the node stays UNVERIFIED.
    const adminA = await signUp(A, 'BUYER');
    const role = await A.prisma.role.findUniqueOrThrow({ where: { key: 'NODE_ADMIN' } });
    await A.prisma.userRole.create({ data: { userId: adminA.user!.id, roleId: role.id } });
    const disc = await adminA.post('/nodes/discover', { url: `http://127.0.0.1:${PORT_B}` });
    expect(disc.status).toBe(201);
    expect(disc.body.trustLevel).toBe('UNVERIFIED');
    const sync = await adminA.post(`/nodes/${disc.body.id}/sync`, { kind: 'products' });
    expect(sync.body).toMatchObject({ upserted: 1, rejected: 0 });
    const listings = await A.prisma.federatedListing.findMany({ where: { kind: 'PRODUCT' } });
    expect(listings.map((l) => l.title)).toEqual(['Federated bamboo cutting board']); // private product never synced
    expect(JSON.stringify(listings[0].data)).not.toMatch(/onHand|reserved|email/);
    // B registers A too (so A's RFQs can be verified).
    await federation.discoverNode(B.core, null, `http://127.0.0.1:${PORT_A}`);

    // Buyer on A searches including remote nodes.
    const buyerA = await signUp(A, 'BUYER');
    const s = await buyerA.get('/products?q=bamboo%20board&includeRemote=true');
    expect(s.body.items).toHaveLength(0);
    expect(s.body.remote).toHaveLength(1);
    expect(s.body.remote[0].node.nodeId).toBe('node-b');
    expect((await buyerA.get('/products?q=bamboo&includeRemote=true&minNodeTrust=DOMAIN_VERIFIED')).body.remote).toHaveLength(0);

    const rfq = await buyerA.post(`/federation/listings/${s.body.remote[0].id}/request-quote`, { quantity: 500, destinationCountry: 'DE', message: 'Need 500 boards with custom engraving' });
    expect(rfq.status).toBe(201);
    expect(rfq.body.delivery.status).toBe('DELIVERED');
    const inbound = await B.prisma.buyingRequest.findFirstOrThrow({ where: { remoteId: rfq.body.buyingRequestId } });
    expect(inbound).toMatchObject({ visibility: 'PRIVATE', targetSupplierId: pub.supplier.id, buyerId: null, remoteBuyerLabel: 'Buyer via Test node-a' });
    expect(JSON.stringify(inbound)).not.toContain(buyerA.user!.email);

    // Supplier on B sees and quotes; quote is relayed to A.
    const view = await supplierB.get(`/buying-requests/${inbound.id}`);
    expect(view.body.buyerLabel).toBe('Buyer via Test node-a');
    const q = await supplierB.post('/quotes', { buyingRequestId: inbound.id, productName: 'Bamboo board 30cm', availableQty: 1000, currency: 'USD', unitPriceMinor: 410, moq: 300, validDays: 10, internationalShippingMinor: null, internationalShippingSource: 'NOT_CONFIRMED' });
    expect(q.status).toBe(201);
    const outbox = await B.prisma.federationOutbox.findFirstOrThrow({ where: { type: 'quote' } });
    expect(outbox.status).toBe('DELIVERED');
    const quotesOnA = await buyerA.get(`/buying-requests/${rfq.body.buyingRequestId}/quotes`);
    expect(quotesOnA.body).toHaveLength(1);
    expect(quotesOnA.body[0]).toMatchObject({ unitPriceMinor: 410, moq: 300 });
    expect(quotesOnA.body[0].notes).toMatch(/Remote supplier/);
    // Accepting a remote quote does not fake a cross-node order.
    const acc = await buyerA.post(`/quotes/${quotesOnA.body[0].id}/accept`, {});
    expect(acc.body.orderId).toBeNull();

    // Removing a product on B propagates as a removal on next sync.
    await supplierB.patch(`/products/${pub.id}`, { isPublic: false });
    const resync = await federation.pullCatalog(A.core, disc.body.id, 'products');
    expect(resync.removed).toBe(1);
    expect((await buyerA.get('/products?q=bamboo&includeRemote=true')).body.remote).toHaveLength(0);
    const sup = await federation.pullCatalog(A.core, disc.body.id, 'suppliers');
    expect(sup.upserted).toBeGreaterThanOrEqual(1);
  });

  it('rejects replays, tampering, unknown nodes, forged quotes and banned nodes', async () => {
    const path = '/api/v1/federation/heartbeat';
    const body = JSON.stringify({ ping: 1 });
    const headers = signRequest({ method: 'POST', path, body, nodeId: 'node-a', keyId: 'ka1', privateKeyPem: keyA.privateKeyPem });
    const send = (h: Record<string, string>, b = body) => fetch(`http://127.0.0.1:${PORT_B}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: b });
    expect((await send(headers)).status).toBe(200);
    expect((await send(headers)).status).toBe(409); // replay (same nonce)
    const h2 = signRequest({ method: 'POST', path, body, nodeId: 'node-a', keyId: 'ka1', privateKeyPem: keyA.privateKeyPem });
    expect((await send(h2, JSON.stringify({ ping: 2 }))).status).toBe(401); // tampered body
    const evil = generateNodeKeyPair('ka1');
    expect((await send(signRequest({ method: 'POST', path, body, nodeId: 'node-a', keyId: 'ka1', privateKeyPem: evil.privateKeyPem }))).status).toBe(401); // impersonation
    expect((await send(signRequest({ method: 'POST', path, body, nodeId: 'node-zzz', keyId: 'k', privateKeyPem: evil.privateKeyPem }))).status).toBe(401); // unknown node
    expect((await send({})).status).toBe(401);

    // Forged quote for an RFQ that node B was never asked about: A rejects it.
    const qpath = '/api/v1/federation/inbox/quote';
    const forged = JSON.stringify({ quoteId: crypto.randomUUID(), rfqId: crypto.randomUUID(), supplierName: 'Fake', productName: 'x', availableQty: 1, currency: 'USD', unitPriceMinor: 1, moq: 1, internationalShippingMinor: null, internationalShippingSource: 'NOT_CONFIRMED', validUntil: new Date(Date.now() + 86400000).toISOString() });
    const fr = await fetch(`http://127.0.0.1:${PORT_A}${qpath}`, { method: 'POST', headers: { 'content-type': 'application/json', ...signRequest({ method: 'POST', path: qpath, body: forged, nodeId: 'node-b', keyId: 'kb1', privateKeyPem: keyB.privateKeyPem }) }, body: forged });
    expect(fr.status).toBe(404);

    // Risk events are audited.
    expect(await B.prisma.auditLog.count({ where: { action: { startsWith: 'risk.federation' } } })).toBeGreaterThanOrEqual(2);

    // Ban node A on B → A's signed requests are refused and its listings hidden.
    const nodeA = await B.prisma.node.findUniqueOrThrow({ where: { nodeId: 'node-a' } });
    const adminB = await signUp(B, 'BUYER');
    const r = await B.prisma.role.findUniqueOrThrow({ where: { key: 'PLATFORM_ADMIN' } });
    await B.prisma.userRole.create({ data: { userId: adminB.user!.id, roleId: r.id } });
    expect((await adminB.patch(`/nodes/${nodeA.id}`, { status: 'BANNED' })).body.status).toBe('BANNED');
    expect((await send(signRequest({ method: 'POST', path, body, nodeId: 'node-a', keyId: 'ka1', privateKeyPem: keyA.privateKeyPem }))).status).toBe(403);
    const status = await new Client(B.app).get('/nodes');
    expect(status.body.nodes.find((n: any) => n.nodeId === 'node-a')).toBeUndefined();
  });

  it('retries failed deliveries via the outbox and marks silent nodes stale', async () => {
    const ghost = await A.prisma.node.create({ data: { nodeId: 'node-ghost', displayName: 'Ghost', publicUrl: 'http://127.0.0.1:4799', protocolVersion: 'globalhub-fed/1', capabilities: ['rfq.receive'], publicScopes: ['products'], lastHeartbeatAt: new Date(Date.now() - 30 * 86400_000) } });
    const item = await A.prisma.federationOutbox.create({ data: { targetNodeId: ghost.id, type: 'rfq', payload: {}, idempotencyKey: 'ghost-1' } });
    await maintenanceJobs['federation-outbox'](A.core);
    const after = await A.prisma.federationOutbox.findUniqueOrThrow({ where: { id: item.id } });
    expect(after).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(after.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    const hk = await maintenanceJobs['federation-housekeeping'](A.core);
    expect(hk.markedStale).toBeGreaterThanOrEqual(1);
    expect((await A.prisma.node.findUniqueOrThrow({ where: { id: ghost.id } })).status).toBe('STALE');
  });
});

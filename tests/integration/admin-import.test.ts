import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestEnv, Client, signUp, makeAdmin, supplierWithProduct, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await createTestEnv(); });
afterAll(async () => { await env.app.close(); await env.prisma.$disconnect(); });

async function supplierStore() {
  const s = await signUp(env, 'SUPPLIER');
  const store = await s.post('/stores', { name: 'Import Store', slug: `imp-${randomUUID().slice(0, 8)}` });
  return { s, storeId: store.body.id as string };
}

describe('scenario 4: CSV import with errors → fix → publish', () => {
  it('previews with errors, commits valid rows, detects duplicates and rolls back', async () => {
    const { s, storeId } = await supplierStore();
    await env.prisma.category.upsert({ where: { slug: 'tents' }, update: {}, create: { slug: 'tents', nameEn: 'Tents' } });
    const bad = 'sku,title_en,price,currency,stock,moq,category,ships_to,status\nT-1,Tent,99.00,USD,10,2,tents,JP|US,ACTIVE\nT-1,Dup,1,USD,1,1,,,\nT-3,,1,USD,1,1,,,\nT-4,Bad price,9.999,USD,1,1,,,\n';
    const p1 = await s.post('/imports/preview', { storeId, filename: 'bad.csv', csv: bad });
    expect(p1.status).toBe(200);
    expect(p1.body.validRows).toBe(1);
    expect(p1.body.errors.map((e: any) => e.field)).toEqual(expect.arrayContaining(['sku', 'title_en', 'price']));

    const good = 'sku,title_en,price,currency,stock,moq,category,ships_to,status,specs\nT-1,Tent,99.00,USD,100,2,tents,JP|US,ACTIVE,color:green|weight:2kg\nT-2,Tarp,12.50,USD,,5,,,ACTIVE,\nT-5,Custom bottle,3.20,USD,,500,,,MADE_TO_ORDER,\n';
    const p2 = await s.post('/imports/preview', { storeId, filename: 'good.csv', csv: good });
    expect(p2.body.errors).toHaveLength(0);
    const commit = await s.post(`/imports/${p2.body.jobId}/commit`, { publish: true });
    expect(commit.body.created).toBe(3);
    expect((await s.post(`/imports/${p2.body.jobId}/commit`, {})).status).toBe(400); // not twice
    const products = await env.prisma.product.findMany({ where: { storeId }, include: { variants: { include: { inventory: true } } } });
    const t1 = products.find((p) => p.variants[0].sku === 'T-1')!;
    expect(t1).toMatchObject({ status: 'ACTIVE', basePriceMinor: 9900, moq: 2, stockStatus: 'IN_STOCK' });
    expect(t1.variants[0].inventory!.source).toBe('IMPORT');
    expect(products.find((p) => p.variants[0].sku === 'T-2')!.stockStatus).toBe('UNVERIFIED');
    expect(products.find((p) => p.variants[0].sku === 'T-5')!.stockStatus).toBe('MADE_TO_ORDER');
    expect((await new Client(env.app).get('/products?q=Tarp')).body.total).toBe(1);

    const again = await s.post('/imports/preview', { storeId, filename: 'again.csv', csv: good });
    expect(again.body.errors.filter((e: any) => /already exists/.test(e.message))).toHaveLength(3);

    const other = await signUp(env, 'SUPPLIER');
    expect((await other.post('/imports/preview', { storeId, filename: 'x.csv', csv: good })).status).toBe(403);
    expect((await other.post(`/imports/${p2.body.jobId}/rollback`)).status).toBe(404);

    const rb = await s.post(`/imports/${p2.body.jobId}/rollback`);
    expect(rb.body).toEqual({ deleted: 3, archived: 0 });
    expect(await env.prisma.product.count({ where: { storeId } })).toBe(0);
  });
});

describe('connectors', () => {
  it('declares real capabilities and refuses unsupported operations', async () => {
    const { s, storeId } = await supplierStore();
    const c = await s.post('/connectors', { storeId, type: 'mock', name: 'Demo ERP', secret: 'erp-secret-key' });
    expect(c.status).toBe(201);
    expect(c.body.capabilityMatrix).toMatchObject({ getInventory: true, createOrder: false, cancelOrder: false });
    const cred = await env.prisma.connectorCredential.findUniqueOrThrow({ where: { connectorId: c.body.id } });
    expect(cred.ciphertext).not.toContain('erp-secret-key');
    const { integrations } = await import('@globalhub/core');
    await expect(integrations.connectorCreateOrder(env.core, { id: s.user!.id, roles: ['SUPPLIER'], status: 'ACTIVE' }, c.body.id, 'ref', [{ sku: 'X', quantity: 1 }], 'JP')).rejects.toMatchObject({ code: 'NOT_SUPPORTED' });
  });
});

describe('admin back office', () => {
  it('manages users, supplier verification, nodes, settings and audit logs', async () => {
    const admin = await makeAdmin(env);
    const { supplier } = await supplierWithProduct(env);
    const prof = (await supplier.get('/seller/profile')).body;
    expect((await admin.post(`/admin/suppliers/${prof.id}/verification`, { status: 'BUSINESS_VERIFIED' })).status).toBe(400); // no business details yet
    await supplier.post('/seller/profile/business-details', { legalName: 'Test Co Ltd', registrationNumber: 'REG-0001234', registeredAddress: '1 Example Street, Rotterdam', contactName: 'Alex' });
    const v = await admin.post(`/admin/suppliers/${prof.id}/verification`, { status: 'ADMIN_REVIEWED', note: 'Docs checked' });
    expect(v.body.verificationStatus).toBe('ADMIN_REVIEWED');
    expect((await new Client(env.app).get('/suppliers?verifiedOnly=true')).body.items.map((x: any) => x.id)).toContain(prof.id);

    const u = await signUp(env, 'BUYER');
    expect((await admin.patch(`/admin/users/${u.user!.id}`, { status: 'DISABLED' })).body.status).toBe('DISABLED');
    expect((await u.get('/users/me')).status).toBe(401); // sessions revoked
    expect((await admin.patch(`/admin/users/${admin.user!.id}`, { status: 'DISABLED' })).status).toBe(400);
    expect((await admin.patch(`/admin/users/${u.user!.id}`, { addRoles: ['MODERATOR'] })).body.roles).toContain('MODERATOR');

    const settings = await admin.get('/admin/settings');
    expect(settings.body.environment).toMatchObject({ paymentProvider: 'mock', paymentIsDemo: true });
    expect((await admin.put('/admin/settings/AUTH_SECRET', { value: 'x' })).status).toBe(400);
    expect((await admin.put('/admin/settings/site.announcement', { value: 'Hello' })).status).toBe(200);

    const dash = await admin.get('/admin/dashboard');
    expect(dash.body.counts.products).toBeGreaterThan(0);
    expect(dash.body.health.database).toBe(true);
    const logs = await admin.get('/admin/audit-logs');
    expect(logs.body.items.some((l: any) => l.action === 'admin.supplier_verification')).toBe(true);
    expect(JSON.stringify(logs.body)).not.toMatch(/correct-horse-battery/);
    const job = await admin.post('/admin/jobs/expire-quotes/run');
    expect(job.body.job).toBe('expire-quotes');
    const mod = await signUp(env, 'BUYER');
    const role = await env.prisma.role.findUniqueOrThrow({ where: { key: 'MODERATOR' } });
    await env.prisma.userRole.create({ data: { userId: mod.user!.id, roleId: role.id } });
    expect((await mod.get('/admin/reports')).status).toBe(200);
    expect((await mod.get('/admin/users')).status).toBe(403);
  });

  it('rate limits return a structured 429', async () => {
    const limited = await createTestEnv({ AUTH_RATE_LIMIT_MAX: '2' });
    const c = new Client(limited.app);
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push(await c.post('/auth/login', { email: 'x@y.example', password: 'nope' }));
    expect(codes[2].status).toBe(429);
    expect(codes[2].body.error.code).toBe('RATE_LIMITED');
    await limited.app.close(); await limited.prisma.$disconnect();
  });
});

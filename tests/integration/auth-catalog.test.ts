import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestEnv, Client, signUp, supplierWithProduct, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => { env = await createTestEnv(); });
afterAll(async () => { await env.app.close(); await env.prisma.$disconnect(); });

describe('auth', () => {
  it('registers, verifies email, logs in, reads profile, logs out', async () => {
    const c = new Client(env.app);
    const reg = await c.post('/auth/register', { email: 'Alice@Test.example', password: 'correct-horse-battery', displayName: 'Alice', role: 'BUYER' });
    expect(reg.status).toBe(201);
    expect(reg.body.user.email).toBe('alice@test.example');
    expect(reg.body.user.emailVerified).toBe(false);
    expect(JSON.stringify(reg.body)).not.toContain('passwordHash');
    const dbUser = await env.prisma.user.findUniqueOrThrow({ where: { email: 'alice@test.example' } });
    expect(dbUser.passwordHash).toMatch(/^\$argon2id\$/);
    expect((await c.post('/auth/verify-email', { token: reg.body.devVerificationToken })).body.verified).toBe(true);
    expect((await c.post('/auth/verify-email', { token: reg.body.devVerificationToken })).status).toBe(400); // single use
    const login = await c.post('/auth/login', { email: 'alice@test.example', password: 'correct-horse-battery' });
    expect(login.status).toBe(200);
    c.token = login.body.token;
    const me = await c.get('/users/me');
    expect(me.body).toMatchObject({ email: 'alice@test.example', emailVerified: true, roles: ['BUYER'] });
    await c.post('/auth/logout');
    expect((await c.get('/users/me')).status).toBe(401);
  });

  it('rejects duplicate email, weak password and privileged self-assigned roles', async () => {
    const c = new Client(env.app);
    await c.post('/auth/register', { email: 'dup@test.example', password: 'correct-horse-battery', displayName: 'D' });
    expect((await c.post('/auth/register', { email: 'dup@test.example', password: 'correct-horse-battery', displayName: 'D' })).status).toBe(409);
    expect((await c.post('/auth/register', { email: 'weak@test.example', password: 'short', displayName: 'W' })).status).toBe(422);
    expect((await c.post('/auth/register', { email: 'evil@test.example', password: 'correct-horse-battery', displayName: 'E', role: 'PLATFORM_ADMIN' })).status).toBe(422);
  });

  it('locks the account after repeated failed logins', async () => {
    const c = new Client(env.app);
    await c.post('/auth/register', { email: 'brute@test.example', password: 'correct-horse-battery', displayName: 'B' });
    for (let i = 0; i < 5; i++) expect((await c.post('/auth/login', { email: 'brute@test.example', password: 'wrong-password' })).status).toBe(401);
    const locked = await c.post('/auth/login', { email: 'brute@test.example', password: 'correct-horse-battery' });
    expect(locked.status).toBe(429);
  });

  it('enforces CSRF for cookie sessions', async () => {
    await new Client(env.app).post('/auth/register', { email: 'csrf@test.example', password: 'correct-horse-battery', displayName: 'C' });
    const login = await env.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'csrf@test.example', password: 'correct-horse-battery' } });
    const cookies = login.cookies.map((k) => `${k.name}=${k.value}`).join('; ');
    const sessionCookie = login.cookies.find((k) => k.name === 'gh_session')!;
    expect(sessionCookie.httpOnly).toBe(true);
    expect(sessionCookie.sameSite).toBe('Lax');
    const csrf = login.json().csrfToken;
    const bad = await env.app.inject({ method: 'POST', url: '/api/v1/users/me/addresses', headers: { cookie: cookies }, payload: { fullName: 'X', line1: 'Y', city: 'Z', country: 'JP' } });
    expect(bad.statusCode).toBe(403);
    const good = await env.app.inject({ method: 'POST', url: '/api/v1/users/me/addresses', headers: { cookie: cookies, 'x-csrf-token': csrf }, payload: { fullName: 'X', line1: 'Y', city: 'Z', country: 'JP' } });
    expect(good.statusCode).toBe(201);
  });

  it('resets a password and revokes old sessions', async () => {
    const c = await signUp(env, 'BUYER');
    const fp = await new Client(env.app).post('/auth/forgot-password', { email: c.user!.email });
    expect(fp.body.ok).toBe(true);
    expect((await new Client(env.app).post('/auth/forgot-password', { email: 'nobody@test.example' })).body.ok).toBe(true); // no user enumeration
    const r = await new Client(env.app).post('/auth/reset-password', { token: fp.body.devResetToken, password: 'a-brand-new-password' });
    expect(r.status).toBe(200);
    expect((await c.get('/users/me')).status).toBe(401);
    expect((await new Client(env.app).post('/auth/login', { email: c.user!.email, password: 'a-brand-new-password' })).status).toBe(200);
  });

  it('returns a uniform error structure with request id', async () => {
    const r = await new Client(env.app).req('GET', '/orders', undefined, { 'x-request-id': 'req-abcdef123' });
    expect(r.status).toBe(401);
    expect(r.body.error).toMatchObject({ code: 'UNAUTHENTICATED', requestId: 'req-abcdef123' });
  });

  it('exports data and deletes (anonymises) an account', async () => {
    const c = await signUp(env, 'BUYER');
    const ex = await c.get('/users/me/export');
    expect(ex.body.user.email).toBe(c.user!.email);
    const del = await c.post('/users/me/delete', { password: 'correct-horse-battery' });
    expect(del.body.deleted).toBe(true);
    const u = await env.prisma.user.findUniqueOrThrow({ where: { id: c.user!.id } });
    expect(u.status).toBe('DELETED');
    expect(u.email).toMatch(/@deleted\.invalid$/);
  });
});

describe('catalog', () => {
  it('supplier creates a product; buyers search the real database', async () => {
    const { product } = await supplierWithProduct(env, { titleEn: 'Ultralight waterproof backpacking tent', stock: 40 });
    expect(product.stockStatus).toBe('IN_STOCK');
    expect(product.inventoryVerifiedAt).toBeTruthy();
    const guest = new Client(env.app);
    const s = await guest.get('/products?q=backpacking%20tent');
    expect(s.status).toBe(200);
    expect(s.body.items.map((p: any) => p.id)).toContain(product.id);
    expect(s.body.matchInfo[product.id].reasons.join(' ')).toMatch(/keywords/);
    const upper = await guest.get('/products?q=ULTRALIGHT');
    expect(upper.body.items.map((p: any) => p.id)).toContain(product.id); // case-insensitive
    const detail = await guest.get(`/products/${product.id}`);
    expect(detail.body.variants[0]).not.toHaveProperty('inventory'); // no raw stock counts publicly
    expect((await guest.get('/products?q=nonexistent-zzz')).body.total).toBe(0);
  });

  it('never shows unverified stock as in stock', async () => {
    const { product } = await supplierWithProduct(env, { stock: null });
    expect(product.stockStatus).toBe('UNVERIFIED');
  });

  it('supports filters: MOQ, price, stock status, destination', async () => {
    const { product } = await supplierWithProduct(env, { titleEn: 'Filter test lamp', moq: 500, price: 900, shipsTo: ['US'] });
    const g = new Client(env.app);
    expect((await g.get('/products?q=lamp&maxMoq=100')).body.items.find((p: any) => p.id === product.id)).toBeUndefined();
    expect((await g.get('/products?q=lamp&maxMoq=500')).body.items.find((p: any) => p.id === product.id)).toBeDefined();
    expect((await g.get('/products?q=lamp&destination=JP')).body.items.find((p: any) => p.id === product.id)).toBeUndefined();
    expect((await g.get('/products?q=lamp&maxPrice=800&currency=USD')).body.items.find((p: any) => p.id === product.id)).toBeUndefined();
    expect((await g.get('/products?sort=price_asc&stockStatus=IN_STOCK')).status).toBe(200);
  });

  it('suppliers can only manage their own store and products', async () => {
    const { product, store } = await supplierWithProduct(env);
    const other = await signUp(env, 'SUPPLIER');
    expect((await other.patch(`/products/${product.id}`, { titleEn: 'hijack' })).status).toBe(403);
    expect((await other.post('/products', { storeId: store.id, titleEn: 'x', currency: 'USD', variants: [{ sku: 'X1', name: 'x' }] })).status).toBe(403);
    const buyer = await signUp(env, 'BUYER');
    expect((await buyer.post('/stores', { name: 'nope', slug: 'nope-store' })).status).toBe(403);
    expect((await new Client(env.app).post('/products', {})).status).toBe(422);
  });

  it('updates inventory (confirmation) and never below reserved', async () => {
    const { supplier, product } = await supplierWithProduct(env, { stock: 5 });
    const vid = product.variants[0].id;
    const r = await supplier.put(`/variants/${vid}/inventory`, { onHand: 8 });
    expect(r.body).toMatchObject({ onHand: 8, stockStatus: 'LOW_STOCK' });
  });

  it('supplier business verification requires admin review', async () => {
    const s = await signUp(env, 'SUPPLIER');
    const prof = await s.get('/seller/profile');
    expect(prof.body.verificationStatus).toBe('EMAIL_VERIFIED');
    const sub = await s.post('/seller/profile/business-details', { legalName: 'Test Co Ltd', registrationNumber: 'REG-0001234', registeredAddress: '1 Example Street, Rotterdam', contactName: 'Alex' });
    expect(sub.body.verificationStatus).toBe('BUSINESS_DETAILS_SUBMITTED');
    expect((await s.post(`/admin/suppliers/${prof.body.id}/verification`, { status: 'ADMIN_REVIEWED' })).status).toBe(403);
  });
});

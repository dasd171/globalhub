import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, createCore, auth, type Core } from '@globalhub/core';
import { createPrismaClient, type PrismaClient } from '@globalhub/database';
import { buildApp } from '../../apps/api/src/app.js';

export const DB_A = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5432/globalhub_test';
export const DB_B = process.env.TEST_DATABASE_URL_B ?? 'postgresql://postgres@127.0.0.1:5432/globalhub_node_b';

export async function resetDb(prisma: PrismaClient) {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_prisma_migrations','Role','Permission','RolePermission')`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(',')} RESTART IDENTITY CASCADE`);
}

export interface TestEnv { core: Core; app: FastifyInstance; prisma: PrismaClient }

export async function createTestEnv(env: Record<string, string> = {}, dbUrl = DB_A): Promise<TestEnv> {
  const config = loadConfig({
    NODE_ENV: 'test', DATABASE_URL: dbUrl, AUTH_SECRET: 'test-secret-0123456789abcdef', LOG_LEVEL: 'silent', RATE_LIMIT_MAX: '100000', AUTH_RATE_LIMIT_MAX: '100000',
    STORAGE_LOCAL_DIR: mkdtempSync(join(tmpdir(), 'globalhub-test-')), MOCK_PAYMENT_WEBHOOK_SECRET: 'test-webhook-secret', ...env,
  } as never);
  const prisma = createPrismaClient(dbUrl);
  const core = createCore(config, { prisma, log: { info() {}, warn() {}, error() {} } });
  await resetDb(prisma);
  await auth.ensureRoles(core);
  const app = await buildApp(core, { logger: process.env.TEST_LOG ? { level: 'error' } : false });
  return { core, app, prisma };
}

export class Client {
  token?: string;
  user?: { id: string; email: string; roles: string[] };
  constructor(private app: FastifyInstance) {}
  async req<T = any>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T }> {
    const res = await this.app.inject({ method: method as never, url: `/api/v1${url}`, payload: body as never, headers: { ...(this.token ? { authorization: `Bearer ${this.token}` } : {}), ...headers } });
    let parsed: any;
    try { parsed = res.json(); } catch { parsed = res.body; }
    return { status: res.statusCode, body: parsed };
  }
  get<T = any>(url: string) { return this.req<T>('GET', url); }
  post<T = any>(url: string, body: unknown = {}) { return this.req<T>('POST', url, body); }
  patch<T = any>(url: string, body: unknown = {}) { return this.req<T>('PATCH', url, body); }
  put<T = any>(url: string, body: unknown = {}) { return this.req<T>('PUT', url, body); }
}

export async function signUp(env: TestEnv, role: 'BUYER' | 'SUPPLIER' | 'AGENT' = 'BUYER', extra: Record<string, unknown> = {}) {
  const c = new Client(env.app);
  const email = `${role.toLowerCase()}-${randomUUID().slice(0, 8)}@test.example`;
  const password = 'correct-horse-battery';
  const r = await c.post('/auth/register', { email, password, displayName: `${role} user`, role, companyName: role === 'SUPPLIER' ? `Factory ${email}` : undefined, country: 'JP', ...extra });
  if (r.status !== 201) throw new Error(`register failed ${r.status} ${JSON.stringify(r.body)}`);
  await c.post('/auth/verify-email', { token: r.body.devVerificationToken });
  const l = await c.post('/auth/login', { email, password });
  c.token = l.body.token; c.user = l.body.user;
  return c;
}

export async function makeAdmin(env: TestEnv) {
  const c = await signUp(env, 'BUYER');
  const role = await env.prisma.role.findUniqueOrThrow({ where: { key: 'PLATFORM_ADMIN' } });
  await env.prisma.userRole.create({ data: { userId: c.user!.id, roleId: role.id } });
  return c;
}

export async function supplierWithProduct(env: TestEnv, opts: { stock?: number | null; moq?: number; price?: number; titleEn?: string; shipsTo?: string[]; tiers?: unknown[] } = {}) {
  const s = await signUp(env, 'SUPPLIER');
  const slug = `store-${randomUUID().slice(0, 8)}`;
  const store = await s.post('/stores', { name: 'Test Store', slug, shipsFrom: 'Rotterdam, NL' });
  if (store.status !== 201) throw new Error(JSON.stringify(store.body));
  const p = await s.post('/products', {
    storeId: store.body.id, titleEn: opts.titleEn ?? 'Waterproof camping tent', descriptionEn: 'Polyester 3000mm tent', currency: 'USD', status: 'ACTIVE',
    moq: opts.moq ?? 1, basePriceMinor: opts.price ?? 2500, shipsTo: opts.shipsTo ?? [], priceTiers: opts.tiers ?? [],
    variants: [{ sku: `SKU-${randomUUID().slice(0, 6)}`, name: 'Standard', stock: opts.stock === null ? undefined : opts.stock ?? 100, weightGrams: 2000 }],
  });
  if (p.status !== 201) throw new Error(JSON.stringify(p.body));
  return { supplier: s, store: store.body, product: p.body };
}

export async function addAddress(c: Client, country = 'JP') {
  const r = await c.post('/users/me/addresses', { fullName: 'Taro Buyer', line1: '1-1 Chiyoda', city: 'Tokyo', postalCode: '100-0001', country, isDefault: true });
  return r.body.id as string;
}

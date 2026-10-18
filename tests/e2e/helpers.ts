import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

export const API_A = 'http://127.0.0.1:4000/api/v1';
export const API_B = 'http://127.0.0.1:4002/api/v1';
const PG = process.env.E2E_PG ?? 'postgresql://postgres@127.0.0.1:5432';
export const dbA = () => new PrismaClient({ datasources: { db: { url: `${PG}/globalhub_e2e_a` } } });
export const dbB = () => new PrismaClient({ datasources: { db: { url: `${PG}/globalhub_e2e_b` } } });
export const PASSWORD = 'correct-horse-battery';

export async function api(base: string, method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

/** Register + verify + login through the API; returns bearer token and user. */
export async function apiUser(base: string, role: 'BUYER' | 'SUPPLIER' | 'AGENT', extra: Record<string, unknown> = {}) {
  const email = `${role.toLowerCase()}-${randomUUID().slice(0, 8)}@e2e.example`;
  const r = await api(base, 'POST', '/auth/register', { email, password: PASSWORD, displayName: `E2E ${role}`, role, companyName: role === 'SUPPLIER' ? `E2E Factory ${email.slice(9, 13)}` : undefined, ...extra });
  expect(r.status).toBe(201);
  await api(base, 'POST', '/auth/verify-email', { token: r.body.devVerificationToken });
  const l = await api(base, 'POST', '/auth/login', { email, password: PASSWORD });
  return { email, token: l.body.token as string, user: l.body.user };
}

export async function supplierProduct(base: string, opts: { title: string; stock?: number; price?: number; moq?: number; currency?: string } ) {
  const s = await apiUser(base, 'SUPPLIER');
  const store = await api(base, 'POST', '/stores', { name: 'E2E Store', slug: `e2e-${randomUUID().slice(0, 8)}`, shipsFrom: 'Rotterdam, NL' }, s.token);
  const p = await api(base, 'POST', '/products', { storeId: store.body.id, titleEn: opts.title, descriptionEn: `${opts.title} for e2e testing`, currency: opts.currency ?? 'USD', status: 'ACTIVE', moq: opts.moq ?? 1, basePriceMinor: opts.price ?? 1999, variants: [{ sku: `E2E-${randomUUID().slice(0, 6)}`, name: 'Standard', stock: opts.stock ?? 100, weightGrams: 1500 }] }, s.token);
  expect(p.status).toBe(201);
  return { supplier: s, product: p.body };
}

export async function loginUI(page: Page, email: string, password = PASSWORD, next = '/buyer') {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(password);
  await page.getByRole('button', { name: /Sign in/ }).click();
  await page.waitForURL((u) => u.pathname.startsWith(next.split('?')[0]));
}

export async function grantRole(db: PrismaClient, userId: string, key: 'PLATFORM_ADMIN' | 'NODE_ADMIN' | 'MODERATOR') {
  const role = await db.role.findUniqueOrThrow({ where: { key } });
  await db.userRole.upsert({ where: { userId_roleId: { userId, roleId: role.id } }, update: {}, create: { userId, roleId: role.id } });
}

import { hash, verify } from '@node-rs/argon2';
import type { z } from 'zod';
import { AppError, type RoleKey, type registerSchema, SELF_ASSIGNABLE_ROLES } from '@globalhub/shared';
import type { Core, Actor, RequestMeta } from '../context.js';
import { randomToken, sha256 } from '../crypto.js';
import { audit } from './audit.js';
import { notify } from './notifications.js';

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const; // OWASP argon2id baseline
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export const hashPassword = (pw: string) => hash(pw, ARGON);
export const verifyPassword = (h: string, pw: string) => verify(h, pw).catch(() => false);

export async function ensureRoles(core: Core) {
  const { ROLE_PERMISSIONS, PERMISSIONS } = await import('@globalhub/shared');
  for (const key of PERMISSIONS) await core.prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  const perms = await core.prisma.permission.findMany();
  for (const [key, list] of Object.entries(ROLE_PERMISSIONS) as [RoleKey, string[]][]) {
    const role = await core.prisma.role.upsert({ where: { key }, update: {}, create: { key, description: key } });
    for (const p of perms.filter((x) => list.includes(x.key))) {
      await core.prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } }, update: {}, create: { roleId: role.id, permissionId: p.id } });
    }
  }
}

async function roleId(core: Core, key: RoleKey) {
  const r = await core.prisma.role.findUnique({ where: { key } });
  if (r) return r.id;
  await ensureRoles(core);
  return (await core.prisma.role.findUniqueOrThrow({ where: { key } })).id;
}

export function publicUser(u: { id: string; email: string; displayName: string; locale: string; preferredCurrency: string; status: string; emailVerifiedAt: Date | null; createdAt: Date }, roles: RoleKey[]) {
  return { id: u.id, email: u.email, displayName: u.displayName, locale: u.locale, preferredCurrency: u.preferredCurrency, status: u.status, emailVerified: !!u.emailVerifiedAt, roles, createdAt: u.createdAt };
}

async function issueToken(core: Core, userId: string, type: 'EMAIL_VERIFY' | 'PASSWORD_RESET', hours: number) {
  const token = randomToken(32);
  await core.prisma.emailToken.create({ data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + hours * 3600_000) } });
  return token;
}

export async function register(core: Core, input: z.infer<typeof registerSchema>, meta: RequestMeta = {}) {
  if (!SELF_ASSIGNABLE_ROLES.includes(input.role)) throw new AppError('FORBIDDEN', 'Role cannot be self-assigned');
  const existing = await core.prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new AppError('CONFLICT', 'An account with this email already exists');
  const passwordHash = await hashPassword(input.password);
  const rid = await roleId(core, input.role);
  const buyerRid = await roleId(core, 'BUYER');
  const user = await core.prisma.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { email: input.email, passwordHash, displayName: input.displayName, locale: input.locale } });
    const roleIds = [...new Set([rid, buyerRid])]; // every account can buy
    await tx.userRole.createMany({ data: roleIds.map((r) => ({ userId: u.id, roleId: r })) });
    await tx.buyerProfile.create({ data: { userId: u.id, companyName: input.companyName, country: input.country } });
    if (input.role === 'SUPPLIER') await tx.supplierProfile.create({ data: { userId: u.id, companyName: input.companyName || input.displayName } });
    await audit(core, { actorId: u.id, action: 'auth.register', targetType: 'User', targetId: u.id, metadata: { role: input.role }, meta }, tx);
    return u;
  });
  const token = await issueToken(core, user.id, 'EMAIL_VERIFY', 48);
  await notify(core, { userId: user.id, type: 'auth.verify_email', title: 'Verify your GlobalHub email', body: `Confirm your email address to finish setting up your account.`, link: `/verify-email?token=${token}` });
  const roles: RoleKey[] = input.role === 'BUYER' ? ['BUYER'] : ['BUYER', input.role];
  return { user: publicUser(user, roles), devVerificationToken: core.config.isProduction ? undefined : token };
}

export async function login(core: Core, email: string, password: string, meta: RequestMeta & { userAgent?: string } = {}) {
  const user = await core.prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: { roles: { include: { role: true } } } });
  const generic = new AppError('UNAUTHENTICATED', 'Invalid email or password');
  if (!user || user.status === 'DELETED') { await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$wTQ5vKC0kw4F+3MeFrLzQFZU6WnOkV3XOSZZa3D3n9E', password); throw generic; }
  if (user.lockedUntil && user.lockedUntil > new Date()) throw new AppError('RATE_LIMITED', 'Too many failed attempts. Try again later.');
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    await core.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: failed >= MAX_FAILED ? 0 : failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null } });
    if (failed >= MAX_FAILED) await audit(core, { actorId: user.id, action: 'auth.locked', targetType: 'User', targetId: user.id, meta });
    throw generic;
  }
  if (user.status !== 'ACTIVE') throw new AppError('FORBIDDEN', 'This account is disabled');
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  await core.prisma.$transaction([
    core.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } }),
    core.prisma.userSession.create({ data: { userId: user.id, tokenHash: sha256(token), csrfToken, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300), expiresAt: new Date(Date.now() + core.config.SESSION_TTL_HOURS * 3600_000) } }),
  ]);
  await audit(core, { actorId: user.id, action: 'auth.login', targetType: 'User', targetId: user.id, meta });
  return { token, csrfToken, expiresInSeconds: core.config.SESSION_TTL_HOURS * 3600, user: publicUser(user, user.roles.map((r) => r.role.key)) };
}

export async function resolveSession(core: Core, token: string | undefined | null): Promise<(Actor & { sessionId: string; csrfToken: string }) | null> {
  if (!token || token.length > 200) return null;
  const s = await core.prisma.userSession.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: { roles: { include: { role: true } } } } } });
  if (!s || s.revokedAt || s.expiresAt < new Date() || s.user.status !== 'ACTIVE') return null;
  return { id: s.user.id, roles: s.user.roles.map((r) => r.role.key), status: s.user.status, email: s.user.email, displayName: s.user.displayName, locale: s.user.locale, sessionId: s.id, csrfToken: s.csrfToken };
}

export async function logout(core: Core, sessionId: string) {
  await core.prisma.userSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

async function consumeToken(core: Core, token: string, type: 'EMAIL_VERIFY' | 'PASSWORD_RESET') {
  const t = await core.prisma.emailToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!t || t.type !== type || t.usedAt || t.expiresAt < new Date()) throw new AppError('BAD_REQUEST', 'Invalid or expired token');
  await core.prisma.emailToken.update({ where: { id: t.id }, data: { usedAt: new Date() } });
  return t;
}

export async function verifyEmail(core: Core, token: string) {
  const t = await consumeToken(core, token, 'EMAIL_VERIFY');
  await core.prisma.user.update({ where: { id: t.userId }, data: { emailVerifiedAt: new Date() } });
  // Email verification only proves control of the inbox — it does NOT verify a business.
  await core.prisma.supplierProfile.updateMany({ where: { userId: t.userId, verificationStatus: 'UNVERIFIED' }, data: { verificationStatus: 'EMAIL_VERIFIED' } });
  await audit(core, { actorId: t.userId, action: 'auth.email_verified', targetType: 'User', targetId: t.userId });
  return { verified: true };
}

export async function forgotPassword(core: Core, email: string) {
  const user = await core.prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== 'ACTIVE') return { ok: true as const };
  const token = await issueToken(core, user.id, 'PASSWORD_RESET', 1);
  await notify(core, { userId: user.id, type: 'auth.password_reset', title: 'Reset your GlobalHub password', body: 'Use this link within 1 hour to reset your password. If you did not request this, ignore this message.', link: `/reset-password?token=${token}` });
  return { ok: true as const, devResetToken: core.config.isProduction ? undefined : token };
}

export async function resetPassword(core: Core, token: string, password: string, meta: RequestMeta = {}) {
  const t = await consumeToken(core, token, 'PASSWORD_RESET');
  await core.prisma.$transaction([
    core.prisma.user.update({ where: { id: t.userId }, data: { passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null } }),
    core.prisma.userSession.updateMany({ where: { userId: t.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit(core, { actorId: t.userId, action: 'auth.password_reset', targetType: 'User', targetId: t.userId, meta });
  return { ok: true };
}

export async function changePassword(core: Core, actor: Actor, current: string, next: string, keepSessionId: string) {
  const u = await core.prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await verifyPassword(u.passwordHash, current))) throw new AppError('UNAUTHENTICATED', 'Current password is incorrect');
  await core.prisma.$transaction([
    core.prisma.user.update({ where: { id: actor.id }, data: { passwordHash: await hashPassword(next) } }),
    core.prisma.userSession.updateMany({ where: { userId: actor.id, revokedAt: null, NOT: { id: keepSessionId } }, data: { revokedAt: new Date() } }),
  ]);
  await audit(core, { actorId: actor.id, action: 'auth.password_changed', targetType: 'User', targetId: actor.id });
  return { ok: true };
}

/** GDPR-style export of the caller's own data. */
export async function exportMyData(core: Core, actor: Actor) {
  const id = actor.id;
  const [user, addresses, requests, orders, messages, reviews, notifications] = await Promise.all([
    core.prisma.user.findUniqueOrThrow({ where: { id }, select: { id: true, email: true, displayName: true, locale: true, preferredCurrency: true, createdAt: true, buyerProfile: true, supplierProfile: true, agentProfile: true } }),
    core.prisma.shippingAddress.findMany({ where: { userId: id } }),
    core.prisma.buyingRequest.findMany({ where: { buyerId: id } }),
    core.prisma.order.findMany({ where: { buyerId: id }, include: { items: true, fees: true } }),
    core.prisma.message.findMany({ where: { senderId: id } }),
    core.prisma.review.findMany({ where: { authorId: id } }),
    core.prisma.notification.findMany({ where: { userId: id } }),
  ]);
  return { exportedAt: new Date().toISOString(), user, addresses, buyingRequests: requests, orders, messages, reviews, notifications };
}

/**
 * Account deletion: personal data is anonymised and sessions revoked. Order and payment
 * records are retained (legal/accounting) but detached from personal identifiers.
 */
export async function deleteMyAccount(core: Core, actor: Actor, password: string, meta: RequestMeta = {}) {
  const u = await core.prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await verifyPassword(u.passwordHash, password))) throw new AppError('UNAUTHENTICATED', 'Password is incorrect');
  const open = await core.prisma.order.count({ where: { buyerId: actor.id, status: { in: ['PAID', 'PROCESSING', 'READY_TO_SHIP', 'SHIPPED', 'IN_TRANSIT', 'DISPUTED', 'REFUND_REQUESTED'] } } });
  if (open > 0) throw new AppError('CONFLICT', 'You have open paid orders or disputes. Resolve them before deleting your account.');
  await core.prisma.$transaction([
    core.prisma.user.update({ where: { id: actor.id }, data: { status: 'DELETED', email: `deleted-${actor.id}@deleted.invalid`, displayName: 'Deleted user', passwordHash: await hashPassword(randomToken(32)), deletionRequestedAt: new Date() } }),
    core.prisma.userSession.updateMany({ where: { userId: actor.id }, data: { revokedAt: new Date() } }),
    core.prisma.shippingAddress.deleteMany({ where: { userId: actor.id } }),
    core.prisma.buyerProfile.updateMany({ where: { userId: actor.id }, data: { companyName: null, country: null } }),
    core.prisma.buyingRequest.updateMany({ where: { buyerId: actor.id, status: 'OPEN' }, data: { status: 'CANCELLED' } }),
  ]);
  await audit(core, { actorId: actor.id, action: 'auth.account_deleted', targetType: 'User', targetId: actor.id, meta });
  return { deleted: true };
}

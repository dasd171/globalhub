import { connect } from 'node:net';
import type { Prisma } from '@globalhub/database';
import { AppError, notFound, type RoleKey } from '@globalhub/shared';
import type { Core, Actor, RequestMeta } from '../context.js';
import { requirePermission, pageResult, paginate } from './guards.js';
import { audit } from './audit.js';
import { notify } from './notifications.js';
import { publicUser } from './auth.js';

export async function listUsers(core: Core, actor: Actor, q: { page: number; pageSize: number; search?: string; role?: RoleKey; status?: 'ACTIVE' | 'DISABLED' | 'DELETED' }) {
  requirePermission(actor, 'admin:users');
  const where: Prisma.UserWhereInput = {
    ...(q.search ? { OR: [{ email: { contains: q.search, mode: 'insensitive' } }, { displayName: { contains: q.search, mode: 'insensitive' } }] } : {}),
    ...(q.role ? { roles: { some: { role: { key: q.role } } } } : {}),
    ...(q.status ? { status: q.status } : {}),
    NOT: { email: { endsWith: '@federation.invalid' } },
  };
  const [items, total] = await Promise.all([
    core.prisma.user.findMany({ where, include: { roles: { include: { role: true } } }, orderBy: { createdAt: 'desc' }, ...paginate(q.page, q.pageSize) }),
    core.prisma.user.count({ where }),
  ]);
  return pageResult(items.map((u) => publicUser(u, u.roles.map((r) => r.role.key))), total, q.page, q.pageSize);
}

export async function adminUpdateUser(core: Core, actor: Actor, userId: string, input: { status?: 'ACTIVE' | 'DISABLED'; addRoles?: RoleKey[]; removeRoles?: RoleKey[] }, meta?: RequestMeta) {
  requirePermission(actor, 'admin:users');
  const u = await core.prisma.user.findUnique({ where: { id: userId }, include: { roles: { include: { role: true } } } });
  if (!u || u.status === 'DELETED') throw notFound('User');
  if (userId === actor.id && (input.status === 'DISABLED' || input.removeRoles?.includes('PLATFORM_ADMIN'))) throw new AppError('BAD_REQUEST', 'You cannot disable yourself or remove your own admin role');
  if (input.removeRoles?.includes('PLATFORM_ADMIN')) {
    const admins = await core.prisma.userRole.count({ where: { role: { key: 'PLATFORM_ADMIN' }, user: { status: 'ACTIVE' } } });
    if (admins <= 1) throw new AppError('BAD_REQUEST', 'Cannot remove the last platform admin');
  }
  await core.prisma.$transaction(async (tx) => {
    if (input.status) {
      await tx.user.update({ where: { id: userId }, data: { status: input.status } });
      if (input.status === 'DISABLED') await tx.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    for (const key of input.addRoles ?? []) {
      const role = await tx.role.findUniqueOrThrow({ where: { key } });
      await tx.userRole.upsert({ where: { userId_roleId: { userId, roleId: role.id } }, update: {}, create: { userId, roleId: role.id } });
    }
    if (input.removeRoles?.length) await tx.userRole.deleteMany({ where: { userId, role: { key: { in: input.removeRoles } } } });
    await audit(core, { actorId: actor.id, action: 'admin.user_updated', targetType: 'User', targetId: userId, metadata: input, meta }, tx);
  });
  const fresh = await core.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { roles: { include: { role: true } } } });
  return publicUser(fresh, fresh.roles.map((r) => r.role.key));
}

export async function listSuppliersForAdmin(core: Core, actor: Actor, status?: string) {
  requirePermission(actor, 'admin:suppliers');
  return core.prisma.supplierProfile.findMany({ where: { remoteNodeId: null, ...(status ? { verificationStatus: status as never } : {}) }, include: { user: { select: { email: true, displayName: true, emailVerifiedAt: true } }, _count: { select: { stores: true, orders: true } } }, orderBy: { updatedAt: 'desc' }, take: 200 });
}

/**
 * Verification is decided by completed checks: BUSINESS_VERIFIED / ADMIN_REVIEWED require
 * submitted business details and a verified email; nothing is auto-promoted.
 */
export async function setSupplierVerification(core: Core, actor: Actor, supplierId: string, status: 'UNVERIFIED' | 'EMAIL_VERIFIED' | 'BUSINESS_DETAILS_SUBMITTED' | 'BUSINESS_VERIFIED' | 'ADMIN_REVIEWED' | 'SUSPENDED', note?: string, meta?: RequestMeta) {
  requirePermission(actor, 'admin:suppliers');
  const s = await core.prisma.supplierProfile.findUnique({ where: { id: supplierId }, include: { user: true } });
  if (!s) throw notFound('Supplier');
  if ((status === 'BUSINESS_VERIFIED' || status === 'ADMIN_REVIEWED') && (!s.businessDetails || !s.user.emailVerifiedAt)) {
    throw new AppError('BAD_REQUEST', 'Supplier must have a verified email and submitted business details before business verification');
  }
  if (status === 'EMAIL_VERIFIED' && !s.user.emailVerifiedAt) throw new AppError('BAD_REQUEST', 'Email is not verified');
  const u = await core.prisma.supplierProfile.update({ where: { id: supplierId }, data: { verificationStatus: status, verifiedAt: ['BUSINESS_VERIFIED', 'ADMIN_REVIEWED'].includes(status) ? new Date() : s.verifiedAt } });
  await audit(core, { actorId: actor.id, action: 'admin.supplier_verification', targetType: 'SupplierProfile', targetId: supplierId, metadata: { from: s.verificationStatus, to: status, note }, meta });
  await notify(core, { userId: s.userId, type: 'supplier.verification', title: `Supplier verification: ${status.replace(/_/g, ' ').toLowerCase()}`, body: note ?? 'Your verification status was updated by an administrator.' });
  return u;
}

export async function setAgentVerification(core: Core, actor: Actor, agentId: string, status: 'UNVERIFIED' | 'BUSINESS_VERIFIED' | 'ADMIN_REVIEWED' | 'SUSPENDED', meta?: RequestMeta) {
  requirePermission(actor, 'admin:suppliers');
  const a = await core.prisma.agentProfile.update({ where: { id: agentId }, data: { verificationStatus: status } });
  await audit(core, { actorId: actor.id, action: 'admin.agent_verification', targetType: 'AgentProfile', targetId: agentId, metadata: { status }, meta });
  return a;
}

export async function adminListProducts(core: Core, actor: Actor, q: { page: number; pageSize: number; search?: string }) {
  requirePermission(actor, 'admin:catalog');
  const where: Prisma.ProductWhereInput = q.search ? { OR: [{ titleEn: { contains: q.search, mode: 'insensitive' } }, { titleZh: { contains: q.search } }] } : {};
  const [items, total] = await Promise.all([core.prisma.product.findMany({ where, include: { store: { select: { name: true } } }, orderBy: { updatedAt: 'desc' }, ...paginate(q.page, q.pageSize) }), core.prisma.product.count({ where })]);
  return pageResult(items, total, q.page, q.pageSize);
}

export async function adminSetProductStatus(core: Core, actor: Actor, id: string, status: 'ACTIVE' | 'ARCHIVED' | 'DRAFT', meta?: RequestMeta) {
  requirePermission(actor, 'admin:catalog');
  const p = await core.prisma.product.update({ where: { id }, data: { status } });
  await audit(core, { actorId: actor.id, action: 'admin.product_status', targetType: 'Product', targetId: id, metadata: { status }, meta });
  return p;
}

export async function adminListBuyingRequests(core: Core, actor: Actor) {
  requirePermission(actor, 'moderation:content');
  return core.prisma.buyingRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, title: true, status: true, visibility: true, quantity: true, destinationCountry: true, createdAt: true, originNodeId: true, _count: { select: { quotes: true } } } });
}

export async function adminListConnectors(core: Core, actor: Actor) {
  requirePermission(actor, 'admin:catalog');
  return core.prisma.connector.findMany({ select: { id: true, name: true, type: true, capabilities: true, status: true, lastSyncAt: true, lastError: true, store: { select: { name: true } } }, orderBy: { createdAt: 'desc' } });
}

export async function adminSetConnectorStatus(core: Core, actor: Actor, id: string, status: 'ACTIVE' | 'DISABLED', meta?: RequestMeta) {
  requirePermission(actor, 'admin:catalog');
  const c = await core.prisma.connector.update({ where: { id }, data: { status } });
  await audit(core, { actorId: actor.id, action: 'admin.connector_status', targetType: 'Connector', targetId: id, metadata: { status }, meta });
  return c;
}

export async function listAuditLogs(core: Core, actor: Actor, q: { page: number; pageSize: number; action?: string; actorId?: string }) {
  requirePermission(actor, 'admin:audit');
  const where: Prisma.AuditLogWhereInput = { ...(q.action ? { action: { startsWith: q.action } } : {}), ...(q.actorId ? { actorId: q.actorId } : {}) };
  const [items, total] = await Promise.all([core.prisma.auditLog.findMany({ where, include: { actor: { select: { email: true } } }, orderBy: { createdAt: 'desc' }, ...paginate(q.page, q.pageSize) }), core.prisma.auditLog.count({ where })]);
  return pageResult(items, total, q.page, q.pageSize);
}

export async function listRiskEvents(core: Core, actor: Actor) {
  requirePermission(actor, 'admin:audit');
  return core.prisma.auditLog.findMany({ where: { OR: [{ action: { startsWith: 'risk.' } }, { action: 'auth.locked' }] }, orderBy: { createdAt: 'desc' }, take: 200 });
}

const SAFE_SETTINGS = ['site.announcement', 'orders.autoCompleteDays', 'federation.autoSync', 'marketplace.defaultCurrency'] as const;
export async function getSettings(core: Core, actor: Actor) {
  requirePermission(actor, 'admin:settings');
  const rows = await core.prisma.systemSetting.findMany({ where: { key: { in: [...SAFE_SETTINGS] } } });
  return {
    editable: Object.fromEntries(SAFE_SETTINGS.map((k) => [k, rows.find((r) => r.key === k)?.value ?? null])),
    environment: {
      nodeEnv: core.config.NODE_ENV, demoMode: core.config.DEMO_MODE, paymentProvider: core.payment.name, paymentIsDemo: core.payment.isDemo, shippingProvider: core.shipping.name,
      shippingIsDemo: core.shipping.isDemo, aiProvider: core.ai.name, emailProvider: core.email.name, storage: core.storage.name, federationEnabled: core.config.FEDERATION_ENABLED, nodeId: core.config.NODE_ID,
    },
  };
}
export async function setSetting(core: Core, actor: Actor, key: string, value: unknown, meta?: RequestMeta) {
  requirePermission(actor, 'admin:settings');
  if (!(SAFE_SETTINGS as readonly string[]).includes(key)) throw new AppError('BAD_REQUEST', 'Unknown setting (secrets are configured via environment variables only)');
  const s = await core.prisma.systemSetting.upsert({ where: { key }, update: { value: value as Prisma.InputJsonValue }, create: { key, value: value as Prisma.InputJsonValue } });
  await audit(core, { actorId: actor.id, action: 'admin.setting_changed', targetType: 'SystemSetting', targetId: key, metadata: { value }, meta });
  return s;
}

function pingRedis(url: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const sock = connect({ host: u.hostname, port: Number(u.port || 6379) });
      const done = (ok: boolean) => { sock.destroy(); resolve(ok); };
      sock.setTimeout(timeoutMs, () => done(false));
      sock.on('error', () => done(false));
      sock.on('connect', () => { if (u.password) sock.write(`AUTH ${decodeURIComponent(u.password)}\r\n`); sock.write('PING\r\n'); });
      sock.on('data', (d) => { if (d.toString().includes('PONG')) done(true); });
    } catch { resolve(false); }
  });
}

export async function systemHealth(core: Core) {
  let db = false;
  try { await core.prisma.$queryRaw`SELECT 1`; db = true; } catch { db = false; }
  const redis = await pingRedis(core.config.REDIS_URL);
  const worker = await core.prisma.systemSetting.findUnique({ where: { key: 'worker.heartbeat' } }).catch(() => null);
  const w = worker?.value as { at?: string; queues?: Record<string, unknown> } | undefined;
  const workerAlive = !!w?.at && Date.now() - new Date(w.at).getTime() < 5 * 60_000;
  return { status: db ? 'ok' : 'degraded', database: db, redis, worker: { alive: workerAlive, lastHeartbeat: w?.at ?? null, queues: w?.queues ?? null }, time: new Date().toISOString() };
}

export async function adminDashboard(core: Core, actor: Actor) {
  requirePermission(actor, 'admin:system');
  const [users, suppliers, products, openRequests, orders, openDisputes, openReports, nodes, pendingVerification] = await Promise.all([
    core.prisma.user.count({ where: { status: 'ACTIVE', NOT: { email: { endsWith: '@federation.invalid' } } } }),
    core.prisma.supplierProfile.count({ where: { remoteNodeId: null } }),
    core.prisma.product.count({ where: { status: 'ACTIVE' } }),
    core.prisma.buyingRequest.count({ where: { status: 'OPEN' } }),
    core.prisma.order.groupBy({ by: ['status'], _count: true }),
    core.prisma.dispute.count({ where: { status: { in: ['OPEN', 'AWAITING_BUYER', 'AWAITING_SUPPLIER', 'UNDER_REVIEW'] } } }),
    core.prisma.report.count({ where: { status: 'OPEN' } }),
    core.prisma.node.count({ where: { isLocal: false } }),
    core.prisma.supplierProfile.count({ where: { verificationStatus: 'BUSINESS_DETAILS_SUBMITTED' } }),
  ]);
  return { counts: { users, suppliers, products, openRequests, openDisputes, openReports, nodes, pendingVerification }, ordersByStatus: Object.fromEntries(orders.map((o) => [o.status, o._count])), health: await systemHealth(core) };
}

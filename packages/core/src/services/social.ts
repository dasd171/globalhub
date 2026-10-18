import type { z } from 'zod';
import { AppError, notFound, forbidden, type conversationSchema, type addressSchema, type agentProfileSchema, type agentTaskSchema, type agentTaskUpdateSchema, type reportSchema } from '@globalhub/shared';
import type { Core, Actor, RequestMeta } from '../context.js';
import { requireActor, requirePermission, has, isAdmin, pageResult, paginate } from './guards.js';
import { notify } from './notifications.js';
import { audit } from './audit.js';

// ───────────── Messaging ─────────────

async function counterpartFor(core: Core, actor: Actor, input: z.infer<typeof conversationSchema>): Promise<string> {
  if (input.subject === 'ORDER' && input.orderId) {
    const o = await core.prisma.order.findUnique({ where: { id: input.orderId }, include: { supplier: true } });
    if (!o) throw notFound('Order');
    if (o.buyerId === actor.id) return o.supplier.userId;
    if (o.supplier.userId === actor.id) return o.buyerId;
    throw notFound('Order');
  }
  if (input.subject === 'PRODUCT_INQUIRY' && input.productId) {
    const p = await core.prisma.product.findUnique({ where: { id: input.productId }, include: { store: { include: { supplier: true } } } });
    if (!p || p.status !== 'ACTIVE') throw notFound('Product');
    return p.store.supplier.userId;
  }
  if (input.subject === 'BUYING_REQUEST' && input.buyingRequestId) {
    const r = await core.prisma.buyingRequest.findUnique({ where: { id: input.buyingRequestId } });
    if (!r || !r.buyerId) throw notFound('Buying request');
    if (r.buyerId !== actor.id) {
      if (!has(actor, 'buying_request:read_public') || r.visibility === 'PRIVATE') throw notFound('Buying request');
      return r.buyerId;
    }
    if (!input.recipientUserId) throw new AppError('BAD_REQUEST', 'recipientUserId required');
    // Buyer may only message suppliers who quoted on this request.
    const quoted = await core.prisma.quote.findFirst({ where: { buyingRequestId: r.id, submitterId: input.recipientUserId, status: { not: 'DRAFT' } } });
    if (!quoted) throw forbidden('You can message suppliers who quoted on your request');
    return input.recipientUserId;
  }
  throw new AppError('BAD_REQUEST', 'Conversation needs a related order, product or buying request');
}

export async function startConversation(core: Core, actor: Actor, input: z.infer<typeof conversationSchema>) {
  requirePermission(actor, 'message:send');
  const other = await counterpartFor(core, actor, input);
  if (other === actor.id) throw new AppError('BAD_REQUEST', 'Cannot message yourself');
  if (await core.prisma.userBlock.findFirst({ where: { OR: [{ blockerId: other, blockedId: actor.id }, { blockerId: actor.id, blockedId: other }] } })) throw forbidden('Messaging is blocked between these users');
  const existing = await core.prisma.conversation.findFirst({
    where: { subject: input.subject, orderId: input.orderId ?? null, productId: input.productId ?? null, buyingRequestId: input.buyingRequestId ?? null, AND: [{ participants: { some: { userId: actor.id } } }, { participants: { some: { userId: other } } }] },
  });
  const conv = existing ?? await core.prisma.conversation.create({
    data: { subject: input.subject, orderId: input.orderId, productId: input.productId, buyingRequestId: input.buyingRequestId, participants: { create: [{ userId: actor.id, lastReadAt: new Date() }, { userId: other }] } },
  });
  await sendMessage(core, actor, conv.id, { body: input.body });
  return conv;
}

async function assertParticipant(core: Core, actor: Actor, conversationId: string) {
  const p = await core.prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId: actor.id } } });
  if (!p) throw notFound('Conversation');
  return p;
}

export async function sendMessage(core: Core, actor: Actor, conversationId: string, input: { body: string; attachmentKey?: string; attachmentName?: string }) {
  requirePermission(actor, 'message:send');
  await assertParticipant(core, actor, conversationId);
  const others = await core.prisma.conversationParticipant.findMany({ where: { conversationId, NOT: { userId: actor.id } } });
  if (await core.prisma.userBlock.findFirst({ where: { OR: others.flatMap((o) => [{ blockerId: o.userId, blockedId: actor.id }, { blockerId: actor.id, blockedId: o.userId }]) } })) throw forbidden('Messaging is blocked');
  const msg = await core.prisma.message.create({ data: { conversationId, senderId: actor.id, body: input.body, attachmentKey: input.attachmentKey, attachmentName: input.attachmentName } });
  await core.prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: msg.createdAt } });
  await core.prisma.conversationParticipant.update({ where: { conversationId_userId: { conversationId, userId: actor.id } }, data: { lastReadAt: msg.createdAt } });
  for (const o of others) await notify(core, { userId: o.userId, type: 'message.new', title: `New message from ${actor.displayName ?? 'a user'}`, body: input.body.slice(0, 200), link: `/messages/${conversationId}`, email: false });
  return msg;
}

export async function listConversations(core: Core, actor: Actor) {
  requireActor(actor);
  const parts = await core.prisma.conversationParticipant.findMany({
    where: { userId: actor.id },
    include: { conversation: { include: { participants: { include: { user: { select: { id: true, displayName: true } } } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } } } },
    orderBy: { conversation: { lastMessageAt: 'desc' } }, take: 100,
  });
  const out = [];
  let totalUnread = 0;
  for (const p of parts) {
    const unread = await core.prisma.message.count({ where: { conversationId: p.conversationId, senderId: { not: actor.id }, createdAt: { gt: p.lastReadAt ?? new Date(0) } } });
    totalUnread += unread;
    out.push({ id: p.conversationId, subject: p.conversation.subject, orderId: p.conversation.orderId, productId: p.conversation.productId, buyingRequestId: p.conversation.buyingRequestId, participants: p.conversation.participants.map((x) => x.user), lastMessage: p.conversation.messages[0] ?? null, unread });
  }
  return { items: out, totalUnread };
}

export async function getMessages(core: Core, actor: Actor, conversationId: string, after?: Date) {
  await assertParticipant(core, actor, conversationId);
  const messages = await core.prisma.message.findMany({ where: { conversationId, ...(after ? { createdAt: { gt: after } } : {}) }, include: { sender: { select: { id: true, displayName: true } } }, orderBy: { createdAt: 'asc' }, take: 500 });
  await core.prisma.conversationParticipant.update({ where: { conversationId_userId: { conversationId, userId: actor.id } }, data: { lastReadAt: new Date() } });
  const others = await core.prisma.conversationParticipant.findMany({ where: { conversationId, NOT: { userId: actor.id } } });
  return { messages: messages.map((m) => ({ ...m, readByOthers: others.every((o) => o.lastReadAt && o.lastReadAt >= m.createdAt) })) };
}

export async function blockUser(core: Core, actor: Actor, userId: string) {
  if (userId === actor.id) throw new AppError('BAD_REQUEST', 'Cannot block yourself');
  await core.prisma.userBlock.upsert({ where: { blockerId_blockedId: { blockerId: actor.id, blockedId: userId } }, update: {}, create: { blockerId: actor.id, blockedId: userId } });
  return { blocked: true };
}
export async function unblockUser(core: Core, actor: Actor, userId: string) {
  await core.prisma.userBlock.deleteMany({ where: { blockerId: actor.id, blockedId: userId } });
  return { blocked: false };
}

// ───────────── Reports ─────────────

export async function createReport(core: Core, actor: Actor, input: z.infer<typeof reportSchema>) {
  requireActor(actor);
  if (input.targetType === 'MESSAGE') {
    const m = await core.prisma.message.findUnique({ where: { id: input.targetId } });
    if (!m) throw notFound('Message');
    await assertParticipant(core, actor, m.conversationId);
    await core.prisma.message.update({ where: { id: m.id }, data: { reportedAt: new Date() } });
  }
  return core.prisma.report.create({ data: { reporterId: actor.id, targetType: input.targetType, targetId: input.targetId, reason: input.reason } });
}

export async function listReports(core: Core, actor: Actor, status?: 'OPEN' | 'ACTIONED' | 'DISMISSED') {
  requirePermission(actor, 'moderation:reports');
  return core.prisma.report.findMany({ where: status ? { status } : {}, include: { reporter: { select: { displayName: true, email: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
}

export async function handleReport(core: Core, actor: Actor, id: string, status: 'ACTIONED' | 'DISMISSED', meta?: RequestMeta) {
  requirePermission(actor, 'moderation:reports');
  const r = await core.prisma.report.update({ where: { id }, data: { status, handledById: actor.id } });
  await audit(core, { actorId: actor.id, action: 'moderation.report_handled', targetType: 'Report', targetId: id, metadata: { status }, meta });
  return r;
}

// ───────────── Addresses / favorites / sourcing lists ─────────────

export async function listAddresses(core: Core, actor: Actor) { return core.prisma.shippingAddress.findMany({ where: { userId: actor.id }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] }); }
export async function createAddress(core: Core, actor: Actor, input: z.infer<typeof addressSchema>) {
  requireActor(actor);
  if (input.isDefault) await core.prisma.shippingAddress.updateMany({ where: { userId: actor.id }, data: { isDefault: false } });
  return core.prisma.shippingAddress.create({ data: { ...input, userId: actor.id } });
}
export async function deleteAddress(core: Core, actor: Actor, id: string) {
  const r = await core.prisma.shippingAddress.deleteMany({ where: { id, userId: actor.id } });
  if (!r.count) throw notFound('Address');
  return { deleted: true };
}

export async function toggleFavorite(core: Core, actor: Actor, input: { productId?: string; supplierId?: string }) {
  requireActor(actor);
  if (!!input.productId === !!input.supplierId) throw new AppError('BAD_REQUEST', 'Provide productId or supplierId');
  const where = input.productId ? { userId_productId: { userId: actor.id, productId: input.productId } } : { userId_supplierId: { userId: actor.id, supplierId: input.supplierId! } };
  const existing = await core.prisma.favorite.findUnique({ where: where as never });
  if (existing) { await core.prisma.favorite.delete({ where: { id: existing.id } }); return { favorited: false }; }
  if (input.productId && !(await core.prisma.product.findUnique({ where: { id: input.productId } }))) throw notFound('Product');
  if (input.supplierId && !(await core.prisma.supplierProfile.findUnique({ where: { id: input.supplierId } }))) throw notFound('Supplier');
  await core.prisma.favorite.create({ data: { userId: actor.id, ...input } });
  return { favorited: true };
}
export async function listFavorites(core: Core, actor: Actor) {
  const favs = await core.prisma.favorite.findMany({ where: { userId: actor.id }, include: { product: { select: { id: true, titleEn: true, titleZh: true, currency: true, basePriceMinor: true, stockStatus: true } } }, orderBy: { createdAt: 'desc' } });
  const supplierIds = favs.filter((f) => f.supplierId).map((f) => f.supplierId!);
  const suppliers = await core.prisma.supplierProfile.findMany({ where: { id: { in: supplierIds } }, select: { id: true, companyName: true, verificationStatus: true } });
  return { products: favs.filter((f) => f.product).map((f) => f.product), suppliers };
}

export async function getOrCreateDefaultList(core: Core, actor: Actor) {
  return (await core.prisma.sourcingList.findFirst({ where: { buyerId: actor.id }, orderBy: { createdAt: 'asc' } })) ?? core.prisma.sourcingList.create({ data: { buyerId: actor.id, name: 'My sourcing list' } });
}
export async function addToSourcingList(core: Core, actor: Actor, productId: string, quantity: number, note?: string) {
  requireActor(actor);
  const p = await core.prisma.product.findUnique({ where: { id: productId } });
  if (!p || p.status !== 'ACTIVE') throw notFound('Product');
  const list = await getOrCreateDefaultList(core, actor);
  return core.prisma.sourcingListItem.upsert({ where: { listId_productId: { listId: list.id, productId } }, update: { quantity, note }, create: { listId: list.id, productId, quantity, note } });
}
export async function getSourcingList(core: Core, actor: Actor) {
  const list = await getOrCreateDefaultList(core, actor);
  return core.prisma.sourcingList.findUniqueOrThrow({ where: { id: list.id }, include: { items: { include: { product: { select: { id: true, titleEn: true, titleZh: true, moq: true, currency: true, basePriceMinor: true, stockStatus: true, store: { select: { name: true } } } } } } } });
}
export async function removeFromSourcingList(core: Core, actor: Actor, productId: string) {
  const list = await getOrCreateDefaultList(core, actor);
  await core.prisma.sourcingListItem.deleteMany({ where: { listId: list.id, productId } });
  return { removed: true };
}

// ───────────── Sourcing agents ─────────────

export async function upsertAgentProfile(core: Core, actor: Actor, input: z.infer<typeof agentProfileSchema>) {
  requirePermission(actor, 'agent:manage_own');
  const p = await core.prisma.agentProfile.upsert({ where: { userId: actor.id }, update: input, create: { ...input, userId: actor.id } });
  await audit(core, { actorId: actor.id, action: 'agent.profile_updated', targetType: 'AgentProfile', targetId: p.id });
  return p;
}
export async function getMyAgentProfile(core: Core, actor: Actor) { return core.prisma.agentProfile.findUnique({ where: { userId: actor.id } }); }

const publicAgentSelect = { id: true, displayName: true, serviceRegions: true, languages: true, services: true, feeStructure: true, capabilities: true, maxOrderValueMinor: true, currency: true, verificationStatus: true, isDemo: true, createdAt: true } as const;

export async function listAgents(core: Core, q: { page: number; pageSize: number; service?: string; region?: string; verifiedOnly?: boolean }) {
  const where = {
    verificationStatus: q.verifiedOnly ? { in: ['BUSINESS_VERIFIED', 'ADMIN_REVIEWED'] as never } : { not: 'SUSPENDED' as never },
    ...(q.service ? { services: { has: q.service as never } } : {}),
    ...(q.region ? { serviceRegions: { has: q.region } } : {}),
  };
  const [items, total] = await Promise.all([core.prisma.agentProfile.findMany({ where, select: publicAgentSelect, ...paginate(q.page, q.pageSize), orderBy: { createdAt: 'desc' } }), core.prisma.agentProfile.count({ where })]);
  return pageResult(items, total, q.page, q.pageSize);
}
export async function getAgent(core: Core, id: string) {
  const a = await core.prisma.agentProfile.findFirst({ where: { id, verificationStatus: { not: 'SUSPENDED' } }, select: publicAgentSelect });
  if (!a) throw notFound('Agent');
  const [rating, completed] = await Promise.all([
    core.prisma.review.aggregate({ where: { agentId: id, status: 'PUBLISHED' }, _avg: { rating: true }, _count: true }),
    core.prisma.agentTask.count({ where: { agentId: id, status: 'COMPLETED' } }),
  ]);
  return { ...a, reputation: { averageRating: rating._avg.rating, reviewCount: rating._count, completedTasks: completed } };
}

async function myAgent(core: Core, actor: Actor) {
  requirePermission(actor, 'agent:manage_own');
  const a = await core.prisma.agentProfile.findUnique({ where: { userId: actor.id } });
  if (!a) throw new AppError('FORBIDDEN', 'Create your agent profile first');
  if (a.verificationStatus === 'SUSPENDED') throw forbidden('Agent account suspended');
  return a;
}
export async function createAgentTask(core: Core, actor: Actor, input: z.infer<typeof agentTaskSchema>) {
  const a = await myAgent(core, actor);
  if (input.buyingRequestId) {
    const r = await core.prisma.buyingRequest.findUnique({ where: { id: input.buyingRequestId } });
    if (!r || r.visibility === 'PRIVATE' || r.status !== 'OPEN') throw notFound('Buying request');
  }
  if (input.orderId) {
    const s = await core.prisma.supplierProfile.findUnique({ where: { userId: actor.id } });
    const o = await core.prisma.order.findUnique({ where: { id: input.orderId } });
    if (!o || !s || o.supplierId !== s.id) throw forbidden('You can only attach tasks to orders where you are the quoting party');
  }
  return core.prisma.agentTask.create({ data: { ...input, agentId: a.id } });
}
export async function listAgentTasks(core: Core, actor: Actor) {
  const a = await myAgent(core, actor);
  return core.prisma.agentTask.findMany({ where: { agentId: a.id }, include: { buyingRequest: { select: { id: true, title: true } }, order: { select: { id: true, orderNumber: true, status: true } } }, orderBy: { updatedAt: 'desc' } });
}
export async function updateAgentTask(core: Core, actor: Actor, id: string, input: z.infer<typeof agentTaskUpdateSchema>) {
  const a = await myAgent(core, actor);
  const t = await core.prisma.agentTask.findUnique({ where: { id } });
  if (!t || (t.agentId !== a.id && !isAdmin(actor))) throw notFound('Task');
  return core.prisma.agentTask.update({ where: { id }, data: input });
}

import type { z } from 'zod';
import type { Prisma } from '@globalhub/database';
import { AppError, notFound, forbidden, rankCandidates, type buyingRequestSchema, type MatchCandidate } from '@globalhub/shared';
import type { Core, Actor, RequestMeta } from '../context.js';
import { requirePermission, requireActor, isAdmin, has, pageResult, paginate } from './guards.js';
import { audit } from './audit.js';
import { notify } from './notifications.js';
import { validateUpload } from '../providers/storage.js';

/** Fields any eligible supplier may see. Never includes buyer identity/contact details. */
function publicRequestView(r: Prisma.BuyingRequestGetPayload<{ include: { buyer: { select: { buyerProfile: { select: { country: true } } } }; category: true; originNode: { select: { nodeId: true; displayName: true; trustLevel: true } }; _count: { select: { quotes: true } } } }>, locale = 'en') {
  return {
    id: r.id, title: r.title, description: r.description, translatedZh: r.translatedZh, translatedEn: r.translatedEn, translationStatus: r.translationStatus,
    originalLanguage: r.originalLanguage, structured: r.structured, category: r.category, quantity: r.quantity, unit: r.unit, currency: r.currency,
    targetUnitPriceMinor: r.targetUnitPriceMinor, budgetMinMinor: r.budgetMinMinor, budgetMaxMinor: r.budgetMaxMinor, qualityRequirements: r.qualityRequirements,
    specifications: r.specifications, acceptsCustomization: r.acceptsCustomization, destinationCountry: r.destinationCountry, deliveryBy: r.deliveryBy,
    needsSample: r.needsSample, needsInspection: r.needsInspection, oemOdm: r.oemOdm, needsShippingQuote: r.needsShippingQuote, supplierTypePreference: r.supplierTypePreference,
    otherRequirements: r.otherRequirements, visibility: r.visibility, status: r.status, expiresAt: r.expiresAt, createdAt: r.createdAt, productId: r.productId,
    buyerLabel: r.originNode ? (r.remoteBuyerLabel ?? 'Remote buyer') : `Buyer${r.buyer?.buyerProfile?.country ? ` (${r.buyer.buyerProfile.country})` : ''}`,
    originNode: r.originNode, quoteCount: r._count.quotes, locale,
  };
}

const requestInclude = {
  buyer: { select: { buyerProfile: { select: { country: true } } } },
  category: true,
  originNode: { select: { nodeId: true, displayName: true, trustLevel: true } },
  _count: { select: { quotes: { where: { status: { notIn: ['DRAFT' as const] } } } } },
};

export async function createBuyingRequest(core: Core, actor: Actor, input: z.infer<typeof buyingRequestSchema> & { productId?: string; targetSupplierId?: string; remoteListingId?: string }, meta?: RequestMeta) {
  requirePermission(actor, 'buying_request:create');
  const parsed = await core.ai.parseBuyingRequest(`${input.title}. ${input.description}`);
  const structured = {
    product: parsed.product,
    quantity: input.quantity,
    unit: input.unit,
    destination: input.destinationCountry,
    supplierType: input.supplierTypePreference ?? parsed.supplierType ?? null,
    requirements: parsed.requirements,
    requestedServices: [...new Set([...parsed.requestedServices, ...(input.needsShippingQuote ? ['shipping quotation'] : []), ...(input.needsSample ? ['samples'] : []), ...(input.needsInspection ? ['inspection'] : []), ...(input.oemOdm ? ['OEM/ODM'] : [])])],
    targetPrice: input.targetUnitPriceMinor != null ? { amountMinor: input.targetUnitPriceMinor, currency: input.currency } : null,
    keywords: parsed.keywords,
    parsedBy: parsed.parsedBy,
    status: 'Open for Quotes',
  };
  const { externalRefs, expiresInDays, ...data } = input;
  const r = await core.prisma.buyingRequest.create({
    data: {
      ...data, buyerId: actor.id, structured, status: 'OPEN', expiresAt: new Date(Date.now() + expiresInDays * 86400_000),
      translationStatus: 'ORIGINAL',
      externalRefs: { create: externalRefs },
    },
  });
  await audit(core, { actorId: actor.id, action: 'buying_request.created', targetType: 'BuyingRequest', targetId: r.id, meta });
  if (r.targetSupplierId) {
    const s = await core.prisma.supplierProfile.findUnique({ where: { id: r.targetSupplierId } });
    if (s && !s.remoteNodeId) await notify(core, { userId: s.userId, type: 'rfq.new', title: 'New quote request for your product', body: `${r.title} — ${r.quantity} ${r.unit} to ${r.destinationCountry}`, link: `/seller/requests/${r.id}` });
  } else if (r.visibility !== 'PRIVATE' && r.categoryId) {
    // "New buying request" alerts for suppliers active in the same category.
    const suppliers = await core.prisma.supplierProfile.findMany({ where: { verificationStatus: { not: 'SUSPENDED' }, remoteNodeId: null, stores: { some: { products: { some: { categoryId: r.categoryId, status: 'ACTIVE' } } } } }, take: 50, select: { userId: true } });
    for (const s of suppliers) if (s.userId !== actor.id) await notify(core, { userId: s.userId, type: 'rfq.new', title: 'New buying request in your category', body: `${r.title} — ${r.quantity} ${r.unit}`, link: `/seller/requests/${r.id}` });
  }
  return getBuyingRequest(core, actor, r.id);
}

/** Can this actor see the request at all? */
async function canView(core: Core, actor: Actor | null, r: { buyerId: string | null; visibility: string; targetSupplierId: string | null; status: string }) {
  if (actor && (r.buyerId === actor.id || isAdmin(actor) || has(actor, 'moderation:content'))) return true;
  if (!actor || !has(actor, 'buying_request:read_public')) return false;
  if (r.targetSupplierId) {
    const s = await core.prisma.supplierProfile.findUnique({ where: { userId: actor.id } });
    return s?.id === r.targetSupplierId;
  }
  return r.visibility !== 'PRIVATE';
}

export async function getBuyingRequest(core: Core, actor: Actor | null, id: string, locale = 'en') {
  const r = await core.prisma.buyingRequest.findUnique({ where: { id }, include: { ...requestInclude, attachments: true, externalRefs: true } });
  if (!r || !(await canView(core, actor, r))) throw notFound('Buying request');
  const isOwner = !!actor && r.buyerId === actor.id;
  return {
    ...publicRequestView(r, locale),
    isOwner,
    attachments: r.attachments.map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, sizeBytes: a.sizeBytes, url: `/api/v1/files/${a.storageKey}` })),
    externalRefs: r.externalRefs,
  };
}

/** Sourcing hall: open requests visible to suppliers/agents. */
export async function listOpenRequests(core: Core, actor: Actor, q: { page: number; pageSize: number; q?: string; category?: string; destination?: string }, locale = 'en') {
  requirePermission(actor, 'buying_request:read_public');
  const supplier = await core.prisma.supplierProfile.findUnique({ where: { userId: actor.id } });
  const where: Prisma.BuyingRequestWhereInput = {
    status: 'OPEN', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    AND: [
      { OR: [{ visibility: { in: ['PUBLIC', 'FEDERATED'] }, targetSupplierId: null }, ...(supplier ? [{ targetSupplierId: supplier.id }] : [])] },
      ...(q.q ? [{ OR: [{ title: { contains: q.q, mode: 'insensitive' as const } }, { description: { contains: q.q, mode: 'insensitive' as const } }, { translatedZh: { contains: q.q } }] }] : []),
    ],
    ...(q.category ? { category: { slug: q.category } } : {}),
    ...(q.destination ? { destinationCountry: q.destination } : {}),
    NOT: { buyerId: actor.id },
  };
  const [items, total] = await Promise.all([
    core.prisma.buyingRequest.findMany({ where, include: requestInclude, orderBy: { createdAt: 'desc' }, ...paginate(q.page, q.pageSize) }),
    core.prisma.buyingRequest.count({ where }),
  ]);
  const myQuotes = supplier ? await core.prisma.quote.findMany({ where: { supplierId: supplier.id, buyingRequestId: { in: items.map((i) => i.id) } }, select: { buyingRequestId: true, status: true } }) : [];
  return pageResult(items.map((i) => ({ ...publicRequestView(i, locale), myQuoteStatus: myQuotes.find((m) => m.buyingRequestId === i.id)?.status ?? null })), total, q.page, q.pageSize);
}

export async function listMyRequests(core: Core, actor: Actor, q: { page: number; pageSize: number }) {
  requireActor(actor);
  const where = { buyerId: actor.id };
  const [items, total] = await Promise.all([
    core.prisma.buyingRequest.findMany({ where, include: requestInclude, orderBy: { createdAt: 'desc' }, ...paginate(q.page, q.pageSize) }),
    core.prisma.buyingRequest.count({ where }),
  ]);
  return pageResult(items.map((i) => publicRequestView(i)), total, q.page, q.pageSize);
}

export async function setRequestStatus(core: Core, actor: Actor, id: string, status: 'CLOSED' | 'CANCELLED' | 'OPEN', meta?: RequestMeta) {
  const r = await core.prisma.buyingRequest.findUnique({ where: { id } });
  if (!r) throw notFound('Buying request');
  const moderator = has(actor, 'moderation:content');
  if (r.buyerId !== actor.id && !moderator) throw forbidden();
  if (status === 'OPEN' && r.buyerId !== actor.id) throw forbidden('Only the buyer can reopen');
  if (!['OPEN', 'CLOSED', 'DRAFT'].includes(r.status) && status === 'OPEN') throw new AppError('INVALID_STATE_TRANSITION', `Cannot reopen a ${r.status} request`);
  const u = await core.prisma.buyingRequest.update({ where: { id }, data: { status } });
  await audit(core, { actorId: actor.id, action: moderator && r.buyerId !== actor.id ? 'moderation.request_status' : 'buying_request.status', targetType: 'BuyingRequest', targetId: id, metadata: { status }, meta });
  return u;
}

export async function addRequestAttachment(core: Core, actor: Actor, id: string, file: { buffer: Buffer; filename: string; mimeType: string }) {
  const r = await core.prisma.buyingRequest.findUnique({ where: { id }, include: { _count: { select: { attachments: true } } } });
  if (!r || r.buyerId !== actor.id) throw notFound('Buying request');
  if (r._count.attachments >= 10) throw new AppError('VALIDATION_FAILED', 'At most 10 attachments');
  if (!file.mimeType.startsWith('image/') && file.mimeType !== 'application/pdf') throw new AppError('VALIDATION_FAILED', 'Only images or PDF');
  const { ext } = validateUpload(file.buffer, file.mimeType, core.config.UPLOAD_MAX_BYTES);
  const key = await core.storage.put('rfq', file.buffer, file.mimeType, ext);
  return core.prisma.buyingRequestAttachment.create({ data: { buyingRequestId: id, storageKey: key, filename: file.filename.replace(/[^\w.\- ]/g, '_').slice(0, 150), mimeType: file.mimeType, sizeBytes: file.buffer.length } });
}

/** Match engine: rank local products and federated listings against a buying request. */
export async function matchProductsForRequest(core: Core, actor: Actor, id: string) {
  const r = await core.prisma.buyingRequest.findUnique({ where: { id } });
  if (!r || (r.buyerId !== actor.id && !isAdmin(actor))) throw notFound('Buying request');
  const s = (r.structured ?? {}) as { keywords?: string[]; requirements?: string[]; supplierType?: string };
  const keywords = (s.keywords ?? []).slice(0, 8);
  const textOr = keywords.flatMap((t) => [{ titleEn: { contains: t, mode: 'insensitive' as const } }, { titleZh: { contains: t } }, { descriptionEn: { contains: t, mode: 'insensitive' as const } }]);
  const products = await core.prisma.product.findMany({
    where: { status: 'ACTIVE', ...(textOr.length ? { OR: textOr } : {}), store: { supplier: { verificationStatus: { not: 'SUSPENDED' } } } },
    include: { store: { include: { supplier: true } } }, take: 300,
  });
  const listings = await core.prisma.federatedListing.findMany({ where: { kind: 'PRODUCT', removed: false, node: { status: 'ACTIVE' }, ...(keywords.length ? { OR: keywords.map((k) => ({ title: { contains: k, mode: 'insensitive' as const } })) } : {}) }, include: { node: true }, take: 200 });
  const cands: MatchCandidate[] = [
    ...products.map((p) => ({ id: p.id, title: `${p.titleEn ?? ''} ${p.titleZh ?? ''}`, description: p.descriptionEn, categoryId: p.categoryId, moq: p.moq, unitPriceMinor: p.basePriceMinor, currency: p.currency, stockStatus: p.stockStatus, shipsFrom: p.shipsFrom, shipsTo: p.shipsTo, supplierType: p.store.supplier.supplierType, verification: p.store.supplier.verificationStatus, customizable: p.customizable, specsText: JSON.stringify(p.specs ?? {}), source: 'local' as const })),
    ...listings.map((l) => {
      const d = l.data as { shipsTo?: string[]; customizable?: boolean; supplier?: { type?: string; verification?: string }; summary?: string };
      return { id: l.id, title: l.title, description: l.summary, moq: l.moq ?? 1, unitPriceMinor: l.priceMinor, currency: l.currency, stockStatus: l.stockStatus, shipsTo: d.shipsTo ?? [], customizable: !!d.customizable, supplierType: (d.supplier?.type ?? null) as never, verification: (d.supplier?.verification ?? 'UNVERIFIED') as never, source: 'federated' as const };
    }),
  ];
  const ranked = rankCandidates({
    keywords, categoryId: r.categoryId, quantity: r.quantity, maxUnitPriceMinor: r.targetUnitPriceMinor, currency: r.currency, destinationCountry: r.destinationCountry,
    supplierType: (r.supplierTypePreference ?? s.supplierType ?? null) as never, needsCustomization: r.oemOdm, requiredFeatures: (s.requirements ?? []).filter((x) => x !== 'bulk purchase'),
  }, cands);
  return {
    criteria: { keywords, quantity: r.quantity, destination: r.destinationCountry, targetUnitPriceMinor: r.targetUnitPriceMinor, currency: r.currency },
    results: ranked.slice(0, 30).map((x) => ({ id: x.id, source: x.candidate.source, title: x.candidate.title.trim(), score: x.score, reasons: x.reasons, warnings: x.warnings, moq: x.candidate.moq, unitPriceMinor: x.candidate.unitPriceMinor, currency: x.candidate.currency, stockStatus: x.candidate.stockStatus })),
    suggestion: ranked.length === 0 ? 'No matching products yet — your request stays open for supplier quotes.' : null,
  };
}

/** Buyer asks one supplier for a quote on a specific product (creates a targeted private request). */
export async function requestQuoteForProduct(core: Core, actor: Actor, productId: string, input: { quantity: number; destinationCountry: string; message: string; currency?: string }, meta?: RequestMeta) {
  const p = await core.prisma.product.findUnique({ where: { id: productId }, include: { store: { include: { supplier: true } } } });
  if (!p || p.status !== 'ACTIVE') throw notFound('Product');
  if (p.store.supplier.userId === actor.id) throw new AppError('BAD_REQUEST', 'You cannot request a quote on your own product');
  return createBuyingRequest(core, actor, {
    title: `Quote request: ${p.titleEn ?? p.titleZh ?? 'product'}`.slice(0, 200), description: input.message.length >= 10 ? input.message : `${input.message} (quantity ${input.quantity})`,
    originalLanguage: 'en', quantity: input.quantity, unit: 'units', currency: input.currency ?? p.currency, destinationCountry: input.destinationCountry,
    acceptsCustomization: false, needsSample: false, needsInspection: false, oemOdm: false, needsShippingQuote: true, visibility: 'PRIVATE', expiresInDays: 30, externalRefs: [],
    categoryId: p.categoryId, productId: p.id, targetSupplierId: p.store.supplierId,
  }, meta);
}

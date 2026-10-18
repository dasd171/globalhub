import type { z } from 'zod';
import { Prisma, type PrismaClient } from '@globalhub/database';
import {
  AppError, notFound, forbidden, validateTiers, deriveStockStatus, rankCandidates, parseBuyingRequestText,
  type productSchema, type productUpdateSchema, type productSearchQuery, type storeSchema, type supplierProfileSchema, type businessDetailsSchema, type categorySchema,
  type StockStatus, type MatchCandidate, type NodeTrustLevel,
} from '@globalhub/shared';
import type { Core, Actor, RequestMeta } from '../context.js';
import { requirePermission, isAdmin, pageResult, paginate } from './guards.js';
import { audit } from './audit.js';

type Db = PrismaClient | Prisma.TransactionClient;

// ───────────── Supplier profile & stores ─────────────

export async function getMySupplierProfile(core: Core, actor: Actor) {
  return core.prisma.supplierProfile.findUnique({ where: { userId: actor.id }, include: { stores: true } });
}

export async function upsertSupplierProfile(core: Core, actor: Actor, input: z.infer<typeof supplierProfileSchema>) {
  requirePermission(actor, 'store:manage_own');
  const existing = await core.prisma.supplierProfile.findUnique({ where: { userId: actor.id } });
  const p = existing
    ? await core.prisma.supplierProfile.update({ where: { userId: actor.id }, data: input })
    : await core.prisma.supplierProfile.create({ data: { ...input, userId: actor.id } });
  await audit(core, { actorId: actor.id, action: 'supplier.profile_updated', targetType: 'SupplierProfile', targetId: p.id });
  return p;
}

/** Supplier submits business details. Status becomes BUSINESS_DETAILS_SUBMITTED — only an admin review can mark it verified. */
export async function submitBusinessDetails(core: Core, actor: Actor, input: z.infer<typeof businessDetailsSchema>) {
  requirePermission(actor, 'store:manage_own');
  const p = await core.prisma.supplierProfile.findUnique({ where: { userId: actor.id } });
  if (!p) throw notFound('Supplier profile');
  if (p.verificationStatus === 'SUSPENDED') throw forbidden('Supplier is suspended');
  const keep = ['BUSINESS_VERIFIED', 'ADMIN_REVIEWED'].includes(p.verificationStatus);
  const updated = await core.prisma.supplierProfile.update({ where: { id: p.id }, data: { businessDetails: input, verificationStatus: keep ? p.verificationStatus : 'BUSINESS_DETAILS_SUBMITTED' } });
  await audit(core, { actorId: actor.id, action: 'supplier.business_details_submitted', targetType: 'SupplierProfile', targetId: p.id });
  return updated;
}

export async function requireSupplier(db: Db, actor: Actor) {
  const p = await db.supplierProfile.findUnique({ where: { userId: actor.id } });
  if (!p) throw new AppError('FORBIDDEN', 'Create a supplier profile first');
  if (p.verificationStatus === 'SUSPENDED') throw forbidden('Supplier account is suspended');
  return p;
}

export async function createStore(core: Core, actor: Actor, input: z.infer<typeof storeSchema>) {
  requirePermission(actor, 'store:manage_own');
  const supplier = await requireSupplier(core.prisma, actor);
  try {
    const s = await core.prisma.store.create({ data: { ...input, supplierId: supplier.id } });
    await audit(core, { actorId: actor.id, action: 'store.created', targetType: 'Store', targetId: s.id });
    return s;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new AppError('CONFLICT', 'Store slug already taken');
    throw e;
  }
}

/** Load a store and assert the actor owns it (or is admin). */
export async function assertStoreOwner(db: Db, actor: Actor, storeId: string) {
  const store = await db.store.findUnique({ where: { id: storeId }, include: { supplier: true } });
  if (!store) throw notFound('Store');
  if (store.supplier.userId !== actor.id && !isAdmin(actor)) throw forbidden('You do not own this store');
  if (store.supplier.verificationStatus === 'SUSPENDED' && !isAdmin(actor)) throw forbidden('Supplier account is suspended');
  return store;
}

export async function updateStore(core: Core, actor: Actor, storeId: string, input: Partial<z.infer<typeof storeSchema>>) {
  requirePermission(actor, 'store:manage_own');
  await assertStoreOwner(core.prisma, actor, storeId);
  return core.prisma.store.update({ where: { id: storeId }, data: input });
}

export async function getStoreBySlug(core: Core, slug: string) {
  const s = await core.prisma.store.findUnique({ where: { slug }, include: { supplier: { select: publicSupplierSelect } } });
  if (!s) throw notFound('Store');
  return s;
}

export const publicSupplierSelect = {
  id: true, companyName: true, companyNameZh: true, supplierType: true, province: true, city: true, description: true, verificationStatus: true, isDemo: true, createdAt: true,
} as const;

export async function listSuppliers(core: Core, q: { page: number; pageSize: number; verifiedOnly?: boolean; type?: string; search?: string }) {
  const where: Prisma.SupplierProfileWhereInput = {
    isPublic: true, verificationStatus: q.verifiedOnly ? { in: ['BUSINESS_VERIFIED', 'ADMIN_REVIEWED'] } : { not: 'SUSPENDED' },
    ...(q.type ? { supplierType: q.type as never } : {}),
    ...(q.search ? { OR: [{ companyName: { contains: q.search, mode: 'insensitive' } }, { companyNameZh: { contains: q.search } }] } : {}),
  };
  const [items, total] = await Promise.all([
    core.prisma.supplierProfile.findMany({ where, select: { ...publicSupplierSelect, stores: { select: { id: true, name: true, slug: true } } }, orderBy: { createdAt: 'desc' }, ...paginate(q.page, q.pageSize) }),
    core.prisma.supplierProfile.count({ where }),
  ]);
  return pageResult(items, total, q.page, q.pageSize);
}

export async function getSupplier(core: Core, id: string) {
  const s = await core.prisma.supplierProfile.findFirst({ where: { id, isPublic: true }, select: { ...publicSupplierSelect, stores: { select: { id: true, name: true, slug: true, shipsFrom: true } } } });
  if (!s) throw notFound('Supplier');
  const rating = await core.prisma.review.aggregate({ where: { supplierId: id, status: 'PUBLISHED', target: 'SUPPLIER' }, _avg: { rating: true }, _count: true });
  const completedOrders = await core.prisma.order.count({ where: { supplierId: id, status: 'COMPLETED', isDemo: false } });
  return { ...s, reputation: { averageRating: rating._avg.rating, reviewCount: rating._count, completedOrders } };
}

// ───────────── Categories ─────────────

export async function listCategories(core: Core) {
  return core.prisma.category.findMany({ orderBy: [{ position: 'asc' }, { nameEn: 'asc' }], include: { _count: { select: { products: { where: { status: 'ACTIVE' } } } } } });
}

export async function upsertCategory(core: Core, actor: Actor, input: z.infer<typeof categorySchema>, meta?: RequestMeta) {
  requirePermission(actor, 'admin:catalog');
  const c = await core.prisma.category.upsert({ where: { slug: input.slug }, update: input, create: input });
  await audit(core, { actorId: actor.id, action: 'admin.category_upserted', targetType: 'Category', targetId: c.id, meta });
  return c;
}

// ───────────── Products ─────────────

const productInclude = {
  store: { include: { supplier: { select: publicSupplierSelect } } },
  category: true,
  variants: { include: { inventory: true }, orderBy: { createdAt: 'asc' } },
  priceTiers: { orderBy: { minQty: 'asc' } },
  images: { orderBy: { position: 'asc' } },
  restrictions: true,
} satisfies Prisma.ProductInclude;

export type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

/** Recompute public stock status from verified inventory (never trusts a raw "in stock" flag). */
export async function refreshProductStock(db: Db, productId: string) {
  const p = await db.product.findUniqueOrThrow({ where: { id: productId }, include: { variants: { include: { inventory: true } } } });
  if (p.stockStatus === 'MADE_TO_ORDER' || p.stockStatus === 'ON_REQUEST') return p.stockStatus;
  const invs = p.variants.map((v) => v.inventory).filter((i): i is NonNullable<typeof i> => !!i);
  let status: StockStatus = 'UNVERIFIED';
  if (invs.length) {
    const verifiedAt = invs.every((i) => i.verifiedAt) ? new Date(Math.min(...invs.map((i) => i.verifiedAt!.getTime()))) : null;
    status = deriveStockStatus({ onHand: invs.reduce((a, i) => a + i.onHand, 0), reserved: invs.reduce((a, i) => a + i.reserved, 0), verifiedAt });
  }
  if (status !== p.stockStatus) await db.product.update({ where: { id: productId }, data: { stockStatus: status } });
  return status;
}

export async function createProduct(core: Core, actor: Actor, input: z.infer<typeof productSchema>, meta?: RequestMeta) {
  requirePermission(actor, 'product:manage_own');
  await assertStoreOwner(core.prisma, actor, input.storeId);
  validateTiers(input.priceTiers);
  const skus = input.variants.map((v) => v.sku);
  if (new Set(skus).size !== skus.length) throw new AppError('VALIDATION_FAILED', 'Duplicate SKU in variants');
  if (input.categoryId && !(await core.prisma.category.findUnique({ where: { id: input.categoryId } }))) throw new AppError('VALIDATION_FAILED', 'Unknown category');

  // Content is stored exactly as the supplier entered it; no automatic machine translation.
  const { titleEn, titleZh, descriptionEn, descriptionZh } = input;
  const translationStatus = 'ORIGINAL' as const;

  const now = new Date();
  const product = await core.prisma.$transaction(async (tx) => {
    const p = await tx.product.create({
      data: {
        storeId: input.storeId, categoryId: input.categoryId ?? null, titleEn, titleZh, descriptionEn, descriptionZh, originalLanguage: input.originalLanguage, translationStatus,
        status: input.status, stockStatus: input.stockMode === 'INVENTORY' ? 'UNVERIFIED' : input.stockMode, customizable: input.customizable, oemOdm: input.oemOdm,
        moq: input.moq, currency: input.currency, basePriceMinor: input.basePriceMinor ?? null, leadTimeDays: input.leadTimeDays ?? null, shipsFrom: input.shipsFrom,
        shipsTo: input.shipsTo, shippingMethods: input.shippingMethods, specs: input.specs ?? undefined, hsCode: input.hsCode, originCountry: input.originCountry,
        material: input.material, intendedUse: input.intendedUse, containsBattery: input.containsBattery, dangerousGoods: input.dangerousGoods,
        requiredDocuments: input.requiredDocuments, complianceNotes: input.complianceNotes, isPublic: input.isPublic,
        priceTiers: { create: input.priceTiers.map((t) => ({ minQty: t.minQty, maxQty: t.maxQty ?? null, unitPriceMinor: t.unitPriceMinor })) },
        images: { create: input.imageUrls.map((url, i) => ({ url, position: i })) },
        restrictions: { create: input.restrictedCountries.map((country) => ({ country, blocked: true })) },
      },
    });
    for (const v of input.variants) {
      await tx.productVariant.create({
        data: {
          productId: p.id, sku: v.sku, name: v.name, attributes: v.attributes ?? undefined, priceMinor: v.priceMinor ?? null, weightGrams: v.weightGrams,
          // Entering a stock figure is the supplier's confirmation; no figure = unverified.
          inventory: { create: { onHand: v.stock ?? 0, source: 'NATIVE', verifiedAt: v.stock != null ? now : null } },
        },
      });
    }
    await refreshProductStock(tx, p.id);
    await audit(core, { actorId: actor.id, action: 'product.created', targetType: 'Product', targetId: p.id, meta }, tx);
    return p;
  });
  return getProductForOwner(core, actor, product.id);
}

export async function assertProductOwner(db: Db, actor: Actor, productId: string) {
  const p = await db.product.findUnique({ where: { id: productId }, select: { id: true, storeId: true } });
  if (!p) throw notFound('Product');
  await assertStoreOwner(db, actor, p.storeId);
  return p;
}

export async function updateProduct(core: Core, actor: Actor, productId: string, input: z.infer<typeof productUpdateSchema>, meta?: RequestMeta) {
  requirePermission(actor, 'product:manage_own');
  await assertProductOwner(core.prisma, actor, productId);
  if (input.priceTiers) validateTiers(input.priceTiers);
  const { priceTiers, translationConfirmed, ...rest } = input;
  await core.prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id: productId }, data: { ...rest, ...(translationConfirmed ? { translationStatus: 'USER_CONFIRMED' } : {}) } });
    if (priceTiers) {
      await tx.priceTier.deleteMany({ where: { productId } });
      await tx.priceTier.createMany({ data: priceTiers.map((t) => ({ productId, minQty: t.minQty, maxQty: t.maxQty ?? null, unitPriceMinor: t.unitPriceMinor })) });
    }
    await audit(core, { actorId: actor.id, action: 'product.updated', targetType: 'Product', targetId: productId, metadata: { fields: Object.keys(input) }, meta }, tx);
  });
  return getProductForOwner(core, actor, productId);
}

export async function addVariant(core: Core, actor: Actor, productId: string, v: { sku: string; name: string; attributes?: Record<string, string>; priceMinor?: number | null; stock?: number }) {
  requirePermission(actor, 'product:manage_own');
  await assertProductOwner(core.prisma, actor, productId);
  try {
    await core.prisma.productVariant.create({ data: { productId, sku: v.sku, name: v.name, attributes: v.attributes, priceMinor: v.priceMinor ?? null, inventory: { create: { onHand: v.stock ?? 0, verifiedAt: v.stock != null ? new Date() : null } } } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new AppError('CONFLICT', 'SKU already exists for this product');
    throw e;
  }
  await refreshProductStock(core.prisma, productId);
  return getProductForOwner(core, actor, productId);
}

/** Supplier sets on-hand stock. This is the act of confirming inventory → verifiedAt = now. */
export async function updateInventory(core: Core, actor: Actor, variantId: string, onHand: number, source: 'NATIVE' | 'MANUAL' | 'CONNECTOR' | 'IMPORT', meta?: RequestMeta) {
  requirePermission(actor, 'product:manage_own');
  const v = await core.prisma.productVariant.findUnique({ where: { id: variantId }, include: { inventory: true } });
  if (!v) throw notFound('Variant');
  await assertProductOwner(core.prisma, actor, v.productId);
  const reserved = v.inventory?.reserved ?? 0;
  if (onHand < reserved) throw new AppError('CONFLICT', `Cannot set stock below currently reserved quantity (${reserved})`);
  await core.prisma.inventory.upsert({ where: { variantId }, update: { onHand, source, verifiedAt: new Date() }, create: { variantId, onHand, source, verifiedAt: new Date() } });
  const status = await refreshProductStock(core.prisma, v.productId);
  await audit(core, { actorId: actor.id, action: 'inventory.updated', targetType: 'ProductVariant', targetId: variantId, metadata: { onHand, source }, meta });
  return { variantId, onHand, reserved, stockStatus: status };
}

function reviewSummary(core: Core, productId: string) {
  return core.prisma.review.aggregate({ where: { productId, status: 'PUBLISHED', target: 'PRODUCT' }, _avg: { rating: true }, _count: true });
}

/** Public product view: no raw inventory counts, cost data or private fields. */
export function toPublicProduct(p: ProductWithRelations, _locale = 'en') {
  const verifiedTimes = p.variants.map((v) => v.inventory?.verifiedAt).filter(Boolean) as Date[];
  return {
    id: p.id,
    title: (p.titleEn || p.titleZh) ?? '',
    titleEn: p.titleEn, titleZh: p.titleZh, descriptionEn: p.descriptionEn, descriptionZh: p.descriptionZh,
    originalLanguage: p.originalLanguage, translationStatus: p.translationStatus,
    status: p.status, stockStatus: p.stockStatus,
    inventoryVerifiedAt: verifiedTimes.length ? new Date(Math.min(...verifiedTimes.map((d) => d.getTime()))) : null,
    customizable: p.customizable, oemOdm: p.oemOdm, moq: p.moq, currency: p.currency, basePriceMinor: p.basePriceMinor,
    priceTiers: p.priceTiers.map((t) => ({ minQty: t.minQty, maxQty: t.maxQty, unitPriceMinor: t.unitPriceMinor })),
    leadTimeDays: p.leadTimeDays, shipsFrom: p.shipsFrom, shipsTo: p.shipsTo, shippingMethods: p.shippingMethods,
    specs: p.specs, compliance: {
      hsCode: p.hsCode, originCountry: p.originCountry, material: p.material, intendedUse: p.intendedUse, containsBattery: p.containsBattery,
      dangerousGoods: p.dangerousGoods, requiredDocuments: p.requiredDocuments, complianceNotes: p.complianceNotes,
      restrictedCountries: p.restrictions.filter((r) => r.blocked).map((r) => r.country),
    },
    category: p.category ? { id: p.category.id, slug: p.category.slug, nameEn: p.category.nameEn, nameZh: p.category.nameZh } : null,
    images: p.images.map((i) => ({ id: i.id, url: i.url ?? (i.storageKey ? `/api/v1/files/${i.storageKey}` : null), alt: i.alt })),
    variants: p.variants.map((v) => ({ id: v.id, sku: v.sku, name: v.name, attributes: v.attributes, priceMinor: v.priceMinor, weightGrams: v.weightGrams })),
    store: { id: p.store.id, name: p.store.name, slug: p.store.slug, shipsFrom: p.store.shipsFrom },
    supplier: p.store.supplier,
    isDemo: p.isDemo,
    createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

export async function getProduct(core: Core, actor: Actor | null, productId: string, locale = 'en') {
  const p = await core.prisma.product.findUnique({ where: { id: productId }, include: productInclude });
  if (!p) throw notFound('Product');
  const isOwner = !!actor && (p.store.supplier.id && (await core.prisma.supplierProfile.findFirst({ where: { id: p.store.supplier.id, userId: actor.id } })));
  if ((p.status !== 'ACTIVE' || p.store.supplier.verificationStatus === 'SUSPENDED') && !isOwner && !isAdmin(actor)) throw notFound('Product');
  const r = await reviewSummary(core, p.id);
  return { ...toPublicProduct(p, locale), reputation: { averageRating: r._avg.rating, reviewCount: r._count } };
}

export async function getProductForOwner(core: Core, actor: Actor, productId: string) {
  await assertProductOwner(core.prisma, actor, productId);
  const p = await core.prisma.product.findUniqueOrThrow({ where: { id: productId }, include: productInclude });
  return { ...toPublicProduct(p), isPublic: p.isPublic, variants: p.variants.map((v) => ({ id: v.id, sku: v.sku, name: v.name, attributes: v.attributes, priceMinor: v.priceMinor, inventory: v.inventory ? { onHand: v.inventory.onHand, reserved: v.inventory.reserved, available: v.inventory.onHand - v.inventory.reserved, source: v.inventory.source, verifiedAt: v.inventory.verifiedAt } : null })) };
}

export async function listMyProducts(core: Core, actor: Actor, q: { page: number; pageSize: number; storeId?: string }) {
  requirePermission(actor, 'product:manage_own');
  const supplier = await requireSupplier(core.prisma, actor);
  const where: Prisma.ProductWhereInput = { store: { supplierId: supplier.id }, ...(q.storeId ? { storeId: q.storeId } : {}) };
  const [items, total] = await Promise.all([
    core.prisma.product.findMany({ where, include: productInclude, orderBy: { updatedAt: 'desc' }, ...paginate(q.page, q.pageSize) }),
    core.prisma.product.count({ where }),
  ]);
  return pageResult(items.map((p) => ({ ...toPublicProduct(p), variants: p.variants.map((v) => ({ id: v.id, sku: v.sku, name: v.name, onHand: v.inventory?.onHand ?? 0, reserved: v.inventory?.reserved ?? 0, verifiedAt: v.inventory?.verifiedAt ?? null })) })), total, q.page, q.pageSize);
}

// ───────────── Search (SearchProvider abstraction) ─────────────

export type ProductSearchInput = z.infer<typeof productSearchQuery>;

export interface SearchProvider {
  searchProducts(core: Core, q: ProductSearchInput, locale: string): Promise<{ items: ReturnType<typeof toPublicProduct>[]; total: number; matchInfo: Record<string, { score: number; reasons: string[]; warnings: string[] }> }>;
}

const TRUST_ORDER: NodeTrustLevel[] = ['UNVERIFIED', 'DOMAIN_VERIFIED', 'BUSINESS_VERIFIED', 'ADMIN_REVIEWED'];

/** Default provider: PostgreSQL (ILIKE backed by pg_trgm GIN indexes) + explainable rule scoring. */
export class PostgresSearchProvider implements SearchProvider {
  async searchProducts(core: Core, q: ProductSearchInput, locale: string) {
    const parsed = q.q ? parseBuyingRequestText(q.q) : null;
    const terms = q.q ? (parsed!.keywords.length ? parsed!.keywords : [q.q.trim()]).slice(0, 8) : [];
    const where: Prisma.ProductWhereInput = {
      status: 'ACTIVE',
      store: { ...(q.supplierId ? { supplierId: q.supplierId } : {}), supplier: { verificationStatus: q.verifiedOnly === 'true' ? { in: ['BUSINESS_VERIFIED', 'ADMIN_REVIEWED'] } : { not: 'SUSPENDED' }, ...(q.supplierType ? { supplierType: q.supplierType } : {}) } },
      ...(q.category ? { category: { OR: [{ slug: q.category }, { parent: { slug: q.category } }] } } : {}),
      ...(q.maxMoq ? { moq: { lte: q.maxMoq } } : {}),
      ...(q.stockStatus ? { stockStatus: q.stockStatus } : {}),
      ...(q.customizable === 'true' ? { customizable: true } : {}),
      ...(q.destination ? { AND: [{ OR: [{ shipsTo: { has: q.destination } }, { shipsTo: { isEmpty: true } }] }, { restrictions: { none: { country: q.destination, blocked: true } } }] } : {}),
      ...(q.shipsFrom ? { shipsFrom: { contains: q.shipsFrom, mode: 'insensitive' } } : {}),
      ...(q.minPrice != null || q.maxPrice != null ? { basePriceMinor: { ...(q.minPrice != null ? { gte: q.minPrice } : {}), ...(q.maxPrice != null ? { lte: q.maxPrice } : {}) }, ...(q.currency ? { currency: q.currency } : {}) } : {}),
    };
    if (terms.length) {
      // Each product must match at least one term in some text field.
      where.OR = terms.flatMap((t) => [
        { titleEn: { contains: t, mode: 'insensitive' as const } }, { titleZh: { contains: t } }, { descriptionEn: { contains: t, mode: 'insensitive' as const } },
        { descriptionZh: { contains: t } }, { material: { contains: t, mode: 'insensitive' as const } }, { variants: { some: { sku: { equals: t, mode: 'insensitive' as const } } } },
      ]);
    }
    const orderBy: Prisma.ProductOrderByWithRelationInput =
      q.sort === 'price_asc' ? { basePriceMinor: { sort: 'asc', nulls: 'last' } } : q.sort === 'price_desc' ? { basePriceMinor: { sort: 'desc', nulls: 'last' } } : q.sort === 'moq_asc' ? { moq: 'asc' } : { createdAt: 'desc' };
    const matchInfo: Record<string, { score: number; reasons: string[]; warnings: string[] }> = {};
    if (q.sort === 'relevance' && terms.length) {
      const all = await core.prisma.product.findMany({ where, include: productInclude, take: 500, orderBy: { createdAt: 'desc' } });
      const cands: MatchCandidate[] = all.map((p) => ({
        id: p.id, title: `${p.titleEn ?? ''} ${p.titleZh ?? ''}`, description: `${p.descriptionEn ?? ''} ${p.descriptionZh ?? ''}`, categoryId: p.categoryId, moq: p.moq,
        unitPriceMinor: p.basePriceMinor, currency: p.currency, stockStatus: p.stockStatus, shipsFrom: p.shipsFrom, shipsTo: p.shipsTo,
        supplierType: p.store.supplier.supplierType, verification: p.store.supplier.verificationStatus, customizable: p.customizable,
        specsText: `${p.material ?? ''} ${JSON.stringify(p.specs ?? {})} ${p.variants.map((v) => v.sku).join(' ')}`, source: 'local',
      }));
      const ranked = rankCandidates({ keywords: terms, destinationCountry: q.destination ?? null }, cands);
      const byId = new Map(all.map((p) => [p.id, p]));
      for (const r of ranked) matchInfo[r.id] = { score: r.score, reasons: r.reasons, warnings: r.warnings };
      const pageIds = ranked.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map((r) => r.id);
      return { items: pageIds.map((id) => toPublicProduct(byId.get(id)!, locale)), total: ranked.length, matchInfo };
    }
    const [items, total] = await Promise.all([
      core.prisma.product.findMany({ where, include: productInclude, orderBy, ...paginate(q.page, q.pageSize) }),
      core.prisma.product.count({ where }),
    ]);
    return { items: items.map((p) => toPublicProduct(p, locale)), total, matchInfo };
  }
}

export const defaultSearchProvider: SearchProvider = new PostgresSearchProvider();

export async function searchRemoteListings(core: Core, q: { q?: string; minNodeTrust?: NodeTrustLevel; destination?: string; take?: number }) {
  const minRank = TRUST_ORDER.indexOf(q.minNodeTrust ?? 'UNVERIFIED');
  const terms = q.q ? (parseBuyingRequestText(q.q).keywords.slice(0, 6)) : [];
  const listings = await core.prisma.federatedListing.findMany({
    where: {
      kind: 'PRODUCT', removed: false,
      node: { status: 'ACTIVE', isLocal: false, trustLevel: { in: TRUST_ORDER.slice(Math.max(0, minRank)) } },
      ...(terms.length ? { OR: terms.map((t) => ({ title: { contains: t, mode: 'insensitive' as const } })) } : {}),
    },
    include: { node: { select: { nodeId: true, displayName: true, trustLevel: true, publicUrl: true } } },
    orderBy: { syncedAt: 'desc' }, take: q.take ?? 50,
  });
  return listings
    .filter((l) => !q.destination || ((l.data as { shipsTo?: string[] }).shipsTo ?? []).length === 0 || ((l.data as { shipsTo?: string[] }).shipsTo ?? []).includes(q.destination))
    .map((l) => ({ id: l.id, remoteId: l.remoteId, title: l.title, summary: l.summary, priceFromMinor: l.priceMinor, currency: l.currency, stockStatus: l.stockStatus, moq: l.moq, data: l.data, node: l.node, syncedAt: l.syncedAt, source: 'federated' as const }));
}

export async function searchProducts(core: Core, q: ProductSearchInput, locale = 'en', provider: SearchProvider = defaultSearchProvider) {
  const local = await provider.searchProducts(core, q, locale);
  const remote = q.includeRemote === 'true' ? await searchRemoteListings(core, { q: q.q, minNodeTrust: q.minNodeTrust, destination: q.destination }) : [];
  return { ...pageResult(local.items, local.total, q.page, q.pageSize), matchInfo: local.matchInfo, remote };
}

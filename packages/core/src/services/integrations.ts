import type { z } from 'zod';
import { Prisma } from '@globalhub/database';
import { AppError, notFound, type connectorSchema } from '@globalhub/shared';
import { previewCsv, HttpJsonConnector, MockConnector, CONNECTOR_CAPABILITIES, type SupplierConnector, type ImportRow } from '@globalhub/connectors';
import type { Core, Actor, RequestMeta } from '../context.js';
import { requirePermission } from './guards.js';
import { assertStoreOwner, refreshProductStock } from './catalog.js';
import { audit } from './audit.js';
import { encryptSecret, decryptSecret } from '../crypto.js';

// ───────────── CSV import: preview → commit → (optional) rollback ─────────────

export async function previewImport(core: Core, actor: Actor, input: { storeId: string; filename: string; csv: string; mapping?: Record<string, string> }, meta?: RequestMeta) {
  requirePermission(actor, 'import:run');
  await assertStoreOwner(core.prisma, actor, input.storeId);
  const existing = await core.prisma.productVariant.findMany({ where: { product: { storeId: input.storeId } }, select: { sku: true } });
  const preview = previewCsv(input.csv, input.mapping, new Set(existing.map((e) => e.sku)));
  const job = await core.prisma.importJob.create({
    data: { storeId: input.storeId, userId: actor.id, filename: input.filename.slice(0, 200), status: 'PREVIEW', mapping: preview.mapping, rows: preview.valid as unknown as Prisma.InputJsonValue, totalRows: preview.totalRows, validRows: preview.valid.length, errorRows: new Set(preview.errors.map((e) => e.rowNumber)).size, errors: preview.errors as unknown as Prisma.InputJsonValue },
  });
  await audit(core, { actorId: actor.id, action: 'import.previewed', targetType: 'ImportJob', targetId: job.id, metadata: { total: preview.totalRows, valid: preview.valid.length }, meta });
  return { jobId: job.id, headers: preview.headers, mapping: preview.mapping, totalRows: preview.totalRows, validRows: preview.valid.length, errors: preview.errors, sample: preview.valid.slice(0, 10) };
}

/** Commit valid rows in one transaction — all succeed or none are written. */
export async function commitImport(core: Core, actor: Actor, jobId: string, opts: { publish?: boolean } = {}, meta?: RequestMeta) {
  requirePermission(actor, 'import:run');
  const job = await core.prisma.importJob.findUnique({ where: { id: jobId } });
  if (!job || job.userId !== actor.id) throw notFound('Import job');
  if (job.status !== 'PREVIEW') throw new AppError('BAD_REQUEST', `Import is ${job.status}`);
  await assertStoreOwner(core.prisma, actor, job.storeId);
  const rows = job.rows as unknown as ImportRow[];
  if (rows.length === 0) throw new AppError('BAD_REQUEST', 'No valid rows to import');
  const categories = await core.prisma.category.findMany();
  const findCat = (c?: string) => (c ? categories.find((x) => x.slug === c.toLowerCase() || x.nameEn.toLowerCase() === c.toLowerCase())?.id ?? null : null);
  const store = await core.prisma.store.findUniqueOrThrow({ where: { id: job.storeId } });
  const now = new Date();
  try {
    const ids = await core.prisma.$transaction(async (tx) => {
      const created: string[] = [];
      for (const r of rows) {
        const dup = await tx.productVariant.findFirst({ where: { sku: r.sku, product: { storeId: job.storeId } } });
        if (dup) throw new AppError('CONFLICT', `Row ${r.rowNumber}: SKU ${r.sku} was created after preview`);
        const declared = r.stockStatusHint === 'MADE_TO_ORDER' || r.stockStatusHint === 'ON_REQUEST' ? r.stockStatusHint : 'UNVERIFIED';
        const p = await tx.product.create({
          data: {
            storeId: job.storeId, categoryId: findCat(r.category), titleEn: r.titleEn, descriptionEn: r.descriptionEn,
            originalLanguage: 'en', status: opts.publish || r.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT', stockStatus: declared, moq: r.moq, currency: r.currency,
            basePriceMinor: r.priceMinor, shipsFrom: r.shipsFrom ?? store.shipsFrom, shipsTo: r.shipsTo, specs: Object.keys(r.specs).length ? r.specs : undefined, importJobId: job.id,
            images: { create: r.imageUrls.map((url, i) => ({ url, position: i })) },
            variants: { create: { sku: r.sku, name: r.titleEn || r.sku, inventory: { create: { onHand: r.stock ?? 0, source: 'IMPORT', verifiedAt: r.stock != null ? now : null } } } },
          },
        });
        await refreshProductStock(tx, p.id);
        created.push(p.id);
      }
      await tx.importJob.update({ where: { id: job.id }, data: { status: 'COMMITTED', createdProductIds: created, committedAt: new Date() } });
      return created;
    }, { timeout: 60_000 });
    await audit(core, { actorId: actor.id, action: 'import.committed', targetType: 'ImportJob', targetId: job.id, metadata: { created: ids.length }, meta });
    return { jobId: job.id, created: ids.length, productIds: ids };
  } catch (e) {
    await core.prisma.importJob.update({ where: { id: job.id }, data: { status: 'FAILED', errors: [...(job.errors as unknown[]), { rowNumber: 0, message: (e as Error).message }] as Prisma.InputJsonValue } });
    throw e;
  }
}

/** Roll back an import: deletes products that were never ordered; ordered ones are archived instead. */
export async function rollbackImport(core: Core, actor: Actor, jobId: string, meta?: RequestMeta) {
  requirePermission(actor, 'import:run');
  const job = await core.prisma.importJob.findUnique({ where: { id: jobId } });
  if (!job || job.userId !== actor.id) throw notFound('Import job');
  if (job.status !== 'COMMITTED') throw new AppError('BAD_REQUEST', 'Only committed imports can be rolled back');
  const result = await core.prisma.$transaction(async (tx) => {
    const ordered = await tx.orderItem.findMany({ where: { productId: { in: job.createdProductIds } }, select: { productId: true }, distinct: ['productId'] });
    const keep = new Set(ordered.map((o) => o.productId!));
    const toDelete = job.createdProductIds.filter((id) => !keep.has(id));
    await tx.product.deleteMany({ where: { id: { in: toDelete } } });
    await tx.product.updateMany({ where: { id: { in: [...keep] } }, data: { status: 'ARCHIVED' } });
    await tx.importJob.update({ where: { id: jobId }, data: { status: 'ROLLED_BACK', rolledBackAt: new Date() } });
    return { deleted: toDelete.length, archived: keep.size };
  });
  await audit(core, { actorId: actor.id, action: 'import.rolled_back', targetType: 'ImportJob', targetId: jobId, metadata: result, meta });
  return result;
}

export async function listImportJobs(core: Core, actor: Actor) {
  return core.prisma.importJob.findMany({ where: { userId: actor.id }, select: { id: true, storeId: true, filename: true, status: true, totalRows: true, validRows: true, errorRows: true, errors: true, createdAt: true, committedAt: true, rolledBackAt: true }, orderBy: { createdAt: 'desc' }, take: 50 });
}

// ───────────── Supplier connectors ─────────────

export async function buildConnector(core: Core, c: { type: string; config: unknown; capabilities: string[]; credential: { ciphertext: string; iv: string; tag: string } | null }): Promise<SupplierConnector> {
  if (c.type === 'mock') return new MockConnector();
  if (c.type === 'http-json') {
    const baseUrl = (c.config as { baseUrl?: string })?.baseUrl;
    if (!baseUrl) throw new AppError('BAD_REQUEST', 'Connector baseUrl missing');
    const secret = c.credential ? decryptSecret(c.credential, core.encryptionKey) : undefined;
    return new HttpJsonConnector(baseUrl, secret, c.capabilities as never, { allowPrivate: core.config.FEDERATION_ALLOW_PRIVATE_NETWORK && !core.config.isProduction });
  }
  throw new AppError('BAD_REQUEST', `Unknown connector type ${c.type}`);
}

export async function createConnector(core: Core, actor: Actor, input: z.infer<typeof connectorSchema>, meta?: RequestMeta) {
  requirePermission(actor, 'connector:manage_own');
  await assertStoreOwner(core.prisma, actor, input.storeId);
  let capabilities: string[];
  if (input.type === 'mock') capabilities = [...new MockConnector().capabilities];
  else {
    const discovered = await HttpJsonConnector.discover(String(input.config.baseUrl ?? ''), input.secret, { allowPrivate: core.config.FEDERATION_ALLOW_PRIVATE_NETWORK && !core.config.isProduction });
    capabilities = [...discovered.capabilities];
  }
  const c = await core.prisma.connector.create({
    data: { storeId: input.storeId, type: input.type, name: input.name, config: input.config as Prisma.InputJsonValue, capabilities, ...(input.secret ? { credential: { create: encryptSecret(input.secret, core.encryptionKey) } } : {}) },
  });
  await audit(core, { actorId: actor.id, action: 'connector.created', targetType: 'Connector', targetId: c.id, metadata: { type: input.type, capabilities }, meta });
  return { ...c, capabilityMatrix: Object.fromEntries(CONNECTOR_CAPABILITIES.map((k) => [k, capabilities.includes(k)])) };
}

async function ownedConnector(core: Core, actor: Actor, id: string) {
  const c = await core.prisma.connector.findUnique({ where: { id }, include: { credential: true } });
  if (!c) throw notFound('Connector');
  await assertStoreOwner(core.prisma, actor, c.storeId);
  return c;
}

export async function listConnectors(core: Core, actor: Actor, storeId?: string) {
  requirePermission(actor, 'connector:manage_own');
  const s = await core.prisma.supplierProfile.findUnique({ where: { userId: actor.id } });
  const list = await core.prisma.connector.findMany({ where: { store: { supplierId: s?.id ?? '00000000-0000-0000-0000-000000000000' }, ...(storeId ? { storeId } : {}) }, orderBy: { createdAt: 'desc' } });
  return list.map((c) => ({ ...c, capabilityMatrix: Object.fromEntries(CONNECTOR_CAPABILITIES.map((k) => [k, c.capabilities.includes(k)])) }));
}

/** Pull inventory for SKUs this store already lists; records CONNECTOR as source with the remote timestamp. */
export async function syncConnectorInventory(core: Core, actor: Actor, id: string, meta?: RequestMeta) {
  const c = await ownedConnector(core, actor, id);
  const conn = await buildConnector(core, c);
  const variants = await core.prisma.productVariant.findMany({ where: { product: { storeId: c.storeId } }, select: { id: true, sku: true, productId: true } });
  try {
    const inv = await conn.getInventory(variants.map((v) => v.sku));
    let updated = 0;
    for (const i of inv) {
      const v = variants.find((x) => x.sku === i.sku);
      if (!v) continue;
      const current = await core.prisma.inventory.findUnique({ where: { variantId: v.id } });
      if (current && i.onHand < current.reserved) continue; // never drop below reservations
      const asOf = new Date(i.asOf);
      await core.prisma.inventory.upsert({ where: { variantId: v.id }, update: { onHand: i.onHand, source: 'CONNECTOR', verifiedAt: Number.isNaN(asOf.getTime()) ? new Date() : asOf }, create: { variantId: v.id, onHand: i.onHand, source: 'CONNECTOR', verifiedAt: new Date() } });
      await refreshProductStock(core.prisma, v.productId);
      updated++;
    }
    await core.prisma.connector.update({ where: { id }, data: { lastSyncAt: new Date(), lastError: null, status: 'ACTIVE' } });
    await audit(core, { actorId: actor.id, action: 'connector.inventory_synced', targetType: 'Connector', targetId: id, metadata: { updated }, meta });
    return { updated, checked: variants.length };
  } catch (e) {
    await core.prisma.connector.update({ where: { id }, data: { lastError: (e as Error).message.slice(0, 500), status: (e as AppError).code === 'NOT_SUPPORTED' ? 'ACTIVE' : 'ERROR' } });
    throw e;
  }
}

/** Calls a connector operation only if the remote system really supports it. */
export async function connectorCreateOrder(core: Core, actor: Actor, id: string, orderRef: string, items: { sku: string; quantity: number }[], country: string) {
  const c = await ownedConnector(core, actor, id);
  const conn = await buildConnector(core, c);
  return conn.createOrder({ reference: orderRef, items, shipTo: { country } }); // throws NOT_SUPPORTED when unsupported
}

export async function deleteConnector(core: Core, actor: Actor, id: string) {
  await ownedConnector(core, actor, id);
  await core.prisma.connector.delete({ where: { id } });
  return { deleted: true };
}

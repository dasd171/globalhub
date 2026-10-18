import { randomUUID } from 'node:crypto';
import { Prisma, type Node } from '@globalhub/database';
import { AppError, notFound, forbidden } from '@globalhub/shared';
import {
  PROTOCOL_VERSION, SUPPORTED_PROTOCOLS, nodeInfoSchema, catalogPageSchema, federatedProductSchema, federatedSupplierSchema, federatedRfqSchema, federatedQuoteReturnSchema,
  safeFetch, signRequest, verifySignature, SIG_HEADERS, type NodeInfo, type FederatedProduct,
} from '@globalhub/federation';
import type { Core, Actor, RequestMeta } from '../context.js';
import { requirePermission } from './guards.js';
import { audit } from './audit.js';
import { notify } from './notifications.js';

const PAGE_SIZE = 100;
const MAX_PAGES_PER_SYNC = 20;
const OUTBOX_MAX_ATTEMPTS = 8;

function requireFederation(core: Core) {
  if (!core.config.FEDERATION_ENABLED) throw new AppError('NOT_SUPPORTED', 'Federation is disabled on this node');
  if (!core.nodeKey || !core.config.NODE_PUBLIC_URL) throw new AppError('NOT_SUPPORTED', 'Node identity (NODE_PRIVATE_KEY, NODE_PUBLIC_URL) is not configured');
  return core.nodeKey;
}

const fetchOpts = (core: Core) => ({ allowPrivate: core.config.FEDERATION_ALLOW_PRIVATE_NETWORK, allowHttp: core.config.FEDERATION_ALLOW_PRIVATE_NETWORK, timeoutMs: 10_000, maxBytes: 5_000_000 });

export function localNodeInfo(core: Core): NodeInfo {
  const key = requireFederation(core);
  const scopes = core.config.publicScopes.filter((s) => ['products', 'suppliers', 'buying_requests', 'rfq_inbox'].includes(s)) as NodeInfo['publicScopes'];
  const caps: string[] = [];
  if (scopes.includes('products')) caps.push('catalog.products');
  if (scopes.includes('suppliers')) caps.push('catalog.suppliers');
  if (scopes.includes('rfq_inbox')) caps.push('rfq.receive', 'rfq.quote_return');
  return {
    protocol: PROTOCOL_VERSION, nodeId: core.config.NODE_ID, displayName: core.config.NODE_NAME, publicUrl: core.config.NODE_PUBLIC_URL!,
    capabilities: caps, publicScopes: scopes, keys: [{ keyId: key.keyId, algorithm: 'ed25519', publicKey: key.publicKeyPem }], software: { name: 'globalhub', version: '0.1.0' },
  };
}

export async function ensureLocalNode(core: Core) {
  if (!core.config.FEDERATION_ENABLED || !core.nodeKey || !core.config.NODE_PUBLIC_URL) return null;
  const info = localNodeInfo(core);
  const node = await core.prisma.node.upsert({
    where: { nodeId: info.nodeId },
    update: { displayName: info.displayName, publicUrl: info.publicUrl, capabilities: info.capabilities, publicScopes: info.publicScopes, isLocal: true, protocolVersion: PROTOCOL_VERSION, lastHeartbeatAt: new Date(), status: 'ACTIVE' },
    create: { nodeId: info.nodeId, displayName: info.displayName, publicUrl: info.publicUrl, capabilities: info.capabilities, publicScopes: info.publicScopes, isLocal: true, protocolVersion: PROTOCOL_VERSION, lastHeartbeatAt: new Date(), trustLevel: 'ADMIN_REVIEWED' },
  });
  await core.prisma.nodeKey.upsert({ where: { nodeId_keyId: { nodeId: node.id, keyId: core.nodeKey.keyId } }, update: { publicKey: core.nodeKey.publicKeyPem, revokedAt: null }, create: { nodeId: node.id, keyId: core.nodeKey.keyId, publicKey: core.nodeKey.publicKeyPem } });
  return node;
}

/** Sign a response body so receivers can verify it came from this node (prevents spoofed catalogs). */
export function signResponse(core: Core, path: string, body: string) {
  const key = requireFederation(core);
  return signRequest({ method: 'RESPONSE', path, body, nodeId: core.config.NODE_ID, keyId: key.keyId, privateKeyPem: key.privateKeyPem });
}

/** Register / refresh a remote node by URL. New nodes start UNVERIFIED regardless of what they claim. */
export async function discoverNode(core: Core, actor: Actor | null, publicUrl: string, meta?: RequestMeta) {
  requireFederation(core);
  if (actor) requirePermission(actor, 'node:manage');
  const base = publicUrl.replace(/\/+$/, '');
  const res = await safeFetch(`${base}/api/v1/federation/node-info`, fetchOpts(core));
  if (res.status !== 200) throw new AppError('FEDERATION_ERROR', `Remote node responded ${res.status}`);
  let info: NodeInfo;
  try { info = nodeInfoSchema.parse(JSON.parse(res.body)); } catch { throw new AppError('FEDERATION_ERROR', 'Remote node-info is invalid'); }
  if (!SUPPORTED_PROTOCOLS.includes(info.protocol)) throw new AppError('FEDERATION_ERROR', `Unsupported protocol ${info.protocol}`);
  if (info.nodeId === core.config.NODE_ID) throw new AppError('BAD_REQUEST', 'That is this node');
  const claimed = new URL(info.publicUrl); const fetched = new URL(base);
  if (claimed.host !== fetched.host) throw new AppError('FEDERATION_ERROR', 'Node publicUrl does not match the URL it was fetched from');
  const existing = await core.prisma.node.findUnique({ where: { nodeId: info.nodeId }, include: { keys: true } });
  if (existing?.status === 'BANNED') throw forbidden('This node is banned');
  if (existing && existing.publicUrl.replace(/\/+$/, '') !== info.publicUrl.replace(/\/+$/, '')) throw new AppError('CONFLICT', 'A node with this ID is already registered at a different URL (possible impersonation)');
  // Domain-verified: served over HTTPS from the host it claims. Business/admin levels need human review.
  const domainVerified = fetched.protocol === 'https:';
  const node = await core.prisma.node.upsert({
    where: { nodeId: info.nodeId },
    update: { displayName: info.displayName, capabilities: info.capabilities, publicScopes: info.publicScopes, protocolVersion: info.protocol, lastHeartbeatAt: new Date(), ...(existing?.status === 'STALE' ? { status: 'ACTIVE' } : {}), ...(domainVerified && existing?.trustLevel === 'UNVERIFIED' ? { trustLevel: 'DOMAIN_VERIFIED' } : {}) },
    create: { nodeId: info.nodeId, displayName: info.displayName, publicUrl: info.publicUrl.replace(/\/+$/, ''), capabilities: info.capabilities, publicScopes: info.publicScopes, protocolVersion: info.protocol, lastHeartbeatAt: new Date(), trustLevel: domainVerified ? 'DOMAIN_VERIFIED' : 'UNVERIFIED' },
  });
  for (const k of info.keys) {
    const prev = existing?.keys.find((x) => x.keyId === k.keyId);
    if (prev && prev.publicKey !== k.publicKey) throw new AppError('CONFLICT', `Key ${k.keyId} changed for node ${info.nodeId}; refusing silent key rotation`);
    if (!prev) await core.prisma.nodeKey.create({ data: { nodeId: node.id, keyId: k.keyId, publicKey: k.publicKey } });
  }
  await core.prisma.nodeAnnouncement.create({ data: { nodeId: node.id, type: 'node-info', payload: info as unknown as Prisma.InputJsonValue } });
  await audit(core, { actorId: actor?.id, action: 'federation.node_discovered', targetType: 'Node', targetId: node.id, metadata: { nodeId: info.nodeId, url: info.publicUrl }, meta });
  return node;
}

/** Verify an inbound signed request: known active node, valid key, fresh timestamp, unused nonce. */
export async function verifyInbound(core: Core, method: string, path: string, rawBody: string, headers: Record<string, string | string[] | undefined>) {
  requireFederation(core);
  const nodeIdHeader = headers[SIG_HEADERS.node];
  const nodeId = Array.isArray(nodeIdHeader) ? nodeIdHeader[0] : nodeIdHeader;
  if (!nodeId) throw new AppError('UNAUTHENTICATED', 'Missing node signature');
  const node = await core.prisma.node.findUnique({ where: { nodeId }, include: { keys: { where: { revokedAt: null } } } });
  if (!node || node.isLocal) throw new AppError('UNAUTHENTICATED', 'Unknown node — register it first');
  if (node.status === 'BANNED') throw forbidden('Node is banned');
  const keyIdH = headers[SIG_HEADERS.keyId]; const keyId = Array.isArray(keyIdH) ? keyIdH[0] : keyIdH;
  const key = node.keys.find((k) => k.keyId === keyId);
  if (!key) throw new AppError('UNAUTHENTICATED', 'Unknown signing key');
  const v = verifySignature({ method, path, body: rawBody, headers, publicKeyPem: key.publicKey });
  if (!v.ok) {
    await audit(core, { action: 'risk.federation_bad_signature', targetType: 'Node', targetId: node.id, metadata: { reason: v.reason, path } });
    throw new AppError('UNAUTHENTICATED', `Signature rejected: ${v.reason}`);
  }
  try { await core.prisma.federationNonce.create({ data: { nodeId: node.id, nonce: v.nonce } }); }
  catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      await audit(core, { action: 'risk.federation_replay', targetType: 'Node', targetId: node.id, metadata: { path } });
      throw new AppError('CONFLICT', 'Replayed request (nonce already used)');
    }
    throw e;
  }
  await core.prisma.node.update({ where: { id: node.id }, data: { lastHeartbeatAt: new Date(), ...(node.status === 'STALE' ? { status: 'ACTIVE' } : {}) } });
  return node;
}

// ───────────── Serving the public catalog ─────────────

export async function serveCatalog(core: Core, kind: 'products' | 'suppliers', cursor: string | undefined, limit = PAGE_SIZE) {
  requireFederation(core);
  if (!core.config.publicScopes.includes(kind)) throw new AppError('FORBIDDEN', `This node does not publish ${kind}`);
  const since = cursor ? new Date(cursor) : new Date(0);
  if (Number.isNaN(since.getTime())) throw new AppError('BAD_REQUEST', 'Invalid cursor');
  const take = Math.min(limit, PAGE_SIZE);
  if (kind === 'products') {
    const rows = await core.prisma.product.findMany({
      where: { updatedAt: { gt: since } }, orderBy: { updatedAt: 'asc' }, take,
      include: { store: { include: { supplier: true } }, category: true, images: { take: 1, orderBy: { position: 'asc' } }, priceTiers: true },
    });
    const items: FederatedProduct[] = []; const removedIds: string[] = [];
    for (const p of rows) {
      const eligible = p.status === 'ACTIVE' && p.isPublic && p.store.supplier.isPublic && p.store.supplier.verificationStatus !== 'SUSPENDED' && !p.store.supplier.remoteNodeId;
      if (!eligible) { removedIds.push(p.id); continue; }
      const prices = [p.basePriceMinor, ...p.priceTiers.map((t) => t.unitPriceMinor)].filter((x): x is number => x != null);
      items.push({
        id: p.id, title: (p.titleEn ?? p.titleZh ?? '').slice(0, 300), titleZh: p.titleZh, summary: (p.descriptionEn ?? p.descriptionZh ?? '').slice(0, 1000) || null,
        category: p.category?.slug ?? null, currency: p.currency, priceFromMinor: prices.length ? Math.min(...prices) : null, moq: p.moq, stockStatus: p.stockStatus,
        shipsFrom: p.shipsFrom, shipsTo: p.shipsTo, customizable: p.customizable,
        supplier: { id: p.store.supplier.id, name: p.store.supplier.companyName, type: p.store.supplier.supplierType, verification: p.store.supplier.verificationStatus },
        imageUrl: p.images[0]?.url?.startsWith('https://') ? p.images[0].url : null, updatedAt: p.updatedAt.toISOString(), isDemo: p.isDemo,
      });
    }
    return { protocol: PROTOCOL_VERSION, nodeId: core.config.NODE_ID, kind, items, removedIds, nextCursor: rows.length === take ? rows[rows.length - 1].updatedAt.toISOString() : null };
  }
  const rows = await core.prisma.supplierProfile.findMany({ where: { updatedAt: { gt: since }, remoteNodeId: null }, orderBy: { updatedAt: 'asc' }, take });
  const items = []; const removedIds: string[] = [];
  for (const s of rows) {
    if (!s.isPublic || s.verificationStatus === 'SUSPENDED') { removedIds.push(s.id); continue; }
    items.push({ id: s.id, name: s.companyName, nameZh: s.companyNameZh, type: s.supplierType, verification: s.verificationStatus, region: [s.city, s.province].filter(Boolean).join(', ') || null, updatedAt: s.updatedAt.toISOString(), isDemo: s.isDemo });
  }
  return { protocol: PROTOCOL_VERSION, nodeId: core.config.NODE_ID, kind, items, removedIds, nextCursor: rows.length === take ? rows[rows.length - 1].updatedAt.toISOString() : null };
}

// ───────────── Pulling a remote catalog ─────────────

async function verifyResponse(core: Core, node: Node & { keys: { keyId: string; publicKey: string; revokedAt: Date | null }[] }, path: string, body: string, headers: Record<string, string | string[] | undefined>) {
  const keyIdH = headers[SIG_HEADERS.keyId]; const keyId = Array.isArray(keyIdH) ? keyIdH[0] : keyIdH;
  const key = node.keys.find((k) => k.keyId === keyId && !k.revokedAt);
  if (!key) throw new AppError('FEDERATION_ERROR', 'Catalog response signed with unknown key');
  const v = verifySignature({ method: 'RESPONSE', path, body, headers, publicKeyPem: key.publicKey });
  if (!v.ok || v.nodeId !== node.nodeId) throw new AppError('FEDERATION_ERROR', `Catalog response signature invalid (${v.ok ? 'node mismatch' : v.reason})`);
}

export async function pullCatalog(core: Core, nodeDbId: string, kind: 'products' | 'suppliers' = 'products') {
  requireFederation(core);
  const node = await core.prisma.node.findUnique({ where: { id: nodeDbId }, include: { keys: true } });
  if (!node || node.isLocal) throw notFound('Node');
  if (node.status === 'BANNED') throw forbidden('Node is banned');
  if (!node.publicScopes.includes(kind)) return { kind, upserted: 0, removed: 0, rejected: 0, skipped: 'not published by node' };
  const cursorKey = `${kind}:`;
  let cursor = (node.syncCursor ?? '').split('|').find((c) => c.startsWith(cursorKey))?.slice(cursorKey.length) || undefined;
  let upserted = 0; let removed = 0; let rejected = 0;
  try {
    for (let page = 0; page < MAX_PAGES_PER_SYNC; page++) {
      const path = `/api/v1/federation/catalog/${kind}`;
      const url = `${node.publicUrl}${path}?limit=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await safeFetch(url, fetchOpts(core));
      if (res.status !== 200) throw new AppError('FEDERATION_ERROR', `Catalog fetch returned ${res.status}`);
      await verifyResponse(core, node, path, res.body, res.headers as never);
      const pageData = catalogPageSchema.parse(JSON.parse(res.body));
      if (pageData.nodeId !== node.nodeId || pageData.kind !== kind) throw new AppError('FEDERATION_ERROR', 'Catalog page metadata mismatch');
      const fkind = kind === 'products' ? 'PRODUCT' : 'SUPPLIER';
      for (const raw of pageData.items) {
        const parsed = kind === 'products' ? federatedProductSchema.safeParse(raw) : federatedSupplierSchema.safeParse(raw);
        if (!parsed.success) { rejected++; continue; } // data-poisoning guard: invalid items are dropped
        const it = parsed.data as FederatedProduct & { name?: string; nameZh?: string };
        const title = kind === 'products' ? it.title : (it.name ?? '');
        await core.prisma.federatedListing.upsert({
          where: { sourceNodeId_kind_remoteId: { sourceNodeId: node.id, kind: fkind, remoteId: it.id } },
          update: { title, summary: kind === 'products' ? it.summary ?? null : it.nameZh ?? null, data: it as unknown as Prisma.InputJsonValue, priceMinor: kind === 'products' ? it.priceFromMinor : null, currency: kind === 'products' ? it.currency : null, stockStatus: kind === 'products' ? it.stockStatus : 'UNVERIFIED', moq: kind === 'products' ? it.moq : null, remoteUpdatedAt: new Date(it.updatedAt), syncedAt: new Date(), removed: false },
          create: { sourceNodeId: node.id, kind: fkind, remoteId: it.id, title, summary: kind === 'products' ? it.summary ?? null : it.nameZh ?? null, data: it as unknown as Prisma.InputJsonValue, priceMinor: kind === 'products' ? it.priceFromMinor : null, currency: kind === 'products' ? it.currency : null, stockStatus: kind === 'products' ? it.stockStatus : 'UNVERIFIED', moq: kind === 'products' ? it.moq : null, remoteUpdatedAt: new Date(it.updatedAt) },
        });
        upserted++;
      }
      if (pageData.removedIds.length) {
        const r = await core.prisma.federatedListing.updateMany({ where: { sourceNodeId: node.id, kind: fkind, remoteId: { in: pageData.removedIds } }, data: { removed: true } });
        removed += r.count;
      }
      const last = pageData.items.length ? (pageData.items[pageData.items.length - 1] as { updatedAt?: string }).updatedAt : undefined;
      cursor = pageData.nextCursor ?? last ?? cursor;
      if (!pageData.nextCursor) break;
    }
    const others = (node.syncCursor ?? '').split('|').filter((c) => c && !c.startsWith(cursorKey));
    await core.prisma.node.update({ where: { id: node.id }, data: { lastSyncedAt: new Date(), failureCount: 0, syncCursor: [...others, ...(cursor ? [`${cursorKey}${cursor}`] : [])].join('|'), ...(node.status === 'STALE' ? { status: 'ACTIVE' } : {}) } });
    return { kind, upserted, removed, rejected };
  } catch (e) {
    await core.prisma.node.update({ where: { id: node.id }, data: { failureCount: { increment: 1 } } });
    throw e;
  }
}

export async function syncAllNodes(core: Core) {
  if (!core.config.FEDERATION_ENABLED) return [];
  const nodes = await core.prisma.node.findMany({ where: { isLocal: false, status: { in: ['ACTIVE', 'STALE'] } } });
  const results = [];
  for (const n of nodes) {
    for (const kind of ['products', 'suppliers'] as const) {
      try { results.push({ node: n.nodeId, ...(await pullCatalog(core, n.id, kind)) }); }
      catch (e) { results.push({ node: n.nodeId, kind, error: (e as Error).message }); }
    }
  }
  return results;
}

// ───────────── Cross-node RFQs and quote return ─────────────

async function enqueue(core: Core, targetNodeId: string, type: 'rfq' | 'quote', payload: object, idempotencyKey: string) {
  const existing = await core.prisma.federationOutbox.findUnique({ where: { idempotencyKey } });
  const row = existing ?? await core.prisma.federationOutbox.create({ data: { targetNodeId, type, payload: payload as Prisma.InputJsonValue, idempotencyKey } });
  await deliverOutboxItem(core, row.id).catch(() => undefined); // first attempt inline; worker retries
  return core.prisma.federationOutbox.findUniqueOrThrow({ where: { id: row.id } });
}

export async function deliverOutboxItem(core: Core, id: string) {
  const key = requireFederation(core);
  const item = await core.prisma.federationOutbox.findUniqueOrThrow({ where: { id }, include: { targetNode: true } });
  if (item.status === 'DELIVERED' || item.status === 'DEAD') return item;
  if (item.targetNode.status === 'BANNED') return core.prisma.federationOutbox.update({ where: { id }, data: { status: 'DEAD', lastError: 'Target node banned' } });
  const path = `/api/v1/federation/inbox/${item.type}`;
  const body = JSON.stringify(item.payload);
  const headers = { ...signRequest({ method: 'POST', path, body, nodeId: core.config.NODE_ID, keyId: key.keyId, privateKeyPem: key.privateKeyPem }), [SIG_HEADERS.idempotency]: item.idempotencyKey };
  try {
    const res = await safeFetch(`${item.targetNode.publicUrl}${path}`, { ...fetchOpts(core), method: 'POST', body, headers });
    if (res.status >= 200 && res.status < 300) {
      return core.prisma.federationOutbox.update({ where: { id }, data: { status: 'DELIVERED', attempts: { increment: 1 }, response: safeJson(res.body), lastError: null } });
    }
    throw new Error(`HTTP ${res.status}: ${res.body.slice(0, 200)}`);
  } catch (e) {
    const attempts = item.attempts + 1;
    return core.prisma.federationOutbox.update({ where: { id }, data: { attempts, lastError: (e as Error).message.slice(0, 500), status: attempts >= OUTBOX_MAX_ATTEMPTS ? 'DEAD' : 'FAILED', nextAttemptAt: new Date(Date.now() + Math.min(3600_000, 2 ** attempts * 30_000)) } });
  }
}

function safeJson(s: string): Prisma.InputJsonValue | undefined { try { return JSON.parse(s); } catch { return undefined; } }

export async function processOutbox(core: Core, limit = 50) {
  if (!core.config.FEDERATION_ENABLED || !core.nodeKey) return { processed: 0 };
  const due = await core.prisma.federationOutbox.findMany({ where: { status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lte: new Date() } }, take: limit, orderBy: { nextAttemptAt: 'asc' } });
  for (const d of due) await deliverOutboxItem(core, d.id);
  return { processed: due.length };
}

/** Buyer on this node asks a supplier listed on a remote node for a quote. Buyer identity stays local. */
export async function sendRemoteRfq(core: Core, actor: Actor, listingId: string, input: { quantity: number; destinationCountry: string; message: string; currency?: string }, meta?: RequestMeta) {
  requirePermission(actor, 'buying_request:create');
  requireFederation(core);
  const listing = await core.prisma.federatedListing.findUnique({ where: { id: listingId }, include: { node: true } });
  if (!listing || listing.removed || listing.kind !== 'PRODUCT') throw notFound('Listing');
  if (listing.node.status !== 'ACTIVE') throw new AppError('BAD_REQUEST', 'Remote node is not active');
  if (!listing.node.capabilities.includes('rfq.receive')) throw new AppError('NOT_SUPPORTED', 'Remote node does not accept quote requests');
  const currency = input.currency ?? listing.currency ?? 'USD';
  const req = await core.prisma.buyingRequest.create({
    data: {
      buyerId: actor.id, title: `Quote request: ${listing.title}`.slice(0, 200), description: input.message, quantity: input.quantity, currency, destinationCountry: input.destinationCountry,
      visibility: 'PRIVATE', status: 'OPEN', remoteListingId: listing.id, expiresAt: new Date(Date.now() + 30 * 86400_000),
      structured: { product: listing.title, quantity: input.quantity, destination: input.destinationCountry, remote: { node: listing.node.nodeId, listingRemoteId: listing.remoteId } },
    },
  });
  const payload = federatedRfqSchema.parse({
    rfqId: req.id, originNodeId: core.config.NODE_ID, listingId: listing.remoteId, title: req.title, description: req.description, quantity: req.quantity, unit: req.unit,
    currency, destinationCountry: req.destinationCountry, buyerLabel: `Buyer via ${core.config.NODE_NAME}`.slice(0, 80), replyBy: req.expiresAt!.toISOString(),
  });
  const out = await enqueue(core, listing.sourceNodeId, 'rfq', payload, `rfq:${req.id}`);
  await audit(core, { actorId: actor.id, action: 'federation.rfq_sent', targetType: 'BuyingRequest', targetId: req.id, metadata: { node: listing.node.nodeId }, meta });
  return { buyingRequestId: req.id, delivery: { status: out.status, attempts: out.attempts, lastError: out.lastError } };
}

export async function receiveRfq(core: Core, node: Node, body: unknown) {
  if (!core.config.publicScopes.includes('rfq_inbox')) throw forbidden('This node does not accept remote quote requests');
  const p = federatedRfqSchema.parse(body);
  if (p.originNodeId !== node.nodeId) throw new AppError('BAD_REQUEST', 'originNodeId does not match signer');
  const dup = await core.prisma.buyingRequest.findUnique({ where: { originNodeId_remoteId: { originNodeId: node.id, remoteId: p.rfqId } } });
  if (dup) return { buyingRequestId: dup.id, duplicate: true };
  let productId: string | undefined; let targetSupplierId: string | undefined; let supplierUserId: string | undefined; let categoryId: string | null = null;
  if (p.listingId) {
    const prod = await core.prisma.product.findUnique({ where: { id: p.listingId }, include: { store: { include: { supplier: true } } } });
    if (!prod || prod.status !== 'ACTIVE' || !prod.isPublic) throw notFound('Listing');
    productId = prod.id; targetSupplierId = prod.store.supplierId; supplierUserId = prod.store.supplier.userId; categoryId = prod.categoryId;
  }
  const r = await core.prisma.buyingRequest.create({
    data: {
      title: p.title, description: p.description, quantity: p.quantity, unit: p.unit, currency: p.currency, targetUnitPriceMinor: p.targetUnitPriceMinor ?? null,
      destinationCountry: p.destinationCountry, needsSample: p.needsSample, needsInspection: p.needsInspection, oemOdm: p.oemOdm, visibility: targetSupplierId ? 'PRIVATE' : 'FEDERATED',
      status: 'OPEN', originNodeId: node.id, remoteId: p.rfqId, remoteBuyerLabel: p.buyerLabel, productId, targetSupplierId, categoryId,
      expiresAt: p.replyBy ? new Date(p.replyBy) : new Date(Date.now() + 30 * 86400_000),
      structured: { product: p.title, quantity: p.quantity, destination: p.destinationCountry, remote: { node: node.nodeId } },
    },
  });
  if (supplierUserId) await notify(core, { userId: supplierUserId, type: 'rfq.remote', title: `Quote request from ${node.displayName}`, body: `${p.title} — ${p.quantity} ${p.unit} to ${p.destinationCountry} (remote node, trust: ${node.trustLevel})`, link: `/seller/requests/${r.id}` });
  await audit(core, { action: 'federation.rfq_received', targetType: 'BuyingRequest', targetId: r.id, metadata: { node: node.nodeId } });
  return { buyingRequestId: r.id, duplicate: false };
}

export async function enqueueQuoteReturn(core: Core, quoteId: string) {
  const q = await core.prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, include: { buyingRequest: true, supplier: true } });
  if (!q.buyingRequest?.originNodeId || !q.buyingRequest.remoteId) return null;
  const payload = federatedQuoteReturnSchema.parse({
    quoteId: q.id, rfqId: q.buyingRequest.remoteId, supplierName: q.supplier.companyName, productName: q.productName, availableQty: q.availableQty, currency: q.currency,
    unitPriceMinor: q.unitPriceMinor, moq: q.moq, internationalShippingMinor: q.internationalShippingMinor, internationalShippingSource: q.internationalShippingSource,
    productionDays: q.productionDays, validUntil: q.validUntil.toISOString(), notes: q.notes ?? null,
  });
  return enqueue(core, q.buyingRequest.originNodeId, 'quote', payload, `quote:${q.id}`);
}

/** Local proxy identity representing a remote node's suppliers (cannot log in). */
async function proxySupplier(core: Core, node: Node) {
  const email = `proxy+${node.nodeId}@federation.invalid`;
  const user = await core.prisma.user.upsert({ where: { email }, update: {}, create: { email, passwordHash: '!federation-proxy-no-login', displayName: `${node.displayName} (remote node)`, status: 'DISABLED' } });
  return core.prisma.supplierProfile.upsert({ where: { userId: user.id }, update: { companyName: `${node.displayName} (remote)` }, create: { userId: user.id, companyName: `${node.displayName} (remote)`, isPublic: false, remoteNodeId: node.id } });
}

export async function receiveQuote(core: Core, node: Node, body: unknown) {
  const p = federatedQuoteReturnSchema.parse(body);
  const req = await core.prisma.buyingRequest.findUnique({ where: { id: p.rfqId } });
  if (!req || !req.remoteListingId) throw notFound('RFQ');
  const listing = await core.prisma.federatedListing.findUnique({ where: { id: req.remoteListingId } });
  // Only the node the RFQ was sent to may answer it (blocks forged quotes from other nodes).
  if (!listing || listing.sourceNodeId !== node.id) throw forbidden('This node was not asked for this quote');
  const dup = await core.prisma.quote.findFirst({ where: { remoteNodeId: node.id, remoteId: p.quoteId } });
  if (dup) return { quoteId: dup.id, duplicate: true };
  if (req.status !== 'OPEN') throw new AppError('BAD_REQUEST', 'Request is no longer open');
  const supplier = await proxySupplier(core, node);
  const q = await core.prisma.quote.create({
    data: {
      buyingRequestId: req.id, supplierId: supplier.id, submitterId: supplier.userId, status: 'SUBMITTED', submittedAt: new Date(), productName: p.productName,
      availableQty: p.availableQty, currency: p.currency, unitPriceMinor: p.unitPriceMinor, moq: p.moq, internationalShippingMinor: p.internationalShippingMinor,
      internationalShippingSource: p.internationalShippingSource, productionDays: p.productionDays ?? null, validUntil: new Date(p.validUntil),
      notes: `[Remote supplier: ${p.supplierName} @ ${node.displayName}, node trust ${node.trustLevel}] ${p.notes ?? ''}`.slice(0, 5000), remoteNodeId: node.id, remoteId: p.quoteId,
    },
  });
  if (req.buyerId) await notify(core, { userId: req.buyerId, type: 'quote.new', title: 'Quote received from a remote node', body: `${p.supplierName} (${node.displayName}) quoted on "${req.title}".`, link: `/buyer/requests/${req.id}` });
  return { quoteId: q.id, duplicate: false };
}

export async function sendHeartbeats(core: Core) {
  if (!core.config.FEDERATION_ENABLED || !core.nodeKey) return { sent: 0 };
  const key = core.nodeKey;
  const nodes = await core.prisma.node.findMany({ where: { isLocal: false, status: { in: ['ACTIVE', 'STALE'] } } });
  let ok = 0;
  for (const n of nodes) {
    const path = '/api/v1/federation/heartbeat';
    const body = JSON.stringify({ nodeId: core.config.NODE_ID, at: new Date().toISOString(), id: randomUUID() });
    try {
      const res = await safeFetch(`${n.publicUrl}${path}`, { ...fetchOpts(core), method: 'POST', body, headers: signRequest({ method: 'POST', path, body, nodeId: core.config.NODE_ID, keyId: key.keyId, privateKeyPem: key.privateKeyPem }) });
      if (res.status < 300) ok++;
    } catch { /* counted by stale detection */ }
  }
  return { sent: ok };
}

/** Maintenance: nodes silent for 7 days become STALE; old nonces are purged (replay window is 5 min). */
export async function federationHousekeeping(core: Core, now = new Date()) {
  const cutoff = new Date(now.getTime() - 7 * 86400_000);
  const stale = await core.prisma.node.updateMany({ where: { isLocal: false, status: 'ACTIVE', OR: [{ lastHeartbeatAt: { lt: cutoff } }, { lastHeartbeatAt: null }], AND: [{ OR: [{ lastSyncedAt: { lt: cutoff } }, { lastSyncedAt: null }] }] }, data: { status: 'STALE' } });
  const purged = await core.prisma.federationNonce.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 86400_000) } } });
  return { markedStale: stale.count, noncesPurged: purged.count };
}

export async function listNodes(core: Core, includeBanned = false) {
  return core.prisma.node.findMany({
    where: includeBanned ? {} : { status: { not: 'BANNED' } },
    select: { id: true, nodeId: true, displayName: true, publicUrl: true, protocolVersion: true, capabilities: true, publicScopes: true, trustLevel: true, status: true, isLocal: true, lastHeartbeatAt: true, lastSyncedAt: true, failureCount: true, _count: { select: { listings: { where: { removed: false } } } } },
    orderBy: [{ isLocal: 'desc' }, { displayName: 'asc' }],
  });
}

export async function adminUpdateNode(core: Core, actor: Actor, id: string, input: { status?: 'ACTIVE' | 'STALE' | 'BANNED'; trustLevel?: 'UNVERIFIED' | 'DOMAIN_VERIFIED' | 'BUSINESS_VERIFIED' | 'ADMIN_REVIEWED' }, meta?: RequestMeta) {
  requirePermission(actor, 'node:manage');
  const n = await core.prisma.node.findUnique({ where: { id } });
  if (!n) throw notFound('Node');
  if (n.isLocal) throw new AppError('BAD_REQUEST', 'Cannot change the local node');
  const u = await core.prisma.$transaction(async (tx) => {
    const node = await tx.node.update({ where: { id }, data: input });
    if (input.status === 'BANNED') await tx.federatedListing.updateMany({ where: { sourceNodeId: id }, data: { removed: true } });
    return node;
  });
  await audit(core, { actorId: actor.id, action: 'admin.node_updated', targetType: 'Node', targetId: id, metadata: input, meta });
  return u;
}

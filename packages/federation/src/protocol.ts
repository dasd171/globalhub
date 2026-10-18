import { z } from 'zod';
import { STOCK_STATUSES, SUPPLIER_TYPES, VERIFICATION_STATUSES } from '@globalhub/shared';

export const PROTOCOL_VERSION = 'globalhub-fed/1';
export const SUPPORTED_PROTOCOLS = [PROTOCOL_VERSION];

export const CAPABILITIES = ['catalog.products', 'catalog.suppliers', 'rfq.receive', 'rfq.quote_return', 'buying_requests.public'] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Data a node may opt in to publishing. Anything else is never served over federation. */
export const PUBLIC_SCOPES = ['products', 'suppliers', 'buying_requests', 'rfq_inbox'] as const;
export type PublicScope = (typeof PUBLIC_SCOPES)[number];

const str = (max: number) => z.string().max(max);

export const nodeInfoSchema = z.object({
  protocol: z.string().max(40),
  nodeId: z.string().regex(/^[a-z0-9][a-z0-9.-]{2,62}$/),
  displayName: str(120),
  publicUrl: z.string().url().max(300),
  capabilities: z.array(z.string().max(60)).max(30),
  publicScopes: z.array(z.enum(PUBLIC_SCOPES)).max(10),
  keys: z.array(z.object({ keyId: str(60), algorithm: z.literal('ed25519'), publicKey: str(500) })).min(1).max(5),
  software: z.object({ name: str(40), version: str(40) }).optional(),
});
export type NodeInfo = z.infer<typeof nodeInfoSchema>;

/** Public product listing as served to other nodes. No private fields (no inventory counts, costs, buyer data). */
export const federatedProductSchema = z.object({
  id: z.string().uuid(),
  title: str(300),
  titleZh: str(300).nullable().optional(),
  summary: str(1000).nullable().optional(),
  category: str(100).nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  priceFromMinor: z.number().int().nonnegative().max(1e12).nullable(),
  moq: z.number().int().min(1).max(1e9),
  stockStatus: z.enum(STOCK_STATUSES),
  shipsFrom: str(100).nullable().optional(),
  shipsTo: z.array(z.string().regex(/^[A-Z]{2}$/)).max(250),
  customizable: z.boolean(),
  supplier: z.object({ id: z.string().uuid(), name: str(200), type: z.enum(SUPPLIER_TYPES), verification: z.enum(VERIFICATION_STATUSES) }),
  imageUrl: z.string().url().max(2000).nullable().optional(),
  updatedAt: z.string().datetime(),
  isDemo: z.boolean().default(false),
});
export type FederatedProduct = z.infer<typeof federatedProductSchema>;

export const federatedSupplierSchema = z.object({
  id: z.string().uuid(), name: str(200), nameZh: str(200).nullable().optional(), type: z.enum(SUPPLIER_TYPES),
  verification: z.enum(VERIFICATION_STATUSES), region: str(200).nullable().optional(), updatedAt: z.string().datetime(), isDemo: z.boolean().default(false),
});

export const catalogPageSchema = z.object({
  protocol: z.string(),
  nodeId: z.string(),
  kind: z.enum(['products', 'suppliers']),
  items: z.array(z.unknown()).max(500),
  removedIds: z.array(z.string().uuid()).max(5000).default([]),
  nextCursor: z.string().max(200).nullable(),
});

/** Cross-node RFQ (buying request forwarded to a remote node). Buyer identity is never shared. */
export const federatedRfqSchema = z.object({
  rfqId: z.string().uuid(),
  originNodeId: z.string(),
  listingId: z.string().uuid().nullable().optional(),
  title: str(200),
  description: str(10_000),
  quantity: z.number().int().min(1).max(1e8),
  unit: str(30),
  currency: z.string().regex(/^[A-Z]{3}$/),
  targetUnitPriceMinor: z.number().int().nonnegative().nullable().optional(),
  destinationCountry: z.string().regex(/^[A-Z]{2}$/),
  needsSample: z.boolean().default(false),
  needsInspection: z.boolean().default(false),
  oemOdm: z.boolean().default(false),
  buyerLabel: str(80),
  replyBy: z.string().datetime().optional(),
});
export type FederatedRfq = z.infer<typeof federatedRfqSchema>;

export const federatedQuoteReturnSchema = z.object({
  quoteId: z.string().uuid(),
  rfqId: z.string().uuid(),
  supplierName: str(200),
  productName: str(200),
  availableQty: z.number().int().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  unitPriceMinor: z.number().int().nonnegative().max(1e12),
  moq: z.number().int().min(1),
  internationalShippingMinor: z.number().int().nonnegative().nullable(),
  internationalShippingSource: z.enum(['SUPPLIER', 'SYSTEM_ESTIMATE', 'THIRD_PARTY', 'NOT_CONFIRMED']),
  productionDays: z.number().int().nullable().optional(),
  validUntil: z.string().datetime(),
  notes: str(5000).nullable().optional(),
});
export type FederatedQuoteReturn = z.infer<typeof federatedQuoteReturnSchema>;

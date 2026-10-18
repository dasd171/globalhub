import { z } from 'zod';
import { AGENT_SERVICES, SHIPMENT_STATUSES, STOCK_STATUSES, SUPPLIER_TYPES, ORDER_STATUSES, VERIFICATION_STATUSES, NODE_TRUST_LEVELS } from './enums.js';

const currency = z.string().regex(/^[A-Z]{3}$/, 'ISO-4217 currency code (e.g. USD)');
const country = z.string().regex(/^[A-Z]{2}$/, 'ISO-3166 alpha-2 country code (e.g. JP)');
const minor = z.number().int().nonnegative();
const shortText = z.string().trim().min(1).max(200);
const longText = z.string().trim().max(10_000);
/** UI locales this build ships. Keep in sync with @globalhub/i18n LOCALES. */
export const LOCALE_CODES = ['en'] as const;
/** ISO 639-1 language code of user-entered content (e.g. en, es, ja). */
const languageCode = z.string().trim().toLowerCase().regex(/^[a-z]{2}$/, 'ISO-639-1 language code (e.g. en)');

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10, 'At least 10 characters').max(200),
  displayName: shortText,
  role: z.enum(['BUYER', 'SUPPLIER', 'AGENT']).default('BUYER'),
  locale: z.enum(LOCALE_CODES).default('en'),
  companyName: z.string().trim().max(200).optional(),
  country: country.optional(),
});
export const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });
export const forgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().email() });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: z.string().min(10).max(200) });
export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(10).max(200) });
export const updateMeSchema = z.object({
  displayName: shortText.optional(),
  locale: z.enum(LOCALE_CODES).optional(),
  preferredCurrency: currency.optional(),
});

export const supplierProfileSchema = z.object({
  companyName: shortText,
  companyNameZh: z.string().trim().max(200).optional(),
  supplierType: z.enum(SUPPLIER_TYPES).default('OTHER'),
  province: z.string().trim().max(100).optional(),
  city: z.string().trim().max(100).optional(),
  description: longText.optional(),
});
export const businessDetailsSchema = z.object({
  legalName: shortText,
  registrationNumber: z.string().trim().min(4).max(64),
  registeredAddress: z.string().trim().min(4).max(500),
  contactName: shortText,
  documentKeys: z.array(z.string().max(300)).max(10).default([]),
});

export const storeSchema = z.object({
  name: shortText,
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'lowercase letters, digits, dashes'),
  description: longText.optional(),
  shipsFrom: z.string().trim().max(100).optional(),
});

export const priceTierSchema = z.object({ minQty: z.number().int().min(1), maxQty: z.number().int().min(1).nullable().optional(), unitPriceMinor: minor.nullable() });
export const variantSchema = z.object({
  sku: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/, 'SKU: letters, digits, . _ -'),
  name: shortText,
  attributes: z.record(z.string().max(200)).optional(),
  priceMinor: minor.nullable().optional(),
  stock: z.number().int().min(0).optional(),
  weightGrams: z.number().int().positive().optional(),
});

export const productSchema = z.object({
  storeId: z.string().uuid(),
  categoryId: z.string().uuid().nullable().optional(),
  titleEn: z.string().trim().min(1, 'English title is required').max(300),
  titleZh: z.string().trim().max(300).optional(),
  descriptionEn: longText.optional(),
  descriptionZh: longText.optional(),
  originalLanguage: languageCode.default('en'),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).default('DRAFT'),
  /** Supplier may declare MADE_TO_ORDER / ON_REQUEST. IN_STOCK/LOW_STOCK are derived from verified inventory. */
  stockMode: z.enum(['INVENTORY', 'MADE_TO_ORDER', 'ON_REQUEST']).default('INVENTORY'),
  customizable: z.boolean().default(false),
  oemOdm: z.boolean().default(false),
  moq: z.number().int().min(1).default(1),
  currency,
  basePriceMinor: minor.nullable().optional(),
  leadTimeDays: z.number().int().min(0).max(365).nullable().optional(),
  shipsFrom: z.string().trim().max(100).optional(),
  shipsTo: z.array(country).max(250).default([]),
  shippingMethods: z.array(z.string().trim().max(50)).max(20).default([]),
  specs: z.record(z.string().max(500)).optional(),
  hsCode: z.string().trim().regex(/^\d{4,10}$/).optional(),
  originCountry: country.optional(),
  material: z.string().trim().max(200).optional(),
  intendedUse: z.string().trim().max(300).optional(),
  containsBattery: z.boolean().default(false),
  dangerousGoods: z.boolean().default(false),
  requiredDocuments: z.array(z.string().max(100)).max(20).default([]),
  complianceNotes: longText.optional(),
  restrictedCountries: z.array(country).max(250).default([]),
  isPublic: z.boolean().default(true),
  priceTiers: z.array(priceTierSchema).max(20).default([]),
  variants: z.array(variantSchema).min(1).max(200),
  imageUrls: z.array(z.string().url().max(2000)).max(20).default([]),
});

export const productUpdateSchema = z.object({
  categoryId: z.string().uuid().nullable().optional(),
  titleEn: z.string().trim().max(300).optional(),
  titleZh: z.string().trim().max(300).optional(),
  descriptionEn: longText.optional(),
  descriptionZh: longText.optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  moq: z.number().int().min(1).optional(),
  basePriceMinor: minor.nullable().optional(),
  leadTimeDays: z.number().int().min(0).max(365).nullable().optional(),
  shipsTo: z.array(country).max(250).optional(),
  isPublic: z.boolean().optional(),
  priceTiers: z.array(priceTierSchema).max(20).optional(),
  translationConfirmed: z.boolean().optional(),
});

export const inventoryUpdateSchema = z.object({ onHand: z.number().int().min(0), source: z.enum(['NATIVE', 'MANUAL', 'CONNECTOR', 'IMPORT']).default('MANUAL') });

export const productSearchQuery = paginationQuery.extend({
  q: z.string().trim().max(200).optional(),
  category: z.string().max(100).optional(),
  supplierId: z.string().uuid().optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  currency: currency.optional(),
  supplierType: z.enum(SUPPLIER_TYPES).optional(),
  maxMoq: z.coerce.number().int().min(1).optional(),
  destination: country.optional(),
  shipsFrom: z.string().max(100).optional(),
  stockStatus: z.enum(STOCK_STATUSES).optional(),
  customizable: z.enum(['true', 'false']).optional(),
  verifiedOnly: z.enum(['true', 'false']).optional(),
  includeRemote: z.enum(['true', 'false']).optional(),
  minNodeTrust: z.enum(NODE_TRUST_LEVELS).optional(),
  sort: z.enum(['relevance', 'newest', 'price_asc', 'price_desc', 'moq_asc']).default('relevance'),
});

export const buyingRequestSchema = z.object({
  title: shortText,
  description: z.string().trim().min(10).max(10_000),
  originalLanguage: languageCode.default('en'),
  categoryId: z.string().uuid().nullable().optional(),
  quantity: z.number().int().min(1).max(100_000_000),
  unit: z.string().trim().max(30).default('units'),
  currency: currency.default('USD'),
  targetUnitPriceMinor: minor.nullable().optional(),
  budgetMinMinor: minor.nullable().optional(),
  budgetMaxMinor: minor.nullable().optional(),
  qualityRequirements: longText.optional(),
  specifications: longText.optional(),
  acceptsCustomization: z.boolean().default(false),
  destinationCountry: country,
  deliveryBy: z.coerce.date().optional(),
  needsSample: z.boolean().default(false),
  needsInspection: z.boolean().default(false),
  oemOdm: z.boolean().default(false),
  needsShippingQuote: z.boolean().default(true),
  supplierTypePreference: z.enum(SUPPLIER_TYPES).nullable().optional(),
  otherRequirements: longText.optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE', 'FEDERATED']).default('PUBLIC'),
  expiresInDays: z.number().int().min(1).max(180).default(30),
  externalRefs: z.array(z.object({
    url: z.string().url().max(2000).refine((u) => /^https?:\/\//i.test(u), 'http(s) only'),
    sourceName: z.string().max(100).optional(),
    title: z.string().max(300).optional(),
    referencePriceMinor: minor.optional(),
    currency: currency.optional(),
    notes: z.string().max(2000).optional(),
  })).max(10).default([]),
}).refine((r) => r.budgetMinMinor == null || r.budgetMaxMinor == null || r.budgetMinMinor <= r.budgetMaxMinor, { message: 'Budget min must be <= max', path: ['budgetMinMinor'] });

export const quoteSchema = z.object({
  buyingRequestId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  productName: shortText,
  specifications: longText.optional(),
  availableQty: z.number().int().min(1),
  currency,
  unitPriceMinor: minor,
  moq: z.number().int().min(1).default(1),
  sampleFeeMinor: minor.nullable().optional(),
  domesticShippingMinor: minor.nullable().optional(),
  internationalShippingMinor: minor.nullable().optional(),
  internationalShippingSource: z.enum(['SUPPLIER', 'SYSTEM_ESTIMATE', 'THIRD_PARTY', 'NOT_CONFIRMED']).default('NOT_CONFIRMED'),
  productionDays: z.number().int().min(0).max(365).nullable().optional(),
  shipWithinDays: z.number().int().min(0).max(365).nullable().optional(),
  validDays: z.number().int().min(1).max(180).default(14),
  paymentTerms: z.string().max(2000).optional(),
  qualityGuarantee: z.string().max(2000).optional(),
  returnPolicy: z.string().max(2000).optional(),
  notes: z.string().max(5000).optional(),
  taxIncluded: z.boolean().default(false),
  inspectionRequired: z.boolean().default(false),
  submit: z.boolean().default(true),
}).refine((q) => q.buyingRequestId || q.productId, { message: 'Quote must reference a buying request or product' })
  .refine((q) => (q.internationalShippingMinor == null) === (q.internationalShippingSource === 'NOT_CONFIRMED'), {
    message: 'International shipping amount requires a source; NOT_CONFIRMED must have no amount', path: ['internationalShippingSource'],
  });

export const addressSchema = z.object({
  fullName: shortText, company: z.string().max(200).optional(), line1: shortText, line2: z.string().max(200).optional(),
  city: shortText, region: z.string().max(100).optional(), postalCode: z.string().max(20).optional(), country, phone: z.string().max(40).optional(),
  isDefault: z.boolean().default(false),
});

export const createOrderSchema = z.object({
  idempotencyKey: z.string().min(8).max(100),
  shippingAddressId: z.string().uuid().optional(),
  items: z.array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(10_000_000) })).min(1).max(50).optional(),
  quoteId: z.string().uuid().optional(),
  terms: z.string().max(5000).optional(),
}).refine((o) => !!o.items !== !!o.quoteId, { message: 'Provide either items or quoteId' });

export const supplierConfirmSchema = z.object({
  fees: z.array(z.object({
    type: z.enum(['DOMESTIC_SHIPPING', 'INTERNATIONAL_SHIPPING', 'PACKAGING', 'SOURCING_SERVICE', 'INSPECTION', 'INSURANCE', 'SAMPLE', 'TAX_KNOWN', 'TAX_ESTIMATED', 'OTHER']),
    label: shortText,
    amountMinor: minor.nullable(),
    status: z.enum(['CONFIRMED', 'ESTIMATED', 'NOT_CONFIRMED']),
  })).max(20).default([]),
  note: z.string().max(2000).optional(),
});

export const orderTransitionSchema = z.object({ to: z.enum(ORDER_STATUSES), note: z.string().max(2000).optional() });

export const shipmentSchema = z.object({
  carrier: shortText, trackingNumber: z.string().max(100).optional(), method: z.string().max(50).optional(),
  weightGrams: z.number().int().positive().optional(), insured: z.boolean().default(false), useProvider: z.boolean().default(false),
});
export const shipmentEventSchema = z.object({
  status: z.enum(SHIPMENT_STATUSES), location: z.string().max(200).optional(), description: z.string().max(1000).optional(), occurredAt: z.coerce.date().optional(),
});

export const refundRequestSchema = z.object({ amountMinor: z.number().int().positive(), reason: z.string().trim().min(5).max(5000) });
export const refundDecisionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT', 'MARK_PROCESSED_MANUAL']), note: z.string().max(2000).optional() });
export const disputeSchema = z.object({ reason: z.string().trim().min(10).max(5000) });
export const disputeEvidenceSchema = z.object({ body: z.string().trim().min(1).max(5000), storageKey: z.string().max(300).optional() });
export const disputeResolveSchema = z.object({ outcome: z.enum(['RESOLVED_BUYER_FAVOR', 'RESOLVED_SUPPLIER_FAVOR', 'RESOLVED_PARTIAL', 'CLOSED']), resolution: z.string().trim().min(5).max(5000) });
export const reviewSchema = z.object({ orderId: z.string().uuid(), target: z.enum(['PRODUCT', 'SUPPLIER', 'AGENT', 'LOGISTICS']), productId: z.string().uuid().optional(), rating: z.number().int().min(1).max(5), body: z.string().max(5000).optional() });

export const conversationSchema = z.object({
  subject: z.enum(['BUYING_REQUEST', 'PRODUCT_INQUIRY', 'ORDER', 'GENERAL']),
  buyingRequestId: z.string().uuid().optional(), productId: z.string().uuid().optional(), orderId: z.string().uuid().optional(),
  recipientUserId: z.string().uuid().optional(),
  body: z.string().trim().min(1).max(5000),
});
export const messageSchema = z.object({ body: z.string().trim().min(1).max(5000), attachmentKey: z.string().max(300).optional(), attachmentName: z.string().max(200).optional() });
export const reportSchema = z.object({ targetType: z.enum(['PRODUCT', 'USER', 'MESSAGE', 'BUYING_REQUEST', 'REVIEW', 'SUPPLIER', 'NODE']), targetId: z.string().max(100), reason: z.string().trim().min(5).max(2000) });

export const agentProfileSchema = z.object({
  displayName: shortText,
  serviceRegions: z.array(z.string().max(100)).min(1).max(30),
  languages: z.array(z.string().max(30)).min(1).max(20),
  services: z.array(z.enum(AGENT_SERVICES)).min(1),
  feeStructure: z.string().trim().min(5).max(5000),
  capabilities: z.string().max(5000).optional(),
  maxOrderValueMinor: minor.nullable().optional(),
  currency: currency.default('USD'),
});
export const agentTaskSchema = z.object({
  buyingRequestId: z.string().uuid().optional(), orderId: z.string().uuid().optional(),
  type: z.enum(['SOURCING', 'SUPPLIER_CONTACT', 'SAMPLE', 'INSPECTION', 'WAREHOUSING', 'LOGISTICS']),
  title: shortText, notes: z.string().max(5000).optional(), supplierContact: z.string().max(1000).optional(), feeMinor: minor.nullable().optional(), currency: currency.default('USD'),
});
export const agentTaskUpdateSchema = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(), notes: z.string().max(5000).optional(), supplierContact: z.string().max(1000).optional(), feeMinor: minor.nullable().optional() });

export const connectorSchema = z.object({
  storeId: z.string().uuid(), type: z.enum(['http-json', 'mock']), name: shortText,
  config: z.object({ baseUrl: z.string().url().optional() }).passthrough().default({}),
  secret: z.string().max(4000).optional(),
});

export const importPreviewSchema = z.object({ storeId: z.string().uuid(), filename: z.string().max(200), csv: z.string().min(1).max(5_000_000), mapping: z.record(z.string()).optional() });

export const adminUserUpdateSchema = z.object({ status: z.enum(['ACTIVE', 'DISABLED']).optional(), addRoles: z.array(z.enum(['BUYER', 'SUPPLIER', 'AGENT', 'MODERATOR', 'NODE_ADMIN', 'PLATFORM_ADMIN'])).optional(), removeRoles: z.array(z.enum(['BUYER', 'SUPPLIER', 'AGENT', 'MODERATOR', 'NODE_ADMIN', 'PLATFORM_ADMIN'])).optional() });
export const adminVerificationSchema = z.object({ status: z.enum(VERIFICATION_STATUSES), note: z.string().max(2000).optional() });
export const categorySchema = z.object({ slug: z.string().regex(/^[a-z0-9-]{2,64}$/), nameEn: shortText, nameZh: z.string().trim().max(200).optional(), parentId: z.string().uuid().nullable().optional(), position: z.number().int().default(0) });
export const nodeAdminUpdateSchema = z.object({ status: z.enum(['ACTIVE', 'STALE', 'BANNED']).optional(), trustLevel: z.enum(NODE_TRUST_LEVELS).optional() });
export const settingSchema = z.object({ value: z.unknown() });

export const aiParseSchema = z.object({ text: z.string().trim().min(3).max(5000) });
export const aiTranslateSchema = z.object({ text: z.string().trim().min(1).max(10_000), from: languageCode, to: languageCode });

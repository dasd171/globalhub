// String unions mirroring the Prisma enums, usable in the browser without @prisma/client.
export const ROLE_KEYS = ['BUYER', 'SUPPLIER', 'AGENT', 'MODERATOR', 'NODE_ADMIN', 'PLATFORM_ADMIN'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const STOCK_STATUSES = ['IN_STOCK', 'LOW_STOCK', 'MADE_TO_ORDER', 'ON_REQUEST', 'OUT_OF_STOCK', 'UNVERIFIED'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

export const SUPPLIER_TYPES = ['MANUFACTURER', 'TRADING_COMPANY', 'DISTRIBUTOR', 'WHOLESALER', 'RETAILER', 'OTHER'] as const;
export type SupplierType = (typeof SUPPLIER_TYPES)[number];

export const VERIFICATION_STATUSES = ['UNVERIFIED', 'EMAIL_VERIFIED', 'BUSINESS_DETAILS_SUBMITTED', 'BUSINESS_VERIFIED', 'ADMIN_REVIEWED', 'SUSPENDED'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const QUOTE_STATUSES = ['DRAFT', 'SUBMITTED', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const ORDER_STATUSES = [
  'DRAFT', 'PENDING_SUPPLIER_CONFIRMATION', 'AWAITING_PAYMENT', 'PAID', 'PROCESSING', 'READY_TO_SHIP',
  'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLATION_REQUESTED', 'CANCELLED',
  'REFUND_REQUESTED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'DISPUTED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const REFUND_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'PROCESSED_MANUAL', 'PROCESSED_PROVIDER'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const FEE_TYPES = [
  'PRODUCT', 'DOMESTIC_SHIPPING', 'INTERNATIONAL_SHIPPING', 'PACKAGING', 'SOURCING_SERVICE', 'INSPECTION',
  'INSURANCE', 'SAMPLE', 'TAX_KNOWN', 'TAX_ESTIMATED', 'OTHER',
] as const;
export type FeeType = (typeof FEE_TYPES)[number];
export type FeeStatus = 'CONFIRMED' | 'ESTIMATED' | 'NOT_CONFIRMED';
export type DataSource = 'SUPPLIER' | 'SYSTEM_ESTIMATE' | 'THIRD_PARTY' | 'NOT_CONFIRMED';

export const SHIPMENT_STATUSES = ['LABEL_CREATED', 'PICKED_UP', 'IN_TRANSIT', 'CUSTOMS', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION', 'RETURNED'] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const AGENT_SERVICES = [
  'LOCAL_SOURCING', 'FACTORY_SOURCING', 'SUPPLIER_CONTACT', 'SAMPLE_PURCHASING', 'INSPECTION', 'CONSOLIDATION',
  'WAREHOUSING', 'REPACKAGING', 'EXPORT_DOCUMENTS', 'LOGISTICS_COORDINATION', 'OEM_ODM', 'RETURNS',
] as const;
export type AgentService = (typeof AGENT_SERVICES)[number];

export const NODE_TRUST_LEVELS = ['UNVERIFIED', 'DOMAIN_VERIFIED', 'BUSINESS_VERIFIED', 'ADMIN_REVIEWED'] as const;
export type NodeTrustLevel = (typeof NODE_TRUST_LEVELS)[number];

export const DISPUTE_STATUSES = ['OPEN', 'AWAITING_SUPPLIER', 'AWAITING_BUYER', 'UNDER_REVIEW', 'RESOLVED_BUYER_FAVOR', 'RESOLVED_SUPPLIER_FAVOR', 'RESOLVED_PARTIAL', 'CLOSED'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/** Stock statuses that may only be shown when a supplier actually confirmed them. */
export const CONFIRMED_STOCK_STATUSES: StockStatus[] = ['IN_STOCK', 'LOW_STOCK'];

import { AppError } from '@globalhub/shared';

export const CONNECTOR_CAPABILITIES = ['searchProducts', 'getProduct', 'getInventory', 'requestQuote', 'createOrder', 'getOrderStatus', 'cancelOrder'] as const;
export type ConnectorCapability = (typeof CONNECTOR_CAPABILITIES)[number];

export interface ConnectorProduct {
  externalId: string;
  sku: string;
  title: string;
  description?: string;
  currency: string;
  priceMinor: number | null;
  moq: number;
  imageUrls?: string[];
}
export interface ConnectorInventory { sku: string; onHand: number; asOf: string }
export interface ConnectorQuoteRequest { sku: string; quantity: number; destinationCountry: string; notes?: string }
export interface ConnectorQuoteResponse { reference: string; status: 'RECEIVED' | 'QUOTED'; unitPriceMinor?: number; currency?: string }
export interface ConnectorOrderRequest { reference: string; items: { sku: string; quantity: number }[]; shipTo: { country: string } }
export interface ConnectorOrderResult { externalOrderId: string; status: string }

/**
 * Contract every supplier connector implements. Capabilities MUST reflect what the remote
 * system really supports; unsupported operations throw NOT_SUPPORTED instead of pretending.
 */
export interface SupplierConnector {
  readonly type: string;
  readonly capabilities: ReadonlySet<ConnectorCapability>;
  searchProducts(query: string, limit?: number): Promise<ConnectorProduct[]>;
  getProduct(externalId: string): Promise<ConnectorProduct | null>;
  getInventory(skus: string[]): Promise<ConnectorInventory[]>;
  requestQuote(req: ConnectorQuoteRequest): Promise<ConnectorQuoteResponse>;
  createOrder(req: ConnectorOrderRequest): Promise<ConnectorOrderResult>;
  getOrderStatus(externalOrderId: string): Promise<ConnectorOrderResult>;
  cancelOrder(externalOrderId: string): Promise<ConnectorOrderResult>;
}

export function assertCapability(c: SupplierConnector, cap: ConnectorCapability): void {
  if (!c.capabilities.has(cap)) throw new AppError('NOT_SUPPORTED', `Connector "${c.type}" does not support ${cap}`);
}

export abstract class BaseConnector implements SupplierConnector {
  abstract readonly type: string;
  abstract readonly capabilities: ReadonlySet<ConnectorCapability>;
  protected unsupported(cap: ConnectorCapability): never { throw new AppError('NOT_SUPPORTED', `Connector "${this.type}" does not support ${cap}`); }
  async searchProducts(_q: string, _l?: number): Promise<ConnectorProduct[]> { return this.unsupported('searchProducts'); }
  async getProduct(_id: string): Promise<ConnectorProduct | null> { return this.unsupported('getProduct'); }
  async getInventory(_s: string[]): Promise<ConnectorInventory[]> { return this.unsupported('getInventory'); }
  async requestQuote(_r: ConnectorQuoteRequest): Promise<ConnectorQuoteResponse> { return this.unsupported('requestQuote'); }
  async createOrder(_r: ConnectorOrderRequest): Promise<ConnectorOrderResult> { return this.unsupported('createOrder'); }
  async getOrderStatus(_id: string): Promise<ConnectorOrderResult> { return this.unsupported('getOrderStatus'); }
  async cancelOrder(_id: string): Promise<ConnectorOrderResult> { return this.unsupported('cancelOrder'); }
}

import { BaseConnector, type ConnectorCapability, type ConnectorProduct, type ConnectorInventory, type ConnectorQuoteRequest, type ConnectorQuoteResponse } from './connector.js';

/**
 * Deterministic in-memory connector for development and tests. It deliberately does NOT
 * support order operations so the UI/API exercise the "not supported" path honestly.
 * Every product it returns is flagged as demo data.
 */
export class MockConnector extends BaseConnector {
  readonly type = 'mock';
  readonly capabilities: ReadonlySet<ConnectorCapability> = new Set(['searchProducts', 'getProduct', 'getInventory', 'requestQuote']);
  private products: ConnectorProduct[] = [
    { externalId: 'mock-1', sku: 'MOCK-TENT-01', title: '[DEMO] Mock connector tent', currency: 'USD', priceMinor: 9900, moq: 10 },
    { externalId: 'mock-2', sku: 'MOCK-HUB-01', title: '[DEMO] Mock connector USB-C hub', currency: 'USD', priceMinor: 4500, moq: 50 },
  ];
  async searchProducts(q: string, limit = 20) { return this.products.filter((p) => p.title.toLowerCase().includes(q.toLowerCase())).slice(0, limit); }
  async getProduct(id: string) { return this.products.find((p) => p.externalId === id) ?? null; }
  async getInventory(skus: string[]): Promise<ConnectorInventory[]> { return skus.filter((s) => this.products.some((p) => p.sku === s)).map((sku) => ({ sku, onHand: 100, asOf: new Date().toISOString() })); }
  async requestQuote(r: ConnectorQuoteRequest): Promise<ConnectorQuoteResponse> { return { reference: `mock-rfq-${r.sku}-${r.quantity}`, status: 'RECEIVED' }; }
}

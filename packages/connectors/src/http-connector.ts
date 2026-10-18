import { z } from 'zod';
import { safeFetch } from '@globalhub/federation';
import { AppError } from '@globalhub/shared';
import { BaseConnector, CONNECTOR_CAPABILITIES, type ConnectorCapability, type ConnectorProduct, type ConnectorInventory, type ConnectorQuoteRequest, type ConnectorQuoteResponse, type ConnectorOrderRequest, type ConnectorOrderResult } from './connector.js';

const productSchema = z.object({
  externalId: z.string().max(200), sku: z.string().max(64), title: z.string().max(300), description: z.string().max(10000).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/), priceMinor: z.number().int().nonnegative().nullable(), moq: z.number().int().min(1), imageUrls: z.array(z.string().url()).max(20).optional(),
});

/**
 * Generic JSON-over-HTTPS connector for supplier ERPs that implement the documented
 * GlobalHub Connector HTTP contract (see docs/connectors.md). Capabilities come from the
 * supplier's /capabilities endpoint, so unsupported operations are never faked.
 */
export class HttpJsonConnector extends BaseConnector {
  readonly type = 'http-json';
  capabilities: ReadonlySet<ConnectorCapability>;
  constructor(private baseUrl: string, private apiKey: string | undefined, capabilities: ConnectorCapability[], private opts: { allowPrivate?: boolean } = {}) {
    super();
    this.capabilities = new Set(capabilities.filter((c) => (CONNECTOR_CAPABILITIES as readonly string[]).includes(c)));
  }

  static async discover(baseUrl: string, apiKey?: string, opts: { allowPrivate?: boolean } = {}): Promise<HttpJsonConnector> {
    const c = new HttpJsonConnector(baseUrl, apiKey, [], opts);
    const res = await c.call('GET', '/capabilities');
    const caps = z.object({ capabilities: z.array(z.string()).max(20) }).parse(res).capabilities as ConnectorCapability[];
    return new HttpJsonConnector(baseUrl, apiKey, caps, opts);
  }

  private async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const res = await safeFetch(new URL(path.replace(/^\//, ''), this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`).toString(), {
      method, body: body ? JSON.stringify(body) : undefined, headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {},
      allowPrivate: this.opts.allowPrivate, allowHttp: this.opts.allowPrivate, timeoutMs: 10_000, maxBytes: 5_000_000,
    });
    if (res.status >= 400) throw new AppError('BAD_REQUEST', `Connector responded ${res.status}`);
    try { return JSON.parse(res.body); } catch { throw new AppError('BAD_REQUEST', 'Connector returned invalid JSON'); }
  }

  async searchProducts(q: string, limit = 20): Promise<ConnectorProduct[]> {
    if (!this.capabilities.has('searchProducts')) return this.unsupported('searchProducts');
    const r = await this.call('GET', `/products?q=${encodeURIComponent(q)}&limit=${limit}`);
    return z.object({ items: z.array(productSchema).max(500) }).parse(r).items;
  }
  async getProduct(id: string) {
    if (!this.capabilities.has('getProduct')) return this.unsupported('getProduct');
    return productSchema.parse(await this.call('GET', `/products/${encodeURIComponent(id)}`));
  }
  async getInventory(skus: string[]): Promise<ConnectorInventory[]> {
    if (!this.capabilities.has('getInventory')) return this.unsupported('getInventory');
    const r = await this.call('POST', '/inventory', { skus });
    return z.object({ items: z.array(z.object({ sku: z.string(), onHand: z.number().int().min(0), asOf: z.string() })) }).parse(r).items;
  }
  async requestQuote(req: ConnectorQuoteRequest): Promise<ConnectorQuoteResponse> {
    if (!this.capabilities.has('requestQuote')) return this.unsupported('requestQuote');
    return z.object({ reference: z.string(), status: z.enum(['RECEIVED', 'QUOTED']), unitPriceMinor: z.number().int().optional(), currency: z.string().optional() }).parse(await this.call('POST', '/quotes', req));
  }
  async createOrder(req: ConnectorOrderRequest): Promise<ConnectorOrderResult> {
    if (!this.capabilities.has('createOrder')) return this.unsupported('createOrder');
    return z.object({ externalOrderId: z.string(), status: z.string() }).parse(await this.call('POST', '/orders', req));
  }
  async getOrderStatus(id: string): Promise<ConnectorOrderResult> {
    if (!this.capabilities.has('getOrderStatus')) return this.unsupported('getOrderStatus');
    return z.object({ externalOrderId: z.string(), status: z.string() }).parse(await this.call('GET', `/orders/${encodeURIComponent(id)}`));
  }
  async cancelOrder(id: string): Promise<ConnectorOrderResult> {
    if (!this.capabilities.has('cancelOrder')) return this.unsupported('cancelOrder');
    return z.object({ externalOrderId: z.string(), status: z.string() }).parse(await this.call('POST', `/orders/${encodeURIComponent(id)}/cancel`));
  }
}

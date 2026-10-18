import { randomUUID } from 'node:crypto';
import { AppError } from '@globalhub/shared';
import { hmacSha256Hex, safeEqual } from '../crypto.js';

export interface CreatePaymentInput { orderId: string; orderNumber: string; amountMinor: number; currency: string; idempotencyKey: string; returnUrl: string }
export interface CreatePaymentResult { providerRef: string; nextAction: { type: 'redirect'; url: string } | { type: 'demo_confirm' } | { type: 'manual_instructions'; text: string } }

/** A provider event after signature verification. */
export interface VerifiedPaymentEvent {
  eventId: string;
  type: 'payment.succeeded' | 'payment.failed' | 'refund.succeeded' | 'other';
  providerRef: string;
  amountMinor: number;
  currency: string;
  orderId?: string;
  raw: unknown;
}

export interface PaymentProvider {
  readonly name: string;
  /** true = no real money moves (mock). Displayed prominently in the UI. */
  readonly isDemo: boolean;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /** Verify signature/origin and parse; throws on invalid signature. */
  verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): VerifiedPaymentEvent;
  refund(providerRef: string, amountMinor: number, currency: string): Promise<{ refundRef: string; status: 'pending' | 'succeeded' }>;
}

export const DEMO_PAYMENT_BANNER = 'DEMO PAYMENT — NO REAL MONEY MOVED';

const h = (headers: Record<string, string | string[] | undefined>, k: string) => { const v = headers[k]; return Array.isArray(v) ? v[0] : v; };

/**
 * Mock provider for development/demo. Payments are confirmed through a webhook that is
 * HMAC-signed with MOCK_PAYMENT_WEBHOOK_SECRET — the same verified-webhook path a real
 * provider uses, so the browser redirect is never trusted as proof of payment.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  readonly isDemo = true;
  constructor(private secret: string) {}
  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    return { providerRef: `mock_pi_${input.idempotencyKey}`, nextAction: { type: 'demo_confirm' } };
  }
  /** Used by the demo-confirm endpoint and tests to build a signed webhook. */
  buildSignedEvent(event: { type: VerifiedPaymentEvent['type']; providerRef: string; amountMinor: number; currency: string; orderId: string; eventId?: string }) {
    const { eventId, ...rest } = event;
    const body = JSON.stringify({ id: eventId ?? `mock_evt_${randomUUID()}`, ...rest });
    return { body, signature: hmacSha256Hex(this.secret, body) };
  }
  verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): VerifiedPaymentEvent {
    const sig = h(headers, 'x-mock-signature');
    if (!sig || !safeEqual(sig, hmacSha256Hex(this.secret, rawBody))) throw new AppError('UNAUTHENTICATED', 'Invalid webhook signature');
    const e = JSON.parse(rawBody);
    return { eventId: String(e.id), type: e.type, providerRef: String(e.providerRef), amountMinor: Number(e.amountMinor), currency: String(e.currency), orderId: e.orderId, raw: e };
  }
  async refund(providerRef: string) { return { refundRef: `mock_re_${providerRef}_${Date.now()}`, status: 'succeeded' as const }; }
}

/** Offline bank-transfer registration. Payment is confirmed by the supplier/admin recording receipt; never automatic. */
export class ManualPaymentProvider implements PaymentProvider {
  readonly name = 'manual';
  readonly isDemo = false;
  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    return { providerRef: `manual_${input.idempotencyKey}`, nextAction: { type: 'manual_instructions', text: `Pay by bank transfer referencing order ${input.orderNumber}. The supplier confirms receipt manually.` } };
  }
  verifyWebhook(): VerifiedPaymentEvent { throw new AppError('NOT_SUPPORTED', 'Manual provider has no webhooks'); }
  async refund(): Promise<never> { throw new AppError('NOT_SUPPORTED', 'Manual payments are refunded outside the system and recorded manually'); }
}

/**
 * Stripe adapter (Checkout Sessions + signed webhooks) via the REST API.
 * Not exercised against live Stripe in CI; signature verification is unit-tested.
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';
  readonly isDemo = false;
  constructor(private secretKey: string, private webhookSecret: string, private toleranceSec = 300) {}
  private async api(path: string, form: Record<string, string>, idem?: string) {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.secretKey}`, 'content-type': 'application/x-www-form-urlencoded', ...(idem ? { 'idempotency-key': idem } : {}) },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new AppError('PAYMENT_ERROR', `Stripe error: ${(json.error as { message?: string })?.message ?? res.status}`);
    return json;
  }
  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const s = await this.api('/checkout/sessions', {
      mode: 'payment', success_url: input.returnUrl, cancel_url: input.returnUrl,
      'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': input.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(input.amountMinor), 'line_items[0][price_data][product_data][name]': `Order ${input.orderNumber}`,
      'metadata[orderId]': input.orderId,
    }, input.idempotencyKey);
    return { providerRef: String(s.id), nextAction: { type: 'redirect', url: String(s.url) } };
  }
  verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): VerifiedPaymentEvent {
    const header = h(headers, 'stripe-signature') ?? '';
    const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
    const t = Number(parts.t);
    if (!t || !parts.v1) throw new AppError('UNAUTHENTICATED', 'Missing Stripe signature');
    if (Math.abs(Date.now() / 1000 - t) > this.toleranceSec) throw new AppError('UNAUTHENTICATED', 'Stale Stripe signature');
    if (!safeEqual(parts.v1, hmacSha256Hex(this.webhookSecret, `${t}.${rawBody}`))) throw new AppError('UNAUTHENTICATED', 'Invalid Stripe signature');
    const e = JSON.parse(rawBody);
    const obj = e.data?.object ?? {};
    const type: VerifiedPaymentEvent['type'] = e.type === 'checkout.session.completed' && obj.payment_status === 'paid' ? 'payment.succeeded'
      : e.type === 'checkout.session.async_payment_failed' ? 'payment.failed' : 'other';
    return { eventId: e.id, type, providerRef: obj.id, amountMinor: Number(obj.amount_total ?? 0), currency: String(obj.currency ?? '').toUpperCase(), orderId: obj.metadata?.orderId, raw: e };
  }
  async refund(providerRef: string, amountMinor: number) {
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(providerRef)}`, { headers: { authorization: `Bearer ${this.secretKey}` }, signal: AbortSignal.timeout(15_000) });
    const session = (await res.json()) as { payment_intent?: string };
    const r = await this.api('/refunds', { payment_intent: String(session.payment_intent), amount: String(amountMinor) });
    return { refundRef: String(r.id), status: r.status === 'succeeded' ? 'succeeded' as const : 'pending' as const };
  }
}

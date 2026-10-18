import { describe, it, expect } from 'vitest';
import { generateNodeKeyPair, signRequest, verifySignature, isPrivateAddress, safeFetch, UnsafeUrlError } from '@globalhub/federation';
import { MockPaymentProvider, StripePaymentProvider, loadConfig, encryptSecret, decryptSecret, redact, hmacSha256Hex, validateUpload, RulesAiProvider } from '@globalhub/core';
import { previewCsv } from '@globalhub/connectors';

describe('node request signing', () => {
  const kp = generateNodeKeyPair('k1');
  const other = generateNodeKeyPair('k2');
  const body = JSON.stringify({ hello: 'world' });
  const headers = signRequest({ method: 'POST', path: '/api/v1/federation/inbox/rfq', body, nodeId: 'node-a', keyId: 'k1', privateKeyPem: kp.privateKeyPem });
  it('verifies a valid signature', () => {
    const v = verifySignature({ method: 'POST', path: '/api/v1/federation/inbox/rfq', body, headers, publicKeyPem: kp.publicKeyPem });
    expect(v.ok).toBe(true);
  });
  it('rejects tampered body, path, wrong key, stale timestamp and missing headers', () => {
    expect(verifySignature({ method: 'POST', path: '/api/v1/federation/inbox/rfq', body: body + ' ', headers, publicKeyPem: kp.publicKeyPem }).ok).toBe(false);
    expect(verifySignature({ method: 'POST', path: '/api/v1/federation/inbox/quote', body, headers, publicKeyPem: kp.publicKeyPem }).ok).toBe(false);
    expect(verifySignature({ method: 'POST', path: '/api/v1/federation/inbox/rfq', body, headers, publicKeyPem: other.publicKeyPem }).ok).toBe(false);
    const old = signRequest({ method: 'POST', path: '/x', body, nodeId: 'node-a', keyId: 'k1', privateKeyPem: kp.privateKeyPem, now: new Date(Date.now() - 3600_000) });
    expect(verifySignature({ method: 'POST', path: '/x', body, headers: old, publicKeyPem: kp.publicKeyPem })).toEqual({ ok: false, reason: 'stale_timestamp' });
    expect(verifySignature({ method: 'POST', path: '/x', body, headers: {}, publicKeyPem: kp.publicKeyPem })).toEqual({ ok: false, reason: 'missing_headers' });
  });
  it('binds the signature to the node id', () => {
    const forged = { ...headers, 'x-globalhub-node': 'node-evil' };
    expect(verifySignature({ method: 'POST', path: '/api/v1/federation/inbox/rfq', body, headers: forged, publicKeyPem: kp.publicKeyPem }).ok).toBe(false);
  });
});

describe('SSRF protection', () => {
  it('classifies private and reserved addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.5.4', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it('refuses private targets, non-http protocols, credentials and plain http', async () => {
    await expect(safeFetch('http://169.254.169.254/latest/meta-data', { allowHttp: true })).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeFetch('https://127.0.0.1/')).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeFetch('https://localhost/')).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeFetch('file:///etc/passwd')).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeFetch('http://example.com/')).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeFetch('https://user:pw@example.com/')).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});

describe('payment webhooks', () => {
  it('mock provider verifies HMAC signatures', () => {
    const p = new MockPaymentProvider('s3cret');
    const { body, signature } = p.buildSignedEvent({ type: 'payment.succeeded', providerRef: 'pi_1', amountMinor: 100, currency: 'USD', orderId: 'o1' });
    expect(p.verifyWebhook(body, { 'x-mock-signature': signature }).amountMinor).toBe(100);
    expect(() => p.verifyWebhook(body, { 'x-mock-signature': 'bad' })).toThrow();
    expect(() => p.verifyWebhook(body.replace('100', '1'), { 'x-mock-signature': signature })).toThrow();
    expect(p.isDemo).toBe(true);
  });
  it('stripe adapter verifies t/v1 signatures and tolerance', () => {
    const s = new StripePaymentProvider('sk_test_x', 'whsec_test');
    const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid', amount_total: 5000, currency: 'usd', metadata: { orderId: 'o1' } } } });
    const t = Math.floor(Date.now() / 1000);
    const ev = s.verifyWebhook(body, { 'stripe-signature': `t=${t},v1=${hmacSha256Hex('whsec_test', `${t}.${body}`)}` });
    expect(ev).toMatchObject({ type: 'payment.succeeded', amountMinor: 5000, currency: 'USD', orderId: 'o1' });
    expect(() => s.verifyWebhook(body, { 'stripe-signature': `t=${t},v1=deadbeef` })).toThrow();
    const old = t - 3600;
    expect(() => s.verifyWebhook(body, { 'stripe-signature': `t=${old},v1=${hmacSha256Hex('whsec_test', `${old}.${body}`)}` })).toThrow(/Stale/);
  });
});

describe('configuration safety', () => {
  const prod = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://ch:Str0ng-Rand0m@db/ch', AUTH_SECRET: 'x'.repeat(40), APP_ENCRYPTION_KEY: 'a'.repeat(64), APP_BASE_URL: 'https://shop.example', PAYMENT_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh' };
  it('accepts a complete production config', () => { expect(loadConfig(prod as never).isProduction).toBe(true); });
  it('refuses mock payments, weak secrets and missing keys in production', () => {
    expect(() => loadConfig({ ...prod, PAYMENT_PROVIDER: 'mock' } as never)).toThrow(/mock/);
    expect(() => loadConfig({ ...prod, AUTH_SECRET: 'changeme-changeme-changeme-changeme' } as never)).toThrow(/AUTH_SECRET/);
    expect(() => loadConfig({ ...prod, APP_ENCRYPTION_KEY: undefined } as never)).toThrow(/APP_ENCRYPTION_KEY/);
    expect(() => loadConfig({ ...prod, DATABASE_URL: 'postgresql://ch:postgres@db/ch' } as never)).toThrow(/weak/);
    expect(() => loadConfig({ ...prod, FEDERATION_ENABLED: 'true', NODE_PUBLIC_URL: 'http://x.example' } as never)).toThrow(/NODE_PUBLIC_URL/);
  });
  it('allows mock payments in development', () => {
    expect(loadConfig({ DATABASE_URL: 'postgresql://x', AUTH_SECRET: 'dev-secret-1234567890' } as never).mockPaymentsAllowed).toBe(true);
  });
});

describe('secrets, redaction and uploads', () => {
  it('encrypts connector secrets with AES-GCM', () => {
    const enc = encryptSecret('api-key-123', 'a'.repeat(64));
    expect(enc.ciphertext).not.toContain('api-key');
    expect(decryptSecret(enc, 'a'.repeat(64))).toBe('api-key-123');
    expect(() => decryptSecret({ ...enc, tag: Buffer.alloc(16).toString('base64') }, 'a'.repeat(64))).toThrow();
  });
  it('redacts sensitive keys', () => {
    expect(redact({ password: 'x', nested: { apiKey: 'y', ok: 1 } })).toEqual({ password: '[REDACTED]', nested: { apiKey: '[REDACTED]', ok: 1 } });
  });
  it('validates upload type by magic bytes and size', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(validateUpload(png, 'image/png', 1000).ext).toBe('png');
    expect(() => validateUpload(Buffer.from('<svg onload=alert(1)>'), 'image/svg+xml', 1000)).toThrow(/not allowed/);
    expect(() => validateUpload(Buffer.from('<html>'), 'image/png', 1000)).toThrow(/does not match/);
    expect(() => validateUpload(png, 'image/png', 5)).toThrow(/exceeds/);
  });
});

describe('CSV import preview', () => {
  it('maps header aliases, detects duplicate and existing SKUs and reports row errors', () => {
    const csv = 'Item Code,Product Name,Unit Price,Currency,Inventory,Minimum Order Quantity,ships_to\nA-1,Tent,120.50,USD,10,1,JP|US\nA-1,Tent 2,99,USD,5,1,JP\nB-2,,10,USD,1,1,JP\nC-3,Cup,abc,USD,1,0,JAPAN\nEXIST,Old item,1,USD,1,1,\n';
    const p = previewCsv(csv, undefined, new Set(['EXIST']));
    expect(p.valid.map((r) => r.sku)).toEqual(['A-1']);
    expect(p.valid[0]).toMatchObject({ priceMinor: 12050, stock: 10, shipsTo: ['JP', 'US'] });
    const msgs = p.errors.map((e) => `${e.rowNumber}:${e.field}`);
    expect(msgs).toEqual(expect.arrayContaining(['3:sku', '4:title_en', '5:price', '5:moq', '5:ships_to', '6:sku']));
  });
});

describe('AI fallback (no API key)', () => {
  it('passes text through untranslated, normalises spec keys; summaries are advisory', async () => {
    const ai = new RulesAiProvider();
    const t = await ai.translateText('waterproof camping tent', 'en', 'es');
    expect(t).toMatchObject({ text: 'waterproof camping tent', needsReview: true, complete: false });
    expect(await ai.normalizeProductSpecs({ Colour: 'green', 'Net Weight': '2kg', 'Pole Material': 'fiberglass' })).toEqual({ color: 'green', weight: '2kg', pole_material: 'fiberglass' });
    const s = await ai.summarizeQuotes([{ id: '1', supplierName: 'A', currency: 'USD', unitPriceMinor: 1000, moq: 10, availableQty: 100, productionDays: 5, internationalShippingSource: 'NOT_CONFIRMED', validUntil: new Date() }]);
    expect(s).toMatch(/lowest unit price/);
    expect(s).toMatch(/not yet confirmed/);
  });
});

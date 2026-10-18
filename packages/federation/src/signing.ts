import { createHash, generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify, randomUUID, KeyObject } from 'node:crypto';

export const SIG_HEADERS = {
  node: 'x-globalhub-node',
  keyId: 'x-globalhub-key-id',
  timestamp: 'x-globalhub-timestamp',
  nonce: 'x-globalhub-nonce',
  signature: 'x-globalhub-signature',
  idempotency: 'idempotency-key',
} as const;

export const MAX_CLOCK_SKEW_SECONDS = 300;

export interface NodeKeyPair {
  keyId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

export function generateNodeKeyPair(keyId = `k-${Date.now()}`): NodeKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    keyId,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Canonical string covered by the signature. */
export function canonicalString(p: { method: string; path: string; timestamp: string; nonce: string; nodeId: string; body: string }): string {
  return [p.method.toUpperCase(), p.path, p.timestamp, p.nonce, p.nodeId, sha256Hex(p.body)].join('\n');
}

export function signRequest(opts: { method: string; path: string; body: string; nodeId: string; keyId: string; privateKeyPem: string; now?: Date; nonce?: string }): Record<string, string> {
  const timestamp = String(Math.floor((opts.now ?? new Date()).getTime() / 1000));
  const nonce = opts.nonce ?? randomUUID();
  const key: KeyObject = createPrivateKey(opts.privateKeyPem);
  const sig = sign(null, Buffer.from(canonicalString({ method: opts.method, path: opts.path, timestamp, nonce, nodeId: opts.nodeId, body: opts.body })), key);
  return {
    [SIG_HEADERS.node]: opts.nodeId,
    [SIG_HEADERS.keyId]: opts.keyId,
    [SIG_HEADERS.timestamp]: timestamp,
    [SIG_HEADERS.nonce]: nonce,
    [SIG_HEADERS.signature]: sig.toString('base64'),
  };
}

export type VerifyFailure = 'missing_headers' | 'stale_timestamp' | 'bad_signature' | 'bad_key';

export function verifySignature(opts: {
  method: string; path: string; body: string; headers: Record<string, string | string[] | undefined>; publicKeyPem: string; now?: Date;
}): { ok: true; nodeId: string; nonce: string; timestamp: number } | { ok: false; reason: VerifyFailure } {
  const h = (k: string) => { const v = opts.headers[k]; return Array.isArray(v) ? v[0] : v; };
  const nodeId = h(SIG_HEADERS.node); const ts = h(SIG_HEADERS.timestamp); const nonce = h(SIG_HEADERS.nonce); const sig = h(SIG_HEADERS.signature);
  if (!nodeId || !ts || !nonce || !sig || !/^\d{1,12}$/.test(ts) || nonce.length > 100) return { ok: false, reason: 'missing_headers' };
  const now = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - Number(ts)) > MAX_CLOCK_SKEW_SECONDS) return { ok: false, reason: 'stale_timestamp' };
  let key: KeyObject;
  try { key = createPublicKey(opts.publicKeyPem); } catch { return { ok: false, reason: 'bad_key' }; }
  const ok = verify(null, Buffer.from(canonicalString({ method: opts.method, path: opts.path, timestamp: ts, nonce, nodeId, body: opts.body })), key, Buffer.from(sig, 'base64'));
  return ok ? { ok: true, nodeId, nonce, timestamp: Number(ts) } : { ok: false, reason: 'bad_signature' };
}

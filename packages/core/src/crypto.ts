import { createHash, createHmac, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const hmacSha256Hex = (key: string, data: string) => createHmac('sha256', key).update(data).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a); const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function keyFrom(secret: string): Buffer {
  return /^[0-9a-f]{64}$/i.test(secret) ? Buffer.from(secret, 'hex') : createHash('sha256').update(secret).digest();
}

/** AES-256-GCM encryption for secrets at rest (connector credentials). */
export function encryptSecret(plain: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

export function decryptSecret(enc: { ciphertext: string; iv: string; tag: string }, secret: string): string {
  const d = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(enc.iv, 'base64'));
  d.setAuthTag(Buffer.from(enc.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc.ciphertext, 'base64')), d.final()]).toString('utf8');
}

/** Redact secrets from arbitrary objects before logging/auditing. */
const SENSITIVE = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|card|cvv|private/i;
export function redact<T>(value: T, depth = 0): T {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SENSITIVE.test(k) ? '[REDACTED]' : redact(v, depth + 1);
  return out as T;
}

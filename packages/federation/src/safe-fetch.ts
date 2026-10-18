import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import http from 'node:http';
import https from 'node:https';

export class UnsafeUrlError extends Error {}

/** Returns true if the IP belongs to a private, loopback, link-local, CGNAT, multicast or reserved range. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v === '::' || v === '::1') return true;
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('ff');
}

export interface SafeFetchOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  /** Development/testing only: allow http:// and private addresses (e.g. two nodes on localhost). */
  allowPrivate?: boolean;
  allowHttp?: boolean;
}

export interface SafeResponse { status: number; headers: http.IncomingHttpHeaders; body: string }

/**
 * Outbound HTTP for federation and connectors with SSRF protection:
 * - only http(s); http only when explicitly allowed
 * - hostname resolved once, every resolved address checked, connection pinned to the vetted
 *   address (prevents DNS rebinding between check and connect)
 * - redirects are not followed
 * - response size and time limited
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new UnsafeUrlError('Invalid URL'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && opts.allowHttp)) throw new UnsafeUrlError(`Protocol ${url.protocol} not allowed`);
  if (url.username || url.password) throw new UnsafeUrlError('Credentials in URL not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await dnsLookup(host, { all: true });
  if (addrs.length === 0) throw new UnsafeUrlError('Host did not resolve');
  if (!opts.allowPrivate && addrs.some((a) => isPrivateAddress(a.address))) throw new UnsafeUrlError('Target resolves to a private or reserved address');
  const pinned = addrs[0];
  const lookup: LookupFunction = (_h, options, cb) => {
    if ((options as { all?: boolean }).all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: pinned.address, family: pinned.family }]);
    else cb(null, pinned.address, pinned.family);
  };
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise<SafeResponse>((resolve, reject) => {
    const req = lib.request(url, {
      method: opts.method ?? 'GET',
      headers: { 'user-agent': 'GlobalHub-Node/0.1', accept: 'application/json', ...(opts.body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(opts.body).toString() } : {}), ...opts.headers },
      lookup,
      timeout: opts.timeoutMs ?? 10_000,
    }, (res) => {
      if ((res.statusCode ?? 0) >= 300 && (res.statusCode ?? 0) < 400) { res.resume(); reject(new UnsafeUrlError('Redirects are not followed')); return; }
      let size = 0; const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(new UnsafeUrlError(`Response exceeds ${maxBytes} bytes`)); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

import type { ApiErrorBody } from '@globalhub/shared';

export class ApiClientError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Bearer token for server-to-server / CLI use. */
  token?: string;
  /** Forwarded cookie header (server-side rendering). */
  cookie?: string;
  /** CSRF token for cookie-authenticated browser requests. */
  csrfToken?: () => string | undefined;
  fetchImpl?: typeof fetch;
  locale?: string;
}

/** Minimal typed client for the GlobalHub REST API (/api/v1). */
export function createApiClient(opts: ApiClientOptions) {
  const f = opts.fetchImpl ?? fetch;
  async function request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.cookie) headers.cookie = opts.cookie;
    if (opts.locale) headers['accept-language'] = opts.locale;
    const csrf = opts.csrfToken?.();
    if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;
    const res = await f(`${opts.baseUrl.replace(/\/$/, '')}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'include', cache: 'no-store', ...init });
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const e = (data as ApiErrorBody | undefined)?.error;
      throw new ApiClientError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? `HTTP ${res.status}`, e?.details);
    }
    return data as T;
  }
  return {
    request,
    get: <T = any>(p: string) => request<T>('GET', p),
    post: <T = any>(p: string, b: unknown = {}) => request<T>('POST', p, b),
    patch: <T = any>(p: string, b: unknown = {}) => request<T>('PATCH', p, b),
    put: <T = any>(p: string, b: unknown = {}) => request<T>('PUT', p, b),
    del: <T = any>(p: string) => request<T>('DELETE', p),
  };
}
export type ApiClient = ReturnType<typeof createApiClient>;

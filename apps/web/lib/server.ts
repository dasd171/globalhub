import { cookies, headers } from 'next/headers';
import { createApiClient, ApiClientError } from '@globalhub/api-client';
import { normalizeLocale, translator, type Locale } from '@globalhub/i18n';

export const API_INTERNAL_URL = process.env.API_INTERNAL_URL || 'http://localhost:4000';

export async function getLocale(): Promise<Locale> {
  const c = (await cookies()).get('gh_locale')?.value;
  if (c) return normalizeLocale(c);
  return normalizeLocale((await headers()).get('accept-language'));
}

export async function getT() { return translator(await getLocale()); }

export async function serverApi() {
  const jar = await cookies();
  const cookie = jar.getAll().map((c) => `${c.name}=${c.value}`).join('; ');
  return createApiClient({ baseUrl: API_INTERNAL_URL, cookie, locale: await getLocale() });
}

export interface Me { id: string; email: string; displayName: string; roles: string[]; locale: string; emailVerified: boolean; preferredCurrency: string; supplierProfile: any; agentProfile: any; csrfToken: string }

export async function getMe(): Promise<Me | null> {
  try { return await (await serverApi()).get<Me>('/users/me'); }
  catch (e) { if (e instanceof ApiClientError && (e.status === 401 || e.status === 403)) return null; return null; }
}

/** Fetch helper for server components: returns { data } or { error } so pages render errors honestly. */
export async function load<T = any>(path: string): Promise<{ data: T; error: null } | { data: null; error: { status: number; message: string } }> {
  try { return { data: await (await serverApi()).get<T>(path), error: null }; }
  catch (e) {
    if (e instanceof ApiClientError) return { data: null, error: { status: e.status, message: e.message } };
    return { data: null, error: { status: 503, message: 'API unavailable' } };
  }
}

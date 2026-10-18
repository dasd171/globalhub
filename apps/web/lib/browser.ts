'use client';
import { createApiClient } from '@globalhub/api-client';

function readCookie(name: string) {
  if (typeof document === 'undefined') return undefined;
  return document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.split('=')[1];
}
/** Browser client: same-origin /api (proxied), cookie session + CSRF header. */
export const browserApi = createApiClient({ baseUrl: '', csrfToken: () => readCookie('gh_csrf') });

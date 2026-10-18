import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError, LOCALE_CODES } from '@globalhub/shared';

export type Locale = (typeof LOCALE_CODES)[number];
const normalizeLocale = (v: string): Locale => (LOCALE_CODES as readonly string[]).find((c) => v.toLowerCase().startsWith(c)) as Locale | undefined ?? 'en';
import type { Actor, RequestMeta } from '@globalhub/core';

export type Api = FastifyInstance<any, any, any, any, ZodTypeProvider>;

export const meta = (req: FastifyRequest): RequestMeta => ({ ip: req.ip, requestId: req.id });
export function actor(req: FastifyRequest): Actor {
  if (!req.actor) throw new AppError('UNAUTHENTICATED', 'Sign in required');
  return req.actor;
}
export const maybeActor = (req: FastifyRequest): Actor | null => req.actor;
/** Response locale. English is the only shipped locale; query/profile/header are honoured once more are added. */
export const locale = (req: FastifyRequest): Locale => {
  const q = (req.query as { locale?: string } | undefined)?.locale;
  return normalizeLocale(q ?? req.actor?.locale ?? (req.headers['accept-language'] ?? '').toString());
};

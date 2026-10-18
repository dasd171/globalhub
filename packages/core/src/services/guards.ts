import { AppError, forbidden, hasPermission, type Permission } from '@globalhub/shared';
import type { Actor } from '../context.js';

export function requireActor(actor: Actor | null): Actor {
  if (!actor) throw new AppError('UNAUTHENTICATED', 'Sign in required');
  if (actor.status !== 'ACTIVE') throw new AppError('FORBIDDEN', 'Account is not active');
  return actor;
}

export function requirePermission(actor: Actor | null, perm: Permission): Actor {
  const a = requireActor(actor);
  if (!hasPermission(a, perm)) throw forbidden(`Missing permission: ${perm}`);
  return a;
}

export const isAdmin = (a: Actor | null) => !!a && a.roles.includes('PLATFORM_ADMIN');
export const has = (a: Actor | null, p: Permission) => !!a && hasPermission(a, p);

export function paginate(page: number, pageSize: number) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}
export function pageResult<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

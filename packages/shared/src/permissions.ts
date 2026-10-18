import type { RoleKey } from './enums.js';

export const PERMISSIONS = [
  'catalog:read',
  'buying_request:create',
  'buying_request:read_public',
  'quote:submit',
  'quote:accept',
  'order:create',
  'order:fulfil',
  'product:manage_own',
  'store:manage_own',
  'import:run',
  'connector:manage_own',
  'agent:manage_own',
  'review:create',
  'dispute:open',
  'message:send',
  'moderation:reports',
  'moderation:content',
  'dispute:resolve',
  'admin:users',
  'admin:suppliers',
  'admin:catalog',
  'admin:orders',
  'admin:settings',
  'admin:audit',
  'admin:system',
  'node:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const BUYER: Permission[] = ['catalog:read', 'buying_request:create', 'quote:accept', 'order:create', 'review:create', 'dispute:open', 'message:send'];
const SUPPLIER: Permission[] = [
  'catalog:read', 'buying_request:read_public', 'quote:submit', 'order:fulfil', 'product:manage_own', 'store:manage_own',
  'import:run', 'connector:manage_own', 'dispute:open', 'message:send',
];
const AGENT: Permission[] = ['catalog:read', 'buying_request:read_public', 'quote:submit', 'agent:manage_own', 'message:send', 'dispute:open'];
const MODERATOR: Permission[] = ['catalog:read', 'moderation:reports', 'moderation:content', 'dispute:resolve', 'admin:audit'];
const NODE_ADMIN: Permission[] = ['catalog:read', 'node:manage', 'admin:system', 'admin:audit'];

/** Role → permission matrix. PLATFORM_ADMIN is explicit (every permission), not implicit. */
export const ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  BUYER,
  SUPPLIER,
  AGENT,
  MODERATOR,
  NODE_ADMIN,
  PLATFORM_ADMIN: [...PERMISSIONS],
};

export const GUEST_PERMISSIONS: Permission[] = ['catalog:read'];

export interface Principal {
  id: string;
  roles: RoleKey[];
  status?: string;
}

export function permissionsFor(roles: RoleKey[]): Set<Permission> {
  const set = new Set<Permission>(GUEST_PERMISSIONS);
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r] ?? []) set.add(p);
  return set;
}

export function hasPermission(principal: Principal | null | undefined, perm: Permission): boolean {
  if (!principal) return GUEST_PERMISSIONS.includes(perm);
  if (principal.status && principal.status !== 'ACTIVE') return false;
  return permissionsFor(principal.roles).has(perm);
}

export function isAdmin(p: Principal | null | undefined): boolean {
  return !!p && p.roles.includes('PLATFORM_ADMIN');
}

/** Ownership check: owner may act, or a principal holding the override permission. */
export function canActOnResource(p: Principal | null | undefined, ownerUserId: string | null | undefined, overridePerm?: Permission): boolean {
  if (!p) return false;
  if (p.status && p.status !== 'ACTIVE') return false;
  if (ownerUserId && p.id === ownerUserId) return true;
  return overridePerm ? hasPermission(p, overridePerm) : false;
}

/** Roles a user may self-assign at registration. Privileged roles are granted only by admins. */
export const SELF_ASSIGNABLE_ROLES: RoleKey[] = ['BUYER', 'SUPPLIER', 'AGENT'];

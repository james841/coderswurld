import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  type Permission,
  type Role,
} from "./constants";

/**
 * Permission resolution.
 *
 * The rule that matters: a MAIN_ADMIN always holds every permission, and its
 * stored grant list is never consulted. Without this, a main admin could
 * un-tick `users.permissions` on itself and permanently lock the business out
 * of its own account — a support call you cannot resolve from the outside.
 */

/** Parse the JSON string stored in `User.permissions`. Never throws. */
export function parsePermissions(raw: string | null | undefined): Permission[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Drop anything that isn't a permission we still recognise, so removing a
    // permission from the codebase doesn't leave ghosts in the database.
    const valid = new Set<string>(ALL_PERMISSIONS);
    return parsed.filter(
      (p): p is Permission => typeof p === "string" && valid.has(p),
    );
  } catch {
    return [];
  }
}

export function serializePermissions(permissions: Permission[]): string {
  // De-duplicate and sort so stored values are stable and diffable in the
  // audit log — "did the permissions change?" should not depend on array order.
  return JSON.stringify([...new Set(permissions)].sort());
}

/**
 * The permissions a user actually has, accounting for role overrides.
 * This is the only function that should decide access.
 */
export function effectivePermissions(
  role: string,
  storedPermissions: string | null | undefined,
): Permission[] {
  if (role === "MAIN_ADMIN") return ALL_PERMISSIONS;

  const stored = parsePermissions(storedPermissions);
  // A user created before a role's defaults existed, or one whose list was
  // wiped, falls back to the role preset rather than to no access at all.
  if (stored.length === 0) {
    return DEFAULT_ROLE_PERMISSIONS[role as Role] ?? [];
  }
  return stored;
}

export interface PermissionCarrier {
  role: string;
  permissions: Permission[];
}

export function hasPermission(
  user: PermissionCarrier | null | undefined,
  permission: Permission,
): boolean {
  if (!user) return false;
  if (user.role === "MAIN_ADMIN") return true;
  return user.permissions.includes(permission);
}

/** True when the user holds *every* listed permission. */
export function hasAllPermissions(
  user: PermissionCarrier | null | undefined,
  permissions: Permission[],
): boolean {
  return permissions.every((p) => hasPermission(user, p));
}

/** True when the user holds *any* of the listed permissions. */
export function hasAnyPermission(
  user: PermissionCarrier | null | undefined,
  permissions: Permission[],
): boolean {
  if (permissions.length === 0) return true;
  return permissions.some((p) => hasPermission(user, p));
}

/** Thrown by `requirePermission`. Mapped to a 403 by the API error handler. */
export class PermissionError extends Error {
  readonly status = 403;
  readonly permission: Permission;

  constructor(permission: Permission) {
    super(`Missing required permission: ${permission}`);
    this.name = "PermissionError";
    this.permission = permission;
  }
}

/**
 * Guard for server actions and route handlers. Throws rather than returning a
 * boolean so a forgotten `if` can't silently authorise a mutation.
 */
export function requirePermission(
  user: PermissionCarrier | null | undefined,
  permission: Permission,
): void {
  if (!hasPermission(user, permission)) {
    throw new PermissionError(permission);
  }
}

/**
 * Whether `actor` is allowed to modify `target`.
 *
 * Only main admins manage staff, and a main admin cannot be demoted or edited
 * by a sub-admin who happens to hold `users.manage` — otherwise granting that
 * one permission would be a privilege-escalation path straight to the top.
 */
export function canManageUser(
  actor: { id: string; role: string; permissions: Permission[] },
  target: { id: string; role: string },
): { allowed: boolean; reason?: string } {
  if (actor.id === target.id) {
    return { allowed: false, reason: "You cannot change your own role or access." };
  }
  if (target.role === "MAIN_ADMIN" && actor.role !== "MAIN_ADMIN") {
    return { allowed: false, reason: "Only a main admin can manage another main admin." };
  }
  if (!hasPermission(actor, "users.manage")) {
    return { allowed: false, reason: "You don't have permission to manage staff." };
  }
  return { allowed: true };
}

/**
 * Sub-admins must not be able to grant permissions they don't themselves hold —
 * that would let a restricted admin bootstrap itself to full access.
 * Main admins are exempt because they already hold everything.
 */
export function filterGrantablePermissions(
  actor: PermissionCarrier,
  requested: Permission[],
): { granted: Permission[]; rejected: Permission[] } {
  if (actor.role === "MAIN_ADMIN") {
    return { granted: requested, rejected: [] };
  }
  const granted: Permission[] = [];
  const rejected: Permission[] = [];
  for (const p of requested) {
    if (actor.permissions.includes(p)) granted.push(p);
    else rejected.push(p);
  }
  return { granted, rejected };
}

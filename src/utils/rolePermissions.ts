import {
  ALL_PERMISSIONS,
  type MembershipRoleDb,
  type Permission,
  ROLE_DEFAULTS,
  isPermissionKey,
} from '../constants/permissions';
import { AppError } from '../middlewares/errorHandler';

export type PermissionsByRoleStored = Partial<
  Record<MembershipRoleDb, Partial<Record<Permission, boolean>>>
>;

export function parseStoredPermissionsByRole(raw: unknown): PermissionsByRoleStored {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: PermissionsByRoleStored = {};
  for (const role of ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'] as MembershipRoleDb[]) {
    const block = (raw as Record<string, unknown>)[role];
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    const partial: Partial<Record<Permission, boolean>> = {};
    for (const [k, v] of Object.entries(block)) {
      if (isPermissionKey(k) && typeof v === 'boolean') {
        partial[k] = v;
      }
    }
    if (Object.keys(partial).length > 0) out[role] = partial;
  }
  return out;
}

/** Effective permissions for a member; OWNER always gets full defaults (ignores DB). */
export function effectivePermissionsForRole(
  membershipRole: MembershipRoleDb,
  rawJson: unknown
): Record<Permission, boolean> {
  if (membershipRole === 'OWNER') {
    return { ...ROLE_DEFAULTS.OWNER };
  }
  const stored = parseStoredPermissionsByRole(rawJson)[membershipRole];
  const base = ROLE_DEFAULTS[membershipRole];
  const merged = { ...base };
  if (stored) {
    for (const p of ALL_PERMISSIONS) {
      if (p in stored) merged[p] = stored[p]!;
    }
  }
  return merged;
}

export function mergedMatrixForAllRoles(rawJson: unknown): Record<MembershipRoleDb, Record<Permission, boolean>> {
  return {
    OWNER: effectivePermissionsForRole('OWNER', rawJson),
    ADMIN: effectivePermissionsForRole('ADMIN', rawJson),
    MANAGER: effectivePermissionsForRole('MANAGER', rawJson),
    MEMBER: effectivePermissionsForRole('MEMBER', rawJson),
  };
}

/** Validate partial update object; returns normalized delta or throws message. */
export function normalizePermissionDelta(input: unknown): Partial<Record<Permission, boolean>> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError('Each role update must be an object of permission booleans.', 400);
  }
  const out: Partial<Record<Permission, boolean>> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!isPermissionKey(k)) {
      throw new AppError(`Unknown permission: ${k}`, 400);
    }
    if (typeof v !== 'boolean') {
      throw new AppError(`Permission ${k} must be a boolean.`, 400);
    }
    out[k] = v;
  }
  return out;
}

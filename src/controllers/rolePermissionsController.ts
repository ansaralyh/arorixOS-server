import { Request, Response } from 'express';
import pool from '../config/db';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../middlewares/errorHandler';
import type { MembershipRoleDb } from '../constants/permissions';
import { EDITABLE_POLICY_ROLES, isPermissionKey } from '../constants/permissions';
import {
  mergedMatrixForAllRoles,
  normalizePermissionDelta,
  parseStoredPermissionsByRole,
  type PermissionsByRoleStored,
} from '../utils/rolePermissions';

const UPPER_EDITABLE = new Set<string>(EDITABLE_POLICY_ROLES);

function assertCanEditTargetRole(actor: MembershipRoleDb, target: MembershipRoleDb) {
  if (target === 'OWNER') {
    throw new AppError('Owner permissions cannot be changed.', 400);
  }
  if (actor === 'OWNER') {
    if (!UPPER_EDITABLE.has(target)) {
      throw new AppError(`Role ${target} is not editable via policy.`, 400);
    }
    return;
  }
  if (actor === 'ADMIN') {
    if (target === 'ADMIN') {
      throw new AppError('Only the owner can change admin permissions.', 403);
    }
    if (target !== 'MANAGER' && target !== 'MEMBER') {
      throw new AppError('You cannot edit this role.', 403);
    }
    return;
  }
  throw new AppError('You cannot edit workspace permissions.', 403);
}

/**
 * GET /api/businesses/role-permissions
 * Merged effective matrix for all roles (for Settings UI). Owner/admin only.
 */
export const getRolePermissions = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const actor = req.user?.membershipRole;
  if (!businessId) throw new AppError('Business not authenticated.', 401);
  if (actor !== 'OWNER' && actor !== 'ADMIN') {
    throw new AppError('Only owners and admins can view role permissions.', 403);
  }

  const result = await pool.query(
    `SELECT permissions_by_role FROM business_role_permissions WHERE business_id = $1`,
    [businessId]
  );
  const raw = result.rows[0]?.permissions_by_role ?? {};
  const matrix = mergedMatrixForAllRoles(raw);

  res.status(200).json({
    status: 'success',
    data: {
      permissionsByRole: matrix,
    },
  });
});

/**
 * PATCH /api/businesses/role-permissions
 * Body:
 *   - permissionsByRole?: { ADMIN?, MANAGER?, MEMBER? } — shallow-merge per role into stored JSON
 *   - resetRoles?: string[] — remove stored overrides for those roles (revert to server defaults)
 */
export const patchRolePermissions = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const actor = req.user?.membershipRole;
  if (!businessId) throw new AppError('Business not authenticated.', 401);
  if (!actor) throw new AppError('Membership required.', 403);

  const payload = req.body?.permissionsByRole;
  const resetRolesRaw = req.body?.resetRoles;

  if (payload !== undefined && payload !== null && (typeof payload !== 'object' || Array.isArray(payload))) {
    throw new AppError('permissionsByRole must be an object when provided.', 400);
  }

  const hasResets = Array.isArray(resetRolesRaw) && resetRolesRaw.length > 0;
  const hasPayload =
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    Object.keys(payload as object).length > 0;

  if (!hasResets && !hasPayload) {
    throw new AppError('Provide permissionsByRole with at least one role or a non-empty resetRoles array.', 400);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO business_role_permissions (business_id, permissions_by_role)
       VALUES ($1, '{}'::jsonb)
       ON CONFLICT (business_id) DO NOTHING`,
      [businessId]
    );

    const lock = await client.query(
      `SELECT permissions_by_role FROM business_role_permissions WHERE business_id = $1 FOR UPDATE`,
      [businessId]
    );
    if (lock.rows.length === 0) {
      throw new AppError('Could not load permission policy row.', 500);
    }

    let storedRoot = lock.rows[0].permissions_by_role;
    if (!storedRoot || typeof storedRoot !== 'object' || Array.isArray(storedRoot)) {
      storedRoot = {};
    }

    const nextRoot: PermissionsByRoleStored = parseStoredPermissionsByRole(storedRoot);

    if (hasResets) {
      for (const r of resetRolesRaw as unknown[]) {
        const roleKey = String(r).toUpperCase() as MembershipRoleDb;
        if (roleKey === 'OWNER') {
          throw new AppError('Owner permissions cannot be changed.', 400);
        }
        if (!UPPER_EDITABLE.has(roleKey)) {
          throw new AppError(`Unknown or non-editable role in resetRoles: ${String(r)}`, 400);
        }
        assertCanEditTargetRole(actor as MembershipRoleDb, roleKey);
        delete nextRoot[roleKey];
      }
    }

    if (hasPayload && payload) {
      for (const [roleKeyRaw, deltaRaw] of Object.entries(payload)) {
        const roleKey = roleKeyRaw.toUpperCase() as MembershipRoleDb;
        if (roleKey === 'OWNER') {
          throw new AppError('Owner permissions cannot be changed.', 400);
        }
        if (!UPPER_EDITABLE.has(roleKey)) {
          throw new AppError(`Unknown or non-editable role: ${roleKeyRaw}`, 400);
        }
        assertCanEditTargetRole(actor as MembershipRoleDb, roleKey);

        const delta = normalizePermissionDelta(deltaRaw);
        const prev = nextRoot[roleKey] ?? {};
        nextRoot[roleKey] = { ...prev, ...delta };
      }
    }

    const serialized: Record<string, Record<string, boolean>> = {};
    for (const [r, block] of Object.entries(nextRoot)) {
      if (!block || typeof block !== 'object') continue;
      const clean: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(block)) {
        if (isPermissionKey(k) && typeof v === 'boolean') clean[k] = v;
      }
      if (Object.keys(clean).length > 0) serialized[r] = clean;
    }

    await client.query(
      `UPDATE business_role_permissions
       SET permissions_by_role = $2::jsonb, updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $1`,
      [businessId, JSON.stringify(serialized)]
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const fresh = await pool.query(
    `SELECT permissions_by_role FROM business_role_permissions WHERE business_id = $1`,
    [businessId]
  );
  const raw = fresh.rows[0]?.permissions_by_role ?? {};
  const matrix = mergedMatrixForAllRoles(raw);

  res.status(200).json({
    status: 'success',
    data: {
      permissionsByRole: matrix,
    },
  });
});

import pool from '../config/db';
import { AppError } from '../middlewares/errorHandler';
import {
  type Permission,
  type MembershipRoleDb,
  ROLE_DEFAULTS,
} from '../constants/permissions';
import { effectivePermissionsForRole } from './rolePermissions';

type Role = NonNullable<Express.Request['user']>['membershipRole'];

/**
 * Merged effective permissions for the current member (same rules as /role-permissions).
 */
export async function getEffectivePermissions(
  businessId: string,
  membershipRole: Role
): Promise<Record<Permission, boolean>> {
  if (!membershipRole) {
    throw new AppError('Membership not loaded.', 403);
  }
  if (membershipRole === 'OWNER') {
    return { ...ROLE_DEFAULTS.OWNER };
  }
  const r = await pool.query(
    `SELECT permissions_by_role FROM business_role_permissions WHERE business_id = $1`,
    [businessId]
  );
  const raw = r.rows[0]?.permissions_by_role;
  return effectivePermissionsForRole(membershipRole as MembershipRoleDb, raw);
}

export function assertCrmView(perms: Record<Permission, boolean>) {
  if (!perms.view_all_customers && !perms.view_assigned_customers) {
    throw new AppError('You do not have permission to view CRM.', 403);
  }
}

/** Mutations to pipeline / stage structure (not lead rows in Phase 2). */
export function assertCrmEditPipelines(perms: Record<Permission, boolean>) {
  if (!perms.edit_customers) {
    throw new AppError('You do not have permission to change pipelines.', 403);
  }
}

export function canViewAllLeads(perms: Record<Permission, boolean>) {
  return perms.view_all_customers;
}

export function assertCrmCreateLeads(perms: Record<Permission, boolean>) {
  if (!perms.create_customers) {
    throw new AppError('You do not have permission to create leads.', 403);
  }
}

export function assertCrmEditLeads(perms: Record<Permission, boolean>) {
  if (!perms.edit_customers) {
    throw new AppError('You do not have permission to edit leads.', 403);
  }
}

export function assertCrmDeleteLeads(perms: Record<Permission, boolean>) {
  if (!perms.delete_customers) {
    throw new AppError('You do not have permission to delete leads.', 403);
  }
}

/** Assigned-only: may edit/delete only if lead is assigned to this user. */
export function assertLeadRowScope(
  perms: Record<Permission, boolean>,
  currentUserId: string,
  ownerUserId: string | null
) {
  if (canViewAllLeads(perms)) {
    return;
  }
  if (ownerUserId && ownerUserId === currentUserId) {
    return;
  }
  throw new AppError('You can only work on leads assigned to you.', 403);
}

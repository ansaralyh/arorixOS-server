/**
 * Canonical permission keys — keep in sync with arorixOS PermissionsContext ALL_PERMISSIONS.
 * DB stores overrides under business_role_permissions.permissions_by_role
 * keyed by OWNER | ADMIN | MANAGER | MEMBER (OWNER ignored on read; always full access).
 */

export const ALL_PERMISSIONS = [
  'view_all_customers',
  'view_assigned_customers',
  'create_customers',
  'edit_customers',
  'delete_customers',
  'view_all_work',
  'view_assigned_work',
  'create_work',
  'edit_work',
  'assign_work',
  'delete_work',
  'view_financials',
  'create_estimates',
  'approve_estimates',
  'send_invoices',
  'view_payments',
  'edit_payments',
  'view_company_calendar',
  'view_assigned_calendar',
  'create_events',
  'edit_events',
  'view_team',
  'invite_team',
  'edit_roles',
  'approve_time_requests',
  'view_business_info',
  'edit_business_info',
  'change_business_type',
  'manage_billing',
  'export_data',
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export type MembershipRoleDb = 'OWNER' | 'ADMIN' | 'MANAGER' | 'MEMBER';

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

export function isPermissionKey(key: string): key is Permission {
  return PERMISSION_SET.has(key);
}

type PermissionSet = Record<Permission, boolean>;

const allTrue = (): PermissionSet =>
  Object.fromEntries(ALL_PERMISSIONS.map((p) => [p, true])) as PermissionSet;

const allFalse = (): PermissionSet =>
  Object.fromEntries(ALL_PERMISSIONS.map((p) => [p, false])) as PermissionSet;

/** Baseline before JSON overrides; matches frontend ROLE_DEFAULTS. */
export const ROLE_DEFAULTS: Record<MembershipRoleDb, PermissionSet> = {
  OWNER: allTrue(),
  ADMIN: {
    ...allTrue(),
    manage_billing: false,
  },
  MANAGER: {
    ...allFalse(),
    view_all_customers: true,
    view_assigned_customers: true,
    create_customers: true,
    edit_customers: true,
    view_all_work: true,
    view_assigned_work: true,
    create_work: true,
    edit_work: true,
    assign_work: true,
    view_financials: true,
    create_estimates: true,
    approve_estimates: true,
    send_invoices: true,
    view_payments: true,
    view_company_calendar: true,
    view_assigned_calendar: true,
    create_events: true,
    edit_events: true,
    view_team: true,
    approve_time_requests: true,
    view_business_info: true,
  },
  MEMBER: {
    ...allFalse(),
    view_assigned_customers: true,
    view_assigned_work: true,
    view_assigned_calendar: true,
  },
};

export const EDITABLE_POLICY_ROLES: MembershipRoleDb[] = ['ADMIN', 'MANAGER', 'MEMBER'];

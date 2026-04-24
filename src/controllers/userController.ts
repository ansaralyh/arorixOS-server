import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import pool from '../config/db';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../middlewares/errorHandler';
import type { MembershipRoleDb } from '../constants/permissions';
import { effectivePermissionsForRole } from '../utils/rolePermissions';

const DEFAULT_PREFERENCES = {
  emailNotifications: true,
  smsNotifications: false,
  marketingEmails: true,
  darkMode: false,
  twoFactorEnabled: false,
};

function mapPreferencesRow(row: Record<string, unknown> | undefined) {
  if (!row) return { ...DEFAULT_PREFERENCES };
  return {
    emailNotifications: Boolean(row.email_notifications),
    smsNotifications: Boolean(row.sms_notifications),
    marketingEmails: Boolean(row.marketing_emails),
    darkMode: Boolean(row.dark_mode),
    twoFactorEnabled: Boolean(row.two_factor_enabled),
  };
}

function fmtPgDate(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return null;
}

export const updateProfile = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { firstName, lastName, email, phone } = req.body;

  if (!userId) {
    throw new AppError('User not authenticated.', 401);
  }

  // Basic validation
  if (!firstName || !lastName || !email) {
    throw new AppError('Please provide firstName, lastName, and email.', 400);
  }

  // Update user in database
  const result = await pool.query(
    `UPDATE users 
     SET first_name = $1, last_name = $2, email = $3, phone = $4, updated_at = CURRENT_TIMESTAMP
     WHERE id = $5 
     RETURNING id, email, first_name, last_name, phone`,
    [firstName, lastName, email, phone || null, userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('User not found.', 404);
  }

  const updatedUser = result.rows[0];

  res.status(200).json({
    status: 'success',
    data: {
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        firstName: updatedUser.first_name,
        lastName: updatedUser.last_name,
        phone: updatedUser.phone
      }
    }
  });
});

export const getMe = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const businessId = req.user?.businessId;

  if (!userId) {
    throw new AppError('User not authenticated.', 401);
  }

  // Get user details
  const userResult = await pool.query(
    'SELECT id, email, first_name, last_name, phone FROM users WHERE id = $1 AND deleted_at IS NULL',
    [userId]
  );

  if (userResult.rows.length === 0) {
    throw new AppError('User not found.', 404);
  }

  const user = userResult.rows[0];

  let preferences = { ...DEFAULT_PREFERENCES };
  try {
    const prefRes = await pool.query(
      `SELECT email_notifications, sms_notifications, marketing_emails, dark_mode, two_factor_enabled
       FROM user_preferences WHERE user_id = $1`,
      [userId]
    );
    if (prefRes.rows.length > 0) {
      preferences = mapPreferencesRow(prefRes.rows[0] as Record<string, unknown>);
    }
  } catch {
    /* table may not exist on very old DBs */
  }

  let membershipRole: string | null = null;
  if (businessId) {
    const memberResult = await pool.query(
      `SELECT role FROM business_members WHERE user_id = $1 AND business_id = $2`,
      [userId, businessId]
    );
    if (memberResult.rows.length > 0) {
      membershipRole = memberResult.rows[0].role;
    }
  }

  // Get business details
  let business = null;
  let businessMode: { mode: string; customLabels: Record<string, string> } | null = null;

  if (businessId) {
    const businessResult = await pool.query(
      `SELECT b.id, b.name, b.entity_type, b.industry, b.state, b.email, b.phone, b.is_paid,
              b.website, b.street, b.city, b.zip_code, b.country,
              b.ein, b.formation_date, b.annual_report_due, b.compliance_status,
              m.mode AS mode_setting, m.custom_labels AS mode_custom_labels
       FROM businesses b
       LEFT JOIN business_mode_settings m ON m.business_id = b.id
       WHERE b.id = $1 AND b.deleted_at IS NULL`,
      [businessId]
    );
    if (businessResult.rows.length > 0) {
      const b = businessResult.rows[0];
      business = {
        id: b.id,
        name: b.name,
        entityType: b.entity_type,
        industry: b.industry,
        stateOfFormation: b.state,
        email: b.email,
        phone: b.phone,
        isPaid: b.is_paid,
        website: b.website,
        street: b.street,
        city: b.city,
        zipCode: b.zip_code,
        country: b.country,
        ein: b.ein,
        formationDate: fmtPgDate(b.formation_date),
        annualReportDue: fmtPgDate(b.annual_report_due),
        complianceStatus: b.compliance_status
      };
      const rawLabels = b.mode_custom_labels;
      const customLabels =
        rawLabels && typeof rawLabels === 'object' && !Array.isArray(rawLabels)
          ? (rawLabels as Record<string, string>)
          : {};
      businessMode = {
        mode: typeof b.mode_setting === 'string' ? b.mode_setting : 'contractor',
        customLabels
      };
    }
  }

  let permissions: Record<string, boolean> | null = null;
  if (businessId && membershipRole) {
    try {
      const permResult = await pool.query(
        `SELECT permissions_by_role FROM business_role_permissions WHERE business_id = $1`,
        [businessId]
      );
      const rawPolicy = permResult.rows[0]?.permissions_by_role;
      permissions = effectivePermissionsForRole(membershipRole as MembershipRoleDb, rawPolicy);
    } catch {
      permissions = effectivePermissionsForRole(membershipRole as MembershipRoleDb, {});
    }
  }

  res.status(200).json({
    status: 'success',
    data: {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone
      },
      business,
      membershipRole,
      permissions,
      preferences,
      businessMode: businessMode ?? { mode: 'contractor', customLabels: {} }
    }
  });
});

/**
 * PUT /api/users/password
 * Body: { currentPassword, newPassword }
 */
export const changePassword = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const currentPassword = req.body?.currentPassword;
  const newPassword = req.body?.newPassword;

  if (!userId) {
    throw new AppError('User not authenticated.', 401);
  }
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    throw new AppError('currentPassword and newPassword are required.', 400);
  }
  if (newPassword.length < 8) {
    throw new AppError('New password must be at least 8 characters.', 400);
  }

  const found = await pool.query(
    `SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  if (found.rows.length === 0) {
    throw new AppError('User not found.', 404);
  }

  const match = await bcrypt.compare(currentPassword, found.rows[0].password_hash);
  if (!match) {
    throw new AppError('Current password is incorrect.', 401);
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query(
    `UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [hash, userId]
  );

  res.status(200).json({
    status: 'success',
    message: 'Password updated successfully.',
  });
});

/**
 * PATCH /api/users/preferences
 * Body: partial { emailNotifications?, smsNotifications?, marketingEmails?, darkMode?, twoFactorEnabled? }
 */
export const patchUserPreferences = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new AppError('User not authenticated.', 401);
  }

  const b = req.body ?? {};
  const colMap: Record<string, string> = {
    emailNotifications: 'email_notifications',
    smsNotifications: 'sms_notifications',
    marketingEmails: 'marketing_emails',
    darkMode: 'dark_mode',
    twoFactorEnabled: 'two_factor_enabled',
  };

  const updates: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;

  for (const [camel, col] of Object.entries(colMap)) {
    if (camel in b && typeof (b as Record<string, unknown>)[camel] === 'boolean') {
      updates.push(`${col} = $${idx}`);
      idx += 1;
      vals.push((b as Record<string, unknown>)[camel]);
    }
  }

  if (updates.length === 0) {
    throw new AppError(
      'Provide at least one boolean field: emailNotifications, smsNotifications, marketingEmails, darkMode, twoFactorEnabled.',
      400
    );
  }

  await pool.query(
    `INSERT INTO user_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );

  vals.push(userId);
  await pool.query(
    `UPDATE user_preferences SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE user_id = $${idx}`,
    vals
  );

  const prefRes = await pool.query(
    `SELECT email_notifications, sms_notifications, marketing_emails, dark_mode, two_factor_enabled
     FROM user_preferences WHERE user_id = $1`,
    [userId]
  );

  res.status(200).json({
    status: 'success',
    data: {
      preferences: mapPreferencesRow(prefRes.rows[0] as Record<string, unknown>),
    },
  });
});

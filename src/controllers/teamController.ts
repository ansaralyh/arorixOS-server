import crypto from 'crypto';
import { Request, Response } from 'express';
import pool from '../config/db';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../middlewares/errorHandler';
import { hashInviteToken } from '../services/authService';
import { isEmailConfigured, sendWorkspaceInviteEmail } from '../services/emailService';
import { getActorDisplayName, recordBusinessActivity } from '../services/businessActivityService';
import { seatCapForPlanTier } from '../constants/billingPlans';

async function tryRecordActivity(
  businessId: string,
  actorUserId: string,
  actorLabel: string,
  action: string,
  category: string,
  itemTitle: string,
  details?: string | null
) {
  try {
    await recordBusinessActivity({
      businessId,
      actorUserId,
      actorLabel,
      action,
      category,
      itemTitle,
      details: details ?? null,
    });
  } catch (err) {
    console.error('[businessActivity]', err);
  }
}

const INVITE_ROLES = ['ADMIN', 'MANAGER', 'MEMBER'] as const;
const MEMBER_PATCH_ROLES = ['ADMIN', 'MANAGER', 'MEMBER'] as const;

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function pathParamId(v: string | string[] | undefined): string {
  if (v == null) return '';
  return Array.isArray(v) ? v[0] ?? '' : v;
}

function normalizeEmail(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new AppError('A valid email is required.', 400);
  }
  return raw.trim().toLowerCase();
}

async function getInviteEmailContext(businessId: string, inviterUserId: string) {
  const [bizRow, inviterRow] = await Promise.all([
    pool.query(`SELECT name FROM businesses WHERE id = $1 AND deleted_at IS NULL`, [businessId]),
    pool.query(
      `SELECT first_name, last_name FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [inviterUserId]
    ),
  ]);
  const workspaceName = (bizRow.rows[0]?.name as string) || 'your workspace';
  const inv = inviterRow.rows[0];
  const inviterLabel =
    [inv?.first_name, inv?.last_name].filter(Boolean).join(' ').trim() || 'A teammate';
  return { workspaceName, inviterLabel };
}

/** Send invite email when Resend is configured; always returns whether client should get a fallback token. */
async function deliverInviteEmail(
  to: string,
  plainToken: string,
  role: string,
  businessId: string,
  inviterUserId: string
): Promise<{ emailSent: boolean; inviteTokenForClient: string | undefined }> {
  const { workspaceName, inviterLabel } = await getInviteEmailContext(businessId, inviterUserId);
  let emailSent = false;
  let inviteTokenForClient: string | undefined = plainToken;

  if (isEmailConfigured()) {
    try {
      await sendWorkspaceInviteEmail({
        to,
        inviteToken: plainToken,
        workspaceName,
        inviterLabel,
        role,
      });
      emailSent = true;
      inviteTokenForClient = undefined;
    } catch (err) {
      console.error('[email] Workspace invite send failed:', err);
      emailSent = false;
      inviteTokenForClient = plainToken;
    }
  }

  return { emailSent, inviteTokenForClient };
}

function toIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return new Date(v).toISOString();
  return null;
}

/**
 * GET /api/businesses/members
 * Active workspace members (joined users only).
 */
export const listMembers = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  if (!businessId) {
    throw new AppError('Business not found on session.', 403);
  }

  const result = await pool.query(
    `SELECT
       bm.id AS membership_id,
       bm.role,
       bm.created_at AS joined_at,
       u.id AS user_id,
       u.email,
       u.first_name,
       u.last_name,
       u.phone
     FROM business_members bm
     INNER JOIN users u ON u.id = bm.user_id
     WHERE bm.business_id = $1
       AND u.deleted_at IS NULL
     ORDER BY
       CASE bm.role
         WHEN 'OWNER' THEN 1
         WHEN 'ADMIN' THEN 2
         WHEN 'MANAGER' THEN 3
         ELSE 4
       END,
       u.last_name ASC NULLS LAST,
       u.first_name ASC NULLS LAST`,
    [businessId]
  );

  const members = result.rows.map((row) => ({
    membershipId: row.membership_id,
    userId: row.user_id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    role: row.role,
    joinedAt: toIso(row.joined_at),
  }));

  res.status(200).json({
    status: 'success',
    data: { members },
  });
});

/**
 * GET /api/businesses/invitations
 * Pending teammate invitations (no token exposure).
 */
export const listPendingInvitations = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  if (!businessId) {
    throw new AppError('Business not found on session.', 403);
  }

  const result = await pool.query(
    `SELECT
       bi.id,
       bi.email,
       bi.role,
       bi.status,
       bi.expires_at,
       bi.created_at,
       bi.invited_by_user_id,
       iu.first_name AS invited_by_first_name,
       iu.last_name AS invited_by_last_name,
       iu.email AS invited_by_email
     FROM business_invitations bi
     INNER JOIN users iu ON iu.id = bi.invited_by_user_id
     WHERE bi.business_id = $1
       AND bi.status = 'PENDING'
     ORDER BY bi.created_at DESC`,
    [businessId]
  );

  const invitations = result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.created_at),
    invitedBy: {
      userId: row.invited_by_user_id,
      firstName: row.invited_by_first_name,
      lastName: row.invited_by_last_name,
      email: row.invited_by_email,
    },
  }));

  res.status(200).json({
    status: 'success',
    data: { invitations },
  });
});

/**
 * POST /api/businesses/invitations
 * Body: { email, role } — role ∈ ADMIN | MANAGER | MEMBER
 * Returns inviteToken once (for email/link until mailer exists).
 */
export const createInvitation = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const invitedByUserId = req.user?.id;
  if (!businessId || !invitedByUserId) {
    throw new AppError('Business not found on session.', 403);
  }

  const email = normalizeEmail(req.body?.email);
  const roleUpper =
    typeof req.body?.role === 'string' ? req.body.role.trim().toUpperCase() : '';
  if (!INVITE_ROLES.includes(roleUpper as (typeof INVITE_ROLES)[number])) {
    throw new AppError(`role must be one of: ${INVITE_ROLES.join(', ')}.`, 400);
  }
  const role = roleUpper as (typeof INVITE_ROLES)[number];

  const inviterEmail = await pool.query(`SELECT lower(trim(email)) AS e FROM users WHERE id = $1`, [invitedByUserId]);
  if (inviterEmail.rows[0]?.e === email) {
    throw new AppError('You cannot invite your own email.', 400);
  }

  const existingMember = await pool.query(
    `SELECT 1 FROM business_members bm
     JOIN users u ON u.id = bm.user_id
     WHERE bm.business_id = $1 AND lower(trim(u.email)) = $2 AND u.deleted_at IS NULL`,
    [businessId, email]
  );
  if (existingMember.rows.length > 0) {
    throw new AppError('This person is already a member of the workspace.', 409);
  }

  const bb = await pool.query(`SELECT plan_tier FROM business_billing WHERE business_id = $1`, [businessId]);
  const cap = seatCapForPlanTier(bb.rows[0]?.plan_tier as string | undefined);
  if (cap != null) {
    const occ = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM business_members WHERE business_id = $1) +
         (SELECT COUNT(*)::int FROM business_invitations WHERE business_id = $1 AND status = 'PENDING')
       AS n`,
      [businessId]
    );
    const occupied = (occ.rows[0]?.n as number) ?? 0;
    if (occupied >= cap) {
      throw new AppError(
        `This workspace is at its plan limit of ${cap} seats (counting pending invites). Upgrade the plan to invite more teammates.`,
        403
      );
    }
  }

  const plainToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashInviteToken(plainToken);

  const ins = await pool.query(
    `INSERT INTO business_invitations (
       business_id, email, role, invited_by_user_id, status, token_hash, expires_at
     ) VALUES ($1, $2, $3, $4, 'PENDING', $5, NOW() + INTERVAL '7 days')
     RETURNING id, email, role, expires_at, created_at`,
    [businessId, email, role, invitedByUserId, tokenHash]
  );

  const row = ins.rows[0];

  const { emailSent, inviteTokenForClient } = await deliverInviteEmail(
    email,
    plainToken,
    role,
    businessId,
    invitedByUserId
  );

  const inviterLabel = await getActorDisplayName(invitedByUserId);
  void tryRecordActivity(
    businessId,
    invitedByUserId,
    inviterLabel,
    'added',
    'Teammates',
    `Invite sent to ${email}`,
    `Role: ${role}`
  );

  res.status(201).json({
    status: 'success',
    data: {
      invitation: {
        id: row.id,
        email: row.email,
        role: row.role,
        expiresAt: toIso(row.expires_at),
        createdAt: toIso(row.created_at),
      },
      emailSent,
      ...(inviteTokenForClient ? { inviteToken: inviteTokenForClient } : {}),
    },
  });
});

/**
 * DELETE /api/businesses/invitations/:id
 * Revokes a pending invitation.
 */
export const revokeInvitation = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const actorUserId = req.user?.id;
  const id = pathParamId(req.params.id);
  if (!businessId) {
    throw new AppError('Business not found on session.', 403);
  }
  if (!id || !isUuid(id)) {
    throw new AppError('Invalid invitation id.', 400);
  }

  const result = await pool.query(
    `UPDATE business_invitations
     SET status = 'REVOKED', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2 AND status = 'PENDING'
     RETURNING id, email`,
    [id, businessId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Pending invitation not found.', 404);
  }

  if (actorUserId) {
    const actorLabel = await getActorDisplayName(actorUserId);
    const email = result.rows[0].email as string;
    void tryRecordActivity(
      businessId,
      actorUserId,
      actorLabel,
      'deleted',
      'Teammates',
      `Revoked invite for ${email}`,
      null
    );
  }

  res.status(200).json({ status: 'success', data: { revokedId: result.rows[0].id } });
});

/**
 * POST /api/businesses/invitations/:id/resend
 * New token + expiry; previous link stops working. Emails when Resend is configured.
 */
export const resendInvitation = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const actorUserId = req.user?.id;
  const id = pathParamId(req.params.id);
  if (!businessId || !actorUserId) {
    throw new AppError('Business not found on session.', 403);
  }
  if (!id || !isUuid(id)) {
    throw new AppError('Invalid invitation id.', 400);
  }

  const found = await pool.query(
    `SELECT id, email, role FROM business_invitations
     WHERE id = $1 AND business_id = $2 AND status = 'PENDING'`,
    [id, businessId]
  );
  if (found.rows.length === 0) {
    throw new AppError('Pending invitation not found.', 404);
  }

  const plainToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashInviteToken(plainToken);

  const upd = await pool.query(
    `UPDATE business_invitations
     SET token_hash = $1,
         expires_at = NOW() + INTERVAL '7 days',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND business_id = $3 AND status = 'PENDING'
     RETURNING id, email, role, expires_at, created_at`,
    [tokenHash, id, businessId]
  );

  if (upd.rows.length === 0) {
    throw new AppError('Pending invitation not found.', 404);
  }

  const row = upd.rows[0];
  const { emailSent, inviteTokenForClient } = await deliverInviteEmail(
    row.email as string,
    plainToken,
    row.role as string,
    businessId,
    actorUserId
  );

  const actorLabel = await getActorDisplayName(actorUserId);
  void tryRecordActivity(
    businessId,
    actorUserId,
    actorLabel,
    'synced',
    'Teammates',
    `Invite resent to ${row.email as string}`,
    `Role: ${row.role as string}`
  );

  res.status(200).json({
    status: 'success',
    data: {
      invitation: {
        id: row.id,
        email: row.email,
        role: row.role,
        expiresAt: toIso(row.expires_at),
        createdAt: toIso(row.created_at),
      },
      emailSent,
      ...(inviteTokenForClient ? { inviteToken: inviteTokenForClient } : {}),
    },
  });
});

/**
 * PATCH /api/businesses/members/:membershipId
 * Body: { role } — role ∈ ADMIN | MANAGER | MEMBER (cannot change OWNER here).
 */
export const updateMemberRole = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const membershipId = pathParamId(req.params.membershipId);
  if (!businessId) {
    throw new AppError('Business not found on session.', 403);
  }
  if (!membershipId || !isUuid(membershipId)) {
    throw new AppError('Invalid membership id.', 400);
  }

  const newRoleUpper =
    typeof req.body?.role === 'string' ? req.body.role.trim().toUpperCase() : '';
  if (!MEMBER_PATCH_ROLES.includes(newRoleUpper as (typeof MEMBER_PATCH_ROLES)[number])) {
    throw new AppError(`role must be one of: ${MEMBER_PATCH_ROLES.join(', ')}.`, 400);
  }
  const newRole = newRoleUpper as (typeof MEMBER_PATCH_ROLES)[number];

  const cur = await pool.query(
    `SELECT bm.id, bm.role, u.email, u.first_name, u.last_name
     FROM business_members bm
     INNER JOIN users u ON u.id = bm.user_id
     WHERE bm.id = $1 AND bm.business_id = $2`,
    [membershipId, businessId]
  );
  if (cur.rows.length === 0) {
    throw new AppError('Member not found.', 404);
  }
  if (cur.rows[0].role === 'OWNER') {
    throw new AppError('Cannot change the workspace owner role here.', 403);
  }

  const oldRole = cur.rows[0].role as string;
  const contact = cur.rows[0];
  const display =
    [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim() ||
    contact.email ||
    'Member';

  const updated = await pool.query(
    `UPDATE business_members SET role = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND business_id = $3
     RETURNING id, user_id, role`,
    [newRole, membershipId, businessId]
  );

  const actorUserId = req.user?.id;
  if (actorUserId) {
    const actorLabel = await getActorDisplayName(actorUserId);
    void tryRecordActivity(
      businessId,
      actorUserId,
      actorLabel,
      'edited',
      'Teammates',
      `${display} — role updated`,
      `${oldRole} → ${newRole}`
    );
  }

  res.status(200).json({
    status: 'success',
    data: {
      membershipId: updated.rows[0].id,
      userId: updated.rows[0].user_id,
      role: updated.rows[0].role,
    },
  });
});

/**
 * DELETE /api/businesses/members/:membershipId
 * Removes a member. Cannot remove the OWNER.
 */
export const removeMember = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const membershipId = pathParamId(req.params.membershipId);
  if (!businessId) {
    throw new AppError('Business not found on session.', 403);
  }
  if (!membershipId || !isUuid(membershipId)) {
    throw new AppError('Invalid membership id.', 400);
  }

  const cur = await pool.query(
    `SELECT bm.id, bm.role, u.email, u.first_name, u.last_name
     FROM business_members bm
     INNER JOIN users u ON u.id = bm.user_id
     WHERE bm.id = $1 AND bm.business_id = $2`,
    [membershipId, businessId]
  );
  if (cur.rows.length === 0) {
    throw new AppError('Member not found.', 404);
  }
  if (cur.rows[0].role === 'OWNER') {
    throw new AppError('Cannot remove the workspace owner.', 403);
  }

  const contact = cur.rows[0];
  const display =
    [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim() ||
    contact.email ||
    'Member';

  await pool.query(`DELETE FROM business_members WHERE id = $1 AND business_id = $2`, [
    membershipId,
    businessId,
  ]);

  const actorUserId = req.user?.id;
  if (actorUserId) {
    const actorLabel = await getActorDisplayName(actorUserId);
    void tryRecordActivity(
      businessId,
      actorUserId,
      actorLabel,
      'deleted',
      'Teammates',
      `Removed ${display} from workspace`,
      null
    );
  }

  res.status(204).send();
});

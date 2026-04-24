import crypto from 'crypto';
import { Request, Response } from 'express';
import pool from '../config/db';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../middlewares/errorHandler';
import { hashInviteToken } from '../services/authService';
import {
  isEmailConfigured,
  sendBusinessEmailVerification,
} from '../services/emailService';

function normalizeEmail(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new AppError('A valid email is required.', 400);
  }
  return raw.trim().toLowerCase();
}

async function ensureCommunicationsRow(businessId: string) {
  await pool.query(
    `INSERT INTO business_communications (business_id) VALUES ($1) ON CONFLICT (business_id) DO NOTHING`,
    [businessId]
  );
}

function apiPublicBase(): string {
  const raw =
    process.env.API_PUBLIC_URL ||
    process.env.SERVER_PUBLIC_URL ||
    'http://localhost:5000';
  return raw.replace(/\/$/, '');
}

function frontendBase(): string {
  return (process.env.APP_PUBLIC_URL || 'http://localhost:8081').replace(/\/$/, '');
}

async function fetchCommunicationsPayload(businessId: string) {
  const biz = await pool.query(`SELECT name FROM businesses WHERE id = $1 AND deleted_at IS NULL`, [
    businessId,
  ]);
  const workspaceName = (biz.rows[0]?.name as string) || 'your workspace';

  const r = await pool.query(
    `SELECT outbound_email, outbound_email_verified, verification_token_hash, verification_expires_at, sms_phone
     FROM business_communications WHERE business_id = $1`,
    [businessId]
  );
  const row = r.rows[0];
  const pending =
    Boolean(row?.verification_token_hash) &&
    row.verification_expires_at &&
    new Date(row.verification_expires_at as Date) > new Date() &&
    !row.outbound_email_verified;

  return {
    workspaceName,
    outboundEmail: (row?.outbound_email as string | null) ?? null,
    outboundEmailVerified: Boolean(row?.outbound_email_verified),
    verificationPending: pending,
    smsPhone: (row?.sms_phone as string | null) ?? null,
    resendConfigured: isEmailConfigured(),
  };
}

/**
 * GET /api/businesses/communications
 */
export const getBusinessCommunications = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  if (!businessId) {
    throw new AppError('Business not found on session.', 403);
  }
  await ensureCommunicationsRow(businessId);
  const data = await fetchCommunicationsPayload(businessId);
  res.status(200).json({ status: 'success', data });
});

/**
 * PATCH /api/businesses/communications
 * Body: { smsPhone?: string | null, clearOutboundEmail?: true }
 */
export const patchBusinessCommunications = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  if (!businessId) {
    throw new AppError('Business not found on session.', 403);
  }
  await ensureCommunicationsRow(businessId);

  let did = false;

  if (req.body.clearOutboundEmail === true) {
    await pool.query(
      `UPDATE business_communications SET
         outbound_email = NULL,
         outbound_email_verified = FALSE,
         verification_token_hash = NULL,
         verification_expires_at = NULL,
         updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $1`,
      [businessId]
    );
    did = true;
  }

  if ('smsPhone' in req.body) {
    const raw = req.body.smsPhone;
    const v =
      raw === null || raw === ''
        ? null
        : typeof raw === 'string'
          ? raw.trim().slice(0, 50) || null
          : null;
    await pool.query(
      `UPDATE business_communications SET sms_phone = $1, updated_at = CURRENT_TIMESTAMP WHERE business_id = $2`,
      [v, businessId]
    );
    did = true;
  }

  if (!did) {
    throw new AppError('Provide smsPhone and/or clearOutboundEmail: true.', 400);
  }

  const data = await fetchCommunicationsPayload(businessId);
  res.status(200).json({ status: 'success', data });
});

/**
 * POST /api/businesses/communications/request-email-verification
 * Body: { email: string }
 */
export const requestOutboundEmailVerification = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  if (!businessId) {
    throw new AppError('Business not found on session.', 403);
  }

  if (!isEmailConfigured()) {
    throw new AppError(
      'Email delivery is not configured. Add RESEND_API_KEY to the server environment (and optionally EMAIL_FROM).',
      503
    );
  }

  const email = normalizeEmail(req.body?.email);
  await ensureCommunicationsRow(businessId);

  const biz = await pool.query(`SELECT name FROM businesses WHERE id = $1 AND deleted_at IS NULL`, [
    businessId,
  ]);
  const workspaceName = (biz.rows[0]?.name as string) || 'your workspace';

  const plain = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashInviteToken(plain);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await pool.query(
    `UPDATE business_communications SET
       outbound_email = $1,
       outbound_email_verified = FALSE,
       verification_token_hash = $2,
       verification_expires_at = $3,
       updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $4`,
    [email, tokenHash, expiresAt.toISOString(), businessId]
  );

  const verifyUrl = `${apiPublicBase()}/api/auth/verify-communications-email?token=${encodeURIComponent(plain)}`;

  try {
    await sendBusinessEmailVerification({
      to: email,
      workspaceName,
      verifyUrl,
    });
  } catch (err) {
    console.error('[email] Business email verification send failed:', err);
    throw new AppError(
      err instanceof Error ? err.message : 'Failed to send verification email.',
      502
    );
  }

  res.status(200).json({
    status: 'success',
    message: 'Check your inbox for a verification link (expires in 24 hours).',
  });
});

/**
 * GET /api/auth/verify-communications-email?token=
 * Public — redirects to SPA Communications settings.
 */
export const verifyCommunicationsEmail = catchAsync(async (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const fe = frontendBase();

  const redirect = (ok: boolean, reason?: string) => {
    if (ok) {
      return res.redirect(302, `${fe}/settings/communications?emailVerified=1`);
    }
    const r = reason ? `&reason=${encodeURIComponent(reason)}` : '';
    return res.redirect(302, `${fe}/settings/communications?emailVerified=0${r}`);
  };

  if (!token || token.length < 16) {
    return redirect(false, 'missing_token');
  }

  const tokenHash = hashInviteToken(token);
  const r = await pool.query(
    `SELECT business_id FROM business_communications
     WHERE verification_token_hash = $1 AND verification_expires_at > NOW()`,
    [tokenHash]
  );

  if (r.rows.length === 0) {
    return redirect(false, 'expired_or_invalid');
  }

  const businessId = r.rows[0].business_id as string;
  await pool.query(
    `UPDATE business_communications SET
       outbound_email_verified = TRUE,
       verification_token_hash = NULL,
       verification_expires_at = NULL,
       updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $1`,
    [businessId]
  );

  return redirect(true);
});

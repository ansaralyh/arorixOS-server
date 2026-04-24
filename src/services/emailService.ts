/**
 * Transactional email via Resend (https://resend.com).
 * No npm dependency — uses fetch. Set RESEND_API_KEY in env.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface WorkspaceInviteEmailParams {
  to: string;
  inviteToken: string;
  workspaceName: string;
  inviterLabel: string;
  role: string;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

/**
 * Sends workspace invite with accept link. Throws on Resend API error.
 */
export async function sendWorkspaceInviteEmail(params: WorkspaceInviteEmailParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set');
  }

  const baseRaw = process.env.APP_PUBLIC_URL || 'http://localhost:8081';
  const baseUrl = baseRaw.replace(/\/$/, '');
  const tokenEnc = encodeURIComponent(params.inviteToken);
  const acceptUrl = `${baseUrl}/accept-invite?token=${tokenEnc}`;

  const from =
    process.env.EMAIL_FROM?.trim() || 'Arorix OS <onboarding@resend.dev>';

  const safeName = escapeHtml(params.workspaceName);
  const safeInviter = escapeHtml(params.inviterLabel);
  const safeRole = escapeHtml(params.role);

  const subject = `${params.inviterLabel} invited you to ${params.workspaceName} on Arorix OS`;

  const text = [
    `${params.inviterLabel} invited you to join ${params.workspaceName} on Arorix OS as ${params.role}.`,
    '',
    `Accept your invite (link expires in 7 days):`,
    acceptUrl,
    '',
    `If the button does not work, open ${baseUrl}/accept-invite and paste this token:`,
    params.inviteToken,
  ].join('\n');

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #1e293b;">
  <p><strong>${safeInviter}</strong> invited you to join <strong>${safeName}</strong> on Arorix OS as <strong>${safeRole}</strong>.</p>
  <p>
    <a href="${acceptUrl}" style="display: inline-block; padding: 10px 18px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600;">Accept invitation</a>
  </p>
  <p style="font-size: 13px; color: #64748b;">This link expires in 7 days. If you did not expect this email, you can ignore it.</p>
  <p style="font-size: 12px; color: #94a3b8;">Or copy your token and open <a href="${acceptUrl}">Accept invite</a> manually.</p>
</body>
</html>`.trim();

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      subject,
      html,
      text,
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    let message = `Resend error (${res.status})`;
    try {
      const j = JSON.parse(body) as { message?: string };
      if (j.message) message = j.message;
    } catch {
      if (body) message = body.slice(0, 200);
    }
    throw new Error(message);
  }
}

export interface BusinessEmailVerificationParams {
  to: string;
  workspaceName: string;
  verifyUrl: string;
}

/**
 * Sends a link to verify outbound / business email for Communications settings.
 */
export async function sendBusinessEmailVerification(params: BusinessEmailVerificationParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set');
  }

  const from =
    process.env.EMAIL_FROM?.trim() || 'Arorix OS <onboarding@resend.dev>';

  const safeName = escapeHtml(params.workspaceName);
  const subject = `Verify your business email for ${params.workspaceName}`;

  const text = [
    `Confirm this address for customer-facing email in Arorix OS (${params.workspaceName}):`,
    '',
    params.verifyUrl,
    '',
    'This link expires in 24 hours. If you did not request this, ignore this email.',
  ].join('\n');

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #1e293b;">
  <p>Confirm <strong>${safeName}</strong> business email for Arorix OS customer messages.</p>
  <p>
    <a href="${params.verifyUrl}" style="display: inline-block; padding: 10px 18px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600;">Verify email</a>
  </p>
  <p style="font-size: 13px; color: #64748b;">Link expires in 24 hours.</p>
</body>
</html>`.trim();

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      subject,
      html,
      text,
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    let message = `Resend error (${res.status})`;
    try {
      const j = JSON.parse(body) as { message?: string };
      if (j.message) message = j.message;
    } catch {
      if (body) message = body.slice(0, 200);
    }
    throw new Error(message);
  }
}

export interface SupportStaffNotificationParams {
  subject: string;
  text: string;
}

/**
 * Sends internal support alerts (new ticket, call request) to SUPPORT_INBOX_EMAIL when Resend is configured.
 * No-op if SUPPORT_INBOX_EMAIL or RESEND_API_KEY is missing.
 */
export async function sendSupportStaffNotification(params: SupportStaffNotificationParams): Promise<void> {
  const to = process.env.SUPPORT_INBOX_EMAIL?.trim();
  if (!to || !isEmailConfigured()) {
    return;
  }

  const apiKey = process.env.RESEND_API_KEY!.trim();
  const from =
    process.env.EMAIL_FROM?.trim() || 'Arorix OS <onboarding@resend.dev>';

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #1e293b;">
  <pre style="white-space: pre-wrap; font-size: 14px;">${escapeHtml(params.text)}</pre>
</body>
</html>`.trim();

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: params.subject,
      html,
      text: params.text,
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    let message = `Resend error (${res.status})`;
    try {
      const j = JSON.parse(body) as { message?: string };
      if (j.message) message = j.message;
    } catch {
      if (body) message = body.slice(0, 200);
    }
    throw new Error(message);
  }
}

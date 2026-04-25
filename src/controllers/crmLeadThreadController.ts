import { Request, Response } from 'express';
import pool from '../config/db';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../middlewares/errorHandler';
import {
  getEffectivePermissions,
  assertCrmView,
  assertCrmEditLeads,
  assertLeadRowScope,
} from '../utils/crmAccess';

type ActivityRow = {
  id: string;
  activity_type: string;
  occurred_at: Date;
  details: string | null;
  extra: unknown;
};

type MessageRow = {
  id: string;
  content: string;
  sender: string;
  sender_type: 'system' | 'user' | 'lead';
  sent_at: Date;
  is_internal: boolean;
  mentions: unknown;
  campaign_id: string | null;
};

/** `ownerUserId` may be null for unassigned leads — do not treat that as “lead not found”. */
async function resolveLeadForThread(
  businessId: string,
  leadId: string
): Promise<{ ok: true; ownerUserId: string | null } | { ok: false }> {
  const r = await pool.query(
    `SELECT owner_user_id FROM crm_leads WHERE id = $1::uuid AND business_id = $2`,
    [leadId, businessId]
  );
  if (!r.rows[0]) return { ok: false };
  return { ok: true, ownerUserId: (r.rows[0].owner_user_id as string | null) ?? null };
}

function extraObj(extra: unknown): Record<string, unknown> {
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    return extra as Record<string, unknown>;
  }
  return {};
}

function toApiActivity(row: ActivityRow) {
  const ex = extraObj(row.extra);
  return {
    id: row.id,
    type: row.activity_type,
    timestamp: new Date(row.occurred_at).toISOString(),
    details: row.details ?? undefined,
    campaignName: typeof ex.campaignName === 'string' ? ex.campaignName : undefined,
    campaignId: typeof ex.campaignId === 'string' ? ex.campaignId : undefined,
    senderIdentity: typeof ex.senderIdentity === 'string' ? ex.senderIdentity : undefined,
    channel: typeof ex.channel === 'string' ? ex.channel : undefined,
    outcome: typeof ex.outcome === 'string' ? ex.outcome : undefined,
    userId: typeof ex.userId === 'string' ? ex.userId : undefined,
    pinned: typeof ex.pinned === 'boolean' ? ex.pinned : undefined,
  };
}

function toApiMessage(row: MessageRow) {
  return {
    id: row.id,
    content: row.content,
    sender: row.sender,
    senderType: row.sender_type,
    timestamp: new Date(row.sent_at).toISOString(),
    isInternal: row.is_internal,
    mentions: Array.isArray(row.mentions) ? (row.mentions as string[]) : undefined,
    campaignId: row.campaign_id ?? undefined,
  };
}

function buildExtraFromBody(body: Record<string, unknown>) {
  const ex: Record<string, unknown> = {};
  if (body.campaignName != null) ex.campaignName = body.campaignName;
  if (body.campaignId != null) ex.campaignId = body.campaignId;
  if (body.senderIdentity != null) ex.senderIdentity = body.senderIdentity;
  if (body.channel != null) ex.channel = body.channel;
  if (body.outcome != null) ex.outcome = body.outcome;
  if (body.userId != null) ex.userId = body.userId;
  if (body.pinned != null) ex.pinned = body.pinned;
  return ex;
}

/**
 * GET /api/businesses/crm/leads/:leadId/activities
 */
export const listCrmLeadActivities = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const userId = req.user?.id;
  const role = req.user?.membershipRole;
  if (!businessId || !userId || !role) throw new AppError('Not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);
  const leadId = String(req.params.leadId || '');
  const resolved = await resolveLeadForThread(businessId, leadId);
  if (!resolved.ok) throw new AppError('Lead not found.', 404);
  assertLeadRowScope(perms, userId, resolved.ownerUserId);

  const r = await pool.query(
    `SELECT id, activity_type, occurred_at, details, extra
     FROM crm_lead_activities
     WHERE business_id = $1 AND lead_id = $2::uuid
     ORDER BY occurred_at DESC
     LIMIT 1000`,
    [businessId, leadId]
  );
  const activities = (r.rows as ActivityRow[]).map(toApiActivity);
  res.status(200).json({ status: 'success', data: { activities } });
});

/**
 * POST /api/businesses/crm/leads/:leadId/activities
 */
export const createCrmLeadActivity = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const userId = req.user?.id;
  const role = req.user?.membershipRole;
  if (!businessId || !userId || !role) throw new AppError('Not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);
  assertCrmEditLeads(perms);
  const leadId = String(req.params.leadId || '');
  const resolved = await resolveLeadForThread(businessId, leadId);
  if (!resolved.ok) throw new AppError('Lead not found.', 404);
  assertLeadRowScope(perms, userId, resolved.ownerUserId);

  const body = req.body || {};
  const activityType = typeof body.type === 'string' ? body.type.trim() : '';
  if (!activityType || activityType.length > 64) {
    throw new AppError('type is required (max 64 characters).', 400);
  }
  const details = typeof body.details === 'string' ? body.details : null;
  let occurredAt = new Date();
  if (typeof body.occurredAt === 'string' && body.occurredAt) {
    const d = new Date(body.occurredAt);
    if (!isNaN(d.getTime())) occurredAt = d;
  }
  const extra = buildExtraFromBody(body as Record<string, unknown>);

  const ins = await pool.query(
    `INSERT INTO crm_lead_activities (business_id, lead_id, activity_type, occurred_at, details, extra)
     VALUES ($1, $2::uuid, $3, $4, $5, $6::jsonb)
     RETURNING id, activity_type, occurred_at, details, extra`,
    [businessId, leadId, activityType, occurredAt, details, JSON.stringify(extra)]
  );
  res.status(201).json({ status: 'success', data: { activity: toApiActivity(ins.rows[0] as ActivityRow) } });
});

/**
 * PATCH /api/businesses/crm/leads/:leadId/activities/:activityId
 */
export const patchCrmLeadActivity = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const userId = req.user?.id;
  const role = req.user?.membershipRole;
  if (!businessId || !userId || !role) throw new AppError('Not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);
  assertCrmEditLeads(perms);
  const leadId = String(req.params.leadId || '');
  const activityId = String(req.params.activityId || '');
  const resolved = await resolveLeadForThread(businessId, leadId);
  if (!resolved.ok) throw new AppError('Lead not found.', 404);
  assertLeadRowScope(perms, userId, resolved.ownerUserId);

  const body = req.body || {};
  const r0 = await pool.query(
    `SELECT details, extra FROM crm_lead_activities
     WHERE id = $1::uuid AND business_id = $2 AND lead_id = $3::uuid`,
    [activityId, businessId, leadId]
  );
  if (!r0.rows[0]) throw new AppError('Activity not found.', 404);

  const cur = r0.rows[0] as { details: string | null; extra: unknown };
  const merged: Record<string, unknown> = { ...extraObj(cur.extra) };
  if (body.pinned != null) merged.pinned = Boolean(body.pinned);
  const newDetails = typeof body.details === 'string' ? body.details : (cur.details ?? '');

  const r = await pool.query(
    `UPDATE crm_lead_activities
     SET details = $1, extra = $2::jsonb
     WHERE id = $3::uuid AND business_id = $4 AND lead_id = $5::uuid
     RETURNING id, activity_type, occurred_at, details, extra`,
    [newDetails, JSON.stringify(merged), activityId, businessId, leadId]
  );
  res.status(200).json({ status: 'success', data: { activity: toApiActivity(r.rows[0] as ActivityRow) } });
});

/**
 * DELETE /api/businesses/crm/leads/:leadId/activities/:activityId
 */
export const deleteCrmLeadActivity = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const userId = req.user?.id;
  const role = req.user?.membershipRole;
  if (!businessId || !userId || !role) throw new AppError('Not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);
  assertCrmEditLeads(perms);
  const leadId = String(req.params.leadId || '');
  const activityId = String(req.params.activityId || '');
  const resolved = await resolveLeadForThread(businessId, leadId);
  if (!resolved.ok) throw new AppError('Lead not found.', 404);
  assertLeadRowScope(perms, userId, resolved.ownerUserId);

  const d = await pool.query(
    `DELETE FROM crm_lead_activities
     WHERE id = $1::uuid AND business_id = $2 AND lead_id = $3::uuid
     RETURNING id`,
    [activityId, businessId, leadId]
  );
  if (!d.rows[0]) throw new AppError('Activity not found.', 404);
  res.status(200).json({ status: 'success', data: { deleted: true } });
});

/**
 * GET /api/businesses/crm/leads/:leadId/conversations
 */
export const listCrmLeadConversations = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const userId = req.user?.id;
  const role = req.user?.membershipRole;
  if (!businessId || !userId || !role) throw new AppError('Not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);
  const leadId = String(req.params.leadId || '');
  const resolved = await resolveLeadForThread(businessId, leadId);
  if (!resolved.ok) throw new AppError('Lead not found.', 404);
  assertLeadRowScope(perms, userId, resolved.ownerUserId);

  const r = await pool.query(
    `SELECT id, content, sender, sender_type, sent_at, is_internal, mentions, campaign_id
     FROM crm_lead_conversation_messages
     WHERE business_id = $1 AND lead_id = $2::uuid
     ORDER BY sent_at ASC
     LIMIT 2000`,
    [businessId, leadId]
  );
  const messages = (r.rows as MessageRow[]).map(toApiMessage);
  res.status(200).json({ status: 'success', data: { messages } });
});

/**
 * POST /api/businesses/crm/leads/:leadId/conversations
 */
export const createCrmLeadConversation = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const userId = req.user?.id;
  const role = req.user?.membershipRole;
  if (!businessId || !userId || !role) throw new AppError('Not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);
  assertCrmEditLeads(perms);
  const leadId = String(req.params.leadId || '');
  const resolved = await resolveLeadForThread(businessId, leadId);
  if (!resolved.ok) throw new AppError('Lead not found.', 404);
  assertLeadRowScope(perms, userId, resolved.ownerUserId);

  const body = req.body || {};
  const content = typeof body.content === 'string' ? body.content : '';
  if (!content.trim()) throw new AppError('content is required.', 400);
  const sender = typeof body.sender === 'string' ? body.sender : 'User';
  const st = body.senderType === 'system' || body.senderType === 'user' || body.senderType === 'lead' ? body.senderType : 'user';
  const isInternal = body.isInternal === true;
  const mentions = Array.isArray(body.mentions) ? body.mentions : null;
  const campaignId = typeof body.campaignId === 'string' ? body.campaignId : null;
  let sentAt = new Date();
  if (typeof body.timestamp === 'string' && body.timestamp) {
    const d = new Date(body.timestamp);
    if (!isNaN(d.getTime())) sentAt = d;
  }

  const ins = await pool.query(
    `INSERT INTO crm_lead_conversation_messages
     (business_id, lead_id, content, sender, sender_type, sent_at, is_internal, mentions, campaign_id)
     VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8::jsonb, $9)
     RETURNING id, content, sender, sender_type, sent_at, is_internal, mentions, campaign_id`,
    [businessId, leadId, content, sender, st, sentAt, isInternal, mentions ? JSON.stringify(mentions) : null, campaignId]
  );
  res.status(201).json({ status: 'success', data: { message: toApiMessage(ins.rows[0] as MessageRow) } });
});

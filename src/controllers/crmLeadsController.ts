import { Request, Response } from 'express';
import pool from '../config/db';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../middlewares/errorHandler';
import {
  getEffectivePermissions,
  assertCrmView,
  assertCrmCreateLeads,
  assertCrmEditLeads,
  assertCrmDeleteLeads,
  assertLeadRowScope,
  canViewAllLeads,
} from '../utils/crmAccess';
function formatEnteredOn(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

type LeadRow = {
  id: string;
  business_id: string;
  pipeline_id: string;
  stage_key: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  source: string;
  notes: string;
  owner_user_id: string | null;
  tags: unknown;
  account_type: string;
  urgency: string | null;
  last_campaign_touched_at: Date | null;
  last_campaign_name: string | null;
  last_campaign_channel: string | null;
  reply_status: string;
  next_suggested_action: string | null;
  created_at: Date;
  is_default: boolean;
  first_name: string | null;
  last_name: string | null;
  owner_email: string | null;
};

function ownerLabel(first: string | null, last: string | null, email: string | null) {
  const n = [first, last].filter(Boolean).join(' ').trim();
  if (n) return n;
  if (email) return email;
  return '';
}

function mapTagsFromDb(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => {
      if (typeof t === 'string') return t;
      if (t && typeof t === 'object' && 'name' in t && typeof (t as { name: unknown }).name === 'string') {
        return (t as { name: string }).name;
      }
      return null;
    })
    .filter((x): x is string => x != null);
}

function mapTagsToJson(tags: string[]) {
  return JSON.stringify(tags);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function looksLikeUuid(s: string) {
  return UUID_RE.test(String(s).trim());
}

async function getDefaultPipelineIdForBusiness(businessId: string): Promise<string> {
  const r = await pool.query(
    `SELECT id FROM crm_pipelines WHERE business_id = $1 AND is_default = TRUE LIMIT 1`,
    [businessId]
  );
  if (!r.rows[0]) {
    throw new AppError('Default pipeline not found. Open CRM to seed pipelines first.', 400);
  }
  return r.rows[0].id as string;
}

/** Resolves client pipeline key: "main" (default), a real UUID, or legacy slugs → default pipeline. */
async function resolvePipelineId(businessId: string, clientPipelineId: string): Promise<string> {
  if (clientPipelineId === 'main' || !looksLikeUuid(clientPipelineId)) {
    return getDefaultPipelineIdForBusiness(businessId);
  }
  const r2 = await pool.query(
    `SELECT id FROM crm_pipelines WHERE id = $1::uuid AND business_id = $2`,
    [clientPipelineId, businessId]
  );
  if (!r2.rows[0]) throw new AppError('Pipeline not found.', 404);
  return r2.rows[0].id;
}

async function assertStageInPipeline(
  businessId: string,
  pipelineId: string,
  stageKey: string
) {
  const r = await pool.query(
    `SELECT 1 FROM crm_pipeline_stages WHERE business_id = $1 AND pipeline_id = $2 AND stage_key = $3`,
    [businessId, pipelineId, stageKey]
  );
  if (r.rows.length === 0) {
    throw new AppError('Invalid stage for this pipeline.', 400);
  }
}

function toApiLead(row: LeadRow) {
  const pipelineId = row.is_default ? 'main' : row.pipeline_id;
  const o = ownerLabel(row.first_name, row.last_name, row.owner_email);
  const lastCh = row.last_campaign_channel;
  return {
    id: row.id,
    pipelineId,
    stage: row.stage_key,
    name: row.name,
    email: row.email,
    phone: row.phone,
    company: row.company,
    source: row.source,
    notes: row.notes,
    owner: o,
    ownerUserId: row.owner_user_id,
    tags: mapTagsFromDb(row.tags),
    enteredOn: formatEnteredOn(new Date(row.created_at)),
    accountType: row.account_type,
    urgency: row.urgency,
    lastCampaignTouch: row.last_campaign_touched_at
      ? row.last_campaign_touched_at.toISOString()
      : undefined,
    lastCampaignName: row.last_campaign_name || undefined,
    lastCampaignChannel: lastCh || undefined,
    replyStatus: row.reply_status,
    nextSuggestedAction: row.next_suggested_action || undefined,
  };
}

/**
 * GET /api/businesses/crm/leads
 */
export const listCrmLeads = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const userId = req.user?.id;
  const role = req.user?.membershipRole;
  if (!businessId || !userId || !role) throw new AppError('Not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);
  const viewAll = canViewAllLeads(perms);

  const clientPipeline = typeof req.query.pipelineId === 'string' ? req.query.pipelineId : '';
  const stageKey = typeof req.query.stageKey === 'string' ? req.query.stageKey : '';

  let serverPipeline: string | null = null;
  if (clientPipeline) {
    serverPipeline = await resolvePipelineId(businessId, clientPipeline);
  }

  const args: unknown[] = [businessId, viewAll, userId];
  let idx = 4;
  let where =
    'l.business_id = $1 AND ( $2 = TRUE OR l.owner_user_id = $3::uuid )';
  if (serverPipeline) {
    where += ` AND l.pipeline_id = $${idx}::uuid`;
    args.push(serverPipeline);
    idx++;
  }
  if (stageKey) {
    where += ` AND l.stage_key = $${idx}`;
    args.push(stageKey);
    idx++;
  }

  const r = await pool.query(
    `SELECT l.id, l.business_id, l.pipeline_id, l.stage_key, l.name, l.email, l.phone, l.company, l.source, l.notes,
            l.owner_user_id, l.tags, l.account_type, l.urgency, l.last_campaign_touched_at, l.last_campaign_name,
            l.last_campaign_channel, l.reply_status, l.next_suggested_action, l.created_at,
            p.is_default, u.first_name, u.last_name, u.email AS owner_email
     FROM crm_leads l
     JOIN crm_pipelines p ON p.id = l.pipeline_id
     LEFT JOIN users u ON u.id = l.owner_user_id
     WHERE ${where}
     ORDER BY l.created_at DESC
     LIMIT 500`,
    args
  );

  const leads = (r.rows as LeadRow[]).map((row) => toApiLead(row));
  res.status(200).json({ status: 'success', data: { leads } });
});

/**
 * GET /api/businesses/crm/leads/:leadId
 */
export const getCrmLead = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const userId = req.user?.id;
  const role = req.user?.membershipRole;
  if (!businessId || !userId || !role) throw new AppError('Not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);
  const viewAll = canViewAllLeads(perms);

  const leadId = String(req.params.leadId || '');
  const r = await pool.query(
    `SELECT l.id, l.business_id, l.pipeline_id, l.stage_key, l.name, l.email, l.phone, l.company, l.source, l.notes,
            l.owner_user_id, l.tags, l.account_type, l.urgency, l.last_campaign_touched_at, l.last_campaign_name,
            l.last_campaign_channel, l.reply_status, l.next_suggested_action, l.created_at,
            p.is_default, u.first_name, u.last_name, u.email AS owner_email
     FROM crm_leads l
     JOIN crm_pipelines p ON p.id = l.pipeline_id
     LEFT JOIN users u ON u.id = l.owner_user_id
     WHERE l.id = $1::uuid AND l.business_id = $2`,
    [leadId, businessId]
  );
  if (!r.rows[0]) throw new AppError('Lead not found.', 404);
  const row = r.rows[0] as LeadRow;
  if (!viewAll && row.owner_user_id !== userId) {
    throw new AppError('You do not have access to this lead.', 403);
  }
  res.status(200).json({ status: 'success', data: { lead: toApiLead(row) } });
});

/**
 * POST /api/businesses/crm/leads
 */
export const createCrmLead = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const userId = req.user?.id;
  const role = req.user?.membershipRole;
  if (!businessId || !userId || !role) throw new AppError('Not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);
  assertCrmCreateLeads(perms);

  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw new AppError('name is required.', 400);
  const clientPipeline = typeof body.pipelineId === 'string' ? body.pipelineId : 'main';
  const stageKey = typeof body.stage === 'string' ? body.stage.trim() : '';
  if (!stageKey) throw new AppError('stage is required.', 400);
  const pipelineId = await resolvePipelineId(businessId, clientPipeline);
  await assertStageInPipeline(businessId, pipelineId, stageKey);

  const email = typeof body.email === 'string' ? body.email : '';
  const phone = typeof body.phone === 'string' ? body.phone : '';
  const company = typeof body.company === 'string' ? body.company : '';
  const source = typeof body.source === 'string' ? body.source : '';
  const notes = typeof body.notes === 'string' ? body.notes : '';
  const accountType = body.accountType === 'commercial' ? 'commercial' : 'personal';
  const urgency =
    body.urgency === 'low' || body.urgency === 'medium' || body.urgency === 'high'
      ? body.urgency
      : null;
  const tags: string[] = Array.isArray(body.tags) ? body.tags.map((t: unknown) => String(t)) : [];
  const ownerUserIdFromBody = body.ownerUserId;
  let ownerUserId: string | null = userId;
  if (ownerUserIdFromBody && typeof ownerUserIdFromBody === 'string' && canViewAllLeads(perms)) {
    const check = await pool.query(
      `SELECT user_id FROM business_members WHERE business_id = $1 AND user_id = $2::uuid`,
      [businessId, ownerUserIdFromBody]
    );
    if (check.rows[0]) ownerUserId = ownerUserIdFromBody;
  }

  const ins = await pool.query(
    `INSERT INTO crm_leads
     (business_id, pipeline_id, stage_key, name, email, phone, company, source, notes, owner_user_id, tags, account_type, urgency, reply_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, 'none')
     RETURNING id`,
    [
      businessId,
      pipelineId,
      stageKey,
      name,
      email,
      phone,
      company,
      source,
      notes,
      ownerUserId,
      mapTagsToJson(tags),
      accountType,
      urgency,
    ]
  );
  const newId = ins.rows[0].id;
  const r = await pool.query(
    `SELECT l.id, l.business_id, l.pipeline_id, l.stage_key, l.name, l.email, l.phone, l.company, l.source, l.notes,
            l.owner_user_id, l.tags, l.account_type, l.urgency, l.last_campaign_touched_at, l.last_campaign_name,
            l.last_campaign_channel, l.reply_status, l.next_suggested_action, l.created_at,
            p.is_default, u.first_name, u.last_name, u.email AS owner_email
     FROM crm_leads l
     JOIN crm_pipelines p ON p.id = l.pipeline_id
     LEFT JOIN users u ON u.id = l.owner_user_id
     WHERE l.id = $1`,
    [newId]
  );
  res.status(201).json({ status: 'success', data: { lead: toApiLead(r.rows[0] as LeadRow) } });
});

/**
 * PATCH /api/businesses/crm/leads/:leadId
 */
export const patchCrmLead = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const userId = req.user?.id;
  const role = req.user?.membershipRole;
  if (!businessId || !userId || !role) throw new AppError('Not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);
  assertCrmEditLeads(perms);

  const leadId = String(req.params.leadId || '');
  const ex = await pool.query(
    `SELECT l.id, l.pipeline_id, l.owner_user_id, l.stage_key, l.name, l.email, l.phone, l.company, l.source, l.notes, l.tags,
            l.account_type, l.urgency, p.is_default, l.last_campaign_touched_at, l.last_campaign_name, l.last_campaign_channel,
            l.reply_status, l.next_suggested_action, l.created_at,
            u.first_name, u.last_name, u.email AS owner_email
     FROM crm_leads l
     JOIN crm_pipelines p ON p.id = l.pipeline_id
     LEFT JOIN users u ON u.id = l.owner_user_id
     WHERE l.id = $1::uuid AND l.business_id = $2`,
    [leadId, businessId]
  );
  if (!ex.rows[0]) throw new AppError('Lead not found.', 404);
  const cur = ex.rows[0] as unknown as LeadRow;
  assertLeadRowScope(perms, userId, cur.owner_user_id);

  const body = req.body || {};
  const sets: string[] = ['updated_at = CURRENT_TIMESTAMP'];
  const vals: unknown[] = [];
  let n = 1;

  if (typeof body.name === 'string' && body.name.trim()) {
    sets.push(`name = $${n++}`);
    vals.push(body.name.trim());
  }
  if (typeof body.email === 'string') {
    sets.push(`email = $${n++}`);
    vals.push(body.email);
  }
  if (typeof body.phone === 'string') {
    sets.push(`phone = $${n++}`);
    vals.push(body.phone);
  }
  if (typeof body.company === 'string') {
    sets.push(`company = $${n++}`);
    vals.push(body.company);
  }
  if (typeof body.source === 'string') {
    sets.push(`source = $${n++}`);
    vals.push(body.source);
  }
  if (typeof body.notes === 'string') {
    sets.push(`notes = $${n++}`);
    vals.push(body.notes);
  }
  if (body.stage != null) {
    const sk = String(body.stage).trim();
    if (sk) {
      await assertStageInPipeline(businessId, cur.pipeline_id, sk);
      sets.push(`stage_key = $${n++}`);
      vals.push(sk);
    }
  }
  if (body.accountType === 'personal' || body.accountType === 'commercial') {
    sets.push(`account_type = $${n++}`);
    vals.push(body.accountType);
  }
  if (body.urgency === 'low' || body.urgency === 'medium' || body.urgency === 'high' || body.urgency === null) {
    sets.push(`urgency = $${n++}`);
    vals.push(body.urgency);
  }
  if (Array.isArray(body.tags)) {
    const tags = body.tags.map((t: unknown) => String(t));
    sets.push(`tags = $${n++}::jsonb`);
    vals.push(mapTagsToJson(tags));
  }
  if (body.ownerUserId !== undefined && canViewAllLeads(perms)) {
    if (body.ownerUserId === null) {
      sets.push(`owner_user_id = NULL`);
    } else if (typeof body.ownerUserId === 'string') {
      const check = await pool.query(
        `SELECT user_id FROM business_members WHERE business_id = $1 AND user_id = $2::uuid`,
        [businessId, body.ownerUserId]
      );
      if (check.rows[0]) {
        sets.push(`owner_user_id = $${n++}::uuid`);
        vals.push(body.ownerUserId);
      }
    }
  }
  if (body.pipelineId !== undefined && canViewAllLeads(perms) && typeof body.pipelineId === 'string') {
    const np = await resolvePipelineId(businessId, body.pipelineId);
    sets.push(`pipeline_id = $${n}::uuid`);
    vals.push(np);
    n++;
  }

  vals.push(leadId, businessId);
  const w1 = n;
  const w2 = n + 1;
  await pool.query(
    `UPDATE crm_leads SET ${sets.join(', ')} WHERE id = $${w1}::uuid AND business_id = $${w2}`,
    vals
  );

  const r = await pool.query(
    `SELECT l.id, l.business_id, l.pipeline_id, l.stage_key, l.name, l.email, l.phone, l.company, l.source, l.notes,
            l.owner_user_id, l.tags, l.account_type, l.urgency, l.last_campaign_touched_at, l.last_campaign_name,
            l.last_campaign_channel, l.reply_status, l.next_suggested_action, l.created_at,
            p.is_default, u.first_name, u.last_name, u.email AS owner_email
     FROM crm_leads l
     JOIN crm_pipelines p ON p.id = l.pipeline_id
     LEFT JOIN users u ON u.id = l.owner_user_id
     WHERE l.id = $1::uuid`,
    [leadId]
  );
  res.status(200).json({ status: 'success', data: { lead: toApiLead(r.rows[0] as LeadRow) } });
});

/**
 * DELETE /api/businesses/crm/leads/:leadId
 */
export const deleteCrmLead = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const userId = req.user?.id;
  const role = req.user?.membershipRole;
  if (!businessId || !userId || !role) throw new AppError('Not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);
  assertCrmDeleteLeads(perms);

  const leadId = String(req.params.leadId || '');
  const ex = await pool.query(
    `SELECT owner_user_id FROM crm_leads WHERE id = $1::uuid AND business_id = $2`,
    [leadId, businessId]
  );
  if (!ex.rows[0]) throw new AppError('Lead not found.', 404);
  assertLeadRowScope(perms, userId, ex.rows[0].owner_user_id);

  const r = await pool.query(
    `DELETE FROM crm_leads WHERE id = $1::uuid AND business_id = $2 RETURNING id`,
    [leadId, businessId]
  );
  if (!r.rows[0]) throw new AppError('Lead not found.', 404);
  res.status(200).json({ status: 'success', data: { deleted: true } });
});

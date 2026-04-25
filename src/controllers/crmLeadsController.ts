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
import {
  firstMissingForStageEntry,
  firstMissingRequiredCrmField,
  fetchCrmConfigPartsForBusiness,
} from '../utils/crmLeadRequiredFields';
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

/** @throws AppError if id is not a workspace member (so we never “succeed” with a stale owner). */
async function assertUserIsBusinessMember(businessId: string, userIdRaw: string): Promise<string> {
  const userId = String(userIdRaw).trim();
  if (!looksLikeUuid(userId)) {
    throw new AppError('ownerUserId must be a valid user id.', 400);
  }
  const check = await pool.query(
    `SELECT user_id FROM business_members WHERE business_id = $1 AND user_id = $2::uuid`,
    [businessId, userId]
  );
  if (!check.rows[0]) {
    throw new AppError('That user is not a member of this workspace.', 400);
  }
  return userId;
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

function trimStr(s: unknown, max: number): string {
  if (s == null || typeof s !== 'string') return '';
  return s.trim().slice(0, max);
}

/** Escape for ILIKE: %, _, \ */
function ilikeTerm(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * GET /api/businesses/crm/leads/filters
 * Distinct lead sources and tag strings for the current business (for pipeline filter UI).
 * Placed on a dedicated path so it is not caught by :leadId.
 */
export const getCrmLeadsFilterMeta = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const userId = req.user?.id;
  const role = req.user?.membershipRole;
  if (!businessId || !userId || !role) throw new AppError('Not authenticated.', 401);
  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);
  const viewAll = canViewAllLeads(perms);

  const whereScope = viewAll
    ? 'l.business_id = $1'
    : 'l.business_id = $1 AND l.owner_user_id = $2::uuid';
  const baseArgs: unknown[] = viewAll ? [businessId] : [businessId, userId];

  const rSources = await pool.query(
    `SELECT DISTINCT TRIM(l.source) AS s
     FROM crm_leads l
     WHERE ${whereScope} AND COALESCE(TRIM(l.source), '') <> ''
     ORDER BY 1
     LIMIT 200`,
    baseArgs
  );
  const sources = (rSources.rows as { s: string }[]).map((x) => x.s).filter(Boolean);

  const rTags = await pool.query(
    `SELECT l.tags
     FROM crm_leads l
     WHERE ${whereScope}
     LIMIT 2000`,
    baseArgs
  );
  const tagSet = new Set<string>();
  for (const row of rTags.rows) {
    for (const t of mapTagsFromDb((row as { tags: unknown }).tags)) {
      if (t) tagSet.add(t);
    }
  }
  const tags = Array.from(tagSet).sort((a, b) => a.localeCompare(b));

  res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.status(200).json({ status: 'success', data: { sources, tags } });
});

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

  // Two explicit branches: avoid boolean parameter quirks and keep assigned-only scoping clear.
  const args: unknown[] = [businessId];
  let next = 2;
  let where = 'l.business_id = $1';
  if (!viewAll) {
    where += ` AND l.owner_user_id = $${next}::uuid`;
    args.push(userId);
    next += 1;
  }
  if (serverPipeline) {
    where += ` AND l.pipeline_id = $${next}::uuid`;
    args.push(serverPipeline);
    next += 1;
  }
  if (stageKey) {
    where += ` AND l.stage_key = $${next}`;
    args.push(stageKey);
    next += 1;
  }

  const unassigned = String(req.query.unassigned || '') === '1' || String(req.query.unassigned || '') === 'true';
  if (unassigned) {
    where += ` AND l.owner_user_id IS NULL`;
  }

  const ownerUserIdQ = typeof req.query.ownerUserId === 'string' ? req.query.ownerUserId.trim() : '';
  if (!unassigned && ownerUserIdQ && looksLikeUuid(ownerUserIdQ)) {
    const m = await pool.query(
      `SELECT 1 FROM business_members WHERE business_id = $1 AND user_id = $2::uuid`,
      [businessId, ownerUserIdQ]
    );
    if (m.rows[0]) {
      where += ` AND l.owner_user_id = $${next}::uuid`;
      args.push(ownerUserIdQ);
      next += 1;
    }
  }

  const sourceQ = trimStr(req.query.source, 200);
  if (sourceQ) {
    where += ` AND LOWER(TRIM(l.source)) = LOWER(TRIM($${next}))`;
    args.push(sourceQ);
    next += 1;
  }

  const urgencyQ = trimStr(req.query.urgency, 20);
  if (urgencyQ && ['low', 'medium', 'high'].includes(urgencyQ)) {
    where += ` AND l.urgency = $${next}`;
    args.push(urgencyQ);
    next += 1;
  }

  const accountQ = trimStr(req.query.accountType, 20);
  if (accountQ === 'personal' || accountQ === 'commercial') {
    where += ` AND l.account_type = $${next}`;
    args.push(accountQ);
    next += 1;
  }

  const tagQ = trimStr(req.query.tag, 100);
  if (tagQ) {
    // tags JSON array contains string; safe parameterised json
    const arr = JSON.stringify([tagQ]);
    where += ` AND l.tags @> $${next}::jsonb`;
    args.push(arr);
    next += 1;
  }

  const excludeTagQ = trimStr(req.query.excludeTag, 100);
  if (excludeTagQ) {
    where += ` AND NOT (l.tags @> $${next}::jsonb)`;
    args.push(JSON.stringify([excludeTagQ]));
    next += 1;
  }

  const searchQ = trimStr(req.query.q, 200);
  if (searchQ) {
    const t = '%' + ilikeTerm(searchQ) + '%';
    where += ` AND (
      l.name ILIKE $${next} ESCAPE '\\' OR l.email ILIKE $${next} ESCAPE '\\'
      OR l.phone ILIKE $${next} ESCAPE '\\' OR l.company ILIKE $${next} ESCAPE '\\'
      OR l.notes ILIKE $${next} ESCAPE '\\'
    )`;
    args.push(t);
    next += 1;
  }

  const createdFrom = typeof req.query.createdFrom === 'string' ? req.query.createdFrom.trim() : '';
  const createdTo = typeof req.query.createdTo === 'string' ? req.query.createdTo.trim() : '';
  if (createdFrom) {
    const d = new Date(createdFrom);
    if (!Number.isNaN(d.getTime())) {
      where += ` AND l.created_at >= $${next}::timestamptz`;
      args.push(d.toISOString());
      next += 1;
    }
  }
  if (createdTo) {
    const d = new Date(createdTo);
    if (!Number.isNaN(d.getTime())) {
      where += ` AND l.created_at <= $${next}::timestamptz`;
      args.push(d.toISOString());
      next += 1;
    }
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
  res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
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
  const hasOwnerKey = Object.prototype.hasOwnProperty.call(body, 'ownerUserId');
  const ownerUserIdFromBody = body.ownerUserId;
  let ownerUserId: string | null = userId;
  if (canViewAllLeads(perms) && hasOwnerKey) {
    if (ownerUserIdFromBody === null || (typeof ownerUserIdFromBody === 'string' && !String(ownerUserIdFromBody).trim())) {
      ownerUserId = null;
    } else if (typeof ownerUserIdFromBody === 'string') {
      ownerUserId = await assertUserIsBusinessMember(businessId, ownerUserIdFromBody);
    }
  }

  const { fieldRows: crmFieldRows, stageReqs } = await fetchCrmConfigPartsForBusiness(businessId);
  const acct: 'personal' | 'commercial' = accountType;
  const leadSnap = {
    name,
    email: typeof email === 'string' ? email : '',
    phone: typeof phone === 'string' ? phone : '',
    company: typeof company === 'string' ? company : '',
    source: typeof source === 'string' ? source : '',
    notes: typeof notes === 'string' ? notes : '',
    stage: stageKey,
    accountType: acct,
    urgency,
    ownerUserId,
  };
  const stageEntryMissing = firstMissingForStageEntry(stageReqs, stageKey, crmFieldRows, leadSnap);
  if (stageEntryMissing) {
    throw new AppError(`Cannot add a lead in this stage: ${stageEntryMissing} is required.`, 400);
  }
  const createMissing = firstMissingRequiredCrmField(crmFieldRows, leadSnap);
  if (createMissing) {
    throw new AppError(`${createMissing} is required.`, 400);
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

  const mName = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : cur.name;
  const mEmail = typeof body.email === 'string' ? body.email : cur.email;
  const mPhone = typeof body.phone === 'string' ? body.phone : cur.phone;
  const mCompany = typeof body.company === 'string' ? body.company : cur.company;
  const mSource = typeof body.source === 'string' ? body.source : cur.source;
  const mNotes = typeof body.notes === 'string' ? body.notes : cur.notes;
  let mStage = cur.stage_key;
  if (body.stage != null) {
    const sk = String(body.stage).trim();
    if (sk) {
      await assertStageInPipeline(businessId, cur.pipeline_id, sk);
      mStage = sk;
    }
  }
  let mAccount: 'personal' | 'commercial' =
    cur.account_type === 'commercial' ? 'commercial' : 'personal';
  if (body.accountType === 'personal' || body.accountType === 'commercial') {
    mAccount = body.accountType;
  }
  let mUrgency: string | null = cur.urgency;
  if (body.urgency === 'low' || body.urgency === 'medium' || body.urgency === 'high' || body.urgency === null) {
    mUrgency = body.urgency;
  }
  let mOwner: string | null = cur.owner_user_id;
  /** When not `unchanged`, DB `owner_user_id` will be set to this value (validated). */
  let ownerUserIdForPatch: string | null | 'unchanged' = 'unchanged';
  if (body.ownerUserId !== undefined && canViewAllLeads(perms)) {
    if (body.ownerUserId === null || (typeof body.ownerUserId === 'string' && !String(body.ownerUserId).trim())) {
      mOwner = null;
      ownerUserIdForPatch = null;
    } else if (typeof body.ownerUserId === 'string') {
      const resolved = await assertUserIsBusinessMember(businessId, body.ownerUserId);
      mOwner = resolved;
      ownerUserIdForPatch = resolved;
    }
  }

  const { fieldRows: crmFieldRowsPatch, stageReqs: stageReqsPatch } = await fetchCrmConfigPartsForBusiness(
    businessId
  );
  const postPatchSnapshot = {
    name: mName,
    email: mEmail,
    phone: mPhone,
    company: mCompany,
    source: mSource,
    notes: mNotes,
    stage: mStage,
    accountType: mAccount,
    urgency: mUrgency,
    ownerUserId: mOwner,
  };
  const stageIsChanging = body.stage != null && String(body.stage).trim() && mStage !== cur.stage_key;
  if (stageIsChanging) {
    const stageEntryMissing = firstMissingForStageEntry(
      stageReqsPatch,
      mStage,
      crmFieldRowsPatch,
      postPatchSnapshot
    );
    if (stageEntryMissing) {
      throw new AppError(`Cannot move to this stage: ${stageEntryMissing} is required.`, 400);
    }
  }
  const patchMissing = firstMissingRequiredCrmField(crmFieldRowsPatch, postPatchSnapshot);
  if (patchMissing) {
    throw new AppError(`${patchMissing} is required.`, 400);
  }

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
  if (ownerUserIdForPatch !== 'unchanged') {
    if (ownerUserIdForPatch === null) {
      sets.push(`owner_user_id = NULL`);
    } else {
      sets.push(`owner_user_id = $${n++}::uuid`);
      vals.push(ownerUserIdForPatch);
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

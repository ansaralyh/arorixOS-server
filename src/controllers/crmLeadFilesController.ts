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

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MiB
const ALLOWED_FOLDERS = new Set([
  'contracts',
  'photos',
  'estimates',
  'documents',
  'signed-forms',
  'other',
]);

type LeadScopeRow = { owner_user_id: string | null };

async function resolveLeadScope(
  businessId: string,
  leadId: string
): Promise<{ ok: true; ownerUserId: string | null } | { ok: false }> {
  const r = await pool.query(
    `SELECT owner_user_id FROM crm_leads WHERE id = $1::uuid AND business_id = $2`,
    [leadId, businessId]
  );
  if (!r.rows[0]) return { ok: false };
  const row = r.rows[0] as LeadScopeRow;
  return { ok: true, ownerUserId: row.owner_user_id ?? null };
}

function parseTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== 'string') continue;
    const t = x.trim().slice(0, 64);
    if (t) out.push(t);
    if (out.length >= 20) break;
  }
  return out;
}

function normalizeFolder(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (s && ALLOWED_FOLDERS.has(s)) return s;
  return 'other';
}

function toApiFile(row: {
  id: string;
  original_name: string;
  mime_type: string | null;
  size_bytes: string | number;
  folder: string;
  tags: string[] | null;
  created_at: Date;
  uploaded_by_user_id: string | null;
}) {
  const tags = Array.isArray(row.tags) ? row.tags : [];
  return {
    id: row.id,
    originalName: row.original_name,
    mimeType: row.mime_type || 'application/octet-stream',
    sizeBytes: Number(row.size_bytes) || 0,
    folder: row.folder || 'other',
    tags,
    createdAt: new Date(row.created_at).toISOString(),
    uploadedByUserId: row.uploaded_by_user_id != null ? String(row.uploaded_by_user_id) : null,
  };
}

/**
 * GET /api/businesses/crm/leads/:leadId/files
 */
export const listCrmLeadFiles = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const userId = req.user?.id;
  const role = req.user?.membershipRole;
  if (!businessId || !userId || !role) throw new AppError('Not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);
  const leadId = String(req.params.leadId || '');
  const resolved = await resolveLeadScope(businessId, leadId);
  if (!resolved.ok) throw new AppError('Lead not found.', 404);
  assertLeadRowScope(perms, userId, resolved.ownerUserId);

  const r = await pool.query(
    `SELECT id, original_name, mime_type, size_bytes, folder, tags, created_at, uploaded_by_user_id
     FROM crm_lead_files
     WHERE business_id = $1 AND lead_id = $2::uuid
     ORDER BY created_at DESC
     LIMIT 500`,
    [businessId, leadId]
  );
  const files = (r.rows as Parameters<typeof toApiFile>[0][]).map(toApiFile);
  res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.status(200).json({ status: 'success', data: { files } });
});

/**
 * POST /api/businesses/crm/leads/:leadId/files
 * Body: { originalName, mimeType?, base64, folder?, tags? }
 */
export const createCrmLeadFile = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const userId = req.user?.id;
  const role = req.user?.membershipRole;
  if (!businessId || !userId || !role) throw new AppError('Not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);
  assertCrmEditLeads(perms);
  const leadId = String(req.params.leadId || '');
  const resolved = await resolveLeadScope(businessId, leadId);
  if (!resolved.ok) throw new AppError('Lead not found.', 404);
  assertLeadRowScope(perms, userId, resolved.ownerUserId);

  const body = req.body || {};
  const originalName =
    typeof body.originalName === 'string' ? body.originalName.trim().slice(0, 512) : '';
  if (!originalName) throw new AppError('originalName is required.', 400);
  const mimeType =
    typeof body.mimeType === 'string' ? body.mimeType.trim().slice(0, 200) : 'application/octet-stream';
  const b64 = typeof body.base64 === 'string' ? body.base64.trim() : '';
  if (!b64) throw new AppError('base64 is required.', 400);
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, 'base64');
  } catch {
    throw new AppError('Invalid base64 payload.', 400);
  }
  if (buf.length === 0) throw new AppError('Empty file.', 400);
  if (buf.length > MAX_FILE_BYTES) {
    throw new AppError(`File exceeds maximum size of ${MAX_FILE_BYTES / (1024 * 1024)} MiB.`, 400);
  }

  const folder = normalizeFolder(body.folder);
  let tags = parseTags(body.tags);
  if (tags.length === 0) tags = [folder];

  const ins = await pool.query(
    `INSERT INTO crm_lead_files
     (business_id, lead_id, uploaded_by_user_id, original_name, mime_type, size_bytes, folder, tags, content)
     VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9)
     RETURNING id, original_name, mime_type, size_bytes, folder, tags, created_at, uploaded_by_user_id`,
    [businessId, leadId, userId, originalName, mimeType || null, buf.length, folder, tags, buf]
  );

  await pool.query(
    `INSERT INTO crm_lead_activities (business_id, lead_id, activity_type, occurred_at, details, extra)
     VALUES ($1, $2::uuid, 'file_uploaded', CURRENT_TIMESTAMP, $3, $4::jsonb)`,
    [
      businessId,
      leadId,
      originalName,
      JSON.stringify({ fileId: ins.rows[0].id, userId }),
    ]
  );

  res.status(201).json({
    status: 'success',
    data: { file: toApiFile(ins.rows[0] as Parameters<typeof toApiFile>[0]) },
  });
});

/**
 * GET /api/businesses/crm/leads/:leadId/files/:fileId/download
 */
export const downloadCrmLeadFile = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const userId = req.user?.id;
  const role = req.user?.membershipRole;
  if (!businessId || !userId || !role) throw new AppError('Not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);
  const leadId = String(req.params.leadId || '');
  const fileId = String(req.params.fileId || '');
  const resolved = await resolveLeadScope(businessId, leadId);
  if (!resolved.ok) throw new AppError('Lead not found.', 404);
  assertLeadRowScope(perms, userId, resolved.ownerUserId);

  const r = await pool.query(
    `SELECT original_name, mime_type, content
     FROM crm_lead_files
     WHERE id = $1::uuid AND business_id = $2 AND lead_id = $3::uuid`,
    [fileId, businessId, leadId]
  );
  if (!r.rows[0]) throw new AppError('File not found.', 404);
  const row = r.rows[0] as { original_name: string; mime_type: string | null; content: Buffer };
  const safeName = row.original_name.replace(/["\r\n]/g, '_').slice(0, 200);
  res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.status(200).send(row.content);
});

/**
 * DELETE /api/businesses/crm/leads/:leadId/files/:fileId
 */
export const deleteCrmLeadFile = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const userId = req.user?.id;
  const role = req.user?.membershipRole;
  if (!businessId || !userId || !role) throw new AppError('Not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);
  assertCrmEditLeads(perms);
  const leadId = String(req.params.leadId || '');
  const fileId = String(req.params.fileId || '');
  const resolved = await resolveLeadScope(businessId, leadId);
  if (!resolved.ok) throw new AppError('Lead not found.', 404);
  assertLeadRowScope(perms, userId, resolved.ownerUserId);

  const del = await pool.query(
    `DELETE FROM crm_lead_files
     WHERE id = $1::uuid AND business_id = $2 AND lead_id = $3::uuid
     RETURNING id`,
    [fileId, businessId, leadId]
  );
  if (!del.rows[0]) throw new AppError('File not found.', 404);
  res.status(204).send();
});

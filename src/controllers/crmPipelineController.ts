import { Request, Response } from 'express';
import pool from '../config/db';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../middlewares/errorHandler';
import {
  assertCrmEditPipelines,
  assertCrmView,
  getEffectivePermissions,
} from '../utils/crmAccess';

const DEFAULT_STAGES: { stageKey: string; label: string; color: string; visible: boolean }[] = [
  { stageKey: 'said-no', label: 'Said No', color: 'border-t-slate-400', visible: true },
  { stageKey: 'just-submitted', label: 'Just Submitted', color: 'border-t-blue-500', visible: true },
  { stageKey: 'contact-no-info', label: 'Contact', color: 'border-t-cyan-500', visible: true },
  { stageKey: 'collected-info', label: 'Collected', color: 'border-t-teal-500', visible: true },
  { stageKey: 'presented-quote', label: 'Quote', color: 'border-t-emerald-500', visible: true },
  { stageKey: 'hot-deal', label: 'HOT', color: 'border-t-orange-500', visible: true },
  { stageKey: 'sold', label: 'Sold', color: 'border-t-green-600', visible: true },
];

async function ensureDefaultPipelinesForBusiness(
  businessId: string
): Promise<void> {
  const c = await pool.query(
    `SELECT 1 AS x FROM crm_pipelines WHERE business_id = $1 LIMIT 1`,
    [businessId]
  );
  if (c.rows.length > 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const p = await client.query(
      `INSERT INTO crm_pipelines (business_id, name, sort_index, is_default)
       VALUES ($1, 'Main Pipeline', 0, TRUE)
       RETURNING id`,
      [businessId]
    );
    const pipelineId = p.rows[0].id as string;
    for (let i = 0; i < DEFAULT_STAGES.length; i++) {
      const s = DEFAULT_STAGES[i];
      await client.query(
        `INSERT INTO crm_pipeline_stages
         (business_id, pipeline_id, stage_key, label, color, sort_index, is_visible)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          businessId,
          pipelineId,
          s.stageKey,
          s.label,
          s.color,
          i,
          s.visible,
        ]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

function rowToPipeline(
  p: { id: string; name: string; sort_index: number; is_default: boolean },
  stages: {
    id: string;
    stage_key: string;
    label: string;
    color: string;
    sort_index: number;
    is_visible: boolean;
  }[]
) {
  return {
    id: p.id,
    name: p.name,
    sortIndex: p.sort_index,
    isDefault: p.is_default,
    stages: stages.map((s) => ({
      id: s.id,
      stageKey: s.stage_key,
      label: s.label,
      color: s.color,
      sortIndex: s.sort_index,
      visible: s.is_visible,
    })),
  };
}

/**
 * GET /api/businesses/crm/pipelines
 */
export const listCrmPipelines = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const role = req.user?.membershipRole;
  if (!businessId || !role) throw new AppError('Business not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);

  await ensureDefaultPipelinesForBusiness(businessId);

  const pl = await pool.query(
    `SELECT id, name, sort_index, is_default FROM crm_pipelines
     WHERE business_id = $1 ORDER BY sort_index ASC, created_at ASC`,
    [businessId]
  );

  const pipelines = [];
  for (const row of pl.rows) {
    const st = await pool.query(
      `SELECT id, stage_key, label, color, sort_index, is_visible
       FROM crm_pipeline_stages
       WHERE pipeline_id = $1
       ORDER BY sort_index ASC, created_at ASC`,
      [row.id]
    );
    pipelines.push(rowToPipeline(row, st.rows));
  }

  res.status(200).json({ status: 'success', data: { pipelines } });
});

/**
 * POST /api/businesses/crm/pipelines
 * Body: { name: string, isDefault?: boolean }
 */
export const createCrmPipeline = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const role = req.user?.membershipRole;
  if (!businessId || !role) throw new AppError('Business not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);
  assertCrmEditPipelines(perms);

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) throw new AppError('name is required.', 400);
  const isDefault = req.body?.isDefault === true;

  const count = await pool.query(
    `SELECT COUNT(*)::int AS c FROM crm_pipelines WHERE business_id = $1`,
    [businessId]
  );
  const n = count.rows[0]?.c ?? 0;
  const nextSort = n;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (isDefault) {
      await client.query(
        `UPDATE crm_pipelines SET is_default = FALSE, updated_at = CURRENT_TIMESTAMP
         WHERE business_id = $1 AND is_default = TRUE`,
        [businessId]
      );
    }
    const onlyOne = n === 0;
    const ins = await client.query(
      `INSERT INTO crm_pipelines (business_id, name, sort_index, is_default)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, sort_index, is_default`,
      [businessId, name, nextSort, onlyOne ? true : isDefault]
    );
    const row = ins.rows[0];
    if (onlyOne) {
      for (let i = 0; i < DEFAULT_STAGES.length; i++) {
        const s = DEFAULT_STAGES[i];
        await client.query(
          `INSERT INTO crm_pipeline_stages
           (business_id, pipeline_id, stage_key, label, color, sort_index, is_visible)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [businessId, row.id, s.stageKey, s.label, s.color, i, s.visible]
        );
      }
    }
    await client.query('COMMIT');
    const st = await pool.query(
      `SELECT id, stage_key, label, color, sort_index, is_visible
       FROM crm_pipeline_stages WHERE pipeline_id = $1 ORDER BY sort_index ASC`,
      [row.id]
    );
    res.status(201).json({
      status: 'success',
      data: { pipeline: rowToPipeline(row, st.rows) },
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

/**
 * PATCH /api/businesses/crm/pipelines/:pipelineId
 * Body: { name?: string, isDefault?: boolean }
 */
export const patchCrmPipeline = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const role = req.user?.membershipRole;
  if (!businessId || !role) throw new AppError('Business not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);
  assertCrmEditPipelines(perms);

  const pipelineId = String(req.params.pipelineId || '');
  if (!pipelineId) throw new AppError('pipelineId is required.', 400);

  const check = await pool.query(
    `SELECT id, name, sort_index, is_default FROM crm_pipelines
     WHERE id = $1 AND business_id = $2`,
    [pipelineId, businessId]
  );
  if (check.rows.length === 0) throw new AppError('Pipeline not found.', 404);

  const nameRaw = req.body?.name;
  const name =
    nameRaw === undefined || nameRaw === null
      ? undefined
      : String(nameRaw).trim() === ''
        ? undefined
        : String(nameRaw).trim();
  const isDefault = req.body?.isDefault;

  if (name === undefined && isDefault === undefined) {
    throw new AppError('Provide name and/or isDefault.', 400);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (isDefault === true) {
      await client.query(
        `UPDATE crm_pipelines SET is_default = FALSE, updated_at = CURRENT_TIMESTAMP
         WHERE business_id = $1 AND is_default = TRUE AND id <> $2`,
        [businessId, pipelineId]
      );
    }
    const parts: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const vals: unknown[] = [];
    let n = 1;
    if (name !== undefined) {
      parts.push(`name = $${n++}`);
      vals.push(name);
    }
    if (isDefault !== undefined) {
      parts.push(`is_default = $${n++}`);
      vals.push(isDefault === true);
    }
    vals.push(pipelineId, businessId);
    await client.query(
      `UPDATE crm_pipelines SET ${parts.join(', ')} WHERE id = $${n++} AND business_id = $${n++}`,
      vals
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const pl = await pool.query(
    `SELECT id, name, sort_index, is_default FROM crm_pipelines WHERE id = $1 AND business_id = $2`,
    [pipelineId, businessId]
  );
  const row = pl.rows[0];
  const st = await pool.query(
    `SELECT id, stage_key, label, color, sort_index, is_visible
     FROM crm_pipeline_stages WHERE pipeline_id = $1 ORDER BY sort_index ASC`,
    [pipelineId]
  );
  res.status(200).json({ status: 'success', data: { pipeline: rowToPipeline(row, st.rows) } });
});

/**
 * DELETE /api/businesses/crm/pipelines/:pipelineId
 */
export const deleteCrmPipeline = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const role = req.user?.membershipRole;
  if (!businessId || !role) throw new AppError('Business not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);
  assertCrmEditPipelines(perms);

  const pipelineId = String(req.params.pipelineId || '');
  const c = await pool.query(
    `SELECT COUNT(*)::int AS c FROM crm_pipelines WHERE business_id = $1`,
    [businessId]
  );
  if ((c.rows[0]?.c ?? 0) <= 1) {
    throw new AppError('Cannot delete the only pipeline. Create another pipeline first.', 400);
  }

  const r = await pool.query(
    `DELETE FROM crm_pipelines WHERE id = $1 AND business_id = $2 RETURNING id`,
    [pipelineId, businessId]
  );
  if (r.rows.length === 0) throw new AppError('Pipeline not found.', 404);
  res.status(200).json({ status: 'success', data: { deleted: true } });
});

type StageInput = { stageKey: string; label: string; color?: string; visible?: boolean };

/**
 * PUT /api/businesses/crm/pipelines/:pipelineId/stages
 * Body: { stages: StageInput[] } — full ordered list. Upserts by stageKey; removes keys not present.
 */
export const putCrmPipelineStages = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const role = req.user?.membershipRole;
  if (!businessId || !role) throw new AppError('Business not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);
  assertCrmEditPipelines(perms);

  const pipelineId = String(req.params.pipelineId || '');
  const pl = await pool.query(
    `SELECT id FROM crm_pipelines WHERE id = $1 AND business_id = $2`,
    [pipelineId, businessId]
  );
  if (pl.rows.length === 0) throw new AppError('Pipeline not found.', 404);

  const raw = req.body?.stages;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AppError('stages must be a non-empty array.', 400);
  }

  const stages: StageInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    if (!s || typeof s !== 'object') {
      throw new AppError(`stages[${i}] is invalid.`, 400);
    }
    const sk = typeof s.stageKey === 'string' ? s.stageKey.trim() : '';
    const lab = typeof s.label === 'string' ? s.label.trim() : '';
    if (!sk || !lab) {
      throw new AppError('Each stage requires stageKey and label.', 400);
    }
    stages.push({
      stageKey: sk,
      label: lab,
      color: typeof s.color === 'string' && s.color.trim() ? s.color.trim() : 'border-t-slate-400',
      visible: s.visible === false ? false : true,
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < stages.length; i++) {
      const s = stages[i];
      await client.query(
        `INSERT INTO crm_pipeline_stages
         (business_id, pipeline_id, stage_key, label, color, sort_index, is_visible)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (pipeline_id, stage_key) DO UPDATE SET
           label = EXCLUDED.label,
           color = EXCLUDED.color,
           sort_index = EXCLUDED.sort_index,
           is_visible = EXCLUDED.is_visible,
           updated_at = CURRENT_TIMESTAMP`,
        [businessId, pipelineId, s.stageKey, s.label, s.color ?? 'border-t-slate-400', i, s.visible !== false]
      );
    }
    const keys = stages.map((s) => s.stageKey);
    await client.query(
      `DELETE FROM crm_pipeline_stages
       WHERE pipeline_id = $1 AND NOT (stage_key = ANY($2::text[]))`,
      [pipelineId, keys]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const st = await pool.query(
    `SELECT id, stage_key, label, color, sort_index, is_visible
     FROM crm_pipeline_stages WHERE pipeline_id = $1 ORDER BY sort_index ASC`,
    [pipelineId]
  );
  const pRow = await pool.query(
    `SELECT id, name, sort_index, is_default FROM crm_pipelines WHERE id = $1 AND business_id = $2`,
    [pipelineId, businessId]
  );
  res.status(200).json({
    status: 'success',
    data: { pipeline: rowToPipeline(pRow.rows[0], st.rows) },
  });
});

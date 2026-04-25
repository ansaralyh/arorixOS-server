import { Request, Response } from 'express';
import pool from '../config/db';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../middlewares/errorHandler';
import { getEffectivePermissions, assertCrmView } from '../utils/crmAccess';

const MAX_CRM_CONFIG_BYTES = 512 * 1024;
const CURRENT_SCHEMA = 1;

/**
 * GET /api/businesses/crm/settings
 * Returns versioned JSON snapshot for the workspace (or null config if never saved).
 * Read: any member who can view CRM (view_all_customers or view_assigned_customers).
 */
export const getCrmSettings = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const userId = req.user?.id;
  const role = req.user?.membershipRole;
  if (!businessId || !userId || !role) throw new AppError('Not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);

  const r = await pool.query(
    `SELECT schema_version, crm_config, updated_at
     FROM business_crm_settings
     WHERE business_id = $1`,
    [businessId]
  );
  if (!r.rows[0]) {
    return res.status(200).json({
      status: 'success',
      data: { schemaVersion: 1, crmConfig: null, updatedAt: null },
    });
  }
  const row = r.rows[0] as {
    schema_version: number;
    crm_config: unknown;
    updated_at: Date;
  };
  return res.status(200).json({
    status: 'success',
    data: {
      schemaVersion: row.schema_version,
      crmConfig: row.crm_config,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    },
  });
});

/**
 * PUT /api/businesses/crm/settings
 * **requireTeamAdmin** on route — only OWNER/ADMIN. Full document replace, versioned JSONB.
 */
export const putCrmSettings = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const userId = req.user?.id;
  const role = req.user?.membershipRole;
  if (!businessId || !userId || !role) throw new AppError('Not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);

  const body = req.body ?? {};
  const crmConfig = body.crmConfig;
  if (crmConfig == null || typeof crmConfig !== 'object' || Array.isArray(crmConfig)) {
    throw new AppError('crmConfig must be a JSON object.', 400);
  }

  const raw = JSON.stringify(crmConfig);
  if (Buffer.byteLength(raw, 'utf8') > MAX_CRM_CONFIG_BYTES) {
    throw new AppError(`CRM settings payload is too large (max ${MAX_CRM_CONFIG_BYTES} bytes).`, 400);
  }

  let schemaVersion = CURRENT_SCHEMA;
  if (body.schemaVersion != null) {
    const n = Number(body.schemaVersion);
    if (Number.isInteger(n) && n >= 1 && n <= 32767) schemaVersion = n;
    else throw new AppError('schemaVersion must be a small positive integer.', 400);
  }

  const r = await pool.query(
    `INSERT INTO business_crm_settings (business_id, schema_version, crm_config, updated_at)
     VALUES ($1, $2, $3::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (business_id) DO UPDATE SET
       schema_version = EXCLUDED.schema_version,
       crm_config = EXCLUDED.crm_config,
       updated_at = CURRENT_TIMESTAMP
     RETURNING schema_version, crm_config, updated_at`,
    [businessId, schemaVersion, crmConfig as object]
  );
  const row = r.rows[0] as {
    schema_version: number;
    crm_config: unknown;
    updated_at: Date;
  };
  return res.status(200).json({
    status: 'success',
    data: {
      schemaVersion: row.schema_version,
      crmConfig: row.crm_config,
      updatedAt: new Date(row.updated_at).toISOString(),
    },
  });
});

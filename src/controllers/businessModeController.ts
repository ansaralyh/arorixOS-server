import { Request, Response } from 'express';
import pool from '../config/db';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../middlewares/errorHandler';
import { parseBusinessMode, sanitizeCustomLabels, type BusinessMode } from '../utils/businessMode';

function rowToDto(row: { mode: string; custom_labels: Record<string, unknown> }) {
  return {
    mode: row.mode as BusinessMode,
    customLabels: row.custom_labels as Record<string, string>
  };
}

/** Ensure a settings row exists (legacy businesses, or first API call before trigger ran). */
async function ensureSettingsRow(businessId: string): Promise<void> {
  await pool.query(
    `INSERT INTO business_mode_settings (business_id) VALUES ($1)
     ON CONFLICT (business_id) DO NOTHING`,
    [businessId]
  );
}

export const updateBusinessModeSettings = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  if (!businessId) {
    throw new AppError('No business associated with this account.', 400);
  }

  const { mode: modeRaw, customLabels: labelsRaw } = req.body ?? {};

  if (modeRaw === undefined && labelsRaw === undefined) {
    throw new AppError('Provide at least one of: mode, customLabels.', 400);
  }

  let mode: BusinessMode | undefined;
  if (modeRaw !== undefined) {
    mode = parseBusinessMode(modeRaw);
  }

  let customLabels: Record<string, string> | undefined;
  if (labelsRaw !== undefined) {
    customLabels = sanitizeCustomLabels(labelsRaw);
  }

  await ensureSettingsRow(businessId);

  if (mode !== undefined && customLabels !== undefined) {
    const result = await pool.query(
      `UPDATE business_mode_settings
       SET mode = $2,
           custom_labels = $3::jsonb,
           updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $1
       RETURNING mode, custom_labels`,
      [businessId, mode, JSON.stringify(customLabels)]
    );
    return res.status(200).json({
      status: 'success',
      data: { businessMode: rowToDto(result.rows[0]) }
    });
  }

  if (mode !== undefined) {
    const result = await pool.query(
      `UPDATE business_mode_settings
       SET mode = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $1
       RETURNING mode, custom_labels`,
      [businessId, mode]
    );
    return res.status(200).json({
      status: 'success',
      data: { businessMode: rowToDto(result.rows[0]) }
    });
  }

  const result = await pool.query(
    `UPDATE business_mode_settings
     SET custom_labels = $2::jsonb,
         updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $1
     RETURNING mode, custom_labels`,
    [businessId, JSON.stringify(customLabels)]
  );

  res.status(200).json({
    status: 'success',
    data: { businessMode: rowToDto(result.rows[0]) }
  });
});

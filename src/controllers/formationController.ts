import { Request, Response } from 'express';
import pool from '../config/db';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../middlewares/errorHandler';

/** List formation orders for the authenticated business (newest first). */
export const listFormationRequests = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  if (!businessId) {
    throw new AppError('No business associated with this account.', 400);
  }

  const result = await pool.query(
    `SELECT id, status, partner_order_id, state_of_formation, desired_name, backup_name,
            addons, documents_url, created_at, updated_at
     FROM formation_requests
     WHERE business_id = $1
     ORDER BY created_at DESC`,
    [businessId]
  );

  const formationRequests = result.rows.map(r => ({
    id: r.id,
    status: r.status,
    partnerOrderId: r.partner_order_id,
    stateOfFormation: r.state_of_formation,
    desiredName: r.desired_name,
    backupName: r.backup_name,
    addons: r.addons && typeof r.addons === 'object' ? r.addons : {},
    documentsUrl: r.documents_url,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));

  res.status(200).json({
    status: 'success',
    data: { formationRequests }
  });
});

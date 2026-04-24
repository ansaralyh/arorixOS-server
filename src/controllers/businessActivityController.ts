import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../middlewares/errorHandler';
import {
  BUSINESS_ACTIVITY_ACTIONS,
  getActorDisplayName,
  listBusinessActivities,
  recordBusinessActivity,
  rowToApiEvent,
} from '../services/businessActivityService';

/**
 * GET /api/businesses/activity?limit=50&before=ISO
 */
export const listActivity = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  if (!businessId) throw new AppError('Business not authenticated.', 401);

  const rawLimit = parseInt(String(req.query.limit ?? '50'), 10);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 50;

  let before: Date | null = null;
  const beforeRaw = req.query.before;
  if (typeof beforeRaw === 'string' && beforeRaw.trim()) {
    const d = new Date(beforeRaw);
    if (Number.isNaN(d.getTime())) {
      throw new AppError('Invalid before cursor (use ISO-8601).', 400);
    }
    before = d;
  }

  const events = await listBusinessActivities(businessId, { limit, before });

  res.status(200).json({
    status: 'success',
    data: { events },
  });
});

/**
 * POST /api/businesses/activity
 * Body: { action, category, itemTitle, details? }
 */
export const createActivity = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const userId = req.user?.id;
  if (!businessId || !userId) throw new AppError('Not authenticated.', 401);

  const action = typeof req.body?.action === 'string' ? req.body.action.trim() : '';
  const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
  const itemTitle = typeof req.body?.itemTitle === 'string' ? req.body.itemTitle.trim() : '';
  const details =
    req.body?.details === undefined || req.body?.details === null
      ? null
      : String(req.body.details);

  if (!action || !category || !itemTitle) {
    throw new AppError('action, category, and itemTitle are required.', 400);
  }
  if (!BUSINESS_ACTIVITY_ACTIONS.has(action)) {
    throw new AppError(`action must be one of: ${[...BUSINESS_ACTIVITY_ACTIONS].join(', ')}.`, 400);
  }

  const actorLabel = await getActorDisplayName(userId);
  const row = await recordBusinessActivity({
    businessId,
    actorUserId: userId,
    actorLabel,
    action,
    category,
    itemTitle,
    details,
  });

  res.status(201).json({
    status: 'success',
    data: { event: rowToApiEvent(row) },
  });
});

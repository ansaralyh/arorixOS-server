import { Request, Response, NextFunction } from 'express';
import pool from '../config/db';
import { AppError } from './errorHandler';

export type MembershipRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'MEMBER';

/** Must run after requireBusinessMembership */
export const requireTeamAdmin = (req: Request, res: Response, next: NextFunction) => {
  const r = req.user?.membershipRole;
  if (r !== 'OWNER' && r !== 'ADMIN') {
    return next(new AppError('Only workspace owners and admins can perform this action.', 403));
  }
  next();
};

/**
 * Ensures JWT businessId is present and the user has a business_members row.
 * Sets req.user.membershipRole for downstream handlers.
 */
export const requireBusinessMembership = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    const businessId = req.user?.businessId;

    if (!userId) {
      return next(new AppError('User not authenticated.', 401));
    }
    if (!businessId) {
      return next(new AppError('No business context on this session.', 403));
    }

    const result = await pool.query(
      `SELECT role FROM business_members WHERE user_id = $1 AND business_id = $2`,
      [userId, businessId]
    );

    if (result.rows.length === 0) {
      return next(new AppError('You are not a member of this business.', 403));
    }

    const role = result.rows[0].role as MembershipRole;
    req.user!.membershipRole = role;
    next();
  } catch (err) {
    next(err);
  }
};

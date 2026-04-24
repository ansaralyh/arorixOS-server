import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from './errorHandler';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key_change_me_in_prod';

// Extend Express Request interface to include our custom user property
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        businessId: string | null;
        /** Set by requireBusinessMembership after verifying business_members row */
        membershipRole?: 'OWNER' | 'ADMIN' | 'MANAGER' | 'MEMBER';
      };
    }
  }
}

/**
 * Middleware to protect routes.
 * Checks for a valid JWT token in the Authorization header.
 * If valid, attaches the decoded user info to req.user.
 * If invalid or missing, throws a 401 Unauthorized error.
 */
export const protect = (req: Request, res: Response, next: NextFunction) => {
  try {
    // 1. Check if token exists in headers
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      throw new AppError('You are not logged in. Please log in to get access.', 401);
    }

    // 2. Verify token
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; businessId: string | null };

    // 3. Attach user info to request object
    req.user = {
      id: decoded.userId,
      businessId: decoded.businessId ?? null,
    };

    next();
  } catch (error: any) {
    if (error.name === 'JsonWebTokenError') {
      next(new AppError('Invalid token. Please log in again.', 401));
    } else if (error.name === 'TokenExpiredError') {
      next(new AppError('Your token has expired. Please log in again.', 401));
    } else {
      next(error);
    }
  }
};

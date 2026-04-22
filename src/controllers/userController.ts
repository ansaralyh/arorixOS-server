import { Request, Response } from 'express';
import * as userService from '../services/userService';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../middlewares/errorHandler';

// Get Current User (Me) Controller
export const getMe = catchAsync(async (req: Request, res: Response) => {
  // 1. Get userId and businessId from the auth middleware (req.user)
  const userId = req.user?.id;
  const businessId = req.user?.businessId;

  if (!userId || !businessId) {
    throw new AppError('User ID or Business ID not found in token.', 401);
  }

  // 2. Call Service Layer
  const result = await userService.getMe(userId, businessId);

  // 3. Send Response
  res.status(200).json({
    status: 'success',
    message: 'User details fetched successfully',
    data: result
  });
});

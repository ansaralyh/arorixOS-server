import { Request, Response } from 'express';
import * as authService from '../services/authService';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../middlewares/errorHandler';

export const register = catchAsync(async (req: Request, res: Response) => {
  const { email, password, firstName, lastName, businessName } = req.body;

  // Basic validation
  if (!email || !password || !firstName || !lastName || !businessName) {
    throw new AppError('Please provide all required fields: email, password, firstName, lastName, businessName.', 400); // 400 Bad Request
  }

  const result = await authService.registerUser(req.body);

  res.status(201).json({ // 201 Created
    status: 'success',
    data: result
  });
});

export const login = catchAsync(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new AppError('Please provide email and password.', 400);
  }

  const result = await authService.loginUser(req.body);

  res.status(200).json({
    status: 'success',
    data: result
  });
});

export const funnelCheckout = catchAsync(async (req: Request, res: Response) => {
  // This endpoint gets hit from the funnel when the user clicks "Pay".
  const { email, firstName, lastName, businessName } = req.body;

  if (!email || !firstName || !lastName || !businessName) {
    throw new AppError('Please provide all required fields: email, firstName, lastName, businessName.', 400);
  }

  // Automatically generate a secure password, register the user and the business,
  // mark them as paid (because of Dev Mode)
  const result = await authService.registerFromFunnel(req.body);

  res.status(201).json({
    status: 'success',
    data: result
  });
});

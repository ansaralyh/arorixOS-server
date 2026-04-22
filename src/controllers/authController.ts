import { Request, Response } from 'express';
import * as authService from '../services/authService';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../middlewares/errorHandler';

// Registration Controller
export const register = catchAsync(async (req: Request, res: Response) => {
  const { email, password, firstName, lastName, businessName } = req.body;

  // 1. Input Validation
  if (!email || !password || !firstName || !lastName || !businessName) {
    throw new AppError('All fields are required (email, password, firstName, lastName, businessName).', 400);
  }

  // 2. Call Service Layer
  const result = await authService.registerUser({
    email,
    password,
    firstName,
    lastName,
    businessName
  });

  // 3. Send Response
  res.status(201).json({
    status: 'success',
    message: 'Account created successfully',
    data: result
  });
});

// Login Controller
export const login = catchAsync(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  // 1. Input Validation
  if (!email || !password) {
    throw new AppError('Email and password are required.', 400);
  }

  // 2. Call Service Layer
  const result = await authService.loginUser({ email, password });

  // 3. Send Response
  res.status(200).json({
    status: 'success',
    message: 'Login successful',
    data: result
  });
});

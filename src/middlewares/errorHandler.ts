import { Request, Response, NextFunction } from 'express';

// Custom Error Class to standardize error responses
export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true; // Indicates this is a known, handled error (not a random crash)
    Error.captureStackTrace(this, this.constructor);
  }
}

// Global Error Handling Middleware
export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);

  // If it's our custom AppError, send the specific status code and message
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
    });
  }

  // Handle specific PostgreSQL Errors (e.g., Unique constraint violation)
  if (err.code === '23505') {
    return res.status(409).json({
      status: 'error',
      message: 'A record with this value already exists.',
    });
  }

  // Fallback for unhandled/unexpected errors (500 Internal Server Error)
  // In production, we don't leak stack traces to the client
  const isProduction = process.env.NODE_ENV === 'production';
  return res.status(500).json({
    status: 'error',
    message: 'Internal server error',
    ...(isProduction ? {} : { stack: err.stack }),
  });
};

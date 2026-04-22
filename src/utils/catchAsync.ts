import { Request, Response, NextFunction } from 'express';

/**
 * A wrapper to catch async errors in Express routes.
 * Instead of wrapping every controller function in a try/catch block,
 * we wrap the route handler with this function. If an error is thrown,
 * it automatically passes it to the global error handler middleware.
 */
export const catchAsync = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
};

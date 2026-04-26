import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import businessRoutes from './routes/businessRoutes';
import { errorHandler, AppError } from './middlewares/errorHandler';

// Application setup (express instance, middleware registration)
const app = express();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '12mb' }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/businesses', businessRoutes);

// Basic Health Check Route
app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', message: 'Arorix OS Backend is running!' });
});

// 404 Route Not Found Handler
app.use((req: Request, res: Response, next: NextFunction) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Global Error Handling Middleware (MUST be the last middleware)
app.use(errorHandler);

// Export the app instance so it can be used by server.ts and test files
export default app;

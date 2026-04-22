import express, { type Request, type Response } from 'express';
import cors from 'cors';

// Application setup (express instance, middleware registration)
const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Basic Health Check Route
app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', message: 'Arorix OS Backend is running!' });
});

// Export the app instance so it can be used by server.ts and test files
export default app;

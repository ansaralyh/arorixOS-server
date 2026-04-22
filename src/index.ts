import express, { type Request, type Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/db';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Basic Health Check Route
app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', message: 'Arorix OS Backend is running!' });
});

// Start Server and Connect to Database
app.listen(PORT, async () => {
  console.log(` Server is running on http://localhost:${PORT}`);
  
  // Test the database connection on startup
  await connectDB();
});

import app from './app';
import { connectDB } from './config/db';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// 1. Handle Uncaught Exceptions (Synchronous Errors)
// This must be at the very top to catch any bugs in the initialization code
process.on('uncaughtException', (err: Error) => {
  console.error('UNCAUGHT EXCEPTION! Shutting down...');
  console.error(err.name, err.message);
  console.error(err.stack);
  process.exit(1);
});

// Keep default aligned with Vite + arorixOS `api` base (http://localhost:5000/api).
const PORT = process.env.PORT || 5000;

// Application entry point (starts the server, connects to DB)
const startServer = async () => {
  try {
    // 1. Connect to Database
    await connectDB();
    
    // 2. Start Express Server
    const server = app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });

    // 3. Handle Unhandled Rejections (Asynchronous Errors like failed DB connections outside of Express)
    process.on('unhandledRejection', (err: Error) => {
      console.error('UNHANDLED REJECTION! Shutting down...');
      console.error(err.name, err.message);
      
      // Gracefully shut down the server before exiting
      server.close(() => {
        process.exit(1);
      });
    });

    // 4. Handle SIGTERM (Graceful shutdown for Heroku/Docker/EC2)
    process.on('SIGTERM', () => {
      console.log('SIGTERM RECEIVED. Shutting down gracefully');
      server.close(() => {
        console.log('Process terminated!');
      });
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

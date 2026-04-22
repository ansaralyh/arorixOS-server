import app from './app';
import { connectDB } from './config/db';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 5000;

// Application entry point (starts the server, connects to DB)
const startServer = async () => {
  try {
    // 1. Connect to Database
    await connectDB();
    
    // 2. Start Express Server
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error(' Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

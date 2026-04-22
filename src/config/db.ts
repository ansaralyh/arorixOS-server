import { Pool } from 'pg';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Create a new PostgreSQL connection pool
// A "Pool" manages multiple connections automatically, which is best practice for web servers
const pool = new Pool({
  user: process.env.POSTGRES_USER,
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  password: process.env.POSTGRES_PASSWORD,
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
});

/**
 * Function to test the database connection on server startup..
 * It attempts to connect, logs success, and immediately releases the test connection.
 */
export const connectDB = async () => {
  try {
    const client = await pool.connect();
    console.log('Successfully connected to PostgreSQL database!');
    
    // Release the client back to the pool so it can be used by real requests
    client.release();
  } catch (error) {
    console.error(' Failed to connect to the database. Please check your .env credentials.');
    console.error(error);
    
    // If the database is required for the app to run, exit the process
    process.exit(1);
  }
};

// Export the pool so other files (like models/controllers) can use it to run queries
export default pool;

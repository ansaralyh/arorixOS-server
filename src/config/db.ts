import { Pool } from 'pg';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Create a new PostgreSQL connection pool
const pool = new Pool({
  user: process.env.POSTGRES_USER,
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  password: process.env.POSTGRES_PASSWORD,
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
});

/**
 * Function to test the database connection on server startup.
 */
export const connectDB = async () => {
  try {
    const client = await pool.connect();
    console.log(' Successfully connected to PostgreSQL database!');
    client.release();
  } catch (error) {
    console.error('Failed to connect to the database. Please check your .env credentials.');
    console.error(error);
    process.exit(1);
  }
};

export default pool;

import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Create a new PostgreSQL connection pool
const pool = new Pool({
  user: process.env.POSTGRES_USER,
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  password: process.env.POSTGRES_PASSWORD,
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
});

const runMigration = async () => {
  try {
    console.log('Starting database migration...');
    
    // Read the init.sql file
    const sqlFilePath = path.join(__dirname, 'init.sql');
    const sql = fs.readFileSync(sqlFilePath, 'utf8');

    // Execute the SQL queries
    await pool.query(sql);
    
    console.log('Migration completed successfully! All tables and triggers are set up.');
  } catch (error) {
    console.error('Migration failed. Please check your database connection and SQL syntax.');
    console.error(error);
    process.exit(1);
  } finally {
    // Close the database connection
    await pool.end();
  }
};

runMigration();

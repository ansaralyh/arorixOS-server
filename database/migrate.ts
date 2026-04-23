import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  user: process.env.POSTGRES_USER || 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  database: process.env.POSTGRES_DB || 'arorixOS',
  password: process.env.POSTGRES_PASSWORD || 'root',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
});

const runMigration = async () => {
  console.log('Starting database migration...');
  const client = await pool.connect();
  
  try {
    const sqlPath = path.join(__dirname, 'init.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    await client.query(sql);

    // Manually add the is_paid column if it wasn't added because the table already existed
    try {
        await client.query('ALTER TABLE businesses ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT FALSE;');
        console.log('Ensured is_paid column exists.');
    } catch (e) {
        console.log('Could not alter businesses table, might already exist correctly.');
    }

    console.log('Migration completed successfully! All tables and triggers are set up.');
  } catch (error) {
    console.error('Error running migration:', error);
  } finally {
    client.release();
    await pool.end();
  }
};

runMigration();

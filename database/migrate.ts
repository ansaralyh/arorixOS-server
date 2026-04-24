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

function logApplied(label: string) {
  console.log(`✓ Applied successfully: ${label}`);
}

const runMigration = async () => {
  console.log('Starting database migration...');
  const client = await pool.connect();
  const dbRoot = __dirname;
  const cwd = process.cwd();

  try {
    const initPath = path.join(dbRoot, 'init.sql');
    try {
      await client.query(fs.readFileSync(initPath, 'utf8'));
      logApplied(path.relative(cwd, initPath));
    } catch (e) {
      console.error(`✗ Failed: ${path.relative(cwd, initPath)}`);
      throw e;
    }

    try {
      await client.query('ALTER TABLE businesses ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT FALSE;');
      logApplied('businesses.is_paid (ALTER COLUMN IF NOT EXISTS)');
    } catch {
      console.log('⚠ Skipped: businesses.is_paid safeguard (table may be unavailable).');
    }

    const migrationsDir = path.join(dbRoot, 'migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      for (const file of files) {
        const fullPath = path.join(migrationsDir, file);
        const rel = path.relative(cwd, fullPath);
        try {
          await client.query(fs.readFileSync(fullPath, 'utf8'));
          logApplied(rel);
        } catch (e) {
          console.error(`✗ Failed: ${rel}`);
          throw e;
        }
      }
    }

    console.log('Migration completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
};

runMigration();

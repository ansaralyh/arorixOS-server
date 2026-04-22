import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../config/db';
import { AppError } from '../middlewares/errorHandler';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key_change_me_in_prod';

export const registerUser = async (data: any) => {
  const { email, password, firstName, lastName, businessName } = data;

  // 1. Check if user exists
  const userCheck = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (userCheck.rows.length > 0) {
    throw new AppError('User already exists with this email.', 409); // 409 Conflict
  }

  // 2. Hash password
  const saltRounds = 10;
  const passwordHash = await bcrypt.hash(password, saltRounds);

  // 3. Transaction to ensure User, Business, and Member are all created together
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert User
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, first_name, last_name) 
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [email, passwordHash, firstName, lastName]
    );
    const userId = userResult.rows[0].id;

    // Insert Business
    const businessResult = await client.query(
      `INSERT INTO businesses (name) VALUES ($1) RETURNING id`,
      [businessName]
    );
    const businessId = businessResult.rows[0].id;

    // Link User to Business as OWNER
    await client.query(
      `INSERT INTO business_members (user_id, business_id, role) VALUES ($1, $2, 'OWNER')`,
      [userId, businessId]
    );

    await client.query('COMMIT');

    // 4. Generate JWT
    const token = jwt.sign({ userId, businessId }, JWT_SECRET, { expiresIn: '7d' });

    return {
      token,
      user: { id: userId, email, firstName, lastName },
      business: { id: businessId, name: businessName }
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err; // Re-throw so the catchAsync wrapper can send it to the global error handler
  } finally {
    client.release();
  }
};

export const loginUser = async (data: any) => {
  const { email, password } = data;

  // 1. Find user
  const userResult = await pool.query('SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL', [email]);
  if (userResult.rows.length === 0) {
    throw new AppError('Invalid email or password.', 401); // 401 Unauthorized
  }
  const user = userResult.rows[0];

  // 2. Verify password
  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    throw new AppError('Invalid email or password.', 401);
  }

  // 3. Get their primary business
  const businessResult = await pool.query(
    `SELECT b.id, b.name, bm.role 
     FROM businesses b 
     JOIN business_members bm ON b.id = bm.business_id 
     WHERE bm.user_id = $1 LIMIT 1`,
    [user.id]
  );
  
  let businessId = null;
  let businessName = null;
  
  if (businessResult.rows.length > 0) {
    businessId = businessResult.rows[0].id;
    businessName = businessResult.rows[0].name;
  }

  // 4. Generate JWT
  const token = jwt.sign({ userId: user.id, businessId }, JWT_SECRET, { expiresIn: '7d' });

  return {
    token,
    user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name },
    business: businessId ? { id: businessId, name: businessName } : null
  };
};

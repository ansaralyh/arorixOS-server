import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../config/db';
import { AppError } from '../middlewares/errorHandler';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key_change_me_in_prod';
const IS_DEV_MODE = process.env.NODE_ENV === 'development';

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

  // 3. Set payment status based on environment
  // In development, auto-mark everyone as paid so we can build the dashboard.
  // In production, this stays false until a Stripe webhook confirms payment.
  const isPaid = IS_DEV_MODE ? true : false;

  // 4. Transaction to ensure User, Business, and Member are all created together
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

    // Insert Business (with the is_paid flag)
    const businessResult = await client.query(
      `INSERT INTO businesses (name, is_paid) VALUES ($1, $2) RETURNING id`,
      [businessName, isPaid]
    );
    const businessId = businessResult.rows[0].id;

    // Link User to Business as OWNER
    await client.query(
      `INSERT INTO business_members (user_id, business_id, role) VALUES ($1, $2, 'OWNER')`,
      [userId, businessId]
    );

    await client.query('COMMIT');

    // 5. Generate JWT
    const token = jwt.sign({ userId, businessId, isPaid }, JWT_SECRET, { expiresIn: '7d' });

    return {
      token,
      user: { id: userId, email, firstName, lastName },
      business: { id: businessId, name: businessName, isPaid }
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err; // Re-throw so the catchAsync wrapper can send it to the global error handler
  } finally {
    client.release();
  }
};

import crypto from 'crypto';

export const registerFromFunnel = async (data: any) => {
  const { email, firstName, lastName, businessName } = data;

  // 1. Generate a secure, random password (e.g., 16 chars long)
  const generatedPassword = crypto.randomBytes(8).toString('hex');
  
  // 2. Reuse the registerUser logic, which handles hashing, saving to DB, 
  // and setting the isPaid flag based on Dev Mode.
  const registerData = {
    ...data,
    password: generatedPassword, 
  };

  const result = await registerUser(registerData);
  
  // Console log the generated password so the admin can see it in the terminal
  console.log(`\n=== NEW USER REGISTERED FROM FUNNEL ===`);
  console.log(`Email: ${email}`);
  console.log(`Password: ${generatedPassword}`);
  console.log(`=======================================\n`);
  
  // Optionally, you might want to return the generated password ONLY ONCE
  // so the funnel can display it to the user or send it in an email.
  // In a real system, you'd send an email to them to set their password.
  return {
    ...result,
    generatedPassword 
  };
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
    `SELECT b.id, b.name, b.is_paid, bm.role 
     FROM businesses b 
     JOIN business_members bm ON b.id = bm.business_id 
     WHERE bm.user_id = $1 LIMIT 1`,
    [user.id]
  );
  
  let businessId = null;
  let businessName = null;
  let isPaid = false;
  
  if (businessResult.rows.length > 0) {
    businessId = businessResult.rows[0].id;
    businessName = businessResult.rows[0].name;
    isPaid = businessResult.rows[0].is_paid;
  }

  // 4. Check if they have paid
  if (businessId && !isPaid && !IS_DEV_MODE) {
     throw new AppError('Your account is active, but we are awaiting payment confirmation. Please check your email.', 403);
  }

  // 5. Generate JWT
  const token = jwt.sign({ userId: user.id, businessId, isPaid }, JWT_SECRET, { expiresIn: '7d' });

  return {
    token,
    user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name },
    business: businessId ? { id: businessId, name: businessName, isPaid } : null
  };
};

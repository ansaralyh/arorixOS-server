import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import pool from '../config/db';
import { AppError } from '../middlewares/errorHandler';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key_change_me_in_prod';
const IS_DEV_MODE = process.env.NODE_ENV === 'development';

/** Session payload for a user scoped to one business (JWT + profile shapes used by login). */
export const getAuthPayloadForUserAndBusiness = async (userId: string, businessId: string) => {
  const userResult = await pool.query(
    `SELECT id, email, first_name, last_name, phone FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  if (userResult.rows.length === 0) {
    throw new AppError('User not found.', 404);
  }
  const u = userResult.rows[0];

  const bResult = await pool.query(
    `SELECT id, name, is_paid, entity_type, industry, state, email, phone
     FROM businesses WHERE id = $1 AND deleted_at IS NULL`,
    [businessId]
  );
  if (bResult.rows.length === 0) {
    throw new AppError('Business not found.', 404);
  }
  const b = bResult.rows[0];

  if (!b.is_paid && !IS_DEV_MODE) {
    throw new AppError('Your account is active, but we are awaiting payment confirmation. Please check your email.', 403);
  }

  const isPaid = b.is_paid;
  const token = jwt.sign({ userId, businessId, isPaid }, JWT_SECRET, { expiresIn: '7d' });

  return {
    token,
    user: {
      id: u.id,
      email: u.email,
      firstName: u.first_name,
      lastName: u.last_name,
      phone: u.phone,
    },
    business: {
      id: b.id,
      name: b.name,
      isPaid,
      entityType: b.entity_type,
      industry: b.industry,
      stateOfFormation: b.state,
      email: b.email,
      phone: b.phone,
    },
  };
};

export const hashInviteToken = (plainToken: string) =>
  crypto.createHash('sha256').update(plainToken, 'utf8').digest('hex');

/**
 * Invites are generated as 64-char hex (lowercase). Hashing is case-sensitive, so
 * normalize pasted/URL tokens (uppercase, zero-width chars, bidi) before lookup.
 */
function normalizeInviteTokenPlain(raw: string): string {
  const stripped = raw.replace(/[\u200B-\u200D\uFEFF\u202A-\u202E]/g, '').trim();
  if (/^[a-f0-9]{64}$/i.test(stripped)) {
    return stripped.toLowerCase();
  }
  return stripped;
}

/**
 * Accept a teammate invite: creates membership for invited business.
 * New users must provide firstName, lastName, password. Existing users: password only.
 */
export const acceptTeamInvite = async (data: {
  token: string;
  password: string;
  firstName?: string;
  lastName?: string;
}) => {
  const { token: rawToken, password } = data;
  if (!rawToken || !password) {
    throw new AppError('Please provide token and password.', 400);
  }

  const plainToken = normalizeInviteTokenPlain(rawToken);
  const tokenHash = hashInviteToken(plainToken);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const invResult = await client.query(
      `SELECT id, business_id, email, role, status, expires_at
       FROM business_invitations
       WHERE token_hash = $1
       FOR UPDATE`,
      [tokenHash]
    );

    if (invResult.rows.length === 0) {
      throw new AppError('Invalid or unknown invitation.', 400);
    }

    const inv = invResult.rows[0];
    if (inv.status !== 'PENDING') {
      throw new AppError('This invitation is no longer valid.', 400);
    }
    if (new Date(inv.expires_at) <= new Date()) {
      await client.query(
        `UPDATE business_invitations SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [inv.id]
      );
      await client.query('COMMIT');
      throw new AppError('This invitation has expired.', 400);
    }

    const businessId = inv.business_id as string;
    const inviteEmail = String(inv.email).trim().toLowerCase();
    const memberRole = inv.role as string;

    const existingUser = await client.query(
      `SELECT id, email, password_hash, first_name, last_name, phone FROM users
       WHERE lower(trim(email)) = $1 AND deleted_at IS NULL`,
      [inviteEmail]
    );

    let userId: string;

    if (existingUser.rows.length > 0) {
      const u = existingUser.rows[0];
      const ok = await bcrypt.compare(password, u.password_hash);
      if (!ok) {
        throw new AppError('Invalid email or password.', 401);
      }
      userId = u.id;
    } else {
      const fn = data.firstName?.trim();
      const ln = data.lastName?.trim();
      if (!fn || !ln) {
        throw new AppError('Please provide firstName and lastName to create your account.', 400);
      }
      const passwordHash = await bcrypt.hash(password, 10);
      const ins = await client.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, phone)
         VALUES ($1, $2, $3, $4, NULL)
         RETURNING id`,
        [inviteEmail, passwordHash, fn, ln]
      );
      userId = ins.rows[0].id;
    }

    const already = await client.query(
      `SELECT 1 FROM business_members WHERE user_id = $1 AND business_id = $2`,
      [userId, businessId]
    );
    if (already.rows.length > 0) {
      await client.query(
        `UPDATE business_invitations
         SET status = 'ACCEPTED', accepted_at = CURRENT_TIMESTAMP, accepted_user_id = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [inv.id, userId]
      );
      await client.query('COMMIT');
      return getAuthPayloadForUserAndBusiness(userId, businessId);
    }

    await client.query(
      `INSERT INTO business_members (user_id, business_id, role) VALUES ($1, $2, $3)`,
      [userId, businessId, memberRole]
    );

    await client.query(
      `UPDATE business_invitations
       SET status = 'ACCEPTED', accepted_at = CURRENT_TIMESTAMP, accepted_user_id = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [inv.id, userId]
    );

    await client.query('COMMIT');
    return getAuthPayloadForUserAndBusiness(userId, businessId);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

export const registerUser = async (data: any) => {
  const { email, password, firstName, lastName, businessName, phone } = data;

  // 1. Check if user exists
  const userCheck = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (userCheck.rows.length > 0) {
    throw new AppError('User already exists with this email.', 409); // 409 Conflict
  }

  // 2. Hash password
  const saltRounds = 10;
  const passwordHash = await bcrypt.hash(password, saltRounds);

  // 3. Set payment status based on environment
  const isPaid = IS_DEV_MODE ? true : false;

  // 4. Transaction to ensure User, Business, and Member are all created together
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert User
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, phone) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [email, passwordHash, firstName, lastName, phone || null]
    );
    const userId = userResult.rows[0].id;

    // Insert Business (with the is_paid flag)
    const businessResult = await client.query(
      `INSERT INTO businesses (
        name, 
        entity_type, 
        industry, 
        state, 
        email, 
        phone, 
        is_paid,
        website,
        street,
        city,
        zip_code,
        country
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [
        businessName, 
        data.entityType || null,
        data.industry || null,
        data.stateOfFormation || null,
        email, // Defaulting business email to user email
        data.phone || null,
        isPaid,
        data.website || null,
        data.street || null,
        data.city || null,
        data.zipCode || null,
        data.country || null
      ]
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
      user: { 
        id: userId, 
        email, 
        firstName, 
        lastName,
        phone: phone || null 
      },
      business: { 
        id: businessId, 
        name: businessName, 
        isPaid,
        entityType: data.entityType || null,
        industry: data.industry || null,
        stateOfFormation: data.stateOfFormation || null,
        email: email,
        phone: data.phone || null
      }
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err; // Re-throw so the catchAsync wrapper can send it to the global error handler
  } finally {
    client.release();
  }
};

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
    `SELECT b.id, b.name, b.is_paid, b.entity_type, b.industry, b.state, b.email as business_email, b.phone as business_phone, bm.role 
     FROM businesses b 
     JOIN business_members bm ON b.id = bm.business_id 
     WHERE bm.user_id = $1 LIMIT 1`,
    [user.id]
  );
  
  let businessId = null;
  let businessName = null;
  let isPaid = false;
  let entityType = null;
  let industry = null;
  let stateOfFormation = null;
  let businessEmail = null;
  let businessPhone = null;
  
  if (businessResult.rows.length > 0) {
    const b = businessResult.rows[0];
    businessId = b.id;
    businessName = b.name;
    isPaid = b.is_paid;
    entityType = b.entity_type;
    industry = b.industry;
    stateOfFormation = b.state;
    businessEmail = b.business_email;
    businessPhone = b.business_phone;
  }

  // 4. Check if they have paid
  if (businessId && !isPaid && !IS_DEV_MODE) {
     throw new AppError('Your account is active, but we are awaiting payment confirmation. Please check your email.', 403);
  }

  // 5. Generate JWT
  const token = jwt.sign({ userId: user.id, businessId, isPaid }, JWT_SECRET, { expiresIn: '7d' });

  return {
    token,
    user: { 
      id: user.id, 
      email: user.email, 
      firstName: user.first_name, 
      lastName: user.last_name,
      phone: user.phone
    },
    business: businessId ? { 
      id: businessId, 
      name: businessName, 
      isPaid,
      entityType,
      industry,
      stateOfFormation,
      email: businessEmail,
      phone: businessPhone
    } : null
  };
};

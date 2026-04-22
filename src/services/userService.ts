import pool from '../config/db';
import { AppError } from '../middlewares/errorHandler';

export const getMe = async (userId: string, businessId: string) => {
  // 1. Fetch User
  const userResult = await pool.query(
    'SELECT id, email, first_name, last_name, phone FROM users WHERE id = $1 AND deleted_at IS NULL',
    [userId]
  );
  if (userResult.rows.length === 0) {
    throw new AppError('User not found.', 404);
  }
  const user = userResult.rows[0];

  // 2. Fetch Business
  let business = null;
  if (businessId) {
    const businessResult = await pool.query(
      `SELECT b.id, b.name, b.entity_type, b.industry, bm.role 
       FROM businesses b 
       JOIN business_members bm ON b.id = bm.business_id 
       WHERE b.id = $1 AND bm.user_id = $2`,
      [businessId, userId]
    );
    if (businessResult.rows.length > 0) {
      business = businessResult.rows[0];
    }
  }

  return {
    user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name, phone: user.phone },
    business: business ? { id: business.id, name: business.name, entityType: business.entity_type, industry: business.industry, role: business.role } : null
  };
};

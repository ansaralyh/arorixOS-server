import { Request, Response } from 'express';
import pool from '../config/db';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../middlewares/errorHandler';

export const updateProfile = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { firstName, lastName, email, phone } = req.body;

  if (!userId) {
    throw new AppError('User not authenticated.', 401);
  }

  // Basic validation
  if (!firstName || !lastName || !email) {
    throw new AppError('Please provide firstName, lastName, and email.', 400);
  }

  // Update user in database
  const result = await pool.query(
    `UPDATE users 
     SET first_name = $1, last_name = $2, email = $3, phone = $4, updated_at = CURRENT_TIMESTAMP
     WHERE id = $5 
     RETURNING id, email, first_name, last_name, phone`,
    [firstName, lastName, email, phone || null, userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('User not found.', 404);
  }

  const updatedUser = result.rows[0];

  res.status(200).json({
    status: 'success',
    data: {
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        firstName: updatedUser.first_name,
        lastName: updatedUser.last_name,
        phone: updatedUser.phone
      }
    }
  });
});

export const getMe = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const businessId = req.user?.businessId;

  if (!userId) {
    throw new AppError('User not authenticated.', 401);
  }

  // Get user details
  const userResult = await pool.query(
    'SELECT id, email, first_name, last_name, phone FROM users WHERE id = $1 AND deleted_at IS NULL',
    [userId]
  );

  if (userResult.rows.length === 0) {
    throw new AppError('User not found.', 404);
  }

  const user = userResult.rows[0];

  // Get business details
  let business = null;
  let businessMode: { mode: string; customLabels: Record<string, string> } | null = null;

  if (businessId) {
    const businessResult = await pool.query(
      `SELECT b.id, b.name, b.entity_type, b.industry, b.state, b.email, b.phone, b.is_paid,
              b.website, b.street, b.city, b.zip_code, b.country,
              m.mode AS mode_setting, m.custom_labels AS mode_custom_labels
       FROM businesses b
       LEFT JOIN business_mode_settings m ON m.business_id = b.id
       WHERE b.id = $1 AND b.deleted_at IS NULL`,
      [businessId]
    );
    if (businessResult.rows.length > 0) {
      const b = businessResult.rows[0];
      business = {
        id: b.id,
        name: b.name,
        entityType: b.entity_type,
        industry: b.industry,
        stateOfFormation: b.state,
        email: b.email,
        phone: b.phone,
        isPaid: b.is_paid,
        website: b.website,
        street: b.street,
        city: b.city,
        zipCode: b.zip_code,
        country: b.country
      };
      const rawLabels = b.mode_custom_labels;
      const customLabels =
        rawLabels && typeof rawLabels === 'object' && !Array.isArray(rawLabels)
          ? (rawLabels as Record<string, string>)
          : {};
      businessMode = {
        mode: typeof b.mode_setting === 'string' ? b.mode_setting : 'contractor',
        customLabels
      };
    }
  }

  res.status(200).json({
    status: 'success',
    data: {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone
      },
      business,
      businessMode: businessMode ?? { mode: 'contractor', customLabels: {} }
    }
  });
});

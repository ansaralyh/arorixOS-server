import { Request, Response } from 'express';
import pool from '../config/db';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../middlewares/errorHandler';

export const updateBusinessInfo = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const { 
    companyName, 
    entityType, 
    industry, 
    stateOfFormation, 
    email, 
    phone, 
    addressLine1, 
    addressLine2, 
    ein 
  } = req.body;

  if (!businessId) {
    throw new AppError('Business not authenticated.', 401);
  }

  if (!companyName) {
    throw new AppError('Please provide a companyName.', 400);
  }

  // Update business in database
  const result = await pool.query(
    `UPDATE businesses 
     SET 
       name = $1, 
       entity_type = $2, 
       industry = $3, 
       state = $4, 
       email = $5, 
       phone = $6, 
       street = $7, 
       city = $8, 
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $9 
     RETURNING id, name, entity_type, industry, state, email, phone, street, city`,
    [
      companyName, 
      entityType || null, 
      industry || null, 
      stateOfFormation || null, 
      email || null, 
      phone || null, 
      addressLine1 || null, 
      addressLine2 || null, // Storing addressLine2 in city for now based on current schema
      businessId
    ]
  );

  if (result.rows.length === 0) {
    throw new AppError('Business not found.', 404);
  }

  const updatedBusiness = result.rows[0];

  res.status(200).json({
    status: 'success',
    data: {
      business: {
        id: updatedBusiness.id,
        name: updatedBusiness.name,
        entityType: updatedBusiness.entity_type,
        industry: updatedBusiness.industry,
        stateOfFormation: updatedBusiness.state,
        email: updatedBusiness.email,
        phone: updatedBusiness.phone,
        addressLine1: updatedBusiness.street,
        addressLine2: updatedBusiness.city
      }
    }
  });
});

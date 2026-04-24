import { Request, Response } from 'express';
import pool from '../config/db';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../middlewares/errorHandler';

/** Accept YYYY-MM-DD or empty → null for DATE columns */
function optionalIsoDate(raw: unknown, field: string): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') {
    throw new AppError(`${field} must be a string (YYYY-MM-DD).`, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new AppError(`${field} must use YYYY-MM-DD.`, 400);
  }
  const t = Date.parse(`${raw}T12:00:00.000Z`);
  if (Number.isNaN(t)) {
    throw new AppError(`${field} is not a valid date.`, 400);
  }
  return raw;
}

function formatRowDates(row: Record<string, unknown>) {
  const fmt = (v: unknown): string | null => {
    if (v == null) return null;
    if (typeof v === 'string') return v.slice(0, 10);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return null;
  };
  return {
    formationDate: fmt(row.formation_date),
    annualReportDue: fmt(row.annual_report_due)
  };
}

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
    website,
    zipCode,
    country,
    ein,
    formationDate,
    annualReportDue,
    complianceStatus
  } = req.body;

  if (!businessId) {
    throw new AppError('Business not authenticated.', 401);
  }

  if (!companyName) {
    throw new AppError('Please provide a companyName.', 400);
  }

  const formation = optionalIsoDate(formationDate, 'formationDate');
  const annualDue = optionalIsoDate(annualReportDue, 'annualReportDue');

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
       website = $9,
       zip_code = $10,
       country = $11,
       ein = $12,
       formation_date = $13::date,
       annual_report_due = $14::date,
       compliance_status = $15,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $16
     RETURNING id, name, entity_type, industry, state, email, phone, street, city, website, zip_code, country,
               ein, formation_date, annual_report_due, compliance_status`,
    [
      companyName,
      entityType || null,
      industry || null,
      stateOfFormation || null,
      email || null,
      phone || null,
      addressLine1 || null,
      addressLine2 || null,
      website || null,
      zipCode || null,
      country || null,
      typeof ein === 'string' && ein.trim() ? ein.trim().slice(0, 50) : null,
      formation,
      annualDue,
      typeof complianceStatus === 'string' && complianceStatus.trim()
        ? complianceStatus.trim().slice(0, 100)
        : null,
      businessId
    ]
  );

  if (result.rows.length === 0) {
    throw new AppError('Business not found.', 404);
  }

  const updatedBusiness = result.rows[0];
  const dates = formatRowDates(updatedBusiness as Record<string, unknown>);

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
        addressLine2: updatedBusiness.city,
        website: updatedBusiness.website,
        zipCode: updatedBusiness.zip_code,
        country: updatedBusiness.country,
        ein: updatedBusiness.ein,
        formationDate: dates.formationDate,
        annualReportDue: dates.annualReportDue,
        complianceStatus: updatedBusiness.compliance_status
      }
    }
  });
});

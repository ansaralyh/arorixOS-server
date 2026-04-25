import { Request, Response } from 'express';
import pool from '../config/db';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../middlewares/errorHandler';
import {
  getEffectivePermissions,
  assertCrmView,
  assertCrmEditLeads,
  assertLeadRowScope,
} from '../utils/crmAccess';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s: string) {
  return typeof s === 'string' && UUID_RE.test(s.trim());
}

function computeJobAmounts(
  lineItems: { quantity: number; unitPrice: number }[],
  taxRate: number,
  discountType: 'percent' | 'dollar',
  discountValue: number
) {
  const subtotal = lineItems.reduce((s, li) => s + (li.quantity || 0) * (li.unitPrice || 0), 0);
  const discountAmount =
    discountType === 'percent' ? (subtotal * (discountValue || 0)) / 100 : discountValue || 0;
  const afterDiscount = Math.max(0, subtotal - discountAmount);
  const taxAmount = (afterDiscount * (taxRate || 0)) / 100;
  const total = afterDiscount + taxAmount;
  return { subtotal, discountAmount, taxAmount, total };
}

async function assertLeadInBusiness(businessId: string, leadId: string) {
  const r = await pool.query(
    `SELECT id, owner_user_id FROM crm_leads WHERE id = $1::uuid AND business_id = $2`,
    [leadId, businessId]
  );
  if (!r.rows[0]) throw new AppError('Lead not found.', 404);
  return r.rows[0] as { id: string; owner_user_id: string | null };
}

function rowToJob(row: Record<string, unknown>) {
  const details = (row.details as Record<string, unknown>) || {};
  const lineItems = (row.line_items as unknown[]) || [];
  const withTotals = (
    lineItems as { id: string; description: string; quantity: number; unitPrice: number }[]
  ).map((li) => ({
    ...li,
    lineTotal: (li.quantity || 0) * (li.unitPrice || 0),
  }));
  const assignedRaw = row.assigned_employees;
  const assignedEmployees = Array.isArray(assignedRaw)
    ? (assignedRaw as string[])
    : [];
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    serviceCategory: row.service_category,
    assignedTo: row.assigned_to || '',
    assignedEmployees: assignedEmployees.length > 0 ? assignedEmployees : undefined,
    startDate: row.start_date || '',
    endDate: row.end_date || '',
    duration: row.duration || '',
    startTime: (row.start_time as string) || undefined,
    location: (row.location as string) || undefined,
    city: (row.city as string) || undefined,
    zipCode: (row.zip_code as string) || undefined,
    notes: row.notes || '',
    linkedEstimateId: row.linked_estimate_id as string | undefined,
    linkedEstimateNumber: (row.linked_estimate_number as string) || undefined,
    linkedInvoiceId: row.linked_invoice_id as string | undefined,
    linkedInvoiceNumber: (row.linked_invoice_number as string) || undefined,
    calendarEventId: (row.calendar_event_id as string) || undefined,
    lineItems: withTotals,
    taxRate: Number(row.tax_rate) || 0,
    discountType: row.discount_type,
    discountValue: Number(row.discount_value) || 0,
    photos: (details.photos as { id: string; label: string; url: string }[]) || [],
    createdAt: row.created_at,
    paymentStatus: (details.paymentStatus as 'pending' | 'paid') || undefined,
    paymentMethod: (details.paymentMethod as 'cash' | 'card' | 'check') || undefined,
  };
}

/**
 * GET /api/businesses/crm/leads/:leadId/jobs
 */
export const getCrmLeadJobs = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const userId = req.user?.id;
  const role = req.user?.membershipRole;
  if (!businessId || !userId || !role) throw new AppError('Not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);

  const leadId = String(req.params.leadId || '');
  if (!isUuid(leadId)) throw new AppError('Invalid lead id.', 400);

  const lead = await assertLeadInBusiness(businessId, leadId);
  assertLeadRowScope(perms, userId, lead.owner_user_id);

  const r = await pool.query(
    `SELECT * FROM crm_lead_jobs WHERE business_id = $1 AND lead_id = $2::uuid ORDER BY created_at ASC`,
    [businessId, leadId]
  );
  res.status(200).json({
    status: 'success',
    data: { jobs: r.rows.map((row) => rowToJob(row as unknown as Record<string, unknown>)) },
  });
});

/**
 * PUT /api/businesses/crm/leads/:leadId/jobs
 * Replaces all jobs for the lead.
 */
export const putCrmLeadJobs = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const userId = req.user?.id;
  const role = req.user?.membershipRole;
  if (!businessId || !userId || !role) throw new AppError('Not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);
  assertCrmEditLeads(perms);

  const leadId = String(req.params.leadId || '');
  if (!isUuid(leadId)) throw new AppError('Invalid lead id.', 400);

  const lead = await assertLeadInBusiness(businessId, leadId);
  assertLeadRowScope(perms, userId, lead.owner_user_id);

  const body = req.body || {};
  const list = (body as { jobs?: unknown }).jobs;
  if (!Array.isArray(list)) throw new AppError('jobs must be an array.', 400);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM crm_lead_jobs WHERE business_id = $1 AND lead_id = $2::uuid`, [
      businessId,
      leadId,
    ]);

    for (const raw of list) {
      if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const o = raw as Record<string, unknown>;
      const id = typeof o.id === 'string' && isUuid(o.id) ? o.id : null;
      if (!id) throw new AppError('Each job must have a valid id (uuid).', 400);
      const name = typeof o.name === 'string' ? o.name : '';
      if (!name.trim()) throw new AppError('Each job must have a name.', 400);
      const status = typeof o.status === 'string' ? o.status : 'scheduled';
      if (!['scheduled', 'in-progress', 'completed', 'on-hold'].includes(status)) {
        throw new AppError('Invalid job status.', 400);
      }
      const lineItems = Array.isArray(o.lineItems) ? o.lineItems : [];
      const taxRate = Number(o.taxRate) || 0;
      const discountType = o.discountType === 'dollar' ? 'dollar' : 'percent';
      const discountValue = Number(o.discountValue) || 0;
      const amounts = computeJobAmounts(
        lineItems as { quantity: number; unitPrice: number }[],
        taxRate,
        discountType,
        discountValue
      );
      const assignedEmployees = Array.isArray(o.assignedEmployees) ? o.assignedEmployees : [];
      const assignedTo =
        typeof o.assignedTo === 'string'
          ? o.assignedTo
          : (assignedEmployees[0] as string) || '';
      const linkedEstimateId =
        typeof o.linkedEstimateId === 'string' && isUuid(o.linkedEstimateId) ? o.linkedEstimateId : null;
      const linkedInvoiceId =
        typeof o.linkedInvoiceId === 'string' && isUuid(o.linkedInvoiceId) ? o.linkedInvoiceId : null;
      const details: Record<string, unknown> = {
        photos: o.photos,
        paymentStatus: o.paymentStatus,
        paymentMethod: o.paymentMethod,
      };

      let createdAtParam: string | null = null;
      if (o.createdAt) {
        const d = new Date(String(o.createdAt));
        if (!isNaN(d.getTime())) createdAtParam = d.toISOString();
      }

      const insertSql = `INSERT INTO crm_lead_jobs (
          id, business_id, lead_id, name, status, service_category, assigned_to, assigned_employees,
          start_date, end_date, duration, start_time, location, city, zip_code, notes,
          linked_estimate_id, linked_invoice_id, linked_estimate_number, linked_invoice_number,
          calendar_event_id, line_items, tax_rate, discount_type, discount_value,
          subtotal, discount_amount, tax_amount, total, details, created_at
        ) VALUES (
          $1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb,
          $9, $10, $11, $12, $13, $14, $15, $16,
          $17::uuid, $18::uuid, $19, $20, $21, $22::jsonb, $23, $24, $25,
          $26, $27, $28, $29, $30::jsonb, COALESCE($31::timestamptz, CURRENT_TIMESTAMP)
        )`;

      const baseParams: unknown[] = [
        id,
        businessId,
        leadId,
        name,
        status,
        typeof o.serviceCategory === 'string' ? o.serviceCategory : '',
        assignedTo,
        JSON.stringify(assignedEmployees),
        typeof o.startDate === 'string' ? o.startDate : '',
        typeof o.endDate === 'string' ? o.endDate : '',
        typeof o.duration === 'string' ? o.duration : '',
        typeof o.startTime === 'string' ? o.startTime : '',
        typeof o.location === 'string' ? o.location : '',
        typeof o.city === 'string' ? o.city : '',
        typeof o.zipCode === 'string' ? o.zipCode : '',
        typeof o.notes === 'string' ? o.notes : '',
        linkedEstimateId,
        linkedInvoiceId,
        typeof o.linkedEstimateNumber === 'string' ? o.linkedEstimateNumber : '',
        typeof o.linkedInvoiceNumber === 'string' ? o.linkedInvoiceNumber : '',
        typeof o.calendarEventId === 'string' ? o.calendarEventId : '',
        JSON.stringify(
          (lineItems as { id: string; description: string; quantity: number; unitPrice: number }[]).map(
            (li) => ({
              id: li.id,
              description: li.description,
              quantity: li.quantity,
              unitPrice: li.unitPrice,
            })
          )
        ),
        taxRate,
        discountType,
        discountValue,
        amounts.subtotal,
        amounts.discountAmount,
        amounts.taxAmount,
        amounts.total,
        JSON.stringify(details),
        createdAtParam,
      ];

      await client.query(insertSql, baseParams);
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const r = await pool.query(
    `SELECT * FROM crm_lead_jobs WHERE business_id = $1 AND lead_id = $2::uuid ORDER BY created_at ASC`,
    [businessId, leadId]
  );
  res.status(200).json({
    status: 'success',
    data: { jobs: r.rows.map((row) => rowToJob(row as unknown as Record<string, unknown>)) },
  });
});

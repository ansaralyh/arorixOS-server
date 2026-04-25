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

function computeEstimateAmounts(
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

// ── mappers: DB row → client JSON (matches LeadDetailPanel / Financials shapes) ──

function rowToEstimate(row: Record<string, unknown>) {
  const details = (row.details as Record<string, unknown>) || {};
  const lineItems = (row.line_items as unknown[]) || [];
  const withTotals = (lineItems as { id: string; description: string; quantity: number; unitPrice: number }[]).map(
    (li) => ({
      ...li,
      lineTotal: (li.quantity || 0) * (li.unitPrice || 0),
    })
  );
  return {
    id: row.id,
    customerId: row.lead_id,
    estimateNumber: row.estimate_number,
    numericSequence: row.numeric_sequence,
    name: row.name,
    serviceName: (details.serviceName as string) || row.service_name || row.name,
    status: row.status,
    lineItems: withTotals,
    subtotal: Number(row.subtotal) || 0,
    taxRate: Number(row.tax_rate) || 0,
    discountType: row.discount_type,
    discountValue: Number(row.discount_value) || 0,
    discountAmount: Number(row.discount_amount) || 0,
    taxAmount: Number(row.tax_amount) || 0,
    total: Number(row.total) || 0,
    attachments: (details.attachments as string[]) || [],
    createdAt: row.created_at,
    notes: row.notes || '',
    issueDate: (details.issueDate as string) || undefined,
    expirationDate: (details.expirationDate as string) || undefined,
    location: details.location,
    scheduledDate: (details.scheduledDate as string) || undefined,
    startTime: (details.startTime as string) || undefined,
    assignedEmployees: (details.assignedEmployees as string[]) || undefined,
    approvedBy: (details.approvedBy as string) || undefined,
    approvedDate: (details.approvedDate as string) || undefined,
    convertedToJob: details.convertedToJob === true,
    convertedToInvoice: details.convertedToInvoice === true,
    invoiceId: (details.invoiceId as string) || undefined,
    paymentStatus: (details.paymentStatus as string) || undefined,
    paymentMethod: (details.paymentMethod as string) || undefined,
  };
}

function rowToInvoice(row: Record<string, unknown>) {
  const details = (row.details as Record<string, unknown>) || {};
  const lineItems = (row.line_items as unknown[]) || [];
  const withTotals = (lineItems as { id: string; description: string; quantity: number; unitPrice: number }[]).map(
    (li) => ({
      ...li,
      lineTotal: (li.quantity || 0) * (li.unitPrice || 0),
    })
  );
  return {
    id: row.id,
    customerId: row.lead_id,
    estimateId: row.estimate_id,
    originalEstimateNumber: (details.originalEstimateNumber as string) || undefined,
    invoiceNumber: row.invoice_number,
    numericSequence: row.numeric_sequence,
    status: row.status,
    lineItems: withTotals,
    issueDate: row.issue_date || '',
    dueDate: row.due_date || '',
    subtotal: Number(row.subtotal) || 0,
    discountType: row.discount_type,
    discountValue: Number(row.discount_value) || 0,
    discountAmount: Number(row.discount_amount) || 0,
    taxRate: Number(row.tax_rate) || 0,
    taxAmount: Number(row.tax_amount) || 0,
    total: Number(row.total) || 0,
    amountPaid: Number(row.amount_paid) || 0,
    balanceDue: Number(row.balance_due) || 0,
    notes: row.notes || '',
    createdAt: row.created_at,
    scheduledDate: (details.scheduledDate as string) || undefined,
    startTime: (details.startTime as string) || undefined,
    assignedEmployees: (details.assignedEmployees as string[]) || undefined,
  };
}

/**
 * GET /api/businesses/crm/leads/:leadId/estimates
 */
export const getCrmLeadEstimates = catchAsync(async (req: Request, res: Response) => {
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
    `SELECT * FROM crm_lead_estimates WHERE business_id = $1 AND lead_id = $2::uuid ORDER BY created_at ASC`,
    [businessId, leadId]
  );
  res.status(200).json({
    status: 'success',
    data: { estimates: r.rows.map((row) => rowToEstimate(row as unknown as Record<string, unknown>)) },
  });
});

/**
 * PUT /api/businesses/crm/leads/:leadId/estimates
 * Replaces all estimates for the lead (array from client, same shape as get).
 */
export const putCrmLeadEstimates = catchAsync(async (req: Request, res: Response) => {
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
  const list = (body as { estimates?: unknown }).estimates;
  if (!Array.isArray(list)) throw new AppError('estimates must be an array.', 400);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM crm_lead_estimates WHERE business_id = $1 AND lead_id = $2::uuid`, [
      businessId,
      leadId,
    ]);

    for (const raw of list) {
      if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const o = raw as Record<string, unknown>;
      const id = typeof o.id === 'string' && isUuid(o.id) ? o.id : null;
      if (!id) throw new AppError('Each estimate must have a valid id (uuid).', 400);
      const estimateNumber = typeof o.estimateNumber === 'string' ? o.estimateNumber : '';
      if (!estimateNumber) throw new AppError('Each estimate must have estimateNumber.', 400);
      const numericSequence =
        typeof o.numericSequence === 'number' && Number.isFinite(o.numericSequence) ? o.numericSequence : 1001;
      const name = typeof o.name === 'string' ? o.name : '';
      const serviceName = typeof o.serviceName === 'string' ? o.serviceName : name;
      const status = typeof o.status === 'string' ? o.status : 'draft';
      if (!['draft', 'sent', 'approved', 'declined', 'expired', 'converted'].includes(status)) {
        throw new AppError('Invalid estimate status.', 400);
      }
      const lineItems = Array.isArray(o.lineItems) ? o.lineItems : [];
      const taxRate = Number(o.taxRate) || 0;
      const discountType = o.discountType === 'dollar' ? 'dollar' : 'percent';
      const discountValue = Number(o.discountValue) || 0;
      const amounts = computeEstimateAmounts(
        lineItems as { quantity: number; unitPrice: number }[],
        taxRate,
        discountType,
        discountValue
      );
      const subtotal = amounts.subtotal;
      const discountAmount = amounts.discountAmount;
      const taxAmount = amounts.taxAmount;
      const total = amounts.total;
      const notes = typeof o.notes === 'string' ? o.notes : '';
      const details: Record<string, unknown> = {
        serviceName,
        issueDate: o.issueDate,
        expirationDate: o.expirationDate,
        location: o.location,
        scheduledDate: o.scheduledDate,
        startTime: o.startTime,
        assignedEmployees: o.assignedEmployees,
        attachments: o.attachments,
        approvedBy: o.approvedBy,
        approvedDate: o.approvedDate,
        convertedToJob: o.convertedToJob,
        convertedToInvoice: o.convertedToInvoice,
        invoiceId: o.invoiceId,
        paymentStatus: o.paymentStatus,
        paymentMethod: o.paymentMethod,
      };

      await client.query(
        `INSERT INTO crm_lead_estimates (
          id, business_id, lead_id, estimate_number, numeric_sequence, name, service_name, status,
          line_items, tax_rate, discount_type, discount_value, subtotal, discount_amount, tax_amount, total, notes, details
        ) VALUES (
          $1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8,
          $9::jsonb, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb
        )`,
        [
          id,
          businessId,
          leadId,
          estimateNumber,
          numericSequence,
          name,
          serviceName,
          status,
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
          subtotal,
          discountAmount,
          taxAmount,
          total,
          notes,
          JSON.stringify(details),
        ]
      );
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const r = await pool.query(
    `SELECT * FROM crm_lead_estimates WHERE business_id = $1 AND lead_id = $2::uuid ORDER BY created_at ASC`,
    [businessId, leadId]
  );
  res.status(200).json({
    status: 'success',
    data: { estimates: r.rows.map((row) => rowToEstimate(row as unknown as Record<string, unknown>)) },
  });
});

/**
 * GET /api/businesses/crm/leads/:leadId/invoices
 */
export const getCrmLeadInvoices = catchAsync(async (req: Request, res: Response) => {
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
    `SELECT * FROM crm_lead_invoices WHERE business_id = $1 AND lead_id = $2::uuid ORDER BY created_at ASC`,
    [businessId, leadId]
  );
  res.status(200).json({
    status: 'success',
    data: { invoices: r.rows.map((row) => rowToInvoice(row as unknown as Record<string, unknown>)) },
  });
});

/**
 * PUT /api/businesses/crm/leads/:leadId/invoices
 */
export const putCrmLeadInvoices = catchAsync(async (req: Request, res: Response) => {
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
  const list = (body as { invoices?: unknown }).invoices;
  if (!Array.isArray(list)) throw new AppError('invoices must be an array.', 400);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM crm_lead_invoices WHERE business_id = $1 AND lead_id = $2::uuid`, [
      businessId,
      leadId,
    ]);

    for (const raw of list) {
      if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const o = raw as Record<string, unknown>;
      const id = typeof o.id === 'string' && isUuid(o.id) ? o.id : null;
      if (!id) throw new AppError('Each invoice must have a valid id (uuid).', 400);
      const invoiceNumber = typeof o.invoiceNumber === 'string' ? o.invoiceNumber : '';
      if (!invoiceNumber) throw new AppError('Each invoice must have invoiceNumber.', 400);
      const numericSequence =
        typeof o.numericSequence === 'number' && Number.isFinite(o.numericSequence) ? o.numericSequence : 1001;
      const status = typeof o.status === 'string' ? o.status : 'draft';
      if (!['draft', 'sent', 'partially_paid', 'paid', 'overdue'].includes(status)) {
        throw new AppError('Invalid invoice status.', 400);
      }
      const lineItems = Array.isArray(o.lineItems) ? o.lineItems : [];
      const taxRate = Number(o.taxRate) || 0;
      const discountType = o.discountType === 'dollar' ? 'dollar' : 'percent';
      const discountValue = Number(o.discountValue) || 0;
      const invAmounts = computeEstimateAmounts(
        lineItems as { quantity: number; unitPrice: number }[],
        taxRate,
        discountType,
        discountValue
      );
      const amountPaid = Number(o.amountPaid) || 0;
      const total = invAmounts.total;
      const balanceDue = Math.max(0, total - amountPaid);
      const estimateId =
        typeof o.estimateId === 'string' && isUuid(o.estimateId) ? o.estimateId : null;
      const details: Record<string, unknown> = {
        originalEstimateNumber: o.originalEstimateNumber,
        scheduledDate: o.scheduledDate,
        startTime: o.startTime,
        assignedEmployees: o.assignedEmployees,
      };

      await client.query(
        `INSERT INTO crm_lead_invoices (
          id, business_id, lead_id, estimate_id, invoice_number, numeric_sequence, status, line_items,
          subtotal, discount_type, discount_value, discount_amount, tax_rate, tax_amount, total,
          amount_paid, balance_due, issue_date, due_date, notes, details
        ) VALUES (
          $1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7, $8::jsonb,
          $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb
        )`,
        [
          id,
          businessId,
          leadId,
          estimateId,
          invoiceNumber,
          numericSequence,
          status,
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
          invAmounts.subtotal,
          discountType,
          discountValue,
          invAmounts.discountAmount,
          taxRate,
          invAmounts.taxAmount,
          total,
          amountPaid,
          balanceDue,
          typeof o.issueDate === 'string' ? o.issueDate : '',
          typeof o.dueDate === 'string' ? o.dueDate : '',
          typeof o.notes === 'string' ? o.notes : '',
          JSON.stringify(details),
        ]
      );
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const r = await pool.query(
    `SELECT * FROM crm_lead_invoices WHERE business_id = $1 AND lead_id = $2::uuid ORDER BY created_at ASC`,
    [businessId, leadId]
  );
  res.status(200).json({
    status: 'success',
    data: { invoices: r.rows.map((row) => rowToInvoice(row as unknown as Record<string, unknown>)) },
  });
});

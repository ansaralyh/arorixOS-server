import { Request, Response } from 'express';
import pool from '../config/db';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../middlewares/errorHandler';
import { getEffectivePermissions, assertCrmView, canViewAllLeads } from '../utils/crmAccess';

type CustomerRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  source: string;
  notes: string;
  created_at: Date;
  became_customer_at: Date;
  owner_user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  owner_email: string | null;
  lifetime_revenue: string | number;
  active_jobs: number;
  total_jobs_completed: number;
  pending_estimates: number;
  open_invoice_balance: number;
  last_job_at: Date | null;
  job_type: string | null;
  stage_key: string;
  stage_label: string | null;
};

function ownerLabel(first: string | null, last: string | null, email: string | null) {
  const n = [first, last].filter(Boolean).join(' ').trim();
  if (n) return n;
  if (email) return email;
  return '—';
}

function trimStr(s: unknown, max: number): string {
  if (s == null) return '';
  const t = String(s).trim();
  return t.length > max ? t.slice(0, max) : t;
}

function ilikeTerm(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

const BADGE_ACTIVE = 'active_project';
const BADGE_EST = 'estimate_pending';
const BADGE_PAY = 'payment_due';
const BADGE_HIGH = 'high_value';
const BADGE_DORMANT = 'dormant';

function computeBadges(r: {
  lifetimeRevenue: number;
  activeJobs: number;
  pendingEstimates: number;
  openInvoiceBalance: number;
  lastJobAt: Date | null;
}): string[] {
  const out: string[] = [];
  if (r.activeJobs > 0) out.push(BADGE_ACTIVE);
  if (r.pendingEstimates > 0) out.push(BADGE_EST);
  if (r.openInvoiceBalance > 0.01) out.push(BADGE_PAY);
  if (r.lifetimeRevenue >= 50000) out.push(BADGE_HIGH);
  if (r.lastJobAt) {
    const days = (Date.now() - r.lastJobAt.getTime()) / (86400 * 1000);
    if (days > 90 && r.activeJobs === 0) out.push(BADGE_DORMANT);
  }
  return out;
}

function rowToCustomerApi(row: CustomerRow) {
  const lifetimeRevenue = Number(row.lifetime_revenue) || 0;
  const activeJobs = Number(row.active_jobs) || 0;
  const totalJobsCompleted = Number(row.total_jobs_completed) || 0;
  const pendingEstimates = Number(row.pending_estimates) || 0;
  const openInvoiceBalance = Number(row.open_invoice_balance) || 0;
  const lastJobAt = row.last_job_at ? new Date(row.last_job_at) : null;
  const badges = computeBadges({
    lifetimeRevenue,
    activeJobs,
    pendingEstimates,
    openInvoiceBalance,
    lastJobAt,
  });
  return {
    id: row.id,
    leadId: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    company: row.company,
    address: '',
    customerSince: new Date(row.became_customer_at).toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    }),
    birthday: '',
    notes: row.notes || '',
    lifetimeRevenue,
    activeJobs,
    totalJobsCompleted,
    lastJobDate: lastJobAt
      ? lastJobAt.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
      : '',
    source: row.source || '',
    assignedRep: ownerLabel(row.first_name, row.last_name, row.owner_email),
    jobType: row.job_type || '',
    ownerUserId: row.owner_user_id != null ? String(row.owner_user_id) : null,
    badges,
    stageKey: row.stage_key,
    stageLabel: row.stage_label || row.stage_key,
  };
}

/**
 * GET /api/businesses/crm/customers
 */
export const listCrmCustomers = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const userId = req.user?.id;
  const role = req.user?.membershipRole;
  if (!businessId || !userId || !role) throw new AppError('Not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);
  const viewAll = canViewAllLeads(perms);

  const args: unknown[] = [businessId];
  let n = 2;
  let where = `l.business_id = $1`;
  if (!viewAll) {
    where += ` AND l.owner_user_id = $${n}::uuid`;
    args.push(userId);
    n += 1;
  }

  const sourceQ = trimStr(req.query.source, 200);
  if (sourceQ) {
    where += ` AND LOWER(TRIM(l.source)) = LOWER(TRIM($${n}))`;
    args.push(sourceQ);
    n += 1;
  }

  const ownerQ = trimStr(req.query.ownerUserId, 64);
  if (ownerQ && ownerQ.toLowerCase() === 'unassigned') {
    where += ` AND l.owner_user_id IS NULL`;
  } else if (ownerQ && /^[0-9a-f-]{36}$/i.test(ownerQ)) {
    const m = await pool.query(
      `SELECT 1 FROM business_members WHERE business_id = $1 AND user_id = $2::uuid`,
      [businessId, ownerQ]
    );
    if (m.rows[0]) {
      where += ` AND l.owner_user_id = $${n}::uuid`;
      args.push(ownerQ);
      n += 1;
    }
  }

  const searchQ = trimStr(req.query.q, 200);
  if (searchQ) {
    const t = '%' + ilikeTerm(searchQ) + '%';
    where += ` AND (
      l.name ILIKE $${n} ESCAPE '\\' OR l.email ILIKE $${n} ESCAPE '\\'
      OR l.phone ILIKE $${n} ESCAPE '\\' OR l.company ILIKE $${n} ESCAPE '\\'
    )`;
    args.push(t);
    n += 1;
  }

  const r = await pool.query(
    `SELECT
       l.id,
       l.name,
       l.email,
       l.phone,
       l.company,
       l.source,
       l.notes,
       l.created_at,
       l.owner_user_id,
       l.stage_key,
       c.became_customer_at,
       u.first_name,
       u.last_name,
       u.email AS owner_email,
       ps.label AS stage_label,
       (SELECT COALESCE(SUM(i.total), 0) FROM crm_lead_invoices i
        WHERE i.business_id = l.business_id AND i.lead_id = l.id) AS lifetime_revenue,
       (SELECT COUNT(*)::int FROM crm_lead_jobs j
        WHERE j.business_id = l.business_id AND j.lead_id = l.id
        AND j.status IN ('scheduled', 'in-progress')) AS active_jobs,
       (SELECT COUNT(*)::int FROM crm_lead_jobs j
        WHERE j.business_id = l.business_id AND j.lead_id = l.id
        AND j.status = 'completed') AS total_jobs_completed,
       (SELECT COUNT(*)::int FROM crm_lead_estimates e
        WHERE e.business_id = l.business_id AND e.lead_id = l.id
        AND e.status IN ('draft', 'sent')) AS pending_estimates,
       (SELECT COALESCE(SUM(i.balance_due), 0) FROM crm_lead_invoices i
        WHERE i.business_id = l.business_id AND i.lead_id = l.id) AS open_invoice_balance,
       (SELECT MAX(j.updated_at) FROM crm_lead_jobs j
        WHERE j.business_id = l.business_id AND j.lead_id = l.id) AS last_job_at,
       (SELECT j.service_category FROM crm_lead_jobs j
        WHERE j.business_id = l.business_id AND j.lead_id = l.id
        ORDER BY j.created_at DESC NULLS LAST LIMIT 1) AS job_type
     FROM crm_leads l
     INNER JOIN crm_customers c ON c.lead_id = l.id AND c.business_id = l.business_id
     JOIN crm_pipelines p ON p.id = l.pipeline_id
     LEFT JOIN crm_pipeline_stages ps ON ps.pipeline_id = l.pipeline_id AND ps.stage_key = l.stage_key
     LEFT JOIN users u ON u.id = l.owner_user_id
     WHERE ${where}
     ORDER BY c.became_customer_at DESC
     LIMIT 500`,
    args
  );

  let customers = (r.rows as unknown as CustomerRow[]).map((row) => rowToCustomerApi(row));

  const badgeQ = trimStr(req.query.badge, 64);
  if (badgeQ && badgeQ !== 'all') {
    customers = customers.filter((c) => c.badges.includes(badgeQ));
  }

  const minRev = Number(req.query.revenueMin);
  const maxRev = Number(req.query.revenueMax);
  if (!Number.isNaN(minRev) && minRev > 0) {
    customers = customers.filter((c) => c.lifetimeRevenue >= minRev);
  }
  if (!Number.isNaN(maxRev) && maxRev > 0) {
    customers = customers.filter((c) => c.lifetimeRevenue <= maxRev);
  }

  const jobTypeQ = trimStr(req.query.jobType, 120);
  if (jobTypeQ) {
    customers = customers.filter((c) => c.jobType === jobTypeQ);
  }

  res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.status(200).json({ status: 'success', data: { customers } });
});

/**
 * GET /api/businesses/crm/customers/filters
 * Distinct sources (from leads in scope), workspace assignees, and job service categories — for Customers filter UI even when the list is empty.
 */
export const getCrmCustomersFilterMeta = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const userId = req.user?.id;
  const role = req.user?.membershipRole;
  if (!businessId || !userId || !role) throw new AppError('Not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);
  const viewAll = canViewAllLeads(perms);

  const whereScope = viewAll
    ? 'l.business_id = $1'
    : 'l.business_id = $1 AND l.owner_user_id = $2::uuid';
  const baseArgs: unknown[] = viewAll ? [businessId] : [businessId, userId];

  const rSources = await pool.query(
    `SELECT DISTINCT TRIM(l.source) AS s
     FROM crm_leads l
     WHERE ${whereScope} AND COALESCE(TRIM(l.source), '') <> ''
     ORDER BY 1
     LIMIT 200`,
    baseArgs
  );
  const sources = (rSources.rows as { s: string }[]).map((x) => x.s).filter(Boolean);

  const rMembers = await pool.query(
    `SELECT u.id AS user_id, u.first_name, u.last_name, u.email
     FROM business_members bm
     INNER JOIN users u ON u.id = bm.user_id
     WHERE bm.business_id = $1 AND u.deleted_at IS NULL
     ORDER BY
       CASE bm.role
         WHEN 'OWNER' THEN 1
         WHEN 'ADMIN' THEN 2
         WHEN 'MANAGER' THEN 3
         ELSE 4
       END,
       u.last_name ASC NULLS LAST,
       u.first_name ASC NULLS LAST`,
    [businessId]
  );
  const assignees = (
    rMembers.rows as { user_id: string; first_name: string | null; last_name: string | null; email: string }[]
  ).map((row) => ({
    userId: String(row.user_id),
    name: ownerLabel(row.first_name, row.last_name, row.email),
  }));

  const rJt = await pool.query(
    `SELECT DISTINCT TRIM(j.service_category) AS t
     FROM crm_lead_jobs j
     WHERE j.business_id = $1 AND COALESCE(TRIM(j.service_category), '') <> ''
     ORDER BY 1
     LIMIT 200`,
    [businessId]
  );
  const jobTypes = (rJt.rows as { t: string }[]).map((x) => x.t).filter(Boolean);

  res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.status(200).json({ status: 'success', data: { sources, assignees, jobTypes } });
});

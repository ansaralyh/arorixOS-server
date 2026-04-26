import { Request, Response } from 'express';
import pool from '../config/db';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../middlewares/errorHandler';
import { getEffectivePermissions, assertCrmView, canViewAllLeads } from '../utils/crmAccess';

type Period = 'all' | 'today' | 'this-week' | 'this-month' | 'last-month' | 'this-year' | 'custom';

function parsePeriod(q: unknown): Period {
  const p = String(q || 'this-month')
    .toLowerCase()
    .replace(/_/g, '-');
  const allowed: Period[] = ['all', 'today', 'this-week', 'this-month', 'last-month', 'this-year', 'custom'];
  return (allowed.includes(p as Period) ? p : 'this-month') as Period;
}

/** UTC boundaries so server results match calendar periods regardless of DB session TZ. */
function periodBounds(period: Period, now = new Date()): { start: Date | null; end: Date | null } {
  if (period === 'all' || period === 'custom') return { start: null, end: null };

  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();

  const startOfUtcDay = (year: number, month: number, day: number) =>
    new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  const endOfUtcDay = (year: number, month: number, day: number) =>
    new Date(Date.UTC(year, month, day, 23, 59, 59, 999));

  if (period === 'today') {
    return { start: startOfUtcDay(y, m, d), end: endOfUtcDay(y, m, d) };
  }

  if (period === 'this-week') {
    const day = now.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(Date.UTC(y, m, d + mondayOffset, 0, 0, 0, 0));
    return { start: monday, end: endOfUtcDay(y, m, d) };
  }

  if (period === 'this-month') {
    return { start: startOfUtcDay(y, m, 1), end: endOfUtcDay(y, m, d) };
  }

  if (period === 'last-month') {
    const start = startOfUtcDay(y, m - 1, 1);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const end = endOfUtcDay(y, m - 1, lastDay);
    return { start, end };
  }

  if (period === 'this-year') {
    return { start: startOfUtcDay(y, 0, 1), end: endOfUtcDay(y, m, d) };
  }

  return { start: null, end: null };
}

function appendLeadTime(clause: string, args: unknown[], start: Date | null, end: Date | null) {
  let c = clause;
  const a = [...args];
  let n = a.length + 1;
  if (start) {
    c += ` AND l.created_at >= $${n}::timestamptz`;
    a.push(start.toISOString());
    n += 1;
  }
  if (end) {
    c += ` AND l.created_at <= $${n}::timestamptz`;
    a.push(end.toISOString());
    n += 1;
  }
  return { clause: c, args: a };
}

function appendInvoiceTime(clause: string, args: unknown[], start: Date | null, end: Date | null) {
  let c = clause;
  const a = [...args];
  let n = a.length + 1;
  if (start) {
    c += ` AND i.created_at >= $${n}::timestamptz`;
    a.push(start.toISOString());
    n += 1;
  }
  if (end) {
    c += ` AND i.created_at <= $${n}::timestamptz`;
    a.push(end.toISOString());
    n += 1;
  }
  return { clause: c, args: a };
}

function appendJobUpdatedTime(clause: string, args: unknown[], start: Date | null, end: Date | null) {
  let c = clause;
  const a = [...args];
  let n = a.length + 1;
  if (start) {
    c += ` AND j.updated_at >= $${n}::timestamptz`;
    a.push(start.toISOString());
    n += 1;
  }
  if (end) {
    c += ` AND j.updated_at <= $${n}::timestamptz`;
    a.push(end.toISOString());
    n += 1;
  }
  return { clause: c, args: a };
}

function num(v: unknown): number {
  if (v == null) return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/**
 * GET /api/businesses/crm/insights?period=this-month|...
 * Aggregates respect the same lead visibility rules as list leads (assigned-only vs view-all).
 */
export const getCrmInsights = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user?.businessId;
  const userId = req.user?.id;
  const role = req.user?.membershipRole;
  if (!businessId || !userId || !role) throw new AppError('Not authenticated.', 401);

  const perms = await getEffectivePermissions(businessId, role);
  assertCrmView(perms);
  const viewAll = canViewAllLeads(perms);

  const period = parsePeriod(req.query.period);
  const { start, end } = periodBounds(period);

  const baseClause = viewAll ? 'l.business_id = $1' : 'l.business_id = $1 AND l.owner_user_id = $2::uuid';
  const baseArgs: unknown[] = viewAll ? [businessId] : [businessId, userId];

  const scopedLeads = appendLeadTime(baseClause, baseArgs, start, end);

  const pipeR = await pool.query(
    `SELECT id FROM crm_pipelines WHERE business_id = $1 AND is_default = TRUE LIMIT 1`,
    [businessId]
  );
  const defaultPipelineId = pipeR.rows[0]?.id as string | undefined;

  let funnel: { stageKey: string; label: string; sortIndex: number; count: number }[] = [];
  if (defaultPipelineId) {
    const fArgs = [...scopedLeads.args, defaultPipelineId];
    const fr = await pool.query(
      `SELECT s.stage_key AS "stageKey", s.label, s.sort_index AS "sortIndex",
              COUNT(l.id)::int AS count
       FROM crm_pipeline_stages s
       LEFT JOIN crm_leads l ON l.pipeline_id = s.pipeline_id
         AND l.stage_key = s.stage_key
         AND (${scopedLeads.clause})
       WHERE s.pipeline_id = $${fArgs.length}::uuid
       GROUP BY s.stage_key, s.label, s.sort_index
       ORDER BY s.sort_index`,
      fArgs
    );
    funnel = fr.rows as typeof funnel;
  }

  const invClause0 = `${baseClause} AND i.status <> 'draft'`;
  const invScoped = appendInvoiceTime(invClause0, [...baseArgs], start, end);
  const invKpi = await pool.query(
    `SELECT COALESCE(SUM(i.total), 0) AS sum, COUNT(*)::int AS n, COALESCE(AVG(i.total), 0) AS avg
     FROM crm_lead_invoices i
     INNER JOIN crm_leads l ON l.id = i.lead_id
     WHERE ${invScoped.clause}`,
    invScoped.args
  );
  const invRow = invKpi.rows[0] as { sum: unknown; n: unknown; avg: unknown };

  const stageInvR = await pool.query(
    `SELECT l.stage_key AS "stageKey", COALESCE(SUM(i.total), 0)::float8 AS sum
     FROM crm_lead_invoices i
     INNER JOIN crm_leads l ON l.id = i.lead_id
     WHERE ${invScoped.clause}
     GROUP BY l.stage_key`,
    invScoped.args
  );
  const stageInvoiced: Record<string, number> = {};
  for (const row of stageInvR.rows as { stageKey: string; sum: unknown }[]) {
    stageInvoiced[row.stageKey] = num(row.sum);
  }

  const avgJobR = await pool.query(
    `SELECT COALESCE(AVG(j.total), 0)::float8 AS a
     FROM crm_lead_jobs j
     INNER JOIN crm_leads l ON l.id = j.lead_id
     WHERE ${scopedLeads.clause} AND j.total > 0`,
    scopedLeads.args
  );

  const jobDoneWhere = appendJobUpdatedTime(
    `${baseClause} AND j.status = 'completed'`,
    [...baseArgs],
    start,
    end
  );
  const jobsDoneR = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM crm_lead_jobs j
     INNER JOIN crm_leads l ON l.id = j.lead_id
     WHERE ${jobDoneWhere.clause}`,
    jobDoneWhere.args
  );

  const jobsActiveR = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM crm_lead_jobs j
     INNER JOIN crm_leads l ON l.id = j.lead_id
     WHERE ${scopedLeads.clause} AND j.status IN ('scheduled', 'in-progress')`,
    scopedLeads.args
  );

  const estDeclR = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM crm_lead_estimates e
     INNER JOIN crm_leads l ON l.id = e.lead_id
     WHERE ${scopedLeads.clause} AND e.status = 'declined'`,
    scopedLeads.args
  );

  const pipeValR = await pool.query(
    `SELECT COALESCE(SUM(e.total), 0) AS s
     FROM crm_lead_estimates e
     INNER JOIN crm_leads l ON l.id = e.lead_id
     WHERE ${scopedLeads.clause} AND e.status IN ('sent', 'approved')`,
    scopedLeads.args
  );

  const leadsCountR = await pool.query(
    `SELECT COUNT(*)::int AS n FROM crm_leads l WHERE ${scopedLeads.clause}`,
    scopedLeads.args
  );

  let custClause = baseClause;
  const custArgs: unknown[] = [...baseArgs];
  let custIdx = baseArgs.length + 1;
  if (start) {
    custClause += ` AND c.became_customer_at >= $${custIdx}::timestamptz`;
    custArgs.push(start.toISOString());
    custIdx += 1;
  }
  if (end) {
    custClause += ` AND c.became_customer_at <= $${custIdx}::timestamptz`;
    custArgs.push(end.toISOString());
    custIdx += 1;
  }
  const custR = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM crm_customers c
     INNER JOIN crm_leads l ON l.id = c.lead_id
     WHERE ${custClause}`,
    custArgs
  );

  const jobTypeR = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(j.service_category), ''), '(Uncategorized)') AS category,
            COALESCE(SUM(j.total), 0)::float8 AS revenue,
            COUNT(*)::int AS "jobCount"
     FROM crm_lead_jobs j
     INNER JOIN crm_leads l ON l.id = j.lead_id
     WHERE ${scopedLeads.clause}
     GROUP BY 1
     HAVING COUNT(*) > 0
     ORDER BY revenue DESC
     LIMIT 12`,
    scopedLeads.args
  );

  const repR = await pool.query(
    `SELECT l.owner_user_id AS "userId",
            COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email, 'Teammate') AS name,
            COUNT(DISTINCT l.id)::int AS "leadCount",
            COALESCE(SUM(i.total), 0)::float8 AS "invoiceTotal"
     FROM crm_leads l
     LEFT JOIN users u ON u.id = l.owner_user_id
     LEFT JOIN crm_lead_invoices i ON i.lead_id = l.id AND i.status <> 'draft'
     WHERE ${scopedLeads.clause} AND l.owner_user_id IS NOT NULL
     GROUP BY l.owner_user_id, u.first_name, u.last_name, u.email
     ORDER BY "invoiceTotal" DESC, "leadCount" DESC
     LIMIT 12`,
    scopedLeads.args
  );

  const healthScope = { clause: baseClause, args: baseArgs };
  const staleR = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM crm_leads l
     WHERE ${healthScope.clause} AND l.created_at < NOW() - INTERVAL '7 days'`,
    healthScope.args
  );
  const pendingR = await pool.query(
    `SELECT COUNT(*)::int AS n FROM crm_leads l WHERE ${healthScope.clause} AND l.reply_status = 'pending'`,
    healthScope.args
  );
  const sentEstR = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM crm_lead_estimates e
     INNER JOIN crm_leads l ON l.id = e.lead_id
     WHERE ${healthScope.clause} AND e.status = 'sent'`,
    healthScope.args
  );

  const srcR = await pool.query(
    `SELECT TRIM(l.source) AS name, COUNT(*)::int AS count
     FROM crm_leads l
     WHERE ${scopedLeads.clause} AND COALESCE(TRIM(l.source), '') <> ''
     GROUP BY TRIM(l.source)
     ORDER BY count DESC
     LIMIT 10`,
    scopedLeads.args
  );
  const srcRows = srcR.rows as { name: string; count: number }[];
  const srcTotal = srcRows.reduce((a, r) => a + r.count, 0);
  const sources = srcRows.map((r) => ({
    name: r.name,
    count: r.count,
    pct: srcTotal > 0 ? Math.round((r.count / srcTotal) * 1000) / 10 : 0,
  }));

  const totalLeads = num((leadsCountR.rows[0] as { n: unknown }).n);
  const customerCount = num((custR.rows[0] as { n: unknown }).n);
  const customerConversionPct = totalLeads > 0 ? Math.round((customerCount / totalLeads) * 1000) / 10 : null;

  res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.status(200).json({
    status: 'success',
    data: {
      period,
      funnel,
      stageInvoiced,
      kpis: {
        invoiced: num(invRow.sum),
        invoiceCount: num(invRow.n),
        avgInvoice: num(invRow.avg),
        avgJobValue: num((avgJobR.rows[0] as { a: unknown }).a),
        jobsCompleted: num((jobsDoneR.rows[0] as { n: unknown }).n),
        jobsActive: num((jobsActiveR.rows[0] as { n: unknown }).n),
        estimatesDeclined: num((estDeclR.rows[0] as { n: unknown }).n),
        activePipelineValue: num((pipeValR.rows[0] as { s: unknown }).s),
        customerCount,
        totalLeads,
        customerConversionPct,
      },
      jobTypes: jobTypeR.rows,
      reps: repR.rows,
      health: {
        staleLeads7d: num((staleR.rows[0] as { n: unknown }).n),
        pendingReply: num((pendingR.rows[0] as { n: unknown }).n),
        sentEstimates: num((sentEstR.rows[0] as { n: unknown }).n),
      },
      sources,
    },
  });
});

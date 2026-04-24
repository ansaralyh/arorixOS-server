import { Request, Response } from 'express';
import pool from '../config/db';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../middlewares/errorHandler';
import { sendSupportStaffNotification } from '../services/emailService';

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function pathId(v: string | string[] | undefined): string {
  if (v == null) return '';
  return Array.isArray(v) ? v[0] ?? '' : v;
}

function pathParamSlug(v: string | string[] | undefined): string {
  const s = pathId(v);
  if (!s || s.length > 200) return '';
  if (!/^[a-z0-9-]+$/.test(s)) return '';
  return s;
}

function isTeamAdmin(req: Request): boolean {
  const r = req.user?.membershipRole;
  return r === 'OWNER' || r === 'ADMIN';
}

/** GET /businesses/support/kb/categories */
export const listKbCategories = catchAsync(async (_req: Request, res: Response) => {
  const r = await pool.query(
    `SELECT c.id, c.slug, c.title, c.description, c.sort_order,
            (SELECT COUNT(*)::int FROM support_kb_articles a WHERE a.category_id = c.id AND a.published) AS article_count
     FROM support_kb_categories c
     ORDER BY c.sort_order ASC, c.title ASC`
  );
  res.status(200).json({
    status: 'success',
    data: {
      categories: r.rows.map((row) => ({
        id: String(row.id),
        slug: String(row.slug),
        title: String(row.title),
        description: String(row.description ?? ''),
        sortOrder: row.sort_order as number,
        articleCount: row.article_count as number,
      })),
    },
  });
});

/** GET /businesses/support/kb/articles?q=&category= */
export const listKbArticles = catchAsync(async (req: Request, res: Response) => {
  const qRaw = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const catRaw = typeof req.query.category === 'string' ? req.query.category.trim() : '';

  const params: string[] = [];
  let where = `WHERE a.published = TRUE`;
  if (catRaw) {
    params.push(catRaw);
    where += ` AND c.slug = $${params.length}`;
  }
  if (qRaw) {
    const term = `%${qRaw.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    params.push(term, term, term);
    const i = params.length;
    where += ` AND (a.title ILIKE $${i - 2} OR a.excerpt ILIKE $${i - 1} OR a.body ILIKE $${i})`;
  }

  const r = await pool.query(
    `SELECT a.id, a.slug, a.title, a.excerpt, c.slug AS category_slug, c.title AS category_title
     FROM support_kb_articles a
     JOIN support_kb_categories c ON c.id = a.category_id
     ${where}
     ORDER BY c.sort_order ASC, a.sort_order ASC, a.title ASC`,
    params
  );

  res.status(200).json({
    status: 'success',
    data: {
      articles: r.rows.map((row) => ({
        id: String(row.id),
        slug: String(row.slug),
        title: String(row.title),
        excerpt: String(row.excerpt ?? ''),
        categorySlug: String(row.category_slug),
        categoryTitle: String(row.category_title),
      })),
    },
  });
});

/** GET /businesses/support/kb/articles/:slug */
export const getKbArticle = catchAsync(async (req: Request, res: Response) => {
  const slug = pathParamSlug(req.params.slug);
  if (!slug) throw new AppError('Invalid article slug.', 400);

  const r = await pool.query(
    `SELECT a.id, a.slug, a.title, a.excerpt, a.body, c.slug AS category_slug, c.title AS category_title
     FROM support_kb_articles a
     JOIN support_kb_categories c ON c.id = a.category_id
     WHERE a.slug = $1 AND a.published = TRUE`,
    [slug]
  );
  if (r.rows.length === 0) {
    throw new AppError('Article not found.', 404);
  }
  const row = r.rows[0];
  res.status(200).json({
    status: 'success',
    data: {
      article: {
        id: String(row.id),
        slug: String(row.slug),
        title: String(row.title),
        excerpt: String(row.excerpt ?? ''),
        body: String(row.body ?? ''),
        categorySlug: String(row.category_slug),
        categoryTitle: String(row.category_title),
      },
    },
  });
});

/** POST /businesses/support/tickets */
export const createTicket = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user!.businessId!;
  const userId = req.user!.id;
  const subject = normalizeSubject(req.body?.subject);
  const body = normalizeBody(req.body?.body);

  const ins = await pool.query(
    `INSERT INTO support_tickets (business_id, created_by_user_id, subject, body)
     VALUES ($1, $2, $3, $4)
     RETURNING id, subject, status, created_at`,
    [businessId, userId, subject, body]
  );
  const row = ins.rows[0];

  const ctx = await pool.query(
    `SELECT b.name AS business_name, u.email AS user_email, u.first_name, u.last_name
     FROM businesses b
     JOIN users u ON u.id = $2
     WHERE b.id = $1 AND b.deleted_at IS NULL`,
    [businessId, userId]
  );
  const bizName = (ctx.rows[0]?.business_name as string) || 'Workspace';
  const email = (ctx.rows[0]?.user_email as string) || '';
  const fn = ctx.rows[0]?.first_name as string | undefined;
  const ln = ctx.rows[0]?.last_name as string | undefined;
  const who = [fn, ln].filter(Boolean).join(' ') || email;

  try {
    await sendSupportStaffNotification({
      subject: `[Arorix Support] ${subject}`,
      text: [
        `New support ticket from ${who} (${email}).`,
        `Workspace: ${bizName}`,
        `Ticket ID: ${row.id}`,
        '',
        `Subject: ${subject}`,
        '',
        body,
      ].join('\n'),
    });
  } catch (e) {
    console.error('[support] ticket notify:', e);
  }

  res.status(201).json({
    status: 'success',
    data: {
      ticket: {
        id: String(row.id),
        subject: String(row.subject),
        status: String(row.status),
        createdAt: (row.created_at as Date).toISOString(),
      },
    },
  });
});

function normalizeSubject(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new AppError('Subject is required.', 400);
  }
  const s = raw.trim();
  if (s.length > 500) throw new AppError('Subject is too long.', 400);
  return s;
}

function normalizeBody(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new AppError('Description is required.', 400);
  }
  const s = raw.trim();
  if (s.length > 20000) throw new AppError('Description is too long.', 400);
  return s;
}

/** GET /businesses/support/tickets */
export const listTickets = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user!.businessId!;
  const userId = req.user!.id;
  const admin = isTeamAdmin(req);

  const r = admin
    ? await pool.query(
        `SELECT t.id, t.subject, t.status, t.created_at, t.updated_at,
                t.created_by_user_id,
                u.email AS submitter_email,
                u.first_name AS submitter_first_name,
                u.last_name AS submitter_last_name
         FROM support_tickets t
         JOIN users u ON u.id = t.created_by_user_id
         WHERE t.business_id = $1
         ORDER BY t.created_at DESC
         LIMIT 100`,
        [businessId]
      )
    : await pool.query(
        `SELECT t.id, t.subject, t.status, t.created_at, t.updated_at,
                t.created_by_user_id,
                u.email AS submitter_email,
                u.first_name AS submitter_first_name,
                u.last_name AS submitter_last_name
         FROM support_tickets t
         JOIN users u ON u.id = t.created_by_user_id
         WHERE t.business_id = $1 AND t.created_by_user_id = $2
         ORDER BY t.created_at DESC
         LIMIT 50`,
        [businessId, userId]
      );

  res.status(200).json({
    status: 'success',
    data: {
      tickets: r.rows.map((row) => ({
        id: String(row.id),
        subject: String(row.subject),
        status: String(row.status),
        createdAt: (row.created_at as Date).toISOString(),
        updatedAt: (row.updated_at as Date).toISOString(),
        submitter: {
          userId: String(row.created_by_user_id),
          email: String(row.submitter_email ?? ''),
          firstName: row.submitter_first_name != null ? String(row.submitter_first_name) : null,
          lastName: row.submitter_last_name != null ? String(row.submitter_last_name) : null,
        },
      })),
    },
  });
});

/** PATCH /businesses/support/tickets/:id — owner/admin only */
export const patchTicket = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user!.businessId!;
  const id = pathId(req.params.id);
  if (!id || !isUuid(id)) throw new AppError('Invalid ticket id.', 400);

  const status = normalizeTicketStatus(req.body?.status);
  const r = await pool.query(
    `UPDATE support_tickets SET status = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND business_id = $3
     RETURNING id, subject, status, created_at, updated_at`,
    [status, id, businessId]
  );
  if (r.rows.length === 0) throw new AppError('Ticket not found.', 404);

  const row = r.rows[0];
  res.status(200).json({
    status: 'success',
    data: {
      ticket: {
        id: String(row.id),
        subject: String(row.subject),
        status: String(row.status),
        createdAt: (row.created_at as Date).toISOString(),
        updatedAt: (row.updated_at as Date).toISOString(),
      },
    },
  });
});

function normalizeTicketStatus(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (['open', 'in_progress', 'resolved', 'closed'].includes(s)) return s;
  throw new AppError('status must be open, in_progress, resolved, or closed.', 400);
}

const CALL_TYPES = ['strategy', 'support', 'general'] as const;

/** POST /businesses/support/call-requests */
export const createCallRequest = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user!.businessId!;
  const userId = req.user!.id;

  const callType = normalizeCallType(req.body?.callType);
  const preferredOn = normalizeDateOnly(req.body?.preferredDate);
  const slot = normalizeTimeSlot(req.body?.preferredTimeSlot);
  const notes = normalizeNotes(req.body?.notes);

  const ins = await pool.query(
    `INSERT INTO support_call_requests (business_id, user_id, call_type, preferred_on, preferred_time_slot, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, call_type, preferred_on, preferred_time_slot, status, created_at`,
    [businessId, userId, callType, preferredOn, slot, notes]
  );
  const row = ins.rows[0];

  const ctx = await pool.query(
    `SELECT b.name AS business_name, u.email AS user_email, u.first_name, u.last_name
     FROM businesses b
     JOIN users u ON u.id = $2
     WHERE b.id = $1 AND b.deleted_at IS NULL`,
    [businessId, userId]
  );
  const bizName = (ctx.rows[0]?.business_name as string) || 'Workspace';
  const email = (ctx.rows[0]?.user_email as string) || '';
  const fn = ctx.rows[0]?.first_name as string | undefined;
  const ln = ctx.rows[0]?.last_name as string | undefined;
  const who = [fn, ln].filter(Boolean).join(' ') || email;

  try {
    await sendSupportStaffNotification({
      subject: `[Arorix Call Request] ${callType} — ${bizName}`,
      text: [
        `Call request from ${who} (${email}).`,
        `Workspace: ${bizName}`,
        `Request ID: ${row.id}`,
        `Type: ${callType}`,
        `Preferred date: ${preferredOn}`,
        `Time slot: ${slot}`,
        notes ? `\nNotes:\n${notes}` : '',
      ].join('\n'),
    });
  } catch (e) {
    console.error('[support] call notify:', e);
  }

  res.status(201).json({
    status: 'success',
    data: {
      callRequest: {
        id: String(row.id),
        callType: String(row.call_type),
        preferredOn: (row.preferred_on as Date).toISOString().slice(0, 10),
        preferredTimeSlot: String(row.preferred_time_slot),
        status: String(row.status),
        createdAt: (row.created_at as Date).toISOString(),
      },
    },
  });
});

function normalizeCallType(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (CALL_TYPES.includes(s as (typeof CALL_TYPES)[number])) return s;
  throw new AppError('callType must be strategy, support, or general.', 400);
}

function normalizeDateOnly(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new AppError('preferredDate is required (YYYY-MM-DD).', 400);
  }
  const s = raw.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new AppError('preferredDate must be a valid date string.', 400);
  }
  return s;
}

function normalizeTimeSlot(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new AppError('preferredTimeSlot is required.', 400);
  }
  const s = raw.trim();
  if (s.length > 32) throw new AppError('Time slot is too long.', 400);
  return s;
}

function normalizeNotes(raw: unknown): string {
  if (raw == null || raw === '') return '';
  if (typeof raw !== 'string') throw new AppError('notes must be a string.', 400);
  if (raw.length > 5000) throw new AppError('notes is too long.', 400);
  return raw.trim();
}

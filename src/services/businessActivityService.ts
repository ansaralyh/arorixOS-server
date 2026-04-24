import pool from '../config/db';
import { AppError } from '../middlewares/errorHandler';

export const BUSINESS_ACTIVITY_ACTIONS = new Set([
  'added',
  'deleted',
  'edited',
  'completed',
  'uncompleted',
  'note_added',
  'note_edited',
  'note_deleted',
  'synced',
]);

export async function getActorDisplayName(userId: string): Promise<string> {
  const r = await pool.query(
    `SELECT first_name, last_name, email FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  const row = r.rows[0];
  if (!row) return 'Someone';
  const n = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return n || row.email || 'Someone';
}

export interface RecordActivityInput {
  businessId: string;
  actorUserId: string;
  actorLabel: string;
  action: string;
  category: string;
  itemTitle: string;
  details?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordBusinessActivity(input: RecordActivityInput) {
  const {
    businessId,
    actorUserId,
    actorLabel,
    action,
    category,
    itemTitle,
    details = null,
    metadata = {},
  } = input;

  if (!BUSINESS_ACTIVITY_ACTIONS.has(action)) {
    throw new AppError(`Invalid activity action: ${action}`, 400);
  }

  const ins = await pool.query(
    `INSERT INTO business_activity_events (
       business_id, actor_user_id, actor_label, action, category, item_title, details, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING id, action, category, item_title, details, actor_label, created_at`,
    [
      businessId,
      actorUserId,
      actorLabel.slice(0, 255),
      action.slice(0, 32),
      category.slice(0, 64),
      itemTitle.slice(0, 2000),
      details ? details.slice(0, 4000) : null,
      JSON.stringify(metadata ?? {}),
    ]
  );
  return ins.rows[0];
}

export function rowToApiEvent(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    action: row.action as string,
    category: row.category as string,
    itemTitle: row.item_title as string,
    details: (row.details as string | null) ?? undefined,
    user: (row.actor_label as string | null) ?? undefined,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at as string).toISOString(),
  };
}

export async function listBusinessActivities(
  businessId: string,
  opts: { limit: number; before: Date | null }
) {
  const limit = Math.min(100, Math.max(1, opts.limit));
  const result = await pool.query(
    `SELECT id, action, category, item_title, details, actor_label, created_at
     FROM business_activity_events
     WHERE business_id = $1
       AND ($2::timestamptz IS NULL OR created_at < $2)
     ORDER BY created_at DESC, id DESC
     LIMIT $3`,
    [businessId, opts.before, limit]
  );
  return result.rows.map(rowToApiEvent);
}

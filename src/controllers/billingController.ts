import { Request, Response } from 'express';
import pool from '../config/db';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../middlewares/errorHandler';

export type ApiPlanTier = 'plus' | 'growth' | 'business';

const PLAN_PRICE_CENTS: Record<ApiPlanTier, number> = {
  plus: 2900,
  growth: 7400,
  business: 14900,
};

function isSimulationMode(): boolean {
  const v = process.env.BILLING_SIMULATION_MODE;
  return v === '1' || v === 'true';
}

function normalizeTier(raw: unknown): ApiPlanTier {
  if (raw === 'plus' || raw === 'growth' || raw === 'business') return raw;
  throw new AppError('Invalid plan tier.', 400);
}

function mapStatusForClient(db: string): 'active' | 'trial' | 'past_due' | 'canceled' {
  if (db === 'trialing') return 'trial';
  if (db === 'past_due') return 'past_due';
  if (db === 'canceled') return 'canceled';
  return 'active';
}

async function ensureBillingRow(businessId: string) {
  await pool.query(
    `INSERT INTO business_billing (business_id) VALUES ($1) ON CONFLICT (business_id) DO NOTHING`,
    [businessId]
  );
}

async function buildBillingPayload(businessId: string) {
  await ensureBillingRow(businessId);

  const b = await pool.query(
    `SELECT plan_tier, subscription_status, current_period_end, billing_address,
            payment_method_brand, payment_method_last4
     FROM business_billing WHERE business_id = $1`,
    [businessId]
  );
  const row = b.rows[0];
  if (!row) throw new AppError('Billing record not found.', 500);

  const inv = await pool.query(
    `SELECT id, amount_cents, description, status, created_at, paid_at
     FROM billing_invoices WHERE business_id = $1 ORDER BY created_at DESC LIMIT 48`,
    [businessId]
  );

  const seatsR = await pool.query(
    `SELECT COUNT(*)::int AS n FROM business_members WHERE business_id = $1`,
    [businessId]
  );
  const seats = seatsR.rows[0]?.n ?? 0;

  const paymentMethod =
    row.payment_method_brand && row.payment_method_last4
      ? {
          brand: String(row.payment_method_brand),
          last4: String(row.payment_method_last4),
          expMonth: 12,
          expYear: new Date().getFullYear() + 3,
        }
      : null;

  const openInvoices = inv.rows
    .filter((r) => r.status === 'open')
    .map((r) => ({
      id: String(r.id),
      amountCents: r.amount_cents as number,
      description: String(r.description || ''),
      createdAt: (r.created_at as Date).toISOString(),
    }));

  return {
    planTier: row.plan_tier as ApiPlanTier,
    status: mapStatusForClient(String(row.subscription_status)),
    nextBillingDate: (row.current_period_end as Date).toISOString().slice(0, 10),
    billingAddress: String(row.billing_address || ''),
    paymentMethod,
    invoices: inv.rows.map((r) => ({
      id: String(r.id),
      date: (r.created_at as Date).toISOString().slice(0, 10),
      amount: (r.amount_cents as number) / 100,
      status: r.status === 'paid' ? 'paid' : r.status === 'open' ? 'pending' : 'failed',
      description: String(r.description || ''),
    })),
    usage: { seats },
    simulationMode: isSimulationMode(),
    openInvoices,
  };
}

/** GET /businesses/billing — owners/admins only (route middleware) */
export const getBilling = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user!.businessId!;
  const data = await buildBillingPayload(businessId);
  res.status(200).json({ status: 'success', data });
});

/** PATCH /businesses/billing — billing address, clear stored payment summary */
export const patchBilling = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user!.businessId!;
  const { billingAddress, clearPaymentMethod } = req.body as {
    billingAddress?: string;
    clearPaymentMethod?: boolean;
  };

  await ensureBillingRow(businessId);

  let updated = false;
  if (clearPaymentMethod === true) {
    await pool.query(
      `UPDATE business_billing SET payment_method_brand = NULL, payment_method_last4 = NULL,
       updated_at = CURRENT_TIMESTAMP WHERE business_id = $1`,
      [businessId]
    );
    updated = true;
  }

  if (typeof billingAddress === 'string') {
    await pool.query(
      `UPDATE business_billing SET billing_address = $1, updated_at = CURRENT_TIMESTAMP WHERE business_id = $2`,
      [billingAddress, businessId]
    );
    updated = true;
  }

  if (!updated) {
    throw new AppError('Nothing to update.', 400);
  }

  const data = await buildBillingPayload(businessId);
  res.status(200).json({ status: 'success', data });
});

/** POST /businesses/billing/change-plan */
export const postChangePlan = catchAsync(async (req: Request, res: Response) => {
  const businessId = req.user!.businessId!;
  const tier = normalizeTier(req.body?.planTier);

  await ensureBillingRow(businessId);

  const cur = await pool.query(`SELECT plan_tier FROM business_billing WHERE business_id = $1`, [businessId]);
  if (cur.rows[0]?.plan_tier === tier) {
    throw new AppError('That is already your current plan.', 400);
  }

  const amountCents = PLAN_PRICE_CENTS[tier];
  const desc = `${tier.charAt(0).toUpperCase() + tier.slice(1)} plan — monthly`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE business_billing SET plan_tier = $1, subscription_status = 'active', updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $2`,
      [tier, businessId]
    );
    await client.query(
      `INSERT INTO billing_invoices (business_id, amount_cents, description, status)
       VALUES ($1, $2, $3, 'open')`,
      [businessId, amountCents, desc]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const data = await buildBillingPayload(businessId);
  res.status(200).json({ status: 'success', data });
});

/**
 * POST /businesses/billing/pay-invoice
 * Records settlement in-DB. When BILLING_SIMULATION_MODE is off, returns 503 — use a PSP for real card charges.
 */
export const postPayInvoice = catchAsync(async (req: Request, res: Response) => {
  if (!isSimulationMode()) {
    throw new AppError(
      'Card payments are not enabled on this server. Set BILLING_SIMULATION_MODE=true for ledger testing, or integrate a payment processor (e.g. Stripe) for production.',
      503
    );
  }

  const businessId = req.user!.businessId!;
  const invoiceId = req.body?.invoiceId;
  if (typeof invoiceId !== 'string' || !invoiceId) {
    throw new AppError('invoiceId is required.', 400);
  }

  let last4 = typeof req.body?.last4 === 'string' ? req.body.last4.replace(/\D/g, '').slice(-4) : '';
  if (last4.length !== 4) last4 = '4242';

  await ensureBillingRow(businessId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const inv = await client.query(
      `SELECT id, status FROM billing_invoices WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [invoiceId, businessId]
    );
    if (inv.rows.length === 0) {
      throw new AppError('Invoice not found.', 404);
    }
    if (inv.rows[0].status !== 'open') {
      throw new AppError('Invoice is not payable.', 400);
    }

    await client.query(
      `UPDATE billing_invoices SET status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [invoiceId]
    );

    await client.query(
      `UPDATE business_billing SET
        subscription_status = 'active',
        current_period_end = (GREATEST(current_period_end, CURRENT_DATE) + INTERVAL '1 month')::date,
        payment_method_brand = 'Card',
        payment_method_last4 = $2,
        updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $1`,
      [businessId, last4]
    );

    await client.query(`UPDATE businesses SET is_paid = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [
      businessId,
    ]);

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const data = await buildBillingPayload(businessId);
  res.status(200).json({ status: 'success', data });
});

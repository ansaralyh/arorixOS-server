/** Seat caps per subscription tier (must match OS BillingContext PLANS). `null` = unlimited. */
export function seatCapForPlanTier(tier: string | null | undefined): number | null {
  const t = typeof tier === 'string' ? tier.toLowerCase() : 'plus';
  if (t === 'business') return null;
  if (t === 'growth') return 10;
  return 3;
}

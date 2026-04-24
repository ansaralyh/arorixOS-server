/** Allowed values — keep in sync with arorixOS BusinessModeContext */

export const BUSINESS_MODES = [
  'contractor',
  'agency',
  'personal_brand',
  'real_estate',
  'custom'
] as const;

export type BusinessMode = (typeof BUSINESS_MODES)[number];

export const LABEL_OVERRIDE_KEYS = [
  'job',
  'jobs',
  'estimate',
  'estimates',
  'customer',
  'customers',
  'pipeline'
] as const;

export type LabelOverrideKey = (typeof LABEL_OVERRIDE_KEYS)[number];

const MAX_LABEL_LEN = 64;

export function parseBusinessMode(raw: unknown): BusinessMode {
  if (typeof raw !== 'string' || !BUSINESS_MODES.includes(raw as BusinessMode)) {
    throw new Error(`Invalid business mode. Must be one of: ${BUSINESS_MODES.join(', ')}.`);
  }
  return raw as BusinessMode;
}

/** Sanitize client-provided label overrides: only known keys, non-empty strings, max length */
export function sanitizeCustomLabels(raw: unknown): Record<string, string> {
  if (raw === undefined || raw === null) {
    return {};
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('customLabels must be a plain object.');
  }
  const out: Record<string, string> = {};
  for (const key of LABEL_OVERRIDE_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'string') {
      throw new Error(`Label "${key}" must be a string.`);
    }
    const t = v.trim().slice(0, MAX_LABEL_LEN);
    if (t.length > 0) {
      out[key] = t;
    }
  }
  return out;
}

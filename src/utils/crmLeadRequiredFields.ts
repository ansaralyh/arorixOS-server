import pool from '../config/db';

/**
 * CRM field rows from `business_crm_settings.crm_config.fields`.
 * The API only persists a subset of these on `crm_leads`; we only enforce what can be read from the POST/PATCH body and stored columns.
 */
export type CrmFieldRow = { id: string; label: string; required: boolean; enabled: boolean };

/** System field ids that map to `crm_leads` columns (or `name` split for first/last). */
const MAPPABLE_FIELD_IDS = new Set([
  'first_name',
  'last_name',
  'phone',
  'email',
  'company',
  'source',
  'internal_notes',
  'pipeline_stage',
  'urgency',
  'assigned_to',
]);

const COMMERCIAL_ONLY_FIELD_IDS = new Set(['company']);

export type CrmLeadFieldSnapshot = {
  name: string;
  email: string;
  phone: string;
  company: string;
  source: string;
  notes: string;
  stage: string;
  accountType: 'personal' | 'commercial';
  /** Stored value(s) e.g. low/medium/high; string | null matches `crm_leads.urgency`. */
  urgency: string | null;
  ownerUserId: string | null;
};

function trimStr(s: string): string {
  return s.trim();
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s: string | null | undefined): boolean {
  return typeof s === 'string' && UUID_RE.test(s.trim());
}

function getFieldString(id: string, s: CrmLeadFieldSnapshot): string {
  const { first, last } = splitName(s.name);
  switch (id) {
    case 'first_name':
      return trimStr(first);
    case 'last_name':
      return trimStr(last);
    case 'phone':
      return trimStr(s.phone);
    case 'email':
      return trimStr(s.email);
    case 'company':
      return trimStr(s.company);
    case 'source':
      return trimStr(s.source);
    case 'internal_notes':
      return trimStr(s.notes);
    case 'pipeline_stage':
      return trimStr(s.stage);
    case 'urgency':
      return s.urgency ? String(s.urgency) : '';
    case 'assigned_to': {
      const o = s.ownerUserId;
      return o && isUuid(o) ? o.trim() : '';
    }
    default:
      return '';
  }
}

function shouldEnforceField(f: CrmFieldRow, s: CrmLeadFieldSnapshot): boolean {
  if (!f.required || !f.enabled) return false;
  if (!MAPPABLE_FIELD_IDS.has(f.id)) return false;
  if (COMMERCIAL_ONLY_FIELD_IDS.has(f.id) && s.accountType !== 'commercial') return false;
  return true;
}

/**
 * @returns first missing field label, or null if all enforced mappable required fields are filled.
 */
export function firstMissingRequiredCrmField(
  fields: CrmFieldRow[],
  snapshot: CrmLeadFieldSnapshot
): string | null {
  for (const f of fields) {
    if (!shouldEnforceField(f, snapshot)) continue;
    const v = getFieldString(f.id, snapshot);
    if (!v) return f.label;
  }
  return null;
}

function parseCrmFieldRows(crmConfig: unknown): CrmFieldRow[] {
  if (crmConfig == null || typeof crmConfig !== 'object' || Array.isArray(crmConfig)) {
    return [];
  }
  const raw = (crmConfig as { fields?: unknown }).fields;
  if (!Array.isArray(raw)) return [];
  const out: CrmFieldRow[] = [];
  for (const x of raw) {
    if (x == null || typeof x !== 'object' || Array.isArray(x)) continue;
    const o = x as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : '';
    if (!id) continue;
    const label = typeof o.label === 'string' && o.label.trim() ? o.label : id;
    out.push({
      id,
      label,
      required: o.required === true,
      enabled: o.enabled !== false,
    });
  }
  return out;
}

/**
 * Per-stage "must have these field values before entering this stage" (from `crm_config.stageRequirements`).
 */
export type StageRequirementRow = { stageId: string; requiredFields: string[] };

function parseStageRequirements(crmConfig: unknown): StageRequirementRow[] {
  if (crmConfig == null || typeof crmConfig !== 'object' || Array.isArray(crmConfig)) {
    return [];
  }
  const raw = (crmConfig as { stageRequirements?: unknown }).stageRequirements;
  if (!Array.isArray(raw)) return [];
  const out: StageRequirementRow[] = [];
  for (const x of raw) {
    if (x == null || typeof x !== 'object' || Array.isArray(x)) continue;
    const o = x as Record<string, unknown>;
    const stageId = typeof o.stageId === 'string' ? o.stageId : '';
    if (!stageId) continue;
    const rf = o.requiredFields;
    const requiredFields = Array.isArray(rf) ? rf.filter((id): id is string => typeof id === 'string') : [];
    out.push({ stageId, requiredFields });
  }
  return out;
}

/**
 * One `business_crm_settings` read: field rows + stage requirements.
 */
export async function fetchCrmConfigPartsForBusiness(
  businessId: string
): Promise<{ fieldRows: CrmFieldRow[]; stageReqs: StageRequirementRow[] }> {
  const r = await pool.query(`SELECT crm_config FROM business_crm_settings WHERE business_id = $1`, [
    businessId,
  ]);
  if (!r.rows[0]) {
    return { fieldRows: [], stageReqs: [] };
  }
  const crm = (r.rows[0] as { crm_config: unknown }).crm_config;
  return { fieldRows: parseCrmFieldRows(crm), stageReqs: parseStageRequirements(crm) };
}

/**
 * Load CRM field rules for a business. If no `business_crm_settings` row exists, returns [] (no extra rules).
 */
export async function fetchCrmFieldRowsForBusiness(businessId: string): Promise<CrmFieldRow[]> {
  const { fieldRows } = await fetchCrmConfigPartsForBusiness(businessId);
  return fieldRows;
}

/** Default: seed pipeline uses `sold` as the closed-won column (see crmPipelineController DEFAULT_STAGES). */
export const DEFAULT_CUSTOMER_STAGE_KEYS = ['sold'];

/**
 * `crm_config.customerStageKeys` — stage_key values that count as “customer” for `crm_customers` upsert.
 */
export function parseCustomerStageKeys(crmConfig: unknown): string[] {
  if (crmConfig == null || typeof crmConfig !== 'object' || Array.isArray(crmConfig)) {
    return DEFAULT_CUSTOMER_STAGE_KEYS;
  }
  const raw = (crmConfig as { customerStageKeys?: unknown }).customerStageKeys;
  if (!Array.isArray(raw)) return DEFAULT_CUSTOMER_STAGE_KEYS;
  const keys = raw.map((k) => (typeof k === 'string' ? k.trim() : '')).filter(Boolean);
  return keys.length > 0 ? keys : DEFAULT_CUSTOMER_STAGE_KEYS;
}

export async function getCustomerStageKeysForBusiness(businessId: string): Promise<string[]> {
  const r = await pool.query(`SELECT crm_config FROM business_crm_settings WHERE business_id = $1`, [
    businessId,
  ]);
  if (!r.rows[0]) return DEFAULT_CUSTOMER_STAGE_KEYS;
  return parseCustomerStageKeys((r.rows[0] as { crm_config: unknown }).crm_config);
}

/**
 * When a lead’s stage is one of the configured customer stages, ensure a `crm_customers` row exists.
 */
export async function upsertCrmCustomerForLead(
  businessId: string,
  leadId: string,
  stageKey: string
): Promise<void> {
  const keys = await getCustomerStageKeysForBusiness(businessId);
  if (!keys.includes(stageKey)) return;
  await pool.query(
    `INSERT INTO crm_customers (lead_id, business_id) VALUES ($1::uuid, $2) ON CONFLICT (lead_id) DO NOTHING`,
    [leadId, businessId]
  );
}

/**
 * When lead enters `targetStage`, each enabled mappable field in the rule must be non-empty in `snapshot`.
 */
export function firstMissingForStageEntry(
  stageReqs: StageRequirementRow[],
  targetStage: string,
  fieldRows: CrmFieldRow[],
  snapshot: CrmLeadFieldSnapshot
): string | null {
  const rule = stageReqs.find((r) => r.stageId === targetStage);
  if (!rule?.requiredFields.length) return null;
  for (const fieldId of rule.requiredFields) {
    const f = fieldRows.find((row) => row.id === fieldId);
    if (!f || !f.enabled) continue;
    if (!MAPPABLE_FIELD_IDS.has(fieldId)) continue;
    if (COMMERCIAL_ONLY_FIELD_IDS.has(fieldId) && snapshot.accountType !== 'commercial') continue;
    const v = getFieldString(fieldId, snapshot);
    if (!v) return f.label;
  }
  return null;
}

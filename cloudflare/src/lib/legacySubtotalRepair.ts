import type { D1Compat } from './db'

export const LEGACY_SUBTOTAL_REPAIR_STEP = 'repair_sep23_subtotals' as const
export const LEGACY_SUBTOTAL_REPAIR_CONFIRMATION = 'APPLY_SEP23_SUBTOTAL_REPAIR' as const
export const LEGACY_SUBTOTAL_REPAIR_BACKUP_TABLES = Object.freeze([
  'sales',
  'sale_write_revisions',
  'action_history',
  'audit_logs',
  'sale_bulk_guards',
] as const)

const SCHEMA_VERSION = 1
const REPAIR_ENTITY = 'sep23_subtotal_repair'
const EXPECTED_IDS = Object.freeze(Array.from({ length: 22 }, (_, index) => 16842 + index))
const EXPECTED_DATES = Object.freeze(Object.fromEntries(EXPECTED_IDS.map((id) => [id, id <= 16858 ? '2026-09-03' : '2026-09-02'])))
const EXPECTED_BY_DATE = Object.freeze({
  '2026-09-02': Object.freeze({ subtotal_usd: '1992.0000', item_discount_usd: '5.0000' }),
  '2026-09-03': Object.freeze({ subtotal_usd: '1470.0000', item_discount_usd: '61.0000' }),
})
const EXPECTED_TOTAL_USD = '3462.0000'
const EXPECTED_ITEM_DISCOUNT_USD = '66.0000'

const REQUEST_KEYS = Object.freeze(['step', 'apply', 'confirmation', 'manifest_sha256', 'manifest'])
const MANIFEST_KEYS = Object.freeze(['schema_version', 'plan_id', 'generated_at_utc', 'operator_name', 'source_note', 'sales'])
const SALE_KEYS = Object.freeze([
  'id', 'receipt_number', 'created_at', 'updated_at', 'business_date', 'notes', 'sale_status',
  'expected_subtotal_usd', 'expected_subtotal_khr', 'target_subtotal_usd',
  'total_usd', 'total_khr', 'amount_paid_usd', 'amount_paid_khr',
  'discount_usd', 'discount_khr', 'tax_usd', 'tax_khr',
  'delivery_fee_usd', 'delivery_fee_khr', 'exchange_rate', 'stock_skipped',
  'payment_method', 'payment_details', 'expected_revision', 'item_count',
  'item_total_usd', 'item_total_khr', 'item_discount_usd', 'item_discount_khr',
])
const MONEY_FIELDS = Object.freeze([
  'expected_subtotal_usd', 'expected_subtotal_khr', 'target_subtotal_usd',
  'total_usd', 'total_khr', 'amount_paid_usd', 'amount_paid_khr',
  'discount_usd', 'discount_khr', 'tax_usd', 'tax_khr',
  'delivery_fee_usd', 'delivery_fee_khr', 'exchange_rate',
  'item_total_usd', 'item_total_khr', 'item_discount_usd', 'item_discount_khr',
] as const)

type MoneyField = typeof MONEY_FIELDS[number]

export class LegacySubtotalRepairValidationError extends Error {
  constructor(message: string) {
    super(`Subtotal repair request rejected: ${message}`)
    this.name = 'LegacySubtotalRepairValidationError'
  }
}

export class LegacySubtotalRepairConflictError extends Error {
  constructor() {
    super('The repair manifest is stale, the cohort is in a mixed state, or guarded verification failed. No data was changed.')
    this.name = 'LegacySubtotalRepairConflictError'
  }
}

interface CanonicalSale {
  id: number
  receipt_number: string
  created_at: string
  updated_at: string | null
  business_date: string
  notes: string | null
  sale_status: string
  expected_subtotal_usd: string
  expected_subtotal_khr: string
  target_subtotal_usd: string
  total_usd: string
  total_khr: string
  amount_paid_usd: string
  amount_paid_khr: string
  discount_usd: string
  discount_khr: string
  tax_usd: string
  tax_khr: string
  delivery_fee_usd: string
  delivery_fee_khr: string
  exchange_rate: string
  stock_skipped: number
  payment_method: string | null
  payment_details: string | null
  expected_revision: number | null
  item_count: number
  item_total_usd: string
  item_total_khr: string
  item_discount_usd: string
  item_discount_khr: string
}

interface CanonicalManifest {
  schema_version: 1
  plan_id: string
  generated_at_utc: string
  operator_name: string
  source_note: string
  sales: CanonicalSale[]
}

type RepairStatement = { sql: string; params?: Record<string, unknown> }

export interface PreparedLegacySubtotalRepair {
  planId: string
  manifestSha256: string
  saleCount: number
  statements: RepairStatement[]
  updateStartIndex: number
  historyStatementIndex: number
}

function fail(message: string): never {
  throw new LegacySubtotalRepairValidationError(message)
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  const record = asRecord(value, label)
  const keys = Object.keys(record)
  const missing = allowed.filter((key) => !keys.includes(key))
  const extra = keys.filter((key) => !allowed.includes(key))
  if (missing.length) fail(`${label} is missing ${missing.join(', ')}`)
  if (extra.length) fail(`${label} contains unsupported fields: ${extra.join(', ')}`)
  return record
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') fail(`${label} must be a string`)
  if (!value.trim()) fail(`${label} must not be blank`)
  if (value.length > maximum) fail(`${label} exceeds ${maximum} characters`)
  return value
}

function nullableString(value: unknown, label: string, maximum: number): string | null {
  if (value === null) return null
  if (typeof value !== 'string') fail(`${label} must be a string or null`)
  if (value.length > maximum) fail(`${label} exceeds ${maximum} characters`)
  return value
}

function decimal4(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/.test(value)) {
    fail(`${label} must be a bounded non-negative decimal string with at most four fractional digits`)
  }
  const [whole, fraction = ''] = value.split('.')
  return `${whole}.${fraction.padEnd(4, '0')}`
}

function scaled4(value: string): bigint {
  const [whole, fraction] = value.split('.')
  return BigInt(whole) * 10000n + BigInt(fraction)
}

function sum4(values: string[]): string {
  const total = values.reduce((sum, value) => sum + scaled4(value), 0n)
  return `${total / 10000n}.${String(total % 10000n).padStart(4, '0')}`
}

function same4(left: string, right: string): boolean {
  return scaled4(left) === scaled4(right)
}

function normalizeSale(rawValue: unknown, index: number): CanonicalSale {
  const label = `manifest.sales[${index}]`
  const raw = exactKeys(rawValue, SALE_KEYS, label)
  if (!Number.isSafeInteger(raw.id)) fail(`${label}.id must be a safe integer`)
  const id = raw.id as number
  if (!EXPECTED_IDS.includes(id)) fail(`${label}.id ${id} is outside the exact 16842-16863 cohort`)
  if (typeof raw.created_at !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?$/.test(raw.created_at)) {
    fail(`${label}.created_at must be an exact SQLite or ISO timestamp`)
  }
  if (raw.updated_at !== null && (typeof raw.updated_at !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?$/.test(raw.updated_at))) {
    fail(`${label}.updated_at must be null or an exact SQLite or ISO timestamp`)
  }
  if (raw.business_date !== EXPECTED_DATES[id]) fail(`${label}.business_date must be ${EXPECTED_DATES[id]} for sale ${id}`)
  if (!Number.isSafeInteger(raw.stock_skipped) || raw.stock_skipped !== 0) fail(`${label}.stock_skipped must be the exact observed value 0`)
  if (!Number.isSafeInteger(raw.item_count) || Number(raw.item_count) < 1) fail(`${label}.item_count must be a positive safe integer`)
  if (raw.expected_revision !== null && (!Number.isSafeInteger(raw.expected_revision) || Number(raw.expected_revision) < 0)) {
    fail(`${label}.expected_revision must be null for an absent revision row or a non-negative safe integer`)
  }

  const money = Object.fromEntries(MONEY_FIELDS.map((field) => [field, decimal4(raw[field], `${label}.${field}`)])) as Record<MoneyField, string>
  const values: Record<string, unknown> = {
    id,
    receipt_number: boundedText(raw.receipt_number, `${label}.receipt_number`, 160),
    created_at: raw.created_at,
    updated_at: raw.updated_at as string | null,
    business_date: raw.business_date as string,
    notes: nullableString(raw.notes, `${label}.notes`, 2000),
    sale_status: boundedText(raw.sale_status, `${label}.sale_status`, 40),
    ...money,
    stock_skipped: raw.stock_skipped as number,
    payment_method: nullableString(raw.payment_method, `${label}.payment_method`, 200),
    payment_details: nullableString(raw.payment_details, `${label}.payment_details`, 20000),
    expected_revision: raw.expected_revision as number | null,
    item_count: raw.item_count as number,
  }
  // Keep the same stable field order as the local planner so a digest
  // produced there identifies the exact same canonical manifest here.
  const normalized = Object.fromEntries(SALE_KEYS.map((key) => [key, values[key]])) as unknown as CanonicalSale
  if (!same4(normalized.expected_subtotal_usd, '0.0000')) fail(`${label}.expected_subtotal_usd must be 0.0000`)
  if (!same4(normalized.target_subtotal_usd, normalized.item_total_usd)) fail(`${label}.target_subtotal_usd must equal its net item_total_usd`)
  if (!same4(normalized.target_subtotal_usd, normalized.total_usd)) fail(`${label}.target_subtotal_usd must equal total_usd`)
  if (!same4(normalized.total_usd, normalized.amount_paid_usd)) fail(`${label}.total_usd must equal amount_paid_usd`)
  for (const field of ['discount_usd', 'tax_usd', 'delivery_fee_usd'] as const) {
    if (!same4(normalized[field], '0.0000')) fail(`${label}.${field} must be 0.0000`)
  }
  if (!same4(normalized.exchange_rate, '4100.0000')) fail(`${label}.exchange_rate must be the observed 4100.0000`)
  return normalized
}

function canonicalizeManifest(rawValue: unknown): CanonicalManifest {
  const raw = exactKeys(rawValue, MANIFEST_KEYS, 'manifest')
  if (raw.schema_version !== SCHEMA_VERSION) fail(`manifest.schema_version must be ${SCHEMA_VERSION}`)
  if (typeof raw.plan_id !== 'string' || !/^sep23-subtotal-[A-Za-z0-9_-]{8,80}$/.test(raw.plan_id)) {
    fail('manifest.plan_id must start with sep23-subtotal- and contain a stable 8-80 character suffix')
  }
  if (typeof raw.generated_at_utc !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw.generated_at_utc)) {
    fail('manifest.generated_at_utc must be an ISO UTC timestamp')
  }
  if (!Array.isArray(raw.sales) || raw.sales.length !== EXPECTED_IDS.length) fail(`manifest.sales must contain exactly ${EXPECTED_IDS.length} rows`)
  const sales = raw.sales.map(normalizeSale).sort((left, right) => left.id - right.id)
  const ids = sales.map((sale) => sale.id)
  if (new Set(ids).size !== EXPECTED_IDS.length || ids.some((id, index) => id !== EXPECTED_IDS[index])) {
    fail('manifest.sales must contain each id from 16842 through 16863 exactly once; 16827 is not in scope')
  }
  if (sum4(sales.map((sale) => sale.target_subtotal_usd)) !== EXPECTED_TOTAL_USD) fail(`target subtotal sum must be ${EXPECTED_TOTAL_USD}`)
  if (sum4(sales.map((sale) => sale.total_usd)) !== EXPECTED_TOTAL_USD) fail(`sale total sum must be ${EXPECTED_TOTAL_USD}`)
  if (sum4(sales.map((sale) => sale.amount_paid_usd)) !== EXPECTED_TOTAL_USD) fail(`paid sum must be ${EXPECTED_TOTAL_USD}`)
  if (sum4(sales.map((sale) => sale.item_discount_usd)) !== EXPECTED_ITEM_DISCOUNT_USD) fail(`item discount sum must be ${EXPECTED_ITEM_DISCOUNT_USD}`)
  for (const [businessDate, expected] of Object.entries(EXPECTED_BY_DATE)) {
    const cohort = sales.filter((sale) => sale.business_date === businessDate)
    if (sum4(cohort.map((sale) => sale.target_subtotal_usd)) !== expected.subtotal_usd) fail(`${businessDate} target subtotal sum must be ${expected.subtotal_usd}`)
    if (sum4(cohort.map((sale) => sale.item_discount_usd)) !== expected.item_discount_usd) fail(`${businessDate} item discount sum must be ${expected.item_discount_usd}`)
  }
  return {
    schema_version: SCHEMA_VERSION,
    plan_id: raw.plan_id,
    generated_at_utc: raw.generated_at_utc,
    operator_name: boundedText(raw.operator_name, 'manifest.operator_name', 120),
    source_note: boundedText(raw.source_note, 'manifest.source_note', 2000),
    sales,
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// One statement reads a consistent snapshot of the fixed cohort. No caller
// supplies identifiers or SQL, and every text column is bounded before transfer.
// Overlong values retain one extra character so canonical validation rejects
// them rather than silently signing a truncated snapshot.
export const LEGACY_SUBTOTAL_PREVIEW_SQL = `SELECT
  s.id, substr(s.receipt_number,1,161) AS receipt_number,
  substr(s.created_at,1,25) AS created_at, substr(s.updated_at,1,25) AS updated_at,
  date(datetime(s.created_at,'+7 hours')) AS business_date,
  substr(s.notes,1,2001) AS notes, substr(COALESCE(s.sale_status,'completed'),1,41) AS sale_status,
  ${MONEY_FIELDS.filter((field) => !field.startsWith('item_')).map((field) => {
    const column = field === 'target_subtotal_usd' ? 'total_usd' : field.replace(/^expected_/, '')
    return `printf('%.4f',COALESCE(s.${column},0)) AS ${field}`
  }).join(',\n  ')},
  COALESCE(s.stock_skipped,0) AS stock_skipped,
  substr(s.payment_method,1,201) AS payment_method,
  substr(s.payment_details,1,20001) AS payment_details,
  (SELECT revision FROM sale_write_revisions v WHERE v.sale_id=s.id) AS expected_revision,
  (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id=s.id) AS item_count,
  ${(['usd', 'khr'] as const).flatMap((currency) => [
    `printf('%.4f',COALESCE((SELECT SUM(COALESCE(si.total_${currency},0)) FROM sale_items si WHERE si.sale_id=s.id),0)) AS item_total_${currency}`,
    `printf('%.4f',COALESCE((SELECT SUM(COALESCE(si.product_discount_${currency},0)+COALESCE(si.manual_discount_${currency},0)) FROM sale_items si WHERE si.sale_id=s.id),0)) AS item_discount_${currency}`,
  ]).join(',\n  ')}
  FROM sales s WHERE s.id IN (SELECT value FROM json_each(@ids)) ORDER BY s.id`

export async function previewLegacySubtotalRepair(db: Pick<D1Compat, 'prepare'>, actor: { id?: unknown; name?: unknown }) {
  const maintenance = await db.prepare("SELECT 1 AS active FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore'").get()
  if (maintenance) throw new LegacySubtotalRepairConflictError()
  const sales = await db.prepare(LEGACY_SUBTOTAL_PREVIEW_SQL).all({ ids: JSON.stringify(EXPECTED_IDS) })
  const manifest = canonicalizeManifest({
    schema_version: SCHEMA_VERSION,
    plan_id: `sep23-subtotal-${crypto.randomUUID()}`,
    generated_at_utc: new Date().toISOString(),
    operator_name: actor.name,
    source_note: 'Owner-authorized Sep 2-3 2026 imported-sale subtotal correction from canonical net item totals. Stock, payments, discounts and COGS remain unchanged.',
    sales,
  })
  const request = {
    step: LEGACY_SUBTOTAL_REPAIR_STEP,
    apply: true as const,
    confirmation: LEGACY_SUBTOTAL_REPAIR_CONFIRMATION,
    manifest_sha256: await sha256(JSON.stringify(manifest)),
    manifest,
  }
  // Share all application validation; preview never backs up or executes a batch.
  await prepareLegacySubtotalRepair(request, actor)
  return {
    success: true as const, state: 'ready' as const, request,
    summary: { sale_count: EXPECTED_IDS.length, subtotal_usd: EXPECTED_TOTAL_USD, item_discount_usd: EXPECTED_ITEM_DISCOUNT_USD },
  }
}

const EXPECTED_CTE = `WITH expected AS (
  SELECT
    CAST(json_extract(value,'$.id') AS INTEGER) AS id,
    json_extract(value,'$.receipt_number') AS receipt_number,
    json_extract(value,'$.created_at') AS created_at,
    json_extract(value,'$.updated_at') AS updated_at,
    json_extract(value,'$.business_date') AS business_date,
    json_extract(value,'$.notes') AS notes,
    json_extract(value,'$.sale_status') AS sale_status,
    json_extract(value,'$.expected_subtotal_usd') AS expected_subtotal_usd,
    json_extract(value,'$.expected_subtotal_khr') AS expected_subtotal_khr,
    json_extract(value,'$.target_subtotal_usd') AS target_subtotal_usd,
    json_extract(value,'$.total_usd') AS total_usd,
    json_extract(value,'$.total_khr') AS total_khr,
    json_extract(value,'$.amount_paid_usd') AS amount_paid_usd,
    json_extract(value,'$.amount_paid_khr') AS amount_paid_khr,
    json_extract(value,'$.discount_usd') AS discount_usd,
    json_extract(value,'$.discount_khr') AS discount_khr,
    json_extract(value,'$.tax_usd') AS tax_usd,
    json_extract(value,'$.tax_khr') AS tax_khr,
    json_extract(value,'$.delivery_fee_usd') AS delivery_fee_usd,
    json_extract(value,'$.delivery_fee_khr') AS delivery_fee_khr,
    json_extract(value,'$.exchange_rate') AS exchange_rate,
    CAST(json_extract(value,'$.stock_skipped') AS INTEGER) AS stock_skipped,
    json_extract(value,'$.payment_method') AS payment_method,
    json_extract(value,'$.payment_details') AS payment_details,
    json_extract(value,'$.expected_revision') AS expected_revision,
    CAST(json_extract(value,'$.item_count') AS INTEGER) AS item_count,
    json_extract(value,'$.item_total_usd') AS item_total_usd,
    json_extract(value,'$.item_total_khr') AS item_total_khr,
    json_extract(value,'$.item_discount_usd') AS item_discount_usd,
    json_extract(value,'$.item_discount_khr') AS item_discount_khr
  FROM json_each(@rows)
)`

const MONEY_GUARDS = Object.freeze([
  'subtotal_khr:expected_subtotal_khr', 'total_usd:total_usd', 'total_khr:total_khr',
  'amount_paid_usd:amount_paid_usd', 'amount_paid_khr:amount_paid_khr',
  'discount_usd:discount_usd', 'discount_khr:discount_khr', 'tax_usd:tax_usd', 'tax_khr:tax_khr',
  'delivery_fee_usd:delivery_fee_usd', 'delivery_fee_khr:delivery_fee_khr', 'exchange_rate:exchange_rate',
])

function rowStatePredicate(phase: 'before' | 'after'): string {
  const subtotal = phase === 'before' ? 'e.expected_subtotal_usd' : 'e.target_subtotal_usd'
  const revision = phase === 'before'
    ? `((e.expected_revision IS NULL AND NOT EXISTS(SELECT 1 FROM sale_write_revisions v WHERE v.sale_id=s.id)) OR (e.expected_revision IS NOT NULL AND EXISTS(SELECT 1 FROM sale_write_revisions v WHERE v.sale_id=s.id AND v.revision=CAST(e.expected_revision AS INTEGER))))`
    : `EXISTS(SELECT 1 FROM sale_write_revisions v WHERE v.sale_id=s.id AND v.revision=COALESCE(CAST(e.expected_revision AS INTEGER),0)+1)`
  return [
    `printf('%.4f',COALESCE(s.subtotal_usd,0))=${subtotal}`,
    ...MONEY_GUARDS.map((pair) => { const [column, expected] = pair.split(':'); return `printf('%.4f',COALESCE(s.${column},0))=e.${expected}` }),
    's.receipt_number IS e.receipt_number', 's.created_at IS e.created_at', 's.updated_at IS e.updated_at',
    `date(datetime(s.created_at,'+7 hours'))=e.business_date`, 's.notes IS e.notes',
    `COALESCE(s.sale_status,'completed')=e.sale_status`, 'COALESCE(s.stock_skipped,0)=e.stock_skipped',
    's.payment_method IS e.payment_method', 's.payment_details IS e.payment_details', revision,
    '(SELECT COUNT(*) FROM sale_items si WHERE si.sale_id=s.id)=e.item_count',
    `printf('%.4f',COALESCE((SELECT SUM(COALESCE(si.total_usd,0)) FROM sale_items si WHERE si.sale_id=s.id),0))=e.item_total_usd`,
    `printf('%.4f',COALESCE((SELECT SUM(COALESCE(si.total_khr,0)) FROM sale_items si WHERE si.sale_id=s.id),0))=e.item_total_khr`,
    `printf('%.4f',COALESCE((SELECT SUM(COALESCE(si.product_discount_usd,0)+COALESCE(si.manual_discount_usd,0)) FROM sale_items si WHERE si.sale_id=s.id),0))=e.item_discount_usd`,
    `printf('%.4f',COALESCE((SELECT SUM(COALESCE(si.product_discount_khr,0)+COALESCE(si.manual_discount_khr,0)) FROM sale_items si WHERE si.sale_id=s.id),0))=e.item_discount_khr`,
  ].join(' AND ')
}

function stateCount(phase: 'before' | 'after'): string {
  return `(SELECT COUNT(*) FROM expected e JOIN sales s ON s.id=e.id WHERE ${rowStatePredicate(phase)})`
}

function historyCount(): string {
  return `(SELECT COUNT(*) FROM action_history WHERE entity='${REPAIR_ENTITY}' AND entity_id=@plan_id AND reversible=0 AND status='recorded' AND json_extract(redo_payload,'$.manifest_sha256')=@digest)`
}

function auditCount(): string {
  return `(SELECT COUNT(*) FROM audit_logs WHERE action='repair_subtotal_usd' AND entity='sale' AND entity_id=@plan_id AND json_extract(details,'$.manifest_sha256')=@digest)`
}

function assertion(predicate: string, params: Record<string, unknown>): RepairStatement {
  return { sql: `INSERT INTO sale_bulk_guards(guard_value) ${EXPECTED_CTE} SELECT CASE WHEN (${predicate}) THEN 1 ELSE 0 END`, params }
}

function updateStatements(sales: CanonicalSale[]): RepairStatement[] {
  return sales.map((sale) => {
    const revisionGuard = sale.expected_revision === null
      ? 'NOT EXISTS(SELECT 1 FROM sale_write_revisions WHERE sale_id=@id)'
      : 'EXISTS(SELECT 1 FROM sale_write_revisions WHERE sale_id=@id AND revision=@revision)'
    return {
      sql: `UPDATE sales SET subtotal_usd=CAST(@to AS NUMERIC) WHERE id=@id AND printf('%.4f',COALESCE(subtotal_usd,0))=@from AND ${revisionGuard}`,
      params: { id: sale.id, from: sale.expected_subtotal_usd, to: sale.target_subtotal_usd, revision: sale.expected_revision },
    }
  })
}

export async function prepareLegacySubtotalRepair(rawRequest: unknown, actor: { id?: unknown; name?: unknown }): Promise<PreparedLegacySubtotalRepair> {
  const request = exactKeys(rawRequest, REQUEST_KEYS, 'request')
  if (request.step !== LEGACY_SUBTOTAL_REPAIR_STEP) fail(`request.step must be ${LEGACY_SUBTOTAL_REPAIR_STEP}`)
  if (request.apply !== true) fail('request.apply must be true')
  if (request.confirmation !== LEGACY_SUBTOTAL_REPAIR_CONFIRMATION) fail(`request.confirmation must be ${LEGACY_SUBTOTAL_REPAIR_CONFIRMATION}`)
  if (typeof request.manifest_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(request.manifest_sha256)) {
    fail('request.manifest_sha256 must be a lowercase SHA-256 hex digest')
  }
  if (!Number.isSafeInteger(actor.id) || Number(actor.id) < 1) fail('authenticated actor id is required')
  const actorName = boundedText(actor.name, 'authenticated actor name', 120)
  const manifest = canonicalizeManifest(request.manifest)
  const digest = await sha256(JSON.stringify(manifest))
  if (digest !== request.manifest_sha256) fail('request.manifest_sha256 does not match the canonical manifest')

  const rows = JSON.stringify(manifest.sales)
  if (new TextEncoder().encode(rows).byteLength > 512000) fail('canonical sales snapshot exceeds the 512000-byte plan bound')
  const common = { rows, plan_id: manifest.plan_id, digest }
  const details = JSON.stringify({
    schema_version: SCHEMA_VERSION,
    plan_id: manifest.plan_id,
    manifest_sha256: digest,
    generated_at_utc: manifest.generated_at_utc,
    source_note: manifest.source_note,
    sale_ids: EXPECTED_IDS,
    before_subtotal_usd: '0.0000',
    after_subtotal_usd: EXPECTED_TOTAL_USD,
    item_discount_usd: EXPECTED_ITEM_DISCOUNT_USD,
    changed_columns: ['sales.subtotal_usd'],
  })
  const applyHistory = historyCount()
  const applyAudit = auditCount()
  const maintenanceGuard = `NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')`
  const applyEntry = `${maintenanceGuard} AND (((${applyHistory})=0 AND (${applyAudit})=0 AND ${stateCount('before')}=22) OR ((${applyHistory})=1 AND (${applyAudit})=1 AND ${stateCount('after')}=22))`
  const applyFinal = `${maintenanceGuard} AND ${stateCount('after')}=22 AND (${applyHistory})=1 AND (${applyAudit})=1`
  const updates = updateStatements(manifest.sales)
  const statements: RepairStatement[] = [
    { sql: 'DELETE FROM sale_bulk_guards', params: {} },
    assertion(applyEntry, common),
    ...updates,
    {
      sql: `INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name)
            SELECT 'global',@entity,@plan_id,@label,0,'recorded','{}',@details,@actor_id,@actor_name
            WHERE NOT EXISTS(SELECT 1 FROM action_history WHERE entity=@entity AND entity_id=@plan_id)`,
      params: { entity: REPAIR_ENTITY, plan_id: manifest.plan_id, label: 'Repair 22 Sep 2-3 sale subtotals from canonical net line totals', details, actor_id: actor.id as number, actor_name: actorName },
    },
    {
      sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,old_value,new_value)
            SELECT @actor_id,@actor_name,'repair_subtotal_usd','sale',@plan_id,@details,'sales',@plan_id,@old_value,@new_value
            WHERE NOT EXISTS(SELECT 1 FROM audit_logs WHERE action='repair_subtotal_usd' AND entity='sale' AND entity_id=@plan_id)`,
      params: { actor_id: actor.id as number, actor_name: actorName, plan_id: manifest.plan_id, details, old_value: JSON.stringify({ subtotal_usd: '0.0000', sale_count: 22 }), new_value: JSON.stringify({ subtotal_usd: EXPECTED_TOTAL_USD, sale_count: 22 }) },
    },
    assertion(applyFinal, common),
    { sql: 'DELETE FROM sale_bulk_guards', params: {} },
  ]
  return {
    planId: manifest.plan_id,
    manifestSha256: digest,
    saleCount: EXPECTED_IDS.length,
    statements,
    updateStartIndex: 2,
    historyStatementIndex: 2 + updates.length,
  }
}

function changed(result: unknown): number {
  const shaped = result as { changes?: number; meta?: { changes?: number } } | undefined
  return Number(shaped?.changes ?? shaped?.meta?.changes ?? 0)
}

export async function applyLegacySubtotalRepair(db: Pick<D1Compat, 'batch'>, plan: PreparedLegacySubtotalRepair): Promise<{ outcome: 'applied' | 'already_applied'; changedSales: number }> {
  try {
    const results = await db.batch(plan.statements)
    const changedSales = results.slice(plan.updateStartIndex, plan.updateStartIndex + plan.saleCount).reduce((sum, result) => sum + changed(result), 0)
    const historyInserted = changed(results[plan.historyStatementIndex])
    if (changedSales !== 0 && changedSales !== plan.saleCount) throw new Error('Unexpected partial guarded repair result')
    return { outcome: historyInserted === 1 ? 'applied' : 'already_applied', changedSales }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/CHECK constraint failed.*(?:sale_bulk_guards|guard_value\s*=\s*1)|sale_bulk_guards\.guard_value/i.test(message)) {
      throw new LegacySubtotalRepairConflictError()
    }
    throw error
  }
}

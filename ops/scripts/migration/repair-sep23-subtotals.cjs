#!/usr/bin/env node
'use strict'

/*
 * LOCAL PLAN GENERATOR ONLY.
 *
 * This module validates a freshly captured manifest for the 22 known Sep 2-3
 * zero-subtotal sales and emits prepared-statement payloads for the repository's
 * trusted D1Compat.batch() execution path. It has no database, network, Wrangler,
 * authentication, or apply capability.
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const SCHEMA_VERSION = 1
const REPAIR_ENTITY = 'sep23_subtotal_repair'
const RECOVERY_ENTITY = 'sep23_subtotal_repair_recovery'
const EXPECTED_IDS = Object.freeze(Array.from({ length: 22 }, (_, index) => 16842 + index))
const EXPECTED_DATES = Object.freeze(Object.fromEntries(EXPECTED_IDS.map((id) => [id, id <= 16858 ? '2026-09-03' : '2026-09-02'])))
const EXPECTED_BY_DATE = Object.freeze({
  '2026-09-02': Object.freeze({ subtotal_usd: '1992.0000', item_discount_usd: '5.0000' }),
  '2026-09-03': Object.freeze({ subtotal_usd: '1470.0000', item_discount_usd: '61.0000' }),
})
const EXPECTED_TOTAL_USD = '3462.0000'
const EXPECTED_ITEM_DISCOUNT_USD = '66.0000'

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
])

function fail(message) {
  throw new Error(`Subtotal repair manifest rejected: ${message}`)
}

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`)
  const keys = Object.keys(value)
  const missing = allowed.filter((key) => !keys.includes(key))
  const extra = keys.filter((key) => !allowed.includes(key))
  if (missing.length) fail(`${label} is missing ${missing.join(', ')}`)
  if (extra.length) fail(`${label} contains unsupported fields: ${extra.join(', ')}`)
}

function boundedText(value, label, maximum, { nullable = false } = {}) {
  if (nullable && value === null) return null
  if (typeof value !== 'string') fail(`${label} must be ${nullable ? 'a string or null' : 'a string'}`)
  if (!value.trim()) fail(`${label} must not be blank`)
  if (value.length > maximum) fail(`${label} exceeds ${maximum} characters`)
  return value
}

function decimal4(value, label) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/.test(value)) {
    fail(`${label} must be a bounded non-negative decimal string with at most four fractional digits`)
  }
  const [whole, fraction = ''] = value.split('.')
  return `${whole}.${fraction.padEnd(4, '0')}`
}

function scaled4(value) {
  const [whole, fraction] = value.split('.')
  return BigInt(whole) * 10000n + BigInt(fraction)
}

function sum4(values) {
  const total = values.reduce((sum, value) => sum + scaled4(value), 0n)
  return `${total / 10000n}.${String(total % 10000n).padStart(4, '0')}`
}

function same4(left, right) {
  return scaled4(left) === scaled4(right)
}

function nullableString(value, label, maximum) {
  if (value === null) return null
  if (typeof value !== 'string') fail(`${label} must be a string or null`)
  if (value.length > maximum) fail(`${label} exceeds ${maximum} characters`)
  return value
}

function normalizeSale(raw, index) {
  const label = `sales[${index}]`
  exactKeys(raw, SALE_KEYS, label)
  if (!Number.isSafeInteger(raw.id)) fail(`${label}.id must be a safe integer`)
  if (!EXPECTED_IDS.includes(raw.id)) fail(`${label}.id ${raw.id} is outside the exact 16842-16863 cohort`)
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?$/.test(String(raw.created_at))) {
    fail(`${label}.created_at must be an exact SQLite or ISO timestamp`)
  }
  if (raw.updated_at !== null && !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?$/.test(String(raw.updated_at))) {
    fail(`${label}.updated_at must be null or an exact SQLite or ISO timestamp`)
  }
  if (raw.business_date !== EXPECTED_DATES[raw.id]) fail(`${label}.business_date must be ${EXPECTED_DATES[raw.id]} for sale ${raw.id}`)
  if (!Number.isSafeInteger(raw.stock_skipped) || raw.stock_skipped !== 0) fail(`${label}.stock_skipped must be the exact observed value 0`)
  if (!Number.isSafeInteger(raw.item_count) || raw.item_count < 1) fail(`${label}.item_count must be a positive safe integer`)
  if (raw.expected_revision !== null && (!Number.isSafeInteger(raw.expected_revision) || raw.expected_revision < 0)) {
    fail(`${label}.expected_revision must be null for an absent revision row or a non-negative safe integer`)
  }
  const normalized = {
    ...raw,
    receipt_number: boundedText(raw.receipt_number, `${label}.receipt_number`, 160),
    created_at: String(raw.created_at),
    updated_at: raw.updated_at === null ? null : String(raw.updated_at),
    notes: nullableString(raw.notes, `${label}.notes`, 2000),
    sale_status: boundedText(raw.sale_status, `${label}.sale_status`, 40),
    payment_method: nullableString(raw.payment_method, `${label}.payment_method`, 200),
    payment_details: nullableString(raw.payment_details, `${label}.payment_details`, 20000),
  }
  for (const field of MONEY_FIELDS) normalized[field] = decimal4(raw[field], `${label}.${field}`)
  if (!same4(normalized.expected_subtotal_usd, '0.0000')) fail(`${label}.expected_subtotal_usd must be 0.0000`)
  if (!same4(normalized.target_subtotal_usd, normalized.item_total_usd)) fail(`${label}.target_subtotal_usd must equal its net item_total_usd`)
  if (!same4(normalized.target_subtotal_usd, normalized.total_usd)) fail(`${label}.target_subtotal_usd must equal total_usd for this no-header-discount/tax/delivery cohort`)
  if (!same4(normalized.total_usd, normalized.amount_paid_usd)) fail(`${label}.total_usd must equal amount_paid_usd`)
  for (const field of ['discount_usd', 'tax_usd', 'delivery_fee_usd']) {
    if (!same4(normalized[field], '0.0000')) fail(`${label}.${field} must be 0.0000`)
  }
  if (!same4(normalized.exchange_rate, '4100.0000')) fail(`${label}.exchange_rate must be the observed 4100.0000`)
  return normalized
}

function canonicalizeManifest(raw) {
  exactKeys(raw, MANIFEST_KEYS, 'manifest')
  if (raw.schema_version !== SCHEMA_VERSION) fail(`schema_version must be ${SCHEMA_VERSION}`)
  if (typeof raw.plan_id !== 'string' || !/^sep23-subtotal-[A-Za-z0-9_-]{8,80}$/.test(raw.plan_id)) {
    fail('plan_id must start with sep23-subtotal- and contain a stable 8-80 character suffix')
  }
  if (typeof raw.generated_at_utc !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw.generated_at_utc)) {
    fail('generated_at_utc must be an ISO UTC timestamp')
  }
  const operatorName = boundedText(raw.operator_name, 'operator_name', 120)
  const sourceNote = boundedText(raw.source_note, 'source_note', 2000)
  if (!Array.isArray(raw.sales) || raw.sales.length !== EXPECTED_IDS.length) fail(`sales must contain exactly ${EXPECTED_IDS.length} rows`)
  const sales = raw.sales.map(normalizeSale).sort((left, right) => left.id - right.id)
  const ids = sales.map((sale) => sale.id)
  if (new Set(ids).size !== EXPECTED_IDS.length || ids.some((id, index) => id !== EXPECTED_IDS[index])) {
    fail('sales must contain each id from 16842 through 16863 exactly once; 16827 is not in scope')
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
  return { schema_version: SCHEMA_VERSION, plan_id: raw.plan_id, generated_at_utc: raw.generated_at_utc, operator_name: operatorName, source_note: sourceNote, sales }
}

function manifestDigest(manifest) {
  return crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
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

function rowStatePredicate(phase) {
  const subtotal = phase === 'before' || phase === 'recovered' ? 'e.expected_subtotal_usd' : 'e.target_subtotal_usd'
  const revision = phase === 'before'
    ? `((e.expected_revision IS NULL AND NOT EXISTS(SELECT 1 FROM sale_write_revisions v WHERE v.sale_id=s.id)) OR (e.expected_revision IS NOT NULL AND EXISTS(SELECT 1 FROM sale_write_revisions v WHERE v.sale_id=s.id AND v.revision=CAST(e.expected_revision AS INTEGER))))`
    : `EXISTS(SELECT 1 FROM sale_write_revisions v WHERE v.sale_id=s.id AND v.revision=COALESCE(CAST(e.expected_revision AS INTEGER),0)+${phase === 'after' ? 1 : 2})`
  return [
    `printf('%.4f',COALESCE(s.subtotal_usd,0))=${subtotal}`,
    ...MONEY_GUARDS.map((pair) => { const [column, expected] = pair.split(':'); return `printf('%.4f',COALESCE(s.${column},0))=e.${expected}` }),
    `s.receipt_number IS e.receipt_number`, `s.created_at IS e.created_at`, `s.updated_at IS e.updated_at`,
    `date(datetime(s.created_at,'+7 hours'))=e.business_date`, `s.notes IS e.notes`,
    `COALESCE(s.sale_status,'completed')=e.sale_status`, `COALESCE(s.stock_skipped,0)=e.stock_skipped`,
    `s.payment_method IS e.payment_method`, `s.payment_details IS e.payment_details`, revision,
    `(SELECT COUNT(*) FROM sale_items si WHERE si.sale_id=s.id)=e.item_count`,
    `printf('%.4f',COALESCE((SELECT SUM(COALESCE(si.total_usd,0)) FROM sale_items si WHERE si.sale_id=s.id),0))=e.item_total_usd`,
    `printf('%.4f',COALESCE((SELECT SUM(COALESCE(si.total_khr,0)) FROM sale_items si WHERE si.sale_id=s.id),0))=e.item_total_khr`,
    `printf('%.4f',COALESCE((SELECT SUM(COALESCE(si.product_discount_usd,0)+COALESCE(si.manual_discount_usd,0)) FROM sale_items si WHERE si.sale_id=s.id),0))=e.item_discount_usd`,
    `printf('%.4f',COALESCE((SELECT SUM(COALESCE(si.product_discount_khr,0)+COALESCE(si.manual_discount_khr,0)) FROM sale_items si WHERE si.sale_id=s.id),0))=e.item_discount_khr`,
  ].join(' AND ')
}

function stateCount(phase) {
  return `(SELECT COUNT(*) FROM expected e JOIN sales s ON s.id=e.id WHERE ${rowStatePredicate(phase)})`
}

function historyCount(entity) {
  return `(SELECT COUNT(*) FROM action_history WHERE entity='${entity}' AND entity_id=@plan_id AND reversible=0 AND status='recorded' AND json_extract(redo_payload,'$.manifest_sha256')=@digest)`
}

function auditCount(action) {
  return `(SELECT COUNT(*) FROM audit_logs WHERE action='${action}' AND entity='sale' AND entity_id=@plan_id AND json_extract(details,'$.manifest_sha256')=@digest)`
}

function assertion(predicate, params) {
  return { sql: `INSERT INTO sale_bulk_guards(guard_value) ${EXPECTED_CTE} SELECT CASE WHEN (${predicate}) THEN 1 ELSE 0 END`, params }
}

function updateStatements(sales, direction) {
  return sales.map((sale) => {
    const from = direction === 'apply' ? sale.expected_subtotal_usd : sale.target_subtotal_usd
    const to = direction === 'apply' ? sale.target_subtotal_usd : sale.expected_subtotal_usd
    const revision = direction === 'apply' ? sale.expected_revision : (sale.expected_revision ?? 0) + 1
    const revisionGuard = direction === 'apply' && sale.expected_revision === null
      ? 'NOT EXISTS(SELECT 1 FROM sale_write_revisions WHERE sale_id=@id)'
      : 'EXISTS(SELECT 1 FROM sale_write_revisions WHERE sale_id=@id AND revision=@revision)'
    return {
      sql: `UPDATE sales SET subtotal_usd=CAST(@to AS NUMERIC) WHERE id=@id AND printf('%.4f',COALESCE(subtotal_usd,0))=@from AND ${revisionGuard}`,
      params: { id: sale.id, from, to, revision },
    }
  })
}

function inspectionSql() {
  return `${EXPECTED_CTE}
SELECT
  (SELECT COUNT(*) FROM expected) AS manifest_rows,
  ${stateCount('before')} AS exact_before_rows,
  ${stateCount('after')} AS exact_after_rows,
  ${stateCount('recovered')} AS exact_recovered_rows,
  (SELECT COUNT(*) FROM sales WHERE id BETWEEN 16842 AND 16863) AS database_cohort_rows,
  printf('%.4f',COALESCE((SELECT SUM(s.subtotal_usd) FROM sales s JOIN expected e ON e.id=s.id),0)) AS current_subtotal_usd,
  printf('%.4f',COALESCE((SELECT SUM(s.total_usd) FROM sales s JOIN expected e ON e.id=s.id),0)) AS current_total_usd,
  printf('%.4f',COALESCE((SELECT SUM(s.amount_paid_usd) FROM sales s JOIN expected e ON e.id=s.id),0)) AS current_paid_usd,
  printf('%.4f',COALESCE((SELECT SUM(COALESCE(si.product_discount_usd,0)+COALESCE(si.manual_discount_usd,0)) FROM sale_items si JOIN expected e ON e.id=si.sale_id),0)) AS current_item_discount_usd,
  ${historyCount(REPAIR_ENTITY)} AS apply_history_rows,
  ${auditCount('repair_subtotal_usd')} AS apply_audit_rows,
  ${historyCount(RECOVERY_ENTITY)} AS recovery_history_rows,
  ${auditCount('recover_subtotal_usd')} AS recovery_audit_rows`
}

function buildPayload(rawManifest) {
  const manifest = canonicalizeManifest(rawManifest)
  const digest = manifestDigest(manifest)
  const rows = JSON.stringify(manifest.sales)
  if (Buffer.byteLength(rows, 'utf8') > 512000) fail('canonical sales snapshot exceeds the 512000-byte plan bound')
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
  const applyHistory = historyCount(REPAIR_ENTITY)
  const applyAudit = auditCount('repair_subtotal_usd')
  const recoveryHistory = historyCount(RECOVERY_ENTITY)
  const recoveryAudit = auditCount('recover_subtotal_usd')
  const maintenanceGuard = `NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')`
  const applyEntry = `${maintenanceGuard} AND (((${applyHistory})=0 AND (${applyAudit})=0 AND ${stateCount('before')}=22) OR ((${applyHistory})=1 AND (${applyAudit})=1 AND ${stateCount('after')}=22))`
  const applyFinal = `${maintenanceGuard} AND ${stateCount('after')}=22 AND (${applyHistory})=1 AND (${applyAudit})=1`
  const recoveryEntry = `${maintenanceGuard} AND (${applyHistory})=1 AND (${applyAudit})=1 AND ((((${recoveryHistory})=0 AND (${recoveryAudit})=0 AND ${stateCount('after')}=22)) OR ((${recoveryHistory})=1 AND (${recoveryAudit})=1 AND ${stateCount('recovered')}=22))`
  const recoveryFinal = `${maintenanceGuard} AND ${stateCount('recovered')}=22 AND (${recoveryHistory})=1 AND (${recoveryAudit})=1`
  const applyStatements = [
    { sql: 'DELETE FROM sale_bulk_guards', params: {} },
    assertion(applyEntry, common),
    ...updateStatements(manifest.sales, 'apply'),
    {
      sql: `INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_name)
            SELECT 'global',@entity,@plan_id,@label,0,'recorded','{}',@details,@operator
            WHERE NOT EXISTS(SELECT 1 FROM action_history WHERE entity=@entity AND entity_id=@plan_id)`,
      params: { entity: REPAIR_ENTITY, plan_id: manifest.plan_id, label: 'Repair 22 Sep 2-3 sale subtotals from canonical net line totals', details, operator: manifest.operator_name },
    },
    {
      sql: `INSERT INTO audit_logs(user_name,action,entity,entity_id,details,table_name,record_id,old_value,new_value)
            SELECT @operator,'repair_subtotal_usd','sale',@plan_id,@details,'sales',@plan_id,@old_value,@new_value
            WHERE NOT EXISTS(SELECT 1 FROM audit_logs WHERE action='repair_subtotal_usd' AND entity='sale' AND entity_id=@plan_id)`,
      params: { operator: manifest.operator_name, plan_id: manifest.plan_id, details, old_value: JSON.stringify({ subtotal_usd: '0.0000', sale_count: 22 }), new_value: JSON.stringify({ subtotal_usd: EXPECTED_TOTAL_USD, sale_count: 22 }) },
    },
    assertion(applyFinal, common),
    { sql: 'DELETE FROM sale_bulk_guards', params: {} },
  ]
  const recoveryDetails = JSON.stringify({ ...JSON.parse(details), recovery_of: manifest.plan_id, before_subtotal_usd: EXPECTED_TOTAL_USD, after_subtotal_usd: '0.0000' })
  const recoveryStatements = [
    { sql: 'DELETE FROM sale_bulk_guards', params: {} },
    assertion(recoveryEntry, common),
    ...updateStatements(manifest.sales, 'recover'),
    {
      sql: `INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_name)
            SELECT 'global',@entity,@plan_id,@label,0,'recorded','{}',@details,@operator
            WHERE NOT EXISTS(SELECT 1 FROM action_history WHERE entity=@entity AND entity_id=@plan_id)`,
      params: { entity: RECOVERY_ENTITY, plan_id: manifest.plan_id, label: 'Recover 22 Sep 2-3 sale subtotals to captured pre-repair values', details: recoveryDetails, operator: manifest.operator_name },
    },
    {
      sql: `INSERT INTO audit_logs(user_name,action,entity,entity_id,details,table_name,record_id,old_value,new_value)
            SELECT @operator,'recover_subtotal_usd','sale',@plan_id,@details,'sales',@plan_id,@old_value,@new_value
            WHERE NOT EXISTS(SELECT 1 FROM audit_logs WHERE action='recover_subtotal_usd' AND entity='sale' AND entity_id=@plan_id)`,
      params: { operator: manifest.operator_name, plan_id: manifest.plan_id, details: recoveryDetails, old_value: JSON.stringify({ subtotal_usd: EXPECTED_TOTAL_USD, sale_count: 22 }), new_value: JSON.stringify({ subtotal_usd: '0.0000', sale_count: 22 }) },
    },
    assertion(recoveryFinal, common),
    { sql: 'DELETE FROM sale_bulk_guards', params: {} },
  ]
  return {
    schema_version: SCHEMA_VERSION,
    kind: REPAIR_ENTITY,
    plan_id: manifest.plan_id,
    manifest_sha256: digest,
    generated_at_utc: manifest.generated_at_utc,
    execution_contract: {
      mechanism: 'D1Compat.batch',
      atomicity: 'Submit exactly one complete statements array; any thrown statement error must roll back the whole array.',
      prohibited: ['BEGIN/COMMIT SQL', 'wrangler execution', 'remote API calls', 'splitting or retrying individual statements'],
    },
    expected: { sale_ids: EXPECTED_IDS, sale_count: 22, subtotal_usd: EXPECTED_TOTAL_USD, amount_paid_usd: EXPECTED_TOTAL_USD, item_discount_usd: EXPECTED_ITEM_DISCOUNT_USD },
    inspect: { sql: inspectionSql(), params: common },
    apply: { statements: applyStatements },
    recovery: { statements: recoveryStatements },
  }
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--manifest') args.manifest = argv[++index]
    else if (token === '--out') args.out = argv[++index]
    else if (token === '--validate-only') args.validateOnly = true
    else fail(`unknown argument ${token}`)
  }
  return args
}

function main(argv) {
  const args = parseArgs(argv)
  if (!args.manifest) fail('usage: node repair-sep23-subtotals.cjs --manifest <fresh.json> [--validate-only | --out <payload.json>]')
  if (!args.validateOnly && !args.out) fail('--out is required unless --validate-only is used')
  const manifestPath = path.resolve(args.manifest)
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const payload = buildPayload(raw)
  if (!args.validateOnly) {
    const outputPath = path.resolve(args.out)
    if (outputPath === manifestPath) fail('refusing to overwrite the input manifest')
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  }
  process.stdout.write(`${JSON.stringify({ valid: true, plan_id: payload.plan_id, manifest_sha256: payload.manifest_sha256, sale_count: payload.expected.sale_count, output: args.validateOnly ? null : path.resolve(args.out) }, null, 2)}\n`)
}

if (require.main === module) {
  try { main(process.argv.slice(2)) } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = {
  EXPECTED_BY_DATE,
  EXPECTED_IDS,
  EXPECTED_ITEM_DISCOUNT_USD,
  EXPECTED_TOTAL_USD,
  buildPayload,
  canonicalizeManifest,
  decimal4,
  manifestDigest,
  sum4,
}

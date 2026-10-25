#!/usr/bin/env node
// Fixture proof for the two health drill-down row lists (lane 6.0.943):
//   ops/queries/forensics-completed-short-rows.sql        -> health-sale-money.completed_short
//   ops/queries/forensics-catalog-mirror-drift-rows.sql   -> health-catalog-cost.active_mirror_drift
// Each runs exactly as the ops workflow runs it (the guard's canonical text) on a fresh node:sqlite database built from
// every migration. The health query runs on the SAME database, so "the list is the column's rows" is observed, not
// assumed, and every control row (one per branch of the predicate) must be absent. The fragments the list copies from the
// health query are extracted from the health query's own text, so editing either predicate alone turns this red.
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const { loadAll } = require('./harness/load_migrations.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const LIB = path.join(ROOT, 'cloudflare', 'src', 'lib')
const PERSONAL_COLUMN = /(^|_)(name|phone|address|email|note|notes)$/
const MAX_CANONICAL_CHARS = 12000
const SALE_LIST = 'forensics-completed-short-rows'
const CATALOG_LIST = 'forensics-catalog-mirror-drift-rows'
const EVENTS_LIST = 'forensics-payment-events-mismatch-rows'

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'health-drilldown-'))
const TEMPLATE = path.join(SCRATCH, 'migrated.sqlite')
const opened = []

let passed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
  } catch (err) {
    console.error(`FAIL ${name}\n  ${err && err.stack}`)
    process.exitCode = 1
  }
}

function buildTemplate() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = OFF;')
  for (const sql of loadAll()) db.exec(sql)
  db.exec(`VACUUM INTO '${TEMPLATE.replace(/'/g, "''")}'`)
  db.close()
}

function migratedDatabase() {
  const file = path.join(SCRATCH, `db-${opened.length + 1}.sqlite`)
  fs.copyFileSync(TEMPLATE, file)
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = OFF;')
  // Migration 0243 fences every stock-table write behind a permit row; fixtures seed through it. No query reads it.
  db.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
  opened.push(db)
  return db
}

function insert(db, table, rows) {
  for (const row of [].concat(rows)) {
    const columns = Object.keys(row)
    db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((c) => `@${c}`).join(', ')})`).run(row)
  }
}

function loadRealLib(fileName, loaded = new Map()) {
  const file = path.join(LIB, fileName)
  if (loaded.has(file)) return loaded.get(file).exports
  const mod = { exports: {} }
  loaded.set(file, mod)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText
  const requireLib = (request) => request.startsWith('./') ? loadRealLib(`${request.slice(2).replace(/\.ts$/, '')}.ts`, loaded) : require(request)
  new Function('require', 'module', 'exports', output)(requireLib, mod, mod.exports)
  return mod.exports
}

const squash = (sql) => sql.replace(/\s+/g, ' ').trim()

// Splits a select list at its top-level commas (parentheses and string literals respected).
function topLevelSplit(text) {
  const parts = []
  let depth = 0
  let quote = null
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (quote) { if (c === quote) quote = null; continue }
    if (c === "'") quote = c
    else if (c === '(') depth += 1
    else if (c === ')') depth -= 1
    else if (c === ',' && depth === 0) { parts.push(text.slice(start, i).trim()); start = i + 1 }
  }
  parts.push(text.slice(start).trim())
  return parts
}

async function main() {
  buildTemplate()
  const guard = await import(pathToFileURL(path.join(ROOT, 'ops', 'scripts', 'ops-sql-guard.mjs')).href)
  const sql = (name) => guard.loadQuery(name).sql
  const rowsOf = (db, name) => db.prepare(sql(name)).all().map((row) => ({ ...row }))
  const one = (db, name) => ({ ...db.prepare(sql(name)).get() })
  const pick = (row, keys) => Object.fromEntries(keys.map((key) => [key, row[key]]))
  const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} vs ${expected}`)

  await check('both lists pass the guard as bounded row lists, return no personal column, and run on the bare migrated schema', () => {
    const db = migratedDatabase()
    for (const name of [SALE_LIST, CATALOG_LIST, EVENTS_LIST]) {
      const query = guard.loadQuery(name)
      assert.equal(query.rules.minRows, 0, `${name}: min-rows`)
      assert.equal(query.rules.maxRows, 200, `${name}: max-rows`)
      assert.ok(/ LIMIT 201$/.test(query.sql), `${name}: the cap must be LIMIT 201 so a longer list trips max-rows instead of truncating`)
      assert.ok(query.sql.length <= MAX_CANONICAL_CHARS, `${name}: ${query.sql.length} canonical characters`)
      assert.doesNotMatch(query.sql, /json_object\(/i, `${name}: json_object`)
      const statement = db.prepare(query.sql)
      const columns = statement.columns().map((c) => c.name)
      assert.deepEqual(columns.filter((c) => PERSONAL_COLUMN.test(c)), [], `${name} returns a personal column`)
      assert.equal(new Set(columns).size, columns.length, `${name}: duplicate column names`)
      assert.deepEqual(statement.all(), [], `${name}: a bare schema has no offender`)
    }
  })

  await check('completed-short list: the health predicate and every column it reads are the health query\'s own text', () => {
    const health = sql('health-sale-money')
    const list = sql(SALE_LIST)
    const rr = /rr AS MATERIALIZED \((.*?)\), s AS MATERIALIZED \(/.exec(health)
    assert.ok(rr, 'health-sale-money lost its rr CTE')
    assert.ok(list.includes(`rr AS MATERIALIZED (${rr[1]})`), 'the list lost health-sale-money\'s rr (debt lowered by active customer returns)')
    const select = /s AS MATERIALIZED \( SELECT (.*?) FROM sales x LEFT JOIN li l ON l\.sale_id = x\.id LEFT JOIN rr r ON r\.sale_id = x\.id \)/.exec(health)
    assert.ok(select, 'health-sale-money lost its s CTE')
    const aliases = new Map()
    for (const part of topLevelSplit(select[1])) {
      const m = /^(.*) AS ([a-z_]+)$/s.exec(part)
      if (m) aliases.set(m[2], part)
    }
    // The count's WHERE is the text between its own "(SELECT COUNT(*) FROM s WHERE " and ") AS completed_short,".
    const end = health.indexOf(') AS completed_short,')
    const start = health.lastIndexOf('(SELECT COUNT(*) FROM s WHERE ', end)
    assert.ok(end > 0 && start >= 0, 'health-sale-money lost completed_short')
    const predicate = health.slice(start + '(SELECT COUNT(*) FROM s WHERE '.length, end)
    assert.ok(!predicate.includes('(SELECT'), 'the extracted predicate spans another column')
    assert.ok(list.includes(` FROM s WHERE ${predicate} ),`), 'the list does not select with the completed_short predicate')
    const used = [...new Set(predicate.match(/[a-z_]+/g))].filter((word) => aliases.has(word))
    assert.deepEqual(used.sort(), ['imported', 'lowered', 'paid_khr', 'paid_usd', 'pay', 'rate', 'total'], 'completed_short reads another column of s: the list must carry it too')
    for (const alias of used) assert.ok(list.includes(aliases.get(alias)), `the list's ${alias} differs from health-sale-money's: ${aliases.get(alias)}`)
  })

  await check('completed-short list: exactly the rows completed_short counts, controls absent, and each hypothesis has its field', () => {
    const { paymentCoversSaleTotal } = loadRealLib('saleStatusResolution.ts')
    const db = migratedDatabase()
    const v0 = (id, total, extra = {}) => ({ id, total_usd: total, subtotal_usd: total, exchange_rate: 4100, amount_paid_usd: total, created_at: '2026-10-01 18:30:00', ...extra })
    const v1 = (id, total, extra = {}) => ({ id, money_precision_version: 1, subtotal_usd: total, calculated_total_usd: total, rounding_adjustment_usd: 0,
      total_usd: total, total_khr: total * 4100, exchange_rate: 4100, amount_paid_usd: total, created_at: '2026-10-01T18:30:00.000Z', ...extra })
    const snapshot = (extra) => JSON.stringify({ version: 1, origin: 'pos', ...extra })
    insert(db, 'sales', [
      // offenders: one per writer or reading the list must expose
      v0(101, 10, { amount_paid_usd: 6 }),                                                                      // plain short, nothing else on it
      v0(102, 10, { amount_paid_usd: 6 }),                                                                      // H2: a pre-0260 return lowered the debt (refund_currency NULL)
      v0(103, 10, { amount_paid_usd: 6 }),                                                                      // H3: the return that lowered the debt was taken back
      v1(104, 8, { amount_paid_usd: 5, creation_snapshot_json: snapshot({ sale_status: 'completed', total_usd: 5, amount_paid_usd: 5, amount_paid_khr: 0 }) }), // H4: amended up
      v0(105, 10, { amount_paid_usd: 0 }),                                                                      // H5: un-cancelled
      v0(106, 10.00502, { amount_paid_usd: 10 }),                                                               // H1: 5 dp total, raw gap 0.00502, the Worker's 4 dp units call it covered
      v0(107, 10, { amount_paid_usd: 0, client_request_id: 'legacy-sale:20260901-100000' }),                    // legacy shape the import exclusion does not know
      v0(108, 10, { amount_paid_usd: 3, sale_status: 'returned', creation_snapshot_json: '{"origin":"Some Customer Name"}' }), // H7: retired label, no status_before_return
      v0(109, 10, { amount_paid_usd: 5, amount_paid_khr: 20000 }),                                              // a mixed tender
      v0(110, 10, { amount_paid_usd: 6 }),                                                                      // a SUPPLIER return never nets a sale
      // controls: each is one branch of the predicate and must stay out
      v0(201, 10), v0(202, 9.61, { amount_paid_usd: 0, amount_paid_khr: 39400 }),                                // paid; short of 1 riel only
      v0(203, 10, { amount_paid_usd: 6, sale_status: 'awaiting_payment' }), v0(204, 10, { amount_paid_usd: 6, sale_status: 'cancelled' }),
      v0(205, 10, { amount_paid_usd: 0, legacy_receipt_number: '000205@2026-01-01' }),                          // historical import
      v0(206, 10, { amount_paid_usd: 0, client_request_id: 'sales-import:job-1:7' }),                           // the sales import's own key
      v0(207, 10, { amount_paid_usd: 6, exchange_rate: 0 }),                                                    // no usable rate
      v0(208, 10, { amount_paid_usd: 6 }),                                                                      // short, but an active return lowered 4 of the debt
      v0(209, 10, { amount_paid_usd: 0, sale_status: 'partial_return', status_before_return: 'awaiting_payment' }), // reads Not Paid
      v0(210, 10, { amount_paid_usd: 6, amount_paid_khr: 1000, exchange_rate: -4100 }),                         // a negative rate would turn the riel tender into a debt
    ])
    const ret = (id, saleId, extra = {}) => ({ id, sale_id: saleId, return_scope: 'customer', status: 'completed', exchange_rate: 4100, total_refund_usd: 4, ...extra })
    insert(db, 'returns', [
      ret(1, 102), ret(2, 103, { refund_currency: 'USD', owed_reduction_usd: 4, status: 'cancelled' }),
      ret(3, 110, { refund_currency: 'USD', owed_reduction_usd: 4, return_scope: 'supplier' }),
      ret(4, 208, { refund_currency: 'USD', owed_reduction_usd: 4 }),
    ])
    insert(db, 'sale_amendments', { sale_id: 104, kind: 'line_added', total_before_usd: 5, total_after_usd: 8, created_at: '2026-10-02 03:00:00' })
    const receipt = (id, saleId, kind) => ({ id, actor_id: 1, sale_id: saleId, mutation_kind: kind, request_id: `r-${id}`, request_digest: 'd', request_json: '{}', before_json: '{}', after_json: '{}', response_json: '{}', sale_revision: 1 })
    insert(db, 'sale_mutation_receipts', [receipt('op-104', 104, 'add_items'), receipt('op-109', 109, 'settlement'), receipt('op-110', 110, 'amendment')])
    insert(db, 'sale_record_events', {
      id: '22222222-2222-4222-8222-222222222222', sale_id: 109, source_kind: 'sale_settlement', source_id: 'op-109', generation: 0, kind: 'payment_settled', via: 'apply',
      occurred_at: '2026-10-02T04:00:00.000Z', changes_json: '[{"field":"amount_paid_usd","before":{"state":"known_value","value":0},"after":{"state":"known_value","value":5}}]',
    })
    insert(db, 'sale_record_events', {
      id: '11111111-1111-4111-8111-111111111111', sale_id: 105, source_kind: 'sale_status', source_id: 'actor:1:request:x', generation: 0, kind: 'cancelled', via: 'apply',
      occurred_at: '2026-10-02T03:00:00.000Z',
      changes_json: '[{"field":"sale_status","before":{"state":"known_value","value":"cancelled"},"after":{"state":"known_value","value":"completed"}},{"field":"cancel_note","before":{"state":"known_value","value":"a customer note"},"after":{"state":"known_none"}}]',
    })
    insert(db, 'audit_logs', [
      { entity: 'sale', entity_id: '101', action: 'update', created_at: '2026-10-02 04:00:00' },
      { entity: 'sale', entity_id: '102', action: 'free text; with a note', created_at: '2026-10-02 04:00:00' },
      { entity: 'sale', entity_id: '1010', action: 'update', created_at: '2026-10-02 04:00:00' },
    ])
    const health = one(db, 'health-sale-money')
    const rows = rowsOf(db, SALE_LIST)
    assert.equal(rows.length, health.completed_short, 'the list is the column')
    assert.deepEqual(rows.map((r) => r.sale_id), [101, 102, 103, 104, 105, 106, 107, 108, 109, 110])
    const by = Object.fromEntries(rows.map((r) => [r.sale_id, r]))

    assert.deepEqual(pick(by[101], ['business_day', 'origin', 'request_kind', 'money_precision_version', 'tender_mix', 'covered_by_worker_rule', 'returns_active', 'amendments', 'uncancelled', 'audit_rows', 'last_audit_action']),
      { business_day: '2026-10-02', origin: 'none', request_kind: 'none', money_precision_version: 0, tender_mix: 'usd', covered_by_worker_rule: 0, returns_active: 0, amendments: 0, uncancelled: 0, audit_rows: 1, last_audit_action: 'update' },
      'a business day crosses midnight at UTC+7, and audit rows of sale 1010 are not sale 101\'s')
    // The sales write counter (sale_write_revisions): every sales insert or update bumps it, and an amendment row bumps it again.
    assert.ok(by[101].write_revision >= 1 && by[104].write_revision > by[101].write_revision, 'write_revision reads sale_write_revisions')
    near(by[101].gap_usd, 4, 'gap'); near(by[101].owed_usd, 10, 'owed'); near(by[101].tender_usd, 6, 'tender')
    assert.equal(by[102].last_audit_action, 'unrecognised', 'an action that is not a code token never leaves as text')
    assert.deepEqual(pick(by[102], ['returns_active', 'pre0260_refund_usd', 'lowered_usd']), { returns_active: 1, pre0260_refund_usd: 4, lowered_usd: 0 })
    near(by[102].gap_if_pre0260_netted, 0, 'H2 explains the gap')
    assert.deepEqual(pick(by[103], ['returns_active', 'returns_cancelled', 'cancelled_lowered_usd']), { returns_active: 0, returns_cancelled: 1, cancelled_lowered_usd: 4 })
    near(by[103].gap_if_cancelled_netted, 0, 'H3 explains the gap')
    assert.ok(by[101].gap_if_pre0260_netted > 3.99 && by[101].gap_if_cancelled_netted > 3.99, 'a plain short is explained by neither return hypothesis')
    assert.deepEqual(pick(by[104], ['origin', 'money_precision_version', 'created_status', 'created_total_usd', 'created_gap_usd', 'amendments', 'last_amendment_kind', 'first_amendment_total_before_usd', 'last_amendment_total_after_usd', 'add_items_receipts', 'amendment_receipts', 'settlement_receipts']),
      { origin: 'pos', money_precision_version: 1, created_status: 'completed', created_total_usd: 5, created_gap_usd: 0, amendments: 1, last_amendment_kind: 'line_added', first_amendment_total_before_usd: 5, last_amendment_total_after_usd: 8, add_items_receipts: 1, amendment_receipts: 0, settlement_receipts: 0 })
    near(by[104].gap_usd, 3, 'amended gap')
    assert.deepEqual(pick(by[105], ['uncancelled', 'last_event_kind', 'last_event_via', 'payment_events']), { uncancelled: 1, last_event_kind: 'cancelled', last_event_via: 'apply', payment_events: 0 })
    assert.deepEqual(pick(by[106], ['covered_by_worker_rule']), { covered_by_worker_rule: 1 }, 'H1: a raw 0.00502 gap the Worker calls paid')
    near(by[106].gap_usd, 0.00502, 'edge gap')
    assert.equal(by[101].covered_by_worker_rule, 0)
    assert.equal(by[107].request_kind, 'legacy-sale')
    assert.deepEqual(pick(by[108], ['sale_status', 'status_before_return', 'origin']), { sale_status: 'returned', status_before_return: null, origin: 'unrecognised' }, 'a snapshot origin that is not a code token never leaves as text')
    assert.deepEqual(pick(by[109], ['tender_mix', 'gap_khr', 'settlement_receipts', 'payment_events', 'last_event_kind', 'last_event_via', 'uncancelled']),
      { tender_mix: 'both', gap_khr: 500, settlement_receipts: 1, payment_events: 1, last_event_kind: 'payment_settled', last_event_via: 'apply', uncancelled: 0 }, 'a settlement shows in its receipt and its Sales Records event, and is not an un-cancel')
    assert.deepEqual(pick(by[110], ['amendment_receipts', 'add_items_receipts']), { amendment_receipts: 1, add_items_receipts: 0 })
    assert.deepEqual(pick(by[110], ['lowered_usd', 'returns_active']), { lowered_usd: 0, returns_active: 0 }, 'a supplier return nets nothing')
    for (const id of [201, 202, 203, 204, 205, 206, 207, 208, 209, 210]) assert.ok(!(id in by), `control sale ${id} must not be listed`)
    assert.equal(rows.length + 10, 20, 'every fixture sale is accounted for')

    // The SQL restatement of the Worker rule against the Worker's own function, on every offender it can be asked about.
    for (const row of rows) {
      if (row.lowered_usd !== 0) continue
      const worker = paymentCoversSaleTotal({ totalUsd: row.total_usd, paidUsd: row.paid_usd, paidKhr: row.paid_khr, exchangeRate: row.exchange_rate })
      assert.equal(row.covered_by_worker_rule, worker ? 1 : 0, `sale ${row.sale_id}`)
    }
  })

  await check('completed-short list: covered_by_worker_rule is paymentCoversSaleTotal across the half-cent edge, on USD and riel tenders', () => {
    const { paymentCoversSaleTotal } = loadRealLib('saleStatusResolution.ts')
    const db = migratedDatabase()
    let seed = 20261022
    const next = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    let covered = 0
    const sales = []
    for (let id = 1; id <= 300; id += 1) {
      const paidUsd = (100 + next(4000)) / 100
      const paidKhr = next(3) === 0 ? 100 * next(400) : 0
      // total = tender + half a cent + a sub-unit excess the raw float rule sees and the 4 dp units may drop
      const excess = (11 + next(1190)) / 10_000_000
      const total = Number((paidUsd + paidKhr / 4100 + 0.005 + excess).toFixed(7))
      sales.push({ id, total_usd: total, subtotal_usd: total, exchange_rate: 4100, amount_paid_usd: paidUsd, amount_paid_khr: paidKhr, created_at: '2026-10-03 03:00:00' })
    }
    insert(db, 'sales', sales)
    const rows = rowsOf(db, SALE_LIST)
    assert.equal(rows.length, 201, 'the list is capped at 201 rows (max-rows 200 then fails the check)')
    assert.ok(rows.length > guard.loadQuery(SALE_LIST).rules.maxRows, 'a list longer than max-rows is visible to the ops check')
    assert.equal(one(db, 'health-sale-money').completed_short, 300, 'the health column counts every one of the 300')
    const byId = new Map(sales.map((sale) => [sale.id, sale]))
    for (const row of rows) {
      const sale = byId.get(row.sale_id)
      const worker = paymentCoversSaleTotal({ totalUsd: sale.total_usd, paidUsd: sale.amount_paid_usd, paidKhr: sale.amount_paid_khr, exchangeRate: 4100 })
      if (worker) covered += 1
      assert.equal(row.covered_by_worker_rule, worker ? 1 : 0, `sale ${row.sale_id}: total ${sale.total_usd}, ${sale.amount_paid_usd} USD + ${sale.amount_paid_khr} KHR`)
    }
    assert.ok(covered > 40 && covered < 190, `${covered} of 201 covered: the tenders do not straddle the edge`)
  })

  await check('catalog list: the derive, the active filter and the mirror predicate are the health query\'s own text', () => {
    const { CATALOG_COST_DERIVE_SQL } = loadRealLib('catalogCostRecompute.ts')
    const health = sql('health-catalog-cost')
    const list = sql(CATALOG_LIST)
    const derived = /products\.purchase_price_khr, (COALESCE\(.*\)) AS derived FROM products WHERE products\.is_active = 1\s*\)/.exec(health)
    assert.ok(derived, 'health-catalog-cost lost its derived column')
    assert.equal(derived[1], squash(CATALOG_COST_DERIVE_SQL), 'the health derive is no longer CATALOG_COST_DERIVE_SQL')
    assert.ok(list.includes(`${derived[1]} AS derived,`), 'the list\'s derive is not health-catalog-cost\'s')
    const predicate = /\(SELECT COUNT\(\*\) FROM d WHERE (NOT \(cost_price_usd IS purchase_price_usd OR \(cost_price_usd IS NULL AND COALESCE\(purchase_price_usd, 0\) = 0\)\))\) AS active_mirror_drift,/.exec(health)
    assert.ok(predicate, 'health-catalog-cost lost active_mirror_drift')
    const qualified = predicate[1].replace(/\b(cost_price_usd|purchase_price_usd)\b/g, 'products.$1')
    assert.ok(list.includes(`FROM products WHERE products.is_active = 1 AND ${qualified} )`), 'the list does not select with the active_mirror_drift predicate over the active rows')
  })

  await check('catalog list: exactly the rows active_mirror_drift counts, controls absent, and each writer shape has its field', () => {
    const db = migratedDatabase()
    insert(db, 'branches', { id: 1, name: 'Store', is_default: 1 })
    insert(db, 'products', [
      { id: 1, name: 'Cost cleared', cost_price_usd: null, purchase_price_usd: 4 },
      { id: 2, name: 'Cost only', cost_price_usd: 5.5, purchase_price_usd: 0, created_at: '2026-10-01T18:30:00.000Z', client_request_id: 'import:job-9' },
      { id: 3, name: 'Cost cleared', cost_price_usd: 0, purchase_price_usd: 3 },
      { id: 4, name: 'Rounding', cost_price_usd: 4, purchase_price_usd: 4.00001 },
      { id: 5, name: 'Stale mirror', cost_price_usd: 4, purchase_price_usd: 6 },
      { id: 6, name: 'Mirror null', cost_price_usd: 2, purchase_price_usd: null },
      { id: 7, name: 'Derived', cost_price_usd: null, purchase_price_usd: 0 },
      { id: 8, name: 'Aligned', cost_price_usd: 7, purchase_price_usd: 7 },                             // controls
      { id: 9, name: 'Both unknown', cost_price_usd: null, purchase_price_usd: null },
      { id: 10, name: 'Inactive', cost_price_usd: 1, purchase_price_usd: 2, is_active: 0 },
      { id: 11, name: 'Lot cost', cost_price_usd: null, purchase_price_usd: 0 },
      { id: 12, name: 'Unknown cost', cost_price_usd: null, purchase_price_usd: 0 },                   // by policy: mirrorCostFields, the dated count insert
    ])
    insert(db, 'product_batches', [
      { id: 51, variant_product_id: 5, batch_key: 'k51', unit_cost_usd: 0, received_at: '2026-09-01' },
      { id: 71, variant_product_id: 7, batch_key: 'k71', unit_cost_usd: 12, received_at: '2026-09-02' },
      { id: 111, variant_product_id: 11, batch_key: 'k111', unit_cost_usd: 3, received_at: '2026-09-03' },
    ])
    insert(db, 'branch_batch_stock', [{ batch_id: 51, branch_id: 1, quantity: 1 }, { batch_id: 71, branch_id: 1, quantity: 2 }, { batch_id: 111, branch_id: 1, quantity: 2 }])
    // The 0195 triggers wrote both columns of products 7 and 11 from their lots; split product 7's mirror by hand, leave 11 aligned.
    assert.deepEqual(db.prepare('SELECT cost_price_usd, purchase_price_usd FROM products WHERE id IN (7, 11) ORDER BY id').all().map((r) => [r.cost_price_usd, r.purchase_price_usd]), [[12, 12], [3, 3]])
    db.exec('UPDATE products SET purchase_price_usd = 11 WHERE id = 7')
    insert(db, 'product_cost_entries', { id: 1, product_id: 2, cost_usd: 5.5, source: 'manual', baseline_batch_id: 0, created_at: '2026-10-02 03:00:00' })
    insert(db, 'audit_logs', [
      { entity: 'product', entity_id: '2', action: 'cost_override', created_at: '2026-10-02 03:00:00' },
      { entity: 'product', entity_id: '2', action: 'update', created_at: '2026-10-03 03:00:00' },
      { entity: 'product', entity_id: '20', action: 'update', created_at: '2026-10-04 03:00:00' },
    ])
    const health = one(db, 'health-catalog-cost')
    const rows = rowsOf(db, CATALOG_LIST)
    assert.equal(rows.length, health.active_mirror_drift, 'the list is the column')
    assert.deepEqual(rows.map((r) => r.product_id), [1, 2, 3, 4, 5, 6, 7])
    assert.deepEqual(rows.map((r) => r.drift_kind), ['cost_unknown_mirror_set', 'mirror_zero_cost_set', 'cost_zero_mirror_set', 'precision', 'both_set_differ', 'mirror_null', 'both_set_differ'])
    const by = Object.fromEntries(rows.map((r) => [r.product_id, r]))
    for (const id of [8, 9, 10, 11, 12]) assert.ok(!(id in by), `control product ${id} must not be listed`)

    assert.deepEqual(pick(by[1], ['cost_price_usd', 'purchase_price_usd', 'derived_cost_usd', 'cost_type', 'mirror_type', 'lots', 'cost_entries', 'request_kind']),
      { cost_price_usd: null, purchase_price_usd: 4, derived_cost_usd: null, cost_type: 'null', mirror_type: 'real', lots: 0, cost_entries: 0, request_kind: 'none' })
    assert.deepEqual(pick(by[2], ['derived_cost_usd', 'created_day', 'request_kind', 'cost_entries', 'last_entry_id', 'last_entry_cost_usd', 'last_entry_baseline_batch_id', 'last_entry_at', 'last_entry_matches_cost', 'last_entry_matches_mirror', 'last_audit_at', 'last_audit_action', 'last_cost_override_at']),
      { derived_cost_usd: null, created_day: '2026-10-02', request_kind: 'import', cost_entries: 1, last_entry_id: 1, last_entry_cost_usd: 5.5, last_entry_baseline_batch_id: 0, last_entry_at: '2026-10-02 03:00:00',
        last_entry_matches_cost: 1, last_entry_matches_mirror: 0, last_audit_at: '2026-10-03 03:00:00', last_audit_action: 'update', last_cost_override_at: '2026-10-02 03:00:00' },
      'a cost-only writer: the entry matches the cost, not the mirror; the audit rows of product 20 are not product 2\'s')
    assert.equal(by[1].last_entry_matches_cost, null, 'no entry, no match')
    near(by[3].diff_usd, -3, 'diff'); near(by[4].diff_usd, -0.00001, 'precision diff')
    assert.deepEqual(pick(by[5], ['lots', 'lots_active', 'lots_cost_positive', 'on_hand_qty', 'newest_lot_id', 'newest_lot_received_at', 'newest_lot_unit_cost_usd', 'derived_cost_usd']),
      { lots: 1, lots_active: 1, lots_cost_positive: 0, on_hand_qty: 1, newest_lot_id: 51, newest_lot_received_at: '2026-09-01', newest_lot_unit_cost_usd: 0, derived_cost_usd: null }, 'a lot with no recorded cost gives the formula nothing')
    assert.deepEqual(pick(by[7], ['cost_price_usd', 'purchase_price_usd', 'derived_cost_usd', 'lots_cost_positive', 'on_hand_qty']),
      { cost_price_usd: 12, purchase_price_usd: 11, derived_cost_usd: 12, lots_cost_positive: 1, on_hand_qty: 2 }, 'a split the formula could repair shows its figure')
    assert.equal(by[6].mirror_type, 'null')

    // A second count of the same query on the same database after one more offender and one fewer: the list follows the column.
    db.exec('UPDATE products SET purchase_price_usd = cost_price_usd WHERE id = 5')
    insert(db, 'products', { id: 13, name: 'New split', cost_price_usd: 1, purchase_price_usd: 0 })
    assert.deepEqual([rowsOf(db, CATALOG_LIST).length, one(db, 'health-catalog-cost').active_mirror_drift], [7, 7])
  })

  await check('no per-row lookup of either list scans a table beneath a correlated sub-query', () => {
    const db = migratedDatabase()
    const watched = new Set(['sale_amendments', 'sale_record_events', 'sale_mutation_receipts', 'sale_write_revisions', 'audit_logs', 'product_cost_entries', 'product_batches', 'branch_batch_stock', 'returns', 'sales', 'sale_items', 'products'])
    const correlatedScans = (text) => {
      const names = new Set(watched)
      for (const [, table, alias] of text.matchAll(/\b(?:FROM|JOIN) ([a-z_]+)(?: (?:AS )?([a-z_]+))?/gi)) {
        if (watched.has(table) && alias && !/^(WHERE|JOIN|LEFT|ON|GROUP|ORDER|UNION|CROSS|INNER|LIMIT|AS)$/i.test(alias)) names.add(alias)
      }
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${text}`).all()
      const byId = new Map(plan.map((row) => [row.id, row]))
      const underCorrelated = (row) => {
        for (let node = byId.get(row.parent); node; node = byId.get(node.parent)) if (/^CORRELATED /.test(node.detail)) return true
        return false
      }
      return plan.filter((row) => /^SCAN \w+$/.test(row.detail) && names.has(row.detail.slice(5)) && underCorrelated(row)).map((row) => row.detail)
    }
    assert.deepEqual(correlatedScans('SELECT (SELECT COUNT(*) FROM sale_amendments a WHERE a.amount_delta_usd = s.total_usd) FROM sales s'), ['SCAN a'], 'the detector sees an aliased correlated scan')
    for (const name of [SALE_LIST, CATALOG_LIST, EVENTS_LIST]) assert.deepEqual(correlatedScans(sql(name)), [], name)
  })

  await check('payment-events list: the health CTE and predicate are the health query own text, and the list is exactly the rows payment_events_mismatch counts', () => {
    const health = sql('health-sale-money')
    const list = sql(EVENTS_LIST)
    const pe = /(pe AS MATERIALIZED \(.*?\)) SELECT \(SELECT COUNT\(\*\) FROM s WHERE mpv = 1\)/.exec(health)
    assert.ok(pe, 'health-sale-money lost its pe CTE')
    assert.ok(list.includes(pe[1]), 'the list lost the pe CTE of health-sale-money (events in minus out per version 1 sale)')
    const end = health.indexOf(') AS payment_events_mismatch')
    const start = health.lastIndexOf('(SELECT COUNT(*) FROM pe WHERE ', end)
    assert.ok(end > 0 && start >= 0, 'health-sale-money lost payment_events_mismatch')
    const predicate = health.slice(start + '(SELECT COUNT(*) FROM pe WHERE '.length, end)
    assert.ok(list.includes(` FROM pe WHERE ${predicate} )`), 'the list does not select with the payment_events_mismatch predicate')

    const db = migratedDatabase()
    const sale = (id, extra = {}) => ({ id, total_usd: 5, subtotal_usd: 5, exchange_rate: 4100, amount_paid_usd: 5, legacy_receipt_number: `0000${id}@2026-01-01`, payments_version: 1, created_at: '2026-10-01 03:00:00', ...extra })
    insert(db, 'sales', [
      sale(1), sale(2), sale(3), sale(4, { amount_paid_usd: 0, amount_paid_khr: 40000 }), sale(5, { amount_paid_usd: 5, payments_version: 0 }), sale(6),
    ])
    const ev = (saleId, n, direction, usd, khr = 0, at = '2026-10-02 03:00:00') => ({ event_id: `e${saleId}-${n}`, sale_id: saleId, direction, origin: direction === 'out' ? 'undo' : 'collect',
      payment_method: 'Cash', payment_details: '[]', amount_paid_usd: usd, amount_paid_khr: khr, exchange_rate: 4100, received_at: at })
    insert(db, 'sale_payment_events', [
      ev(1, 1, 'in', 5),                                  // control: matches
      ev(2, 1, 'in', 5), ev(2, 2, 'out', 5, 0, '2026-10-03 04:00:00'), // undone: 0 against 5 paid, mismatch
      ev(3, 1, 'in', 2),                                  // 2 against 5 paid
      ev(4, 1, 'in', 0, 40000),                           // control: riel matches
      ev(5, 1, 'in', 9),                                  // control: a version 0 sale is not compared
    ])
    const rows = rowsOf(db, EVENTS_LIST)
    assert.equal(rows.length, one(db, 'health-sale-money').payment_events_mismatch, 'the list is the column')
    assert.deepEqual(rows.map((r) => r.sale_id), [2, 3, 6])
    const by = Object.fromEntries(rows.map((r) => [r.sale_id, r]))
    assert.deepEqual(pick(by[2], ['paid_usd', 'ev_usd', 'gap_usd', 'event_count', 'in_count', 'out_count', 'first_event_at', 'last_event_at', 'last_origin']),
      { paid_usd: 5, ev_usd: 0, gap_usd: 5, event_count: 2, in_count: 1, out_count: 1, first_event_at: '2026-10-02 03:00:00', last_event_at: '2026-10-03 04:00:00', last_origin: 'undo' })
    assert.deepEqual(pick(by[6], ['ev_usd', 'gap_usd', 'event_count', 'last_origin']), { ev_usd: 0, gap_usd: 5, event_count: 0, last_origin: null }, 'a paid version 1 sale with no event at all is listed')
    assert.deepEqual(pick(by[3], ['ev_usd', 'gap_usd']), { ev_usd: 2, gap_usd: 3 })
  })

  if (process.exitCode) console.error(`test-health-drilldown-rows-native: FAILED (${passed} passed)`)
  else console.log(`test-health-drilldown-rows-native: ${passed} checks passed`)
}

main().catch((err) => {
  console.error(`test-health-drilldown-rows-native: crashed: ${err && err.stack}`)
  process.exitCode = 1
}).finally(() => {
  for (const db of opened) db.close()
  fs.rmSync(SCRATCH, { recursive: true, force: true })
})

// Phase X (Part 395) -- the daily-report kernel: payment-method breakdown,
// per-contact delivery totals, and the single-day report assembly
// (lib/salesAnalytics.ts). Runs the COMPILED production module against the
// REAL sales schema (0001's CREATE TABLE sales + 0068's actual-cost ALTERs)
// in better-sqlite3 through a getDb-compatible shim, so the SQL that runs
// here is byte-identical to what D1 executes.
//
// Run: node scripts/test-sales-day-report-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const Database = require(path.join(cloudflareRoot, 'node_modules', 'better-sqlite3'))
let checks = 0
function ok(cond, label) {
  assert.ok(cond, label)
  checks += 1
  console.log(`PASS ${label}`)
}

// ---- compile the real kernel with a stubbed ./db + ../index ---------------
// The ONLY edits to the source are the two module-boundary lines (its db
// accessor and a type-only Env import) -- every query and calculation
// compiles verbatim, under the project's own strict settings.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-day-report-'))
const kernelSrc = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'salesAnalytics.ts'), 'utf8')
  .replace(
    "import { getDb } from './db'",
    [
      'type __TestStmt = { get<T = Record<string, unknown>>(params?: unknown): Promise<T | undefined>; all<T = Record<string, unknown>>(params?: unknown): Promise<T[]> }',
      'type __TestDb = { prepare(sql: string): __TestStmt }',
      'const getDb = (_env: unknown): __TestDb => (globalThis as { __testDb?: __TestDb }).__testDb as __TestDb',
    ].join('\n'),
  )
  .replace("import type { Env } from '../index'", 'type Env = unknown')
assert.ok(kernelSrc.includes('__testDb') && kernelSrc.includes('type Env = unknown'), 'both import shims applied')
fs.writeFileSync(path.join(tmpDir, 'salesAnalytics.ts'), kernelSrc)
// salesAnalytics.ts imports ./businessDateWindow (the UTC+7 helpers); copy that
// pure dependency in so the isolated strict compile resolves and emits it.
fs.writeFileSync(path.join(tmpDir, 'businessDateWindow.ts'), fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'businessDateWindow.ts'), 'utf8'))
const tscBin = path.join(cloudflareRoot, 'node_modules', 'typescript', 'bin', 'tsc')
execSync(`node ${tscBin} --module commonjs --target es2022 --strict --skipLibCheck --outDir ${tmpDir} ${path.join(tmpDir, 'salesAnalytics.ts')} ${path.join(tmpDir, 'businessDateWindow.ts')}`, { cwd: tmpDir, stdio: 'inherit' })

// ---- real schema ----------------------------------------------------------
const migrationSql = (file) => fs.readFileSync(path.join(cloudflareRoot, 'migrations', file), 'utf8')
const initSql = migrationSql('0001_init.sql')
function liftFrom(file, tableName) {
  const sql = file === '0001_init.sql' ? initSql : migrationSql(file)
  const start = sql.indexOf(`CREATE TABLE ${tableName} (`)
  assert.ok(start > 0, `${tableName} CREATE TABLE found in ${file}`)
  return sql.slice(start, sql.indexOf(';', start) + 1)
}
const lift = (tableName) => liftFrom('0001_init.sql', tableName)
const db = new Database(':memory:')
db.exec(lift('sales'))
db.exec(lift('sale_items'))
// getSalesTotals now LEFT JOINs a per-sale customer-refund subquery over the
// `returns` table (net-sales revenue is stated net of customer refunds). Provide
// the real returns schema so that SQL resolves; this suite seeds no returns, so
// refund_usd is 0 and the payment/delivery assertions below are unaffected.
db.exec(lift('returns'))
// getDeliveryContactTotals (fees lane) folds courier expense rows into the
// delivery report: real fees schema (0018) + the 0105 link column, plus the
// delivery_contacts table it joins for names. No fees are seeded here, so
// the delivery assertions below are unaffected.
db.exec(lift('delivery_contacts'))
db.exec(liftFrom('0018_fees.sql', 'fees'))
db.exec('ALTER TABLE fees ADD COLUMN delivery_contact_id INTEGER')
db.exec('ALTER TABLE sales ADD COLUMN delivery_actual_cost_usd REAL')
db.exec('ALTER TABLE sales ADD COLUMN delivery_actual_cost_khr REAL')

// getDb-compatible shim: named @params -> better-sqlite3 named binding.
const dbShim = {
  prepare(sql) {
    const stmt = db.prepare(sql.replace(/@(\w+)/g, ':$1'))
    return {
      get: async (params = {}) => stmt.get(params),
      all: async (params = {}) => stmt.all(params),
    }
  },
}
globalThis.__testDb = dbShim
const kernel = require(path.join(tmpDir, 'salesAnalytics.js'))

// ---- seed one day of sales ------------------------------------------------
const insertSale = db.prepare(`
  INSERT INTO sales (receipt_number, branch_id, payment_method, subtotal_usd, discount_usd, membership_discount_usd,
                     tax_usd, total_usd, is_delivery, delivery_contact_id, delivery_contact_name,
                     delivery_fee_usd, delivery_fee_paid_by, delivery_actual_cost_usd, sale_status, created_at)
  VALUES (@receipt, @branch, @method, @subtotal, @discount, @member, @tax, @total, @isDel, @contactId, @contactName,
          @fee, @paidBy, @actual, @status, @at)
`)
const D = '2026-08-28'
const seed = (row) => insertSale.run({
  receipt: row.receipt, branch: row.branch ?? 1, method: row.method ?? 'Cash',
  subtotal: row.subtotal ?? 10, discount: row.discount ?? 0, member: row.member ?? 0,
  tax: row.tax ?? 0, total: row.total ?? (row.subtotal ?? 10), isDel: row.isDel ?? 0,
  contactId: row.contactId ?? null, contactName: row.contactName ?? null,
  fee: row.fee ?? 0, paidBy: row.paidBy ?? 'customer', actual: row.actual ?? null,
  status: row.status ?? 'completed', at: row.at ?? `${D}T10:00:00.000Z`,
})

seed({ receipt: 'R1', method: 'Cash', subtotal: 10, total: 10 })
seed({ receipt: 'R2', method: 'ABA', subtotal: 30, discount: 5, total: 25, isDel: 1, contactId: 7, contactName: 'Grab', fee: 2, paidBy: 'customer', actual: 1.5 })
seed({ receipt: 'R3', method: 'aba ', subtotal: 20, member: 2, total: 18, isDel: 1, contactId: 7, contactName: 'Grab Cambodia', fee: 3, paidBy: 'store', actual: 2, at: `${D}T15:00:00.000Z` })
seed({ receipt: 'R4', method: '', subtotal: 8, total: 8, isDel: 1, contactId: null, contactName: 'ពូ​ ខុម', fee: 1, paidBy: 'customer' })
seed({ receipt: 'R5', method: 'Cash', subtotal: 99, total: 99, status: 'cancelled' })
seed({ receipt: 'R6', method: 'Cash', subtotal: 40, total: 40, branch: 2 })
seed({ receipt: 'R7', method: 'Cash', subtotal: 11, total: 11, at: '2026-08-27T09:00:00.000Z' })

const env = { DB: {} }

;(async () => {
  // ---- payment methods ----------------------------------------------------
  const methods = await kernel.getPaymentMethodBreakdown(env, { startDate: D, endDate: D })
  const byMethod = new Map(methods.map((m) => [m.payment_method, m]))
  ok(!byMethod.has('') && byMethod.has('Unknown') && byMethod.get('Unknown').tx_count === 1,
    'blank payment methods bucket as Unknown')
  ok(byMethod.get('ABA')?.tx_count === 1 && byMethod.get('aba')?.tx_count === 1,
    'method labels keep their stored spelling (trimmed), no silent case-merge')
  ok(byMethod.get('Cash').tx_count === 2 && !methods.some((m) => m.tx_count === 0),
    'cancelled and out-of-range sales are excluded')
  const aba = byMethod.get('ABA')
  // sales.total_usd already carries the customer-paid delivery fee (POS:
  // totalUsd = afterDisc + tax + customerFee; 4,398/4,398 delivery sales on
  // prod agree), so Collected is total_usd itself -- adding the fee again
  // double-counted every delivery sale until the fees lane fixed it.
  ok(aba.collected_usd === 25 && aba.total_usd === 25,
    'collected = total_usd; the customer-paid delivery fee is already inside total_usd, never added twice')
  const abaLower = byMethod.get('aba')
  ok(abaLower.collected_usd === 18, "store-paid delivery adds nothing to the customer's collected figure")

  // ---- delivery contacts --------------------------------------------------
  const couriers = await kernel.getDeliveryContactTotals(env, { startDate: D, endDate: D })
  ok(couriers.length === 2, 'two courier lines: id 7 (merged across rename) + the unlinked name bucket')
  const grab = couriers.find((r) => r.delivery_contact_id === 7)
  ok(grab.deliveries === 2 && grab.delivery_contact_name === 'Grab Cambodia',
    'same contact id merges across name snapshots; the LATEST snapshot names the line')
  ok(grab.charged_fee_usd === 2 && grab.absorbed_fee_usd === 3,
    'customer-paid vs store-absorbed fees split per courier')
  ok(grab.actual_cost_usd === 3.5 && grab.actual_cost_count === 2 && grab.margin_usd === -1.5,
    'actual courier cost sums; margin = charged - actual (can be negative)')
  const unlinked = couriers.find((r) => r.delivery_contact_id === null)
  ok(unlinked.delivery_contact_name === 'ពូ​ ខុម' && unlinked.deliveries === 1 && unlinked.actual_cost_count === 0,
    'unlinked deliveries keep their name snapshot; missing actual costs count as unrecorded, not zero-cost')

  const scoped = await kernel.getDeliveryContactTotals(env, { startDate: D, endDate: D, contactId: 7 })
  ok(scoped.length === 1 && scoped[0].delivery_contact_id === 7, 'contactId scopes the report to one courier')

  // ---- the assembled day report -------------------------------------------
  const report = await kernel.getSalesDayReport(env, D)
  ok(report.date === D && report.totals.tx_count === 5,
    'day report covers exactly the day (cancelled excluded, other days excluded)')
  ok(report.totals.gross_sales_usd === 108 && report.totals.discount_usd === 7,
    'totals come from the SAME shared kernel (gross 10+30+20+8+40, discounts 5+2)')
  ok(report.discounts.store_usd === 5 && report.discounts.membership_usd === 2
    && report.discounts.store_tx_count === 1 && report.discounts.membership_tx_count === 1,
    'discount block splits store vs membership with per-kind sale counts')
  ok(report.payment_methods.length === 4 && report.delivery_contacts.length === 2,
    'breakdowns ride along in one response')

  // Per-sale drill: one row per receipt in the same scope, and each row's
  // kernel-computed revenue SUMS to the day's revenue_usd -- the single-source
  // rule proven per row (never a raw receipt total that includes tax/delivery).
  const perSaleRevenue = report.sales.reduce((sum, s) => sum + s.revenue_usd, 0)
  ok(report.sales.length === 5
    && Math.abs(perSaleRevenue - report.totals.revenue_usd) < 1e-9
    && report.totals.revenue_usd === 101,
    'per-sale rows: one per receipt, revenue reconciles to the day total (101)')
  ok(report.sales.every((s) => s.receipt_number && typeof s.revenue_usd === 'number' && s.payment_method),
    'each per-sale row carries receipt number, payment method and a numeric revenue')

  const branch1 = await kernel.getSalesDayReport(env, D, { branchId: 1 })
  ok(branch1.totals.tx_count === 4 && branch1.totals.gross_sales_usd === 68,
    'branch filter applies to every block of the report')

  // ---- time-of-day window (viewer-local via tz offset) --------------------
  // Seeded UTC times: 10:00 (R1,R2,R4,R6) and 15:00 (R3). Phnom Penh
  // (+420 min) local: 17:00 and 22:00.
  const afternoon = await kernel.getSalesTotals(env, {
    startDate: D, endDate: D, startTime: '16:00', endTime: '18:00', tzOffsetMinutes: 420,
  })
  ok(afternoon.tx_count === 4, 'time window filters in LOCAL time (UTC 10:00 = 17:00 at +420)')
  const evening = await kernel.getSalesTotals(env, {
    startDate: D, endDate: D, startTime: '21:00', endTime: '23:00', tzOffsetMinutes: 420,
  })
  ok(evening.tx_count === 1 && evening.gross_sales_usd === 20, 'the 22:00-local sale sits alone in the evening window')
  const overnight = await kernel.getSalesTotals(env, {
    startDate: D, endDate: D, startTime: '21:00', endTime: '02:00', tzOffsetMinutes: 420,
  })
  ok(overnight.tx_count === 1, 'an overnight window (start > end) wraps around midnight')
  const noTime = await kernel.getSalesTotals(env, { startDate: D, endDate: D })
  ok(noTime.tx_count === 5, 'omitting the time window changes nothing for existing callers')
  const dayWithTime = await kernel.getSalesDayReport(env, D, { startTime: '16:00', endTime: '18:00', tzOffsetMinutes: 420 })
  ok(dayWithTime.totals.tx_count === 4 && dayWithTime.payment_methods.every((m) => m.payment_method !== 'aba'),
    'the day report threads the time window into every block (the 22:00 aba sale drops out)')

  // ---- X4: per-customer purchase totals -----------------------------------
  db.exec("UPDATE sales SET customer_id = 5 WHERE receipt_number IN ('R1', 'R2', 'R5', 'R7')")
  const customerDay = await kernel.getCustomerSalesTotals(env, { startDate: D, endDate: D, customerId: 5 })
  ok(customerDay.tx_count === 2 && customerDay.collected_usd === 35,
    'customer totals: cancelled excluded; collected = total_usd (10 + 25), delivery fee already inside total_usd')
  ok(customerDay.discount_usd === 5 && customerDay.membership_discount_usd === 0,
    'customer discount split rides along')
  const customerAll = await kernel.getCustomerSalesTotals(env, { startDate: '2026-08-27', endDate: D, customerId: 5 })
  ok(customerAll.tx_count === 3 && String(customerAll.first_sale_at).startsWith('2026-08-27')
    && String(customerAll.last_sale_at).startsWith(D),
    'range widens to earlier purchases; first/last stamps bracket the range')

  console.log(`\nAll ${checks} day-report kernel checks passed.`)
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

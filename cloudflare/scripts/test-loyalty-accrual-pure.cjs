// Loyalty accrual flag (migration 0061): a sale with loyalty_accrual = 0
// (historical import, POS opt-out) must never EARN points, while points
// REDEEMED on it stay spent. Balances are computed by summing sales, so this
// is enforced at every aggregation site — proven here against the REAL
// migration schema, the REAL route SQL, and the REAL summarizePoints source.
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8')

// ---- 1. Schema: column exists, defaults to 1 ----
const sqlite = new Database(':memory:')
for (const migration of loadAll()) sqlite.exec(migration)
sqlite.prepare(`INSERT INTO customers (id, name) VALUES (7, 'Dara')`).run()
const insertSale = sqlite.prepare(`
  INSERT INTO sales (receipt_number, customer_id, total_usd, total_khr, membership_points_redeemed, sale_status, loyalty_accrual)
  VALUES (@r, 7, @usd, @khr, @redeemed, 'completed', @accrual)
`)
insertSale.run({ r: 'R-1', usd: 10, khr: 41000, redeemed: 0, accrual: 1 })
insertSale.run({ r: 'R-2', usd: 90, khr: 369000, redeemed: 5, accrual: 0 }) // historical
sqlite.prepare(`INSERT INTO sales (receipt_number, customer_id, total_usd, total_khr, sale_status) VALUES ('R-3', 7, 2, 8200, 'completed')`).run()
const defaulted = sqlite.prepare(`SELECT loyalty_accrual FROM sales WHERE receipt_number = 'R-3'`).get()
assert.equal(defaulted.loyalty_accrual, 1, 'omitting the column must default to accruing (old writers unaffected)')

// ---- 2. The redemption-check aggregation SQL, taken from the route source ----
const salesRoute = read(path.join('routes', 'sales.ts'))
const aggMatch = salesRoute.match(/`(SELECT\s*\n\s*COALESCE\(SUM\(CASE WHEN[\s\S]*?FROM sales WHERE customer_id = \?)`/)
assert.ok(aggMatch, 'routes/sales.ts still contains the earned/redeemed aggregation')
const agg = sqlite.prepare(aggMatch[1]).get(7)
assert.equal(agg.earned_usd, 12, 'earned skips the accrual=0 sale ($10 + $2, not the $90 historical)')
assert.equal(agg.earned_khr, 49200, 'earned_khr skips the accrual=0 sale too')
assert.equal(agg.redeemed, 5, 'points redeemed on a non-accruing sale still count as spent')

// ---- 3. The notifications aggregation SQL, same treatment ----
const notifications = read(path.join('routes', 'notifications.ts'))
const notifMatch = notifications.match(/`\s*\n\s*(SELECT customer_id,\s*\n[\s\S]*?GROUP BY customer_id)\s*\n\s*`/)
assert.ok(notifMatch, 'routes/notifications.ts still contains the loyalty sales aggregation')
const notifRow = sqlite.prepare(notifMatch[1]).all().find((r) => r.customer_id === 7)
assert.equal(notifRow.sales_usd, 12, 'notifications earned skips the accrual=0 sale')
assert.equal(notifRow.redeemed, 5, 'notifications redeemed still counts the non-accruing sale')

// ---- 4. summarizePoints (REAL portal.ts source, extracted + transpiled) ----
const portal = read(path.join('routes', 'portal.ts'))
const calcStart = portal.indexOf('function calculatePointsValue')
const sumStart = portal.indexOf('export function summarizePoints')
assert.ok(calcStart > 0 && sumStart > calcStart, 'portal.ts still defines calculatePointsValue + summarizePoints')
const sumEnd = portal.indexOf('\n}', portal.indexOf('return {', sumStart)) + 2
const extracted = 'const toNumber = (v) => Number(v) || 0\n' + portal.slice(calcStart, sumEnd)
const output = ts.transpileModule(extracted, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const moduleObj = { exports: {} }
new Function('exports', 'require', 'module', output)(moduleObj.exports, require, moduleObj)
const { summarizePoints } = moduleObj.exports
const config = { pointsBasis: 'usd', pointsPerUsd: 1, pointsPerKhr: 0, redeemPoints: 100 }
const summary = summarizePoints([
  { sale_status: 'completed', total_usd: 10, total_khr: 41000, membership_points_redeemed: 0, loyalty_accrual: 1 },
  { sale_status: 'completed', total_usd: 90, total_khr: 369000, membership_points_redeemed: 5, loyalty_accrual: 0 },
  { sale_status: 'completed', total_usd: 2, total_khr: 8200, membership_points_redeemed: 0 }, // caller without the column
], [], [], config)
assert.equal(summary.earned, 12, 'summarizePoints earns only from accruing sales; absent column keeps the default')
assert.equal(summary.redeemed, 5, 'summarizePoints still counts redemption on a non-accruing sale')

// ---- 5. The two writers ----
const importCommit = read(path.join('lib', 'salesImportCommit.ts'))
assert.match(importCommit, /loyalty_accrual, sale_status, items/, 'import INSERT carries the column')
assert.match(importCommit, /loyalty_accrual: 0/, 'historical sales import always writes loyalty_accrual = 0')
assert.match(salesRoute, /loyalty_accrual: body\.loyalty_accrual === false \? 0 : 1/, 'POS route: only an explicit false opts out')
const contacts = read(path.join('routes', 'contacts.ts'))
assert.match(contacts, /COALESCE\(loyalty_accrual, 1\) AS loyalty_accrual/, 'contacts feeds the flag into summarizePoints')
const pos = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'pos', 'POS.tsx'), 'utf8')
assert.match(pos, /loyalty_accrual: active\.loyaltyAccrual !== false/, 'POS checkout sends the flag with on-by-default semantics')

console.log('test-loyalty-accrual-pure: all checks passed')

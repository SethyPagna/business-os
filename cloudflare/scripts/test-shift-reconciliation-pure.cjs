// N5. The ONE shift reconciliation: what should be in the drawer, per
// currency, and why the answer used to be wrong in two different places.
//
// This runs the REAL lib/shiftReconciliation.ts against a real SQLite
// database seeded with real column shapes -- no stubbed query builder, no
// hand-copied SQL. What it is guarding, and why each case discriminates:
//
//   1. REFUNDS AND COURIER PAYOUTS ARE SUBTRACTED. The old Telegram formula
//      was `opening + cash - expenses` and suppressed itself to a dash the
//      moment a refund or a delivery appeared in the window. Every fixture
//      below contains both, and the test asserts the answer is NOT the old
//      formula's answer -- an implementation that keeps the old arithmetic
//      fails on the number, not on a missing line.
//   2. THE TWO CURRENCIES NEVER MEET. The riel side of this fixture is driven
//      by a KHR-only expense and a KHR-only tender while the dollar side is
//      driven by USD-only ones, so any implementation that folds one into the
//      other (or applies an exchange rate) gets both totals wrong.
//   3. CASH IS A KIND, NOT A NAME. The old code was
//      `method === 'cash' || method === 'សាច់ប្រាក់'`, so renaming the method
//      through Settings' own /payment-methods/replace silently reported an
//      empty drawer. Renaming it to "Cash USD" must keep working; renaming it
//      to "Drawer" must raise a REVIEW CODE rather than report $0.00; and an
//      explicit kind map must make even that case correct.
//   4. A COURIER PAYOUT THAT IS ALSO A DELIVERY FEE IS SUBTRACTED ONCE. Both
//      currencies. The USD guard belongs to salesAnalytics (another lane owns
//      that file); the riel guard is mirrored here, and this case is what
//      stops the mirror drifting.
//   5. A NULL-BRANCH EXPENSE COUNTS (owner ruling), a wrong-branch one does
//      not, and the window stays half-open at both ends.
//
// Run (from cloudflare/): node scripts/test-shift-reconciliation-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')

const root = path.join(__dirname, '..')
function load(file, overrides = {}) {
  const filePath = path.join(root, 'src', file)
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const m = { exports: {} }
  new Function('require', 'module', 'exports', output)((name) => (name in overrides ? overrides[name] : require(name)), m, m.exports)
  return m.exports
}

const sql = new Database(':memory:')
sql.exec(`
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE sales(id INTEGER PRIMARY KEY, created_at TEXT, sale_status TEXT, branch_id INTEGER, cashier_id INTEGER,
 payment_method TEXT, payment_details TEXT, amount_paid_usd REAL DEFAULT 0, amount_paid_khr REAL DEFAULT 0,
 change_usd REAL, change_khr REAL, change_is_actual INTEGER, change_exchange_rate REAL,
 total_usd REAL DEFAULT 0, exchange_rate REAL DEFAULT 4100,
 delivery_actual_cost_usd REAL, delivery_actual_cost_khr REAL);
CREATE TABLE fees(id INTEGER PRIMARY KEY, created_at TEXT, branch_id INTEGER, sale_id INTEGER, fee_type TEXT,
 label TEXT, amount_usd REAL DEFAULT 0, amount_khr REAL DEFAULT 0, created_by INTEGER);
CREATE TABLE returns(id INTEGER PRIMARY KEY, created_at TEXT, branch_id INTEGER, cashier_id INTEGER,
 status TEXT DEFAULT 'completed', return_scope TEXT DEFAULT 'customer',
 total_refund_usd REAL DEFAULT 0, total_refund_khr REAL DEFAULT 0);

INSERT INTO settings VALUES('pos_payment_methods','["Cash","ABA"]');

-- The shift runs 02:00 -> 06:00 UTC. Everything below is deliberately placed
-- against those bounds, the branch, and the cashier.
INSERT INTO sales(id,created_at,sale_status,branch_id,cashier_id,payment_method,amount_paid_usd,amount_paid_khr,total_usd,exchange_rate,delivery_actual_cost_usd,delivery_actual_cost_khr) VALUES
 (1,'2026-09-06 02:00:00','completed',2,7,'Cash',40,0,40,4100,NULL,NULL),
 (2,'2026-09-06 03:00:00','completed',2,7,'ABA',25,0,25,4100,NULL,NULL),
 (3,'2026-09-06 03:30:00','completed',2,7,'Cash',0,82000,20,4100,NULL,NULL),
 (4,'2026-09-06 03:40:00','cancelled',2,7,'Cash',999,0,999,4100,NULL,NULL),
 (5,'2026-09-06 06:00:00','completed',2,7,'Cash',777,0,777,4100,NULL,NULL),
 (6,'2026-09-06 04:00:00','completed',2,7,'Cash',10,0,10,4100,3,4000),
 (7,'2026-09-06 04:30:00','completed',2,7,'Cash',8,0,8,4100,5,20000),
 (8,'2026-09-06 04:40:00','completed',3,7,'Cash',500,0,500,4100,NULL,NULL),
 (9,'2026-09-06 04:45:00','completed',2,8,'Cash',600,0,600,4100,NULL,NULL);

INSERT INTO fees(id,created_at,branch_id,sale_id,fee_type,label,amount_usd,amount_khr,created_by) VALUES
 (1,'2026-09-06 02:30:00',2,NULL,'expense','Ice',4,0,7),
 (2,'2026-09-06 03:00:00',NULL,NULL,'expense','Moto',0,20000,7),
 (3,'2026-09-06 03:00:00',3,NULL,'expense','Other branch',900,0,7),
 (4,'2026-09-06 04:30:00',2,7,'delivery','Grab',5,0,7),
 (5,'2026-09-06 03:00:00',2,NULL,'expense','Other employee',77,0,8),
 (6,'2026-09-06 06:00:00',2,NULL,'expense','At the closing second',66,0,7),
 (7,'2026-09-06 01:59:59',2,NULL,'expense','Before opening',55,0,7);

INSERT INTO returns(id,created_at,branch_id,cashier_id,status,return_scope,total_refund_usd,total_refund_khr) VALUES
 (1,'2026-09-06 03:15:00',2,7,'completed','customer',6,0),
 (2,'2026-09-06 03:20:00',2,7,'cancelled','customer',44,0),
 (3,'2026-09-06 03:25:00',2,7,'completed','supplier',33,0),
 (4,'2026-09-06 05:00:00',2,7,'completed','customer',0,10000),
 (5,'2026-09-06 05:10:00',2,8,'completed','customer',22,0),
 (6,'2026-09-06 06:00:00',2,7,'completed','customer',11,0);
`)

const db = {
  prepare(query) {
    const bind = (params = {}) => {
      const values = []
      const text = query.replace(/@(\w+)/g, (_, key) => { values.push(params[key] ?? null); return '?' })
      return { stmt: sql.prepare(text), values }
    }
    return {
      get(params) { const b = bind(params); return b.stmt.get(...b.values) },
      all(params) { const b = bind(params); return b.stmt.all(...b.values) },
      run(params) { const b = bind(params); return b.stmt.run(...b.values) },
    }
  },
}

const businessDateWindow = load('lib/businessDateWindow.ts')
const saleTotals = load('lib/saleTotals.ts')
const financialPrecision = load('lib/financialPrecision.ts')
const nativeSaleChange = load('lib/nativeSaleChange.ts', { './financialPrecision': financialPrecision, './saleTotals': saleTotals })
const salesAnalytics = load('lib/salesAnalytics.ts', { './db': { getDb: () => db }, './businessDateWindow': businessDateWindow })
const registry = load('lib/paymentMethodRegistry.ts')
const recon = load('lib/shiftReconciliation.ts', {
  './db': { getDb: () => db },
  './nativeSaleChange': nativeSaleChange,
  './salesAnalytics': salesAnalytics,
  './paymentMethodRegistry': registry,
})

const SHIFT = {
  scope_mode: 'per_account',
  user_id: 7,
  branch_id: 2,
  opened_at: '2026-09-06T02:00:00.000Z',
  closed_at: '2026-09-06T06:00:00.000Z',
  opening_float_usd: 50,
  opening_float_khr: 100_000,
  closing_counted_usd: 100,
  closing_counted_khr: 150_000,
}
const NOW = Date.parse('2026-09-06T08:00:00.000Z')

;(async () => {
  // --- 1. the components, each read from its own table ----------------------

  const cashConfigFor = async () => {
    const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('pos_payment_methods', 'pos_payment_method_kinds')").all({})
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]))
    return {
      kinds: registry.parsePaymentMethodKinds(values.pos_payment_method_kinds),
      configuredMethods: registry.parseConfiguredMethods(values.pos_payment_methods),
    }
  }
  const cash = await recon.shiftCashSales({}, SHIFT, NOW, await cashConfigFor())
  assert.deepEqual({ usd: cash.usd, khr: cash.khr }, { usd: 58, khr: 82_000 },
    'cash tender is the cash-kind tenders only: 40 + 10 + 8 and 82,000 riel, with ABA, the cancelled sale, the other branch, the other cashier and the sale at the exact closing second all out')
  assert.equal(cash.needsReview, false)

  const expenses = await recon.shiftExpenses({}, SHIFT, NOW)
  assert.deepEqual({ usd: expenses.usd, khr: expenses.khr }, { usd: 9, khr: 20_000 },
    'expenses are Ice ($4) + the delivery fee ($5) + a NULL-BRANCH moto fare (20,000 riel); the other branch, the other employee, the closing second and the second before opening are all out')
  assert.ok(expenses.details.some((row) => row.label === 'Moto'), 'the NULL-branch fee is itemised, not silently folded away')

  const refunds = await recon.shiftRefunds({}, SHIFT, NOW)
  assert.deepEqual(refunds, { usd: 6, khr: 10_000 },
    'refunds are the completed CUSTOMER returns issued in the window; cancelled, supplier-scope, another cashier and the closing second are out')

  const courier = await recon.shiftCourierPayouts({}, SHIFT, NOW)
  assert.deepEqual(courier, { usd: 3, khr: 4_000 },
    'courier payouts count sale 6 only -- sale 7 already has a delivery FEE row, so its $5/20,000 is not subtracted twice')

  // --- 2. the reconciliation, and the answer the old formula gave -----------

  const result = await recon.loadShiftReconciliation({}, SHIFT, NOW)
  assert.deepEqual(result.opening, { usd: 50, khr: 100_000 })
  assert.deepEqual(result.cash_sales, { usd: 58, khr: 82_000 })
  assert.deepEqual(result.refunds, { usd: 6, khr: 10_000 })
  assert.deepEqual(result.expenses, { usd: 9, khr: 20_000 })
  assert.deepEqual(result.courier, { usd: 3, khr: 4_000 })
  assert.deepEqual(result.expected, { usd: 90, khr: 148_000 })
  assert.deepEqual(result.counted, { usd: 100, khr: 150_000 })
  assert.deepEqual(result.difference, { usd: 10, khr: 2_000 })
  assert.equal(result.needs_review, false)
  assert.deepEqual(result.review_codes, [])

  // THE DISCRIMINATOR. `opening + cash - expenses` is what lib/telegram.ts
  // computed before this module existed. On this drawer it answers $99 and
  // 162,000 riel -- $9 and 14,000 riel of money that was handed back to
  // customers and couriers and is not in the till.
  const legacyUsd = 50 + 58 - 9
  const legacyKhr = 100_000 + 82_000 - 20_000
  assert.equal(legacyUsd, 99)
  assert.equal(legacyKhr, 162_000)
  assert.notEqual(result.expected.usd, legacyUsd, 'refunds and courier payouts are still missing from the dollar expectation')
  assert.notEqual(result.expected.khr, legacyKhr, 'refunds and courier payouts are still missing from the riel expectation')
  console.log('PASS components: cash, expenses (NULL branch included), refunds and courier payouts, each from its own table, half-open window, per-account scope')
  console.log('PASS arithmetic: expected = opening + cash - refunds - expenses - courier, per currency, and it is NOT the old opening+cash-expenses answer')

  // --- 3. the two currencies stay apart ------------------------------------
  // The dollar side moved by 58 - 6 - 9 - 3 = +40 and the riel side by
  // 82,000 - 10,000 - 20,000 - 4,000 = +48,000. Neither number is derivable
  // from the other at any exchange rate the fixture uses (4,100), so an
  // implementation that folded them would have to miss one.
  assert.equal(result.expected.usd - result.opening.usd, 40)
  assert.equal(result.expected.khr - result.opening.khr, 48_000)
  assert.notEqual(Math.round((result.expected.khr - result.opening.khr) / 4100), result.expected.usd - result.opening.usd)
  console.log('PASS native currencies: dollars and riel move independently; no exchange rate is applied anywhere')

  // --- 4. cash is a KIND, not a name ---------------------------------------

  const renameTo = (method, methods) => {
    sql.prepare("UPDATE sales SET payment_method=? WHERE payment_method IN ('Cash','Cash USD','Drawer')").run(method)
    sql.prepare("UPDATE settings SET value=? WHERE key='pos_payment_methods'").run(JSON.stringify(methods))
  }

  // "Cash" -> "Cash USD" is what Settings' own /payment-methods/replace does.
  // The old literal comparison reported an EMPTY drawer for this shop.
  renameTo('Cash USD', ['Cash USD', 'ABA'])
  const renamed = await recon.loadShiftReconciliation({}, SHIFT, NOW)
  assert.deepEqual(renamed.cash_sales, { usd: 58, khr: 82_000 }, 'a renamed cash method is still cash')
  assert.deepEqual(renamed.expected, { usd: 90, khr: 148_000 })
  assert.equal(renamed.needs_review, false)
  assert.equal(registry.resolvePaymentMethodKind('Cash USD'), 'cash')
  assert.equal(registry.resolvePaymentMethodKind('សាច់ប្រាក់ដុល្លារ'), 'cash')
  assert.equal(registry.resolvePaymentMethodKind('ABA Bank'), 'digital')

  // Renamed past recognition: the honest answer is a review flag, NOT a $0.00
  // expectation that reads as a stolen drawer.
  renameTo('Drawer', ['Drawer', 'ABA'])
  const unresolved = await recon.loadShiftReconciliation({}, SHIFT, NOW)
  assert.deepEqual(unresolved.cash_sales, { usd: 0, khr: 0 })
  assert.equal(unresolved.needs_review, true)
  assert.deepEqual(unresolved.review_codes, ['cash_method_unresolved'])

  // ...and the operator can pin it, after which the numbers are right again.
  sql.prepare("INSERT INTO settings(key,value) VALUES('pos_payment_method_kinds',?)").run(JSON.stringify({ Drawer: 'cash' }))
  const pinned = await recon.loadShiftReconciliation({}, SHIFT, NOW)
  assert.deepEqual(pinned.cash_sales, { usd: 58, khr: 82_000 })
  assert.deepEqual(pinned.expected, { usd: 90, khr: 148_000 })
  assert.equal(pinned.needs_review, false)
  sql.prepare("DELETE FROM settings WHERE key='pos_payment_method_kinds'").run()
  renameTo('Cash', ['Cash', 'ABA'])
  console.log('PASS method kind: a renamed cash method keeps working, an unrecognisable one raises a review code instead of an empty drawer, and an explicit kind map settles it')

  // --- 5. scope and open shifts --------------------------------------------

  const shopWide = await recon.loadShiftReconciliation({}, { ...SHIFT, scope_mode: 'shop_wide' }, NOW)
  assert.equal(shopWide.cash_sales.usd, 58 + 600, 'a shop-wide shift counts every cashier at the branch')
  assert.equal(shopWide.expenses.usd, 9 + 77, 'and every employee expense')

  const open = await recon.loadShiftReconciliation({}, {
    ...SHIFT, closed_at: null, closing_counted_usd: null, closing_counted_khr: null,
  }, NOW)
  assert.deepEqual(open.counted, { usd: null, khr: null })
  assert.deepEqual(open.difference, { usd: null, khr: null },
    'an open shift has no count, so it has no difference -- never a large negative that reads as a missing-cash alarm')
  assert.equal(open.expected.usd > 0, true, 'but it still has an expectation, reported up to now')
  console.log('PASS scope: shop-wide widens to the branch, and an open shift reports an expectation without inventing a count')

  // --- 6. the pure arithmetic on its own -----------------------------------

  const pure = recon.computeShiftReconciliation({
    opening: { usd: 10.25, khr: 100_000 },
    cashSales: { usd: 40, khr: 0 },
    refunds: { usd: 5, khr: 0 },
    expenses: { usd: 1.75, khr: 20_000 },
    courier: { usd: 2, khr: 0 },
    counted: { usd: 13.5, khr: 135_000 },
  })
  assert.deepEqual(pure.expected, { usd: 41.5, khr: 80_000 })
  assert.deepEqual(pure.difference, { usd: -28, khr: 55_000 })
  assert.equal(pure.needs_review, false)
  // Floating point must not leak into a money figure a cashier is asked to match.
  const cents = recon.computeShiftReconciliation({
    opening: { usd: 0.1, khr: 0 }, cashSales: { usd: 0.2, khr: 0 },
    refunds: null, expenses: null, courier: null, counted: { usd: 0.3, khr: null },
  })
  assert.equal(cents.expected.usd, 0.3)
  assert.equal(cents.difference.usd, 0)
  assert.equal(cents.difference.khr, null)
  // A missing component is zero, never NaN: an unreadable figure must not
  // erase the whole expectation.
  const messy = recon.computeShiftReconciliation({
    opening: { usd: Number.NaN, khr: 'x' }, cashSales: { usd: 5, khr: 1000 },
    refunds: undefined, expenses: undefined, courier: undefined, counted: { usd: 5, khr: 1000 },
    reviewCodes: ['tender_incomplete', 'tender_incomplete'],
  })
  assert.deepEqual(messy.expected, { usd: 5, khr: 1000 })
  assert.deepEqual(messy.difference, { usd: 0, khr: 0 })
  assert.deepEqual(messy.review_codes, ['tender_incomplete'], 'review codes are de-duplicated and sorted')
  assert.equal(messy.needs_review, true)
  console.log('PASS pure: cent-exact rounding, no NaN, de-duplicated review codes, and a null count yields a null difference')
})().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => sql.close())

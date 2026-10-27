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
//   6. A REFUND LEAVES THE DRAWER ONCE (SCAN1 M2). Returns are seeded the way
//      every live writer stores them: the dollar refund AND its riel
//      equivalent at the return's own rate (total_refund_khr =
//      multiplyMoney4(usd, rate)). The riel figure is the same money, so a
//      reconciliation that subtracts it as well reports a riel surplus on
//      every shift with a return.
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
 delivery_actual_cost_usd REAL, delivery_actual_cost_khr REAL, payments_version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE return_refund_corrections(id INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL UNIQUE, return_id INTEGER NOT NULL, sale_id INTEGER, branch_id INTEGER, kind TEXT NOT NULL DEFAULT 'edit', mode TEXT NOT NULL, counts_at TEXT NOT NULL, before_total_refund_usd REAL NOT NULL DEFAULT 0, before_total_refund_khr REAL NOT NULL DEFAULT 0, before_owed_reduction_usd REAL NOT NULL DEFAULT 0, before_refund_currency TEXT, after_total_refund_usd REAL NOT NULL DEFAULT 0, after_total_refund_khr REAL NOT NULL DEFAULT 0, after_owed_reduction_usd REAL NOT NULL DEFAULT 0, after_refund_currency TEXT, reverses_id INTEGER, actor_id INTEGER, actor_name TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE sale_payment_events(id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER NOT NULL, direction TEXT NOT NULL, origin TEXT NOT NULL,
 payment_method TEXT NOT NULL, payment_details TEXT NOT NULL, amount_paid_usd REAL NOT NULL DEFAULT 0, amount_paid_khr REAL NOT NULL DEFAULT 0,
 change_usd REAL NOT NULL DEFAULT 0, change_khr REAL NOT NULL DEFAULT 0, change_is_actual INTEGER NOT NULL DEFAULT 0, change_exchange_rate REAL,
 exchange_rate REAL NOT NULL, drawer_effect INTEGER NOT NULL DEFAULT 1, received_at TEXT NOT NULL, branch_id INTEGER, cashier_id INTEGER);
CREATE INDEX idx_sale_payment_events_received ON sale_payment_events(received_at, branch_id);
CREATE TABLE sale_write_revisions(sale_id INTEGER PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE fees(id INTEGER PRIMARY KEY, created_at TEXT, branch_id INTEGER, sale_id INTEGER, fee_type TEXT,
 label TEXT, amount_usd REAL DEFAULT 0, amount_khr REAL DEFAULT 0, created_by INTEGER);
CREATE TABLE returns(id INTEGER PRIMARY KEY, created_at TEXT, branch_id INTEGER, cashier_id INTEGER,
 status TEXT DEFAULT 'completed', return_scope TEXT DEFAULT 'customer',
 total_refund_usd REAL DEFAULT 0, total_refund_khr REAL DEFAULT 0, owed_reduction_usd REAL NOT NULL DEFAULT 0, refund_currency TEXT, exchange_rate REAL);

INSERT INTO settings VALUES('pos_payment_methods','["Cash","ABA"]');

-- The shift runs 02:00 -> 06:00 UTC. Everything below is deliberately placed
-- against those bounds, the branch, and the cashier.
INSERT INTO sales(id,created_at,sale_status,branch_id,cashier_id,payment_method,amount_paid_usd,amount_paid_khr,total_usd,exchange_rate,delivery_actual_cost_usd,delivery_actual_cost_khr) VALUES
 (1,'2026-09-06 02:00:00','completed',2,7,'Cash',40,0,40,4100,NULL,NULL),
 (2,'2026-09-06 03:00:00','completed',2,7,'ABA',25,0,25,4100,NULL,NULL),
 (3,'2026-09-06 03:30:00','completed',2,7,'Cash',0,82000,20,4100,NULL,NULL),
 (4,'2026-09-06 03:40:00','cancelled',2,7,'Cash',999,0,999,4100,NULL,NULL),
 (5,'2026-09-06 06:00:00','completed',2,7,'Cash',777,0,777,4100,NULL,NULL),
 (6,'2026-09-06 04:00:00','completed',2,7,'Cash',10,0,10,4100,3,12300),
 (7,'2026-09-06 04:30:00','completed',2,7,'Cash',8,0,8,4100,5,20500),
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
`)

const seen = []
const db = {
  prepare(query) {
    seen.push(query)
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
const moneyPrecision = load('lib/moneyPrecision.ts')

// Customer returns, stored the way routes/returns.ts stores them: the dollar
// refund plus its riel equivalent at the return's own rate, through the
// writer's own multiplyMoney4. Return 4 is at 4,000 so the twin is not a
// multiple of the 4,100 used elsewhere.
const insertReturn = sql.prepare(`INSERT INTO returns(id,created_at,branch_id,cashier_id,status,return_scope,
  total_refund_usd,total_refund_khr,exchange_rate) VALUES (?,?,?,?,?,?,?,?,?)`)
function pairedReturn(id, createdAt, branchId, cashierId, status, scope, usd, rate = 4100) {
  insertReturn.run(id, createdAt, branchId, cashierId, status, scope, usd, moneyPrecision.multiplyMoney4(usd, rate), rate)
}
pairedReturn(1, '2026-09-06 03:15:00', 2, 7, 'completed', 'customer', 6)
pairedReturn(2, '2026-09-06 03:20:00', 2, 7, 'cancelled', 'customer', 44)
pairedReturn(3, '2026-09-06 03:25:00', 2, 7, 'completed', 'supplier', 33)
pairedReturn(4, '2026-09-06 05:00:00', 2, 7, 'completed', 'customer', 2.5, 4000)
pairedReturn(5, '2026-09-06 05:10:00', 2, 8, 'completed', 'customer', 22)
pairedReturn(6, '2026-09-06 06:00:00', 2, 7, 'completed', 'customer', 11)
assert.deepEqual(sql.prepare('SELECT total_refund_khr AS khr FROM returns WHERE id IN (1,4) ORDER BY id').all().map((r) => r.khr), [24_600, 10_000],
  'the fixture carries the riel twin every live writer stores')
// A courier paid $1.50 on a delivery sale, stored the way routes/sales.ts stores
// it: the dollar cost and its riel twin at the sale's rate. The drawer holds
// $12 and 20,000 riel of cash sales; the payout left it in dollars once.
const insertPayoutSale = sql.prepare(`INSERT INTO sales(id,created_at,sale_status,branch_id,cashier_id,payment_method,
  amount_paid_usd,amount_paid_khr,total_usd,exchange_rate,delivery_actual_cost_usd,delivery_actual_cost_khr) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
insertPayoutSale.run(20, '2026-09-07 03:00:00', 'completed', 9, 11, 'Cash', 12, 0, 12, 4000, null, null)
insertPayoutSale.run(21, '2026-09-07 03:10:00', 'completed', 9, 11, 'Cash', 0, 20000, 5, 4000, null, null)
insertPayoutSale.run(22, '2026-09-07 03:20:00', 'completed', 9, 11, 'ABA', 9, 0, 9, 4000, 1.5, moneyPrecision.multiplyMoney4(1.5, 4000))
insertPayoutSale.run(23, '2026-09-07 03:30:00', 'completed', 9, 11, 'ABA', 0, 0, 4, 4000, null, 8000)
assert.equal(sql.prepare('SELECT delivery_actual_cost_khr AS khr FROM sales WHERE id = 22').get().khr, 6_000,
  'the fixture carries the riel twin the writer stores')
const reportMoneyPrecision = load('lib/reportMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const promotionRules = load('lib/promotionRules.ts', { './moneyPrecision': moneyPrecision })
const saleItemPricing = load('lib/saleItemPricing.ts', { './moneyPrecision': moneyPrecision, './promotionRules': promotionRules })
const saleMoneyPrecision = load('lib/saleMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const refundMoneyPrecision = load('lib/refundMoneyPrecision.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const customerReturnEntitlement = load('lib/customerReturnEntitlement.ts', { './moneyPrecision': moneyPrecision, './refundMoneyPrecision': refundMoneyPrecision, './saleItemPricing': saleItemPricing, './saleMoneyPrecision': saleMoneyPrecision })
const analyticsPrecision = { './saleMoneyPrecision': saleMoneyPrecision, './reportMoneyPrecision': reportMoneyPrecision, './customerReturnEntitlement': customerReturnEntitlement, './refundMoneyPrecision': refundMoneyPrecision }
const saleTotals = load('lib/saleTotals.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const financialPrecision = load('lib/financialPrecision.ts')
const nativeSaleChange = load('lib/nativeSaleChange.ts', { './financialPrecision': financialPrecision, './saleTotals': saleTotals })
const salesAnalytics = load('lib/salesAnalytics.ts', { './db': { getDb: () => db }, './removalLosses': load('lib/removalLosses.ts'), './schemaProbe': load('lib/schemaProbe.ts'), './businessDateWindow': businessDateWindow, ...analyticsPrecision })
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
  additional_cash_usd: 10,
  additional_cash_khr: 5_000,
  closing_counted_usd: 97.5,
  closing_counted_khr: 160_000,
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
  assert.deepEqual(refunds, { usd: 8.5, khr: 0 },
    'refunds are the completed CUSTOMER returns issued in the window ($6 + $2.50), each taken out ONCE in dollars -- their riel twins (24,600 + 10,000) are the same money; cancelled, supplier-scope, another cashier and the closing second are out')

  const courier = await recon.shiftCourierPayouts({}, SHIFT, NOW)
  assert.deepEqual(courier, { usd: 3, khr: 0 },
    'courier payouts count sale 6 only, in dollars: its 12,300 riel is the twin of the $3 the writer stores, not a second payout; sale 7 already has a delivery FEE row, so its $5 is not subtracted twice')

  // A payout reduces only the drawer currency it was paid in.
  const PAYOUT_SHIFT = {
    scope_mode: 'per_account', user_id: 11, branch_id: 9,
    opened_at: '2026-09-07T02:00:00.000Z', closed_at: '2026-09-07T06:00:00.000Z',
    opening_float_usd: 0, opening_float_khr: 0, additional_cash_usd: 0, additional_cash_khr: 0,
    closing_counted_usd: 10.5, closing_counted_khr: 20_000,
  }
  const payout = await recon.loadShiftReconciliation({}, PAYOUT_SHIFT, NOW)
  assert.deepEqual(payout.courier, { usd: 1.5, khr: 8_000 },
    'sale 22 counts $1.50 only (its 6,000 riel twin is the same money); sale 23 records 8,000 riel alone, an explicit riel payout')
  assert.deepEqual(payout.expected, { usd: 10.5, khr: 12_000 })
  sql.prepare('DELETE FROM sales WHERE id = 23').run()
  const dollarPayout = await recon.loadShiftReconciliation({}, PAYOUT_SHIFT, NOW)
  assert.deepEqual(dollarPayout.courier, { usd: 1.5, khr: 0 })
  assert.deepEqual(dollarPayout.expected, { usd: 10.5, khr: 20_000 })
  assert.deepEqual(dollarPayout.difference, { usd: 0, khr: 0 },
    'cash 12 USD + 20,000 riel, a $1.50 courier payout, counted 10.50 USD + 20,000 riel: nothing is missing')
  assert.equal(dollarPayout.needs_review, false)
  console.log('PASS courier payout: a dollar payout leaves the dollar drawer once, an explicit riel payout leaves the riel drawer, difference 0 / 0')

  // --- 2. the reconciliation, and the answer the old formula gave -----------

  const result = await recon.loadShiftReconciliation({}, SHIFT, NOW)
  assert.deepEqual(result.opening, { usd: 50, khr: 100_000 })
  assert.deepEqual(result.additional_cash, { usd: 10, khr: 5_000 })
  assert.deepEqual(result.cash_sales, { usd: 58, khr: 82_000 })
  assert.deepEqual(result.refunds, { usd: 8.5, khr: 0 })
  assert.deepEqual(result.expenses, { usd: 9, khr: 20_000 })
  assert.deepEqual(result.courier, { usd: 3, khr: 0 })
  assert.deepEqual(result.expected, { usd: 97.5, khr: 167_000 })
  assert.deepEqual(result.counted, { usd: 97.5, khr: 160_000 })
  // The drawer really is 7,000 riel short. Subtracting the refunds' riel
  // twins as well (34,600) turned that into a +31,600 riel SURPLUS: the
  // double subtraction does not just add noise, it hides a real shortage.
  assert.deepEqual(result.difference, { usd: 0, khr: -7_000 })
  assert.equal(result.needs_review, false)
  assert.deepEqual(result.review_codes, [])

  // THE DISCRIMINATOR. `opening + cash - expenses` is what lib/telegram.ts
  // computed before this module existed. On this drawer it answers $99 and
  // 162,000 riel -- ignoring the $8.50 of refunds and the courier payouts
  // that are not in the till, and the change added after opening.
  const legacyUsd = 50 + 58 - 9
  const legacyKhr = 100_000 + 82_000 - 20_000
  assert.equal(legacyUsd, 99)
  assert.equal(legacyKhr, 162_000)
  assert.notEqual(result.expected.usd, legacyUsd, 'refunds and courier payouts are still missing from the dollar expectation')
  assert.notEqual(result.expected.khr, legacyKhr, 'refunds and courier payouts are still missing from the riel expectation')
  console.log('PASS components: cash, expenses (NULL branch included), refunds and courier payouts, each from its own table, half-open window, per-account scope')
  console.log('PASS arithmetic: expected = opening + cash - refunds - expenses - courier, per currency, and it is NOT the old opening+cash-expenses answer')

  // --- 3. the two currencies stay apart ------------------------------------
  // The dollar side moved by 10 + 58 - 8.5 - 9 - 3 = +47.5 and the riel side
  // by 5,000 + 82,000 - 20,000 = +67,000. Neither number is
  // derivable from the other at either rate the fixture uses (4,100 or 4,000),
  // so an implementation that folded them would have to miss one.
  assert.equal(result.expected.usd - result.opening.usd, 47.5)
  assert.equal(result.expected.khr - result.opening.khr, 67_000)
  for (const rate of [4100, 4000]) {
    assert.notEqual((result.expected.khr - result.opening.khr) / rate, result.expected.usd - result.opening.usd, `riel / ${rate}`)
  }
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
  assert.deepEqual(renamed.expected, { usd: 97.5, khr: 167_000 })
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
  assert.deepEqual(pinned.expected, { usd: 97.5, khr: 167_000 })
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

  // A later settlement changes the sale's original window, never the later
  // drawer. This documents the current creation-time attribution invariant;
  // it deliberately does not invent a collection timestamp from an update.
  const laterShift = { ...SHIFT, opened_at: SHIFT.closed_at, closed_at: '2026-09-06T08:00:00.000Z' }
  sql.prepare(`INSERT INTO sales(id,created_at,sale_status,branch_id,cashier_id,payment_method,total_usd)
    VALUES (50,'2026-09-06 05:30:00','awaiting_payment',2,7,'Cash',17)`).run()
  const originalBeforeSettlement = await recon.loadShiftReconciliation({}, SHIFT, NOW)
  const laterBeforeSettlement = await recon.loadShiftReconciliation({}, laterShift, NOW)
  sql.prepare("UPDATE sales SET sale_status='completed',amount_paid_usd=17 WHERE id=50").run()
  const originalAfterSettlement = await recon.loadShiftReconciliation({}, SHIFT, NOW)
  const laterAfterSettlement = await recon.loadShiftReconciliation({}, laterShift, NOW)
  assert.equal(originalAfterSettlement.cash_sales.usd - originalBeforeSettlement.cash_sales.usd, 17)
  assert.deepEqual(laterAfterSettlement.cash_sales, laterBeforeSettlement.cash_sales)
  pairedReturn(50, '2026-09-06 07:00:00', 2, 7, 'completed', 'customer', 2)
  sql.prepare(`INSERT INTO fees(id,created_at,branch_id,created_by,fee_type,amount_usd)
    VALUES (50,'2026-09-06 07:00:00',2,7,'expense',3)`).run()
  const laterWithOutflows = await recon.loadShiftReconciliation({}, laterShift, NOW)
  assert.equal(laterWithOutflows.refunds.usd - laterAfterSettlement.refunds.usd, 2)
  assert.equal(laterWithOutflows.refunds.khr, 0, 'the later refund\'s riel twin is not a second payout')
  assert.equal(laterWithOutflows.expenses.usd - laterAfterSettlement.expenses.usd, 3)
  console.log('PASS attribution: later settlement stays with sale creation; returns and fees use their own recorded windows')

  // --- 5b. a refund leaves the drawer ONCE (SCAN1 M2) -----------------------
  // The finding's own scenario: open $50 / 0 riel, one $10 customer return at
  // 4,100 (stored 10 / 41,000), paid out in dollars, $40 / 0 riel counted.
  // The honest answer is "balanced". Subtracting the riel twin as well said
  // expected -41,000 riel and a +41,000 riel surplus on a drawer that holds no
  // riel at all.
  const refundShift = { ...SHIFT, user_id: 9, branch_id: 4, opened_at: '2026-09-07T02:00:00.000Z', closed_at: '2026-09-07T03:00:00.000Z',
    opening_float_usd: 50, opening_float_khr: 0, additional_cash_usd: 0, additional_cash_khr: 0,
    closing_counted_usd: 40, closing_counted_khr: 0 }
  pairedReturn(60, '2026-09-07 02:30:00', 4, 9, 'completed', 'customer', 10)
  const once = await recon.loadShiftReconciliation({}, refundShift, NOW)
  assert.deepEqual(once.refunds, { usd: 10, khr: 0 }, 'one $10 refund is $10 out of the drawer, not $10 and 41,000 riel')
  assert.deepEqual(once.expected, { usd: 40, khr: 0 })
  assert.deepEqual(once.difference, { usd: 0, khr: 0 }, 'a balanced drawer reads balanced -- no phantom riel surplus')
  console.log('PASS refund once: a return stored as USD + its riel twin is subtracted once, in dollars')

  // --- 6. the pure arithmetic on its own -----------------------------------

  const pure = recon.computeShiftReconciliation({
    opening: { usd: 10.25, khr: 100_000 },
    additionalCash: { usd: 3.5, khr: 5_000 },
    cashSales: { usd: 40, khr: 0 },
    refunds: { usd: 5, khr: 0 },
    expenses: { usd: 1.75, khr: 20_000 },
    courier: { usd: 2, khr: 0 },
    counted: { usd: 13.5, khr: 135_000 },
  })
  assert.deepEqual(pure.expected, { usd: 45, khr: 85_000 })
  assert.deepEqual(pure.difference, { usd: -31.5, khr: 50_000 })
  assert.equal(pure.needs_review, false)
  // Floating point must not leak into a money figure a cashier is asked to match.
  const cents = recon.computeShiftReconciliation({
    opening: { usd: 0.1, khr: 0 }, cashSales: { usd: 0.2, khr: 0 },
    refunds: null, expenses: null, courier: null, counted: { usd: 0.3, khr: null },
  })
  assert.equal(cents.expected.usd, 0.3)
  assert.equal(cents.difference.usd, 0)
  assert.equal(cents.difference.khr, null)
  const unknownOpening = recon.computeShiftReconciliation({
    opening: { usd: null, khr: 0 }, cashSales: { usd: 5, khr: 1000 },
    refunds: null, expenses: null, courier: null, counted: { usd: 5, khr: 1000 },
  })
  assert.deepEqual(unknownOpening.opening, { usd: null, khr: 0 })
  assert.deepEqual(unknownOpening.expected, { usd: null, khr: 1000 },
    'an unknown opening count cannot silently become a measured zero in expected cash')
  assert.deepEqual(unknownOpening.difference, { usd: null, khr: 0 })
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

  // --- 4. attribution by payments_version (lane 6.0.974, slice S3) ----------
  // Version 0 sales keep the created_at rule byte for byte; version 1 sales are read from their payment events by
  // received_at, so a collect taken in a later shift lands in that shift.
  const legacyShiftCashSales = async (shift, config) => {
    // The reader as it was before this lane: the window and branch of the shift over sales.created_at, nothing else.
    const { clauses, params } = salesAnalytics.shiftWindowWhere('sales', recon.shiftFilters(shift, NOW))
    if (shift.branch_id) { clauses.push('sales.branch_id = @branchId'); params.branchId = shift.branch_id }
    return recon.tenderWhere({}, clauses, params, config)
  }
  const config = await cashConfigFor()
  for (const shift of [SHIFT, PAYOUT_SHIFT, { ...SHIFT, scope_mode: 'shop_wide' }, { ...SHIFT, branch_id: null, user_id: 8 }]) {
    assert.deepEqual(await recon.shiftCashSales({}, shift, NOW, config), await legacyShiftCashSales(shift, config),
      'with no version 1 sale in the database the new reader answers exactly what the created_at reader answers, for every window, branch and scope')
  }
  const legacyTenders = async (shift) => {
    const { clauses, params } = salesAnalytics.shiftWindowWhere('sales', recon.shiftFilters(shift, NOW))
    if (shift.branch_id) { clauses.push('sales.branch_id = @branchId'); params.branchId = shift.branch_id }
    const rows = db.prepare(`SELECT id, payment_method, payment_details, amount_paid_usd, amount_paid_khr, change_usd, change_khr, change_is_actual,
      change_exchange_rate, sale_status, total_usd, exchange_rate FROM sales WHERE ${clauses.join(' AND ')} ORDER BY id`).all(params)
    return rows.map((row) => recon.shiftSaleTenderEntry(row, config))
  }
  assert.deepEqual(await recon.shiftSaleTenders({}, SHIFT, NOW, config), await legacyTenders(SHIFT), 'the per-sale fingerprint of version 0 sales is unchanged')
  assert.ok((await legacyTenders(SHIFT)).length >= 6, 'control: the fingerprint compared is not empty')
  console.log('PASS version 0: the drawer and the per-sale fingerprint equal the created_at reader for every shift shape')

  // Branch 5, cashiers 21 (rings the sales and opens shift A) and 22 (takes the later money, opens shift B).
  const SALE_V1 = 30
  const insertSale = sql.prepare(`INSERT INTO sales(id,created_at,sale_status,branch_id,cashier_id,payment_method,amount_paid_usd,amount_paid_khr,total_usd,exchange_rate,payments_version)
    VALUES (?,?,?,?,?,?,?,?,?,4000,?)`)
  const insertEvent = sql.prepare(`INSERT INTO sale_payment_events(sale_id,direction,origin,payment_method,payment_details,amount_paid_usd,amount_paid_khr,
    exchange_rate,drawer_effect,received_at,branch_id,cashier_id) VALUES (?,?,?,?,?,?,?,4000,?,?,?,?)`)
  const event = (saleId, direction, origin, method, usd, khr, receivedAt, cashierId, extra = {}) => insertEvent.run(saleId, direction, origin, method,
    JSON.stringify([{ method, amount_usd: usd, amount_khr: khr }]), usd, khr, extra.drawer ?? 1, receivedAt, extra.branch ?? 5, cashierId)
  const shiftOn = (day, userId, extra = {}) => ({ scope_mode: 'per_account', user_id: userId, branch_id: 5, opened_at: `2026-09-${day}T02:00:00.000Z`,
    closed_at: `2026-09-${day}T06:00:00.000Z`, opening_float_usd: 0, opening_float_khr: 0, ...extra })
  const A = shiftOn('08', 21)
  const B = shiftOn('09', 22)
  const C = shiftOn('10', 22)

  // Sale 30: $40 Not Paid sale rung in shift A with a $10 deposit, the other $30 collected in shift B.
  insertSale.run(SALE_V1, '2026-09-08 03:00:00', 'completed', 5, 21, 'Cash', 40, 0, 40, 1)
  event(SALE_V1, 'in', 'checkout', 'Cash', 10, 0, '2026-09-08 03:00:00', 21)
  event(SALE_V1, 'in', 'collect', 'Cash', 30, 0, '2026-09-09 04:00:00', 22)
  // Sale 31: v1, cancelled, its $5 was received in shift A. Sale 32: a v1 sale paid in ABA (digital), with 12,000 riel in cash.
  insertSale.run(31, '2026-09-08 03:10:00', 'cancelled', 5, 21, 'Cash', 5, 0, 5, 1)
  event(31, 'in', 'checkout', 'Cash', 5, 0, '2026-09-08 03:10:00', 21)
  insertSale.run(32, '2026-09-08 03:20:00', 'completed', 5, 21, 'ABA', 20, 12000, 23, 1)
  event(32, 'in', 'checkout', 'ABA', 20, 0, '2026-09-08 03:20:00', 21)
  event(32, 'in', 'collect', 'Cash', 0, 12000, '2026-09-08 03:30:00', 21)
  // Sale 33: a payment recorded late (drawer_effect 0) lands in no drawer; one received at the closing second of A is outside A.
  insertSale.run(33, '2026-09-08 03:40:00', 'completed', 5, 21, 'Cash', 7, 0, 7, 1)
  event(33, 'in', 'late_record', 'Cash', 3, 0, '2026-09-08 04:00:00', 21, { drawer: 0 })
  event(33, 'in', 'collect', 'Cash', 4, 0, '2026-09-08 06:00:00', 21)
  // Sale 34: the collect in shift B is undone in shift C: money back out.
  insertSale.run(34, '2026-09-08 03:50:00', 'awaiting_payment', 5, 21, 'Cash', 0, 0, 9, 1)
  event(34, 'in', 'collect', 'Cash', 9, 0, '2026-09-09 05:00:00', 22)
  event(34, 'out', 'undo', 'Cash', 9, 0, '2026-09-10 03:00:00', 22)
  // The same collect in another branch's drawer.
  event(SALE_V1, 'in', 'collect', 'Cash', 1000, 0, '2026-09-09 04:30:00', 22, { branch: 6 })

  const net = (cash) => [cash.usd, cash.khr, cash.digital.usd, cash.digital.khr]
  const shiftA = await recon.shiftCashSales({}, A, NOW, config)
  const shiftB = await recon.shiftCashSales({}, B, NOW, config)
  const shiftC = await recon.shiftCashSales({}, C, NOW, config)
  assert.deepEqual(net(shiftA), [10, 12000, 20, 0], 'shift A: the $10 deposit and the 12,000 riel collect (sale 32 ABA is digital); the cancelled sale, the late record and the closing-second collect are out')
  assert.deepEqual(net(shiftB), [39, 0, 0, 0], 'shift B: the $30 collect on sale 30 and the $9 on sale 34, in the shift that took them; the other branch is out')
  assert.deepEqual(net(shiftC), [-9, 0, 0, 0], 'shift C: the undo takes $9 back out, signed')
  assert.equal(shiftA.needsReview || shiftB.needsReview || shiftC.needsReview, false)

  // THE CONTROL. Attribution by created_at, the rule a revert would restore, puts all $40 in shift A and nothing in B,
  // which is a different answer on this very fixture.
  const createdAtRule = async (shift) => {
    const { clauses, params } = salesAnalytics.shiftWindowWhere('sales', recon.shiftFilters(shift, NOW))
    clauses.push('sales.branch_id = @branchId'); params.branchId = shift.branch_id
    return recon.tenderWhere({}, clauses, params, config)
  }
  assert.equal((await createdAtRule(A)).usd, 47, 'control: by created_at shift A would hold sale 30 whole ($40) and sale 33 ($7)')
  assert.equal((await createdAtRule(B)).usd, 0, 'control: by created_at shift B would hold nothing')
  assert.notDeepEqual(net(shiftB), net(await createdAtRule(B)))

  // Scope: a shop-wide shift of branch 5 sees both cashiers' money, a per-account shift only its own cashier's.
  const wide = await recon.shiftCashSales({}, { ...A, scope_mode: 'shop_wide', user_id: 99 }, NOW, config)
  assert.deepEqual(net(wide), net(shiftA), 'shop-wide scope reads the branch')
  assert.deepEqual(net(await recon.shiftCashSales({}, { ...A, user_id: 22 }, NOW, config)), [0, 0, 0, 0], 'cashier 22 took nothing in the A window')
  // v0 and v1 add up in one drawer: the fixture's own branch-2 shift and a v1 collect landing in it.
  event(SALE_V1, 'in', 'collect', 'Cash', 2, 0, '2026-09-06 03:00:00', 7, { branch: 2 })
  const v0Only = await legacyShiftCashSales(SHIFT, config)
  assert.ok(v0Only.usd > 0, 'control: the version 0 drawer is not empty')
  assert.deepEqual(net(await recon.shiftCashSales({}, SHIFT, NOW, config)), [v0Only.usd + 2, v0Only.khr, v0Only.digital.usd, v0Only.digital.khr], 'the version 1 collect ($2) adds to the version 0 cash of the same drawer')
  sql.prepare("DELETE FROM sale_payment_events WHERE branch_id = 2").run()
  console.log('PASS version 1: a later collect lands in the shift that took it, an undo is signed out, late records and cancelled sales are in no drawer, scope and branch hold; created_at control differs')

  // The per-sale fingerprint (shift close drift) reads the same events.
  const tendersB = await recon.shiftSaleTenders({}, B, NOW, config)
  assert.deepEqual(tendersB, [[SALE_V1, 30, 0, 0, 0], [34, 9, 0, 0, 0]], 'shift B fingerprint: one entry per version 1 sale that received money in B')
  const tendersA = await recon.shiftSaleTenders({}, A, NOW, config)
  assert.deepEqual(tendersA, [[SALE_V1, 10, 0, 0, 0], [31, 0, 0, 0, 0], [32, 0, 12000, 20, 0], [33, 0, 0, 0, 0], [34, 0, 0, 0, 0]],
    'shift A: every version 1 sale rung in A keeps its entry (E1): the cancelled sale and sale 34 (collected later) are zeros, sale 33 received nothing inside A')
  console.log('PASS version 1: the per-sale fingerprint follows received_at')

  // --- 5. review exceptions E1-E5 (lane 6.0.974) ------------------------------
  const salePayments = load('lib/salePayments.ts', { './financialPrecision': financialPrecision, './saleStatusResolution': load('lib/saleStatusResolution.ts', { './financialPrecision': financialPrecision }) })
  const openingInsert = sql.prepare(`INSERT INTO sale_payment_events(sale_id,direction,origin,payment_method,payment_details,amount_paid_usd,amount_paid_khr,change_usd,change_khr,
    change_is_actual,change_exchange_rate,exchange_rate,drawer_effect,received_at,branch_id,cashier_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  const insertRaw = sql.prepare(`INSERT INTO sales(id,created_at,sale_status,branch_id,cashier_id,payment_method,payment_details,amount_paid_usd,amount_paid_khr,total_usd,exchange_rate)
    VALUES (?,?,?,?,?,?,?,?,?,?,4000)`)
  const convert = (saleId) => {
    // What S4's first money write does to a version 0 sale: its opening event, then payments_version 1.
    const row = sql.prepare('SELECT * FROM sales WHERE id = ?').get(saleId)
    const opening = salePayments.buildOpeningPaymentEvent(row)
    if (opening) openingInsert.run(opening.sale_id, opening.direction, opening.origin, opening.payment_method, opening.payment_details, opening.amount_paid_usd, opening.amount_paid_khr,
      opening.change_usd, opening.change_khr, opening.change_is_actual, opening.change_exchange_rate, opening.exchange_rate, opening.drawer_effect, opening.received_at, opening.branch_id, opening.cashier_id)
    sql.prepare('UPDATE sales SET payments_version = 1 WHERE id = ?').run(saleId)
    return opening
  }
  const all = async (shift) => JSON.stringify([await recon.shiftCashSales({}, shift, NOW, config), await recon.shiftSaleTenders({}, shift, NOW, config)])
  const day = (d, userId, extra = {}) => ({ scope_mode: 'per_account', user_id: userId, branch_id: 7, opened_at: `2026-09-${d}T02:00:00.000Z`, closed_at: `2026-09-${d}T06:00:00.000Z`,
    opening_float_usd: 0, opening_float_khr: 0, ...extra })
  const D = day('14', 31)
  const D2 = day('15', 32)
  insertRaw.run(150, '2026-09-14 03:00:00', 'awaiting_payment', 7, 31, 'Cash', null, 0, 0, 20)             // Not Paid, nothing taken
  insertRaw.run(151, '2026-09-14 03:10:00', 'completed', 7, 31, 'Cash', null, 10, 0, 10)                   // a normal paid sale
  insertRaw.run(152, '2026-09-14 03:20:00', 'completed', 7, 31, 'Cash', '', 10, 0, 10)                     // payment_details is the empty string (E4)
  insertRaw.run(153, '2026-09-14 03:30:00', 'completed', 7, 31, 'Cash', '{bad json', 10, 0, 10)            // malformed details (E4)
  insertRaw.run(154, '2026-09-14 03:40:00', 'completed', 7, 31, '', null, 10, 0, 10)                       // no method name at all (E4)
  insertRaw.run(155, '2026-09-14 03:50:00', 'completed', 7, 31, 'ABA', '[{"method":"ABA","amount_usd":6,"amount_khr":0}]', 6, 0, 6)
  const beforeD = await all(D)
  const cashBefore = await recon.shiftCashSales({}, D, NOW, config)
  assert.deepEqual([cashBefore.usd, cashBefore.digital.usd], [10, 6], 'v0: only the valid cash sale (151) and the ABA sale count; the three unreadable ones count nothing')
  assert.equal(cashBefore.needsReview, true, 'v0 flags the unreadable tenders')
  const unreadableOpenings = [152, 153, 154].map(convert)
  assert.deepEqual(unreadableOpenings.map((e) => e.drawer_effect), [0, 0, 0])
  for (const id of [150, 151, 155]) convert(id)
  assert.deepEqual(await all(D), beforeD,
    'converting every sale to version 1 moves nothing in the closed shift: cash, review codes and the per-sale fingerprint are identical (E1 zero entry, E4 unreadable details)')
  assert.ok(JSON.parse(beforeD)[1].some((entry) => entry[0] === 150), 'control: the zero-deposit Not Paid sale is in the fingerprint')

  // The collect that finishes sale 50 in the next shift moves cash there and nothing in D.
  event(150, 'in', 'collect', 'Cash', 20, 0, '2026-09-15 04:00:00', 32, { branch: 7 })
  assert.deepEqual(await all(D), beforeD, 'a later collect does not touch the closed shift (no "Changed after close")')
  assert.deepEqual(net(await recon.shiftCashSales({}, D2, NOW, config)), [20, 0, 0, 0], 'it lands in the shift that took it')
  // The unconverted-fingerprint control: a reader that dropped version 1 sales created in the window would have lost entry 50.
  const withoutV1 = JSON.parse(beforeD)[1].filter((entry) => ![150, 151, 152, 153, 154, 155].includes(entry[0]))
  assert.notDeepEqual(withoutV1, JSON.parse(beforeD)[1])
  console.log('PASS E1/E4: converting v0 sales, empty/malformed/unnamed details included, and collecting later moves no closed shift')

  // E2: the close-time digest sees events.
  const digestOf = (shift) => { const d = recon.shiftCloseInputsDigestSql(shift, NOW); return db.prepare(`SELECT ${d.expr} AS digest`).get(d.params).digest }
  const E = day('16', 41, { branch_id: 8 })
  const d0 = digestOf(E)
  event(160, 'in', 'collect', 'Cash', 5, 0, '2026-09-16 05:00:00', 41, { branch: 8 })
  insertSale.run(160, '2026-09-01 03:00:00', 'awaiting_payment', 8, 41, 'Cash', 5, 0, 5, 1)
  const d1 = digestOf(E)
  assert.notEqual(d1, d0, 'a collect received inside the open shift changes the digest, so a close that read the figures before it is refused')
  event(161, 'in', 'collect', 'Cash', 5, 0, '2026-09-17 05:00:00', 41, { branch: 8 })
  event(162, 'in', 'collect', 'Cash', 5, 0, '2026-09-16 05:00:00', 41, { branch: 9 })
  insertSale.run(161, '2026-09-01 03:00:00', 'awaiting_payment', 8, 41, 'Cash', 5, 0, 5, 1)
  insertSale.run(162, '2026-09-01 03:00:00', 'awaiting_payment', 9, 41, 'Cash', 5, 0, 5, 1)
  assert.equal(digestOf(E), d1, 'control: an event outside the window or in another branch leaves the digest alone')
  sql.prepare('INSERT INTO sale_write_revisions(sale_id, revision) VALUES (160, 3)').run()
  assert.notEqual(digestOf(E), d1, 'a write to the sale behind an in-window event (a cancel) changes the digest too')
  console.log('PASS E2: the close-inputs digest covers payment events')

  // E3: the last money record of a shift counts events.
  const F = day('06', 151, { branch_id: 10 })
  assert.equal(await recon.shiftLastActivityMs({}, F, NOW), null, 'control: nothing in the branch')
  insertSale.run(170, '2026-09-01 03:00:00', 'awaiting_payment', 10, 151, 'Cash', 5, 0, 5, 1)
  event(170, 'in', 'late_record', 'Cash', 5, 0, '2026-09-06 03:00:00', 151, { branch: 10, drawer: 0 })
  assert.equal(await recon.shiftLastActivityMs({}, F, NOW), null, 'a late record is in no drawer, so it is not a drawer record')
  event(170, 'in', 'collect', 'Cash', 5, 0, '2026-09-06 04:00:00', 151, { branch: 10 })
  assert.equal(await recon.shiftLastActivityMs({}, F, NOW), Date.parse('2026-09-06T04:00:00Z'), 'a collect received in the window is the latest money record')
  console.log('PASS E3: the last-money-record check counts events')

  // E5: the events are read through the received_at index, with one scan of sales.
  const planOf = (queryText, params) => {
    const values = []
    const text = queryText.replace(/@(\w+)/g, (_, key) => { values.push(params[key] ?? null); return '?' })
    return sql.prepare(`EXPLAIN QUERY PLAN ${text}`).all(...values).map((row) => row.detail)
  }
  for (const analyzed of [false, true]) {
    if (analyzed) sql.exec('ANALYZE')
    seen.length = 0
    await recon.shiftCashSales({}, A, NOW, config)
    const eventQuery = seen.find((text) => text.includes('FROM sale_payment_events e'))
    assert.ok(eventQuery, 'the event query ran')
    const window = shiftOn('08', 21)
    const plan = planOf(eventQuery, { createdFrom: '2026-09-08 02:00:00', createdTo: '2026-09-08 06:00:00', cashierId: 21, branchId: 5 })
    assert.ok(plan.some((line) => /SEARCH e USING (COVERING )?INDEX idx_sale_payment_events_received/.test(line)), `${analyzed ? 'after ANALYZE ' : ''}events use the received_at index: ${plan.join(' | ')}`)
    assert.ok(!plan.some((line) => /^SCAN (sales|e)\b/.test(line)), `no table scan: ${plan.join(' | ')}`)
    assert.ok(window)
  }
  seen.length = 0
  await recon.shiftSaleTenders({}, A, NOW, config)
  assert.equal(seen.filter((text) => /FROM sales WHERE/.test(text)).length, 1, 'the fingerprint scans sales once')
  console.log('PASS E5: events are read through idx_sale_payment_events_received, sales is scanned once')
})().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => sql.close())

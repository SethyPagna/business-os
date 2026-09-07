// N38. THE SHIFT REPORT'S MONEY FIGURES -- and the expense split that has to
// foot against the drawer.
//
// Owner ruling, Sep 6 2026: "the registration is just a more detailed
// breakdown for shift to keep track how much is spent ... and the actual
// calculations is without this ... just the COGS, profit, sales, expenses,
// delivery etc.", and "for reports of shift, you didn't mention the registered
// cash dollar and khr in open vs end. it should".
//
// So the report carries two halves that must not contaminate each other: the
// REGISTRATION (opening float and closing count, per currency, open vs end)
// and the BUSINESS FIGURES (sales, COGS, profit, delivery, expenses). This
// drives the real lib/shiftReconciliation.ts over a real SQLite database and
// pins:
//
//   1. THE EXPENSE SPLIT IS A PARTITION, NOT TWO GUESSES. A delivery courier
//      can be paid in two different places -- `sales.delivery_actual_cost_*`
//      and a `fees` row typed 'delivery' -- and the fixture below contains
//      BOTH, on two different sales, in two different currencies. The two
//      obvious wrong implementations are:
//        (a) "other expenses = every fee" (what the Telegram figures do), which
//            reports the $5 Grab fee as an other-expense AND inside delivery
//            cost, so the halves sum to $17 against a $12 drawer outflow; and
//        (b) "delivery cost = courier payouts only", which reports $3 and hides
//            the $5 that was recorded as a fee.
//      Case 1 asserts each half by value AND asserts the invariant
//      delivery_cost + other_expenses == expenses + courier, per currency, so
//      neither wrong answer can pass.
//   2. THE REGISTRATION TRAVELS WITH THE REPORT. opening and closing, both
//      currencies, and an UNCOUNTED drawer stays null rather than becoming a
//      zero nobody counted.
//   3. NO FIGURE MOVES WHEN THE COUNT MOVES. The same window is priced with a
//      $100 count, a $9,999 count and no count at all: sales, COGS, profit,
//      delivery and expenses are identical in all three. That is what
//      "report-only" means, executed rather than asserted in prose.
//   4. CREDIT IS A POSITIVE NOTE. It is carried through as an amount owed and
//      is never subtracted from anything; a negative kernel figure (a data
//      defect) is floored at 0 rather than printed as negative money owed.
//
// The sales KERNEL is stubbed: getSalesTotals belongs to another lane and has
// its own suite, so what is proved here is this module's own arithmetic, the
// SQL for the fee split, and that the kernel is called with the shift's own
// window. Everything else -- fees, courier payouts, the window bounds, the
// per-account scope -- is the real query against real rows.
//
// Run (from cloudflare/): node scripts/test-shift-figures-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const Database = require(path.join(root, 'node_modules', 'better-sqlite3'))

function load(file, overrides = {}) {
  const filePath = path.join(root, 'src', file)
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const m = { exports: {} }
  new Function('require', 'module', 'exports', output)((name) => (name in overrides ? overrides[name] : require(name)), m, m.exports)
  return m.exports
}

let checks = 0
function ok(label) { checks += 1; console.log(`PASS ${label}`) }

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

-- The shift runs 02:00 -> 06:00 UTC, branch 2, cashier 7.
-- Sale 6 paid a courier directly and has NO fee row  -> a courier payout.
-- Sale 7 paid a courier AND has a 'delivery' fee row -> counted once, as a fee.
INSERT INTO sales(id,created_at,sale_status,branch_id,cashier_id,payment_method,amount_paid_usd,amount_paid_khr,total_usd,exchange_rate,delivery_actual_cost_usd,delivery_actual_cost_khr) VALUES
 (1,'2026-09-06 02:00:00','completed',2,7,'Cash',40,0,40,4100,NULL,NULL),
 (6,'2026-09-06 04:00:00','completed',2,7,'Cash',10,0,10,4100,3,4000),
 (7,'2026-09-06 04:30:00','completed',2,7,'Cash',8,0,8,4100,5,20000);

INSERT INTO fees(id,created_at,branch_id,sale_id,fee_type,label,amount_usd,amount_khr,created_by) VALUES
 (1,'2026-09-06 02:30:00',2,NULL,'expense','Ice',4,0,7),
 (2,'2026-09-06 03:00:00',NULL,NULL,'expense','Moto',0,20000,7),
 (3,'2026-09-06 03:00:00',3,NULL,'expense','Other branch',900,0,7),
 (4,'2026-09-06 04:30:00',2,7,'delivery','Grab',5,0,7),
 (8,'2026-09-06 04:35:00',2,NULL,'delivery','Courier riel',0,12000,7),
 (9,'2026-09-06 01:59:59',2,NULL,'delivery','Before opening',88,88000,7);
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

// The kernel, recorded rather than re-implemented. `seen` captures the filters
// it was handed, so "priced over the shift's own window" is asserted, not
// assumed.
const seen = []
const KERNEL = {
  revenue_usd: 312.5, cost_usd: 190.25, profit_usd: 122.25,
  delivery_usd: 14, pending_revenue_usd: 47.5, refund_usd: 8.75,
}
const businessDateWindow = load('lib/businessDateWindow.ts')
const saleTotals = load('lib/saleTotals.ts')
const financialPrecision = load('lib/financialPrecision.ts')
const nativeSaleChange = load('lib/nativeSaleChange.ts', { './financialPrecision': financialPrecision, './saleTotals': saleTotals })
const realAnalytics = load('lib/salesAnalytics.ts', { './db': { getDb: () => db }, './businessDateWindow': businessDateWindow })
const analytics = {
  ...realAnalytics,
  getSalesTotals: async (_env, filters) => { seen.push(filters); return { ...KERNEL } },
}
const registry = load('lib/paymentMethodRegistry.ts')
const recon = load('lib/shiftReconciliation.ts', {
  './db': { getDb: () => db },
  './nativeSaleChange': nativeSaleChange,
  './salesAnalytics': analytics,
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
  // ---- 1. the expense split is a partition of the drawer's outflow --------

  const expenses = await recon.shiftExpenses({}, SHIFT, NOW)
  assert.deepEqual({ usd: expenses.usd, khr: expenses.khr }, { usd: 9, khr: 32_000 },
    'every fee in the window: Ice $4 + Grab $5 + a NULL-branch 20,000 moto + a 12,000 riel courier fee')
  const deliveryFees = await recon.shiftDeliveryFeeExpenses({}, SHIFT, NOW)
  assert.deepEqual(deliveryFees, { usd: 5, khr: 12_000 },
    "only the fees typed 'delivery', and only inside the window -- the $88/88,000 one a second before opening is out")
  const courier = await recon.shiftCourierPayouts({}, SHIFT, NOW)
  assert.deepEqual(courier, { usd: 3, khr: 4_000 },
    "sale 6's payout only: sale 7 already has a delivery FEE row, so its money is not taken twice")

  const figures = await recon.loadShiftFigures({}, SHIFT, NOW)
  assert.deepEqual(figures.delivery_cost, { usd: 8, khr: 16_000 },
    'delivery cost is BOTH ways a courier gets paid: the $5 fee row plus the $3 direct payout')
  assert.deepEqual(figures.other_expenses, { usd: 4, khr: 20_000 },
    'other expenses is everything that is not delivery: Ice $4 and the 20,000 riel moto fare')
  ok('the expense split names both halves by value')

  // THE INVARIANT. The two halves must sum to exactly what the drawer
  // reconciliation subtracted, per currency -- otherwise the report and the
  // drawer are describing two different days.
  const drawer = await recon.loadShiftReconciliation({}, SHIFT, NOW)
  assert.equal(figures.delivery_cost.usd + figures.other_expenses.usd, drawer.expenses.usd + drawer.courier.usd)
  assert.equal(figures.delivery_cost.khr + figures.other_expenses.khr, drawer.expenses.khr + drawer.courier.khr)
  assert.equal(drawer.expenses.usd + drawer.courier.usd, 12)
  assert.equal(drawer.expenses.khr + drawer.courier.khr, 36_000)

  // ...and the two wrong implementations, named and excluded by value.
  assert.notEqual(figures.other_expenses.usd, expenses.usd,
    'other expenses still counts the delivery fee, so the halves double-count $5')
  assert.notEqual(figures.delivery_cost.usd, courier.usd,
    'delivery cost is still the direct payouts only, so the $5 recorded as a fee is missing from it')
  ok('delivery cost + other expenses == expenses + courier, in both currencies, and neither wrong split passes')

  // ---- 2. the kernel is asked about THIS shift's window -------------------
  assert.equal(seen.length, 1, 'the report prices the window once')
  assert.deepEqual(seen[0], {
    createdFrom: SHIFT.opened_at, createdTo: SHIFT.closed_at, cashierId: 7, branchId: 2,
  }, "sales, COGS and profit come from the shift's own window and cashier, not the day's")
  assert.deepEqual(
    { sales: figures.sales_usd, cogs: figures.cogs_usd, profit: figures.profit_usd, delivery: figures.delivery_fee_usd, refunds: figures.refunds_usd },
    { sales: 312.5, cogs: 190.25, profit: 122.25, delivery: 14, refunds: 8.75 },
    'the kernel figures are carried through unchanged -- no second profit formula lives in the shift report')
  ok('sales, COGS, profit, delivery fees and refunds come from the sales kernel over the shift window')

  // ---- 3. the registration, per currency, open vs end ---------------------
  assert.deepEqual(figures.opening, { usd: 50, khr: 100_000 })
  assert.deepEqual(figures.closing, { usd: 100, khr: 150_000 })
  const uncounted = await recon.loadShiftFigures({}, { ...SHIFT, closing_counted_usd: null, closing_counted_khr: null }, NOW)
  assert.deepEqual(uncounted.closing, { usd: null, khr: null },
    'a drawer nobody counted stays null; "the till held nothing" is a different fact from "nobody counted the till"')
  ok('the registered cash at open and at end travels with the report, per currency')

  // ---- 4. no business figure depends on the count ------------------------
  const wild = await recon.loadShiftFigures({}, { ...SHIFT, closing_counted_usd: 9_999, closing_counted_khr: 0 }, NOW)
  const business = (f) => ({
    sales: f.sales_usd, cogs: f.cogs_usd, profit: f.profit_usd, delivery_fee: f.delivery_fee_usd,
    credit: f.credit_usd, refunds: f.refunds_usd, delivery_cost: f.delivery_cost, other: f.other_expenses,
  })
  assert.deepEqual(business(wild), business(figures))
  assert.deepEqual(business(uncounted), business(figures))
  assert.notDeepEqual(wild.closing, figures.closing, 'the counts really did differ between the three runs')
  ok('a $100 count, a $9,999 count and no count at all price the shift identically -- the registration is report-only')

  // ---- 5. credit is a positive note --------------------------------------
  assert.equal(figures.credit_usd, 47.5, 'unpaid sales are carried as an amount owed')
  const composed = recon.composeShiftFigures({
    opening: { usd: 1, khr: 2 }, counted: { usd: null, khr: 3 },
    totals: { ...KERNEL, pending_revenue_usd: -12 },
    expenses: { usd: 9, khr: 32_000 }, deliveryFees: { usd: 5, khr: 12_000 }, courier: { usd: 3, khr: 4_000 },
  })
  assert.equal(composed.credit_usd, 0, 'a negative amount owed is a data defect, never printed as negative money')
  assert.deepEqual(composed.closing, { usd: null, khr: 3 }, 'one counted currency and one uncounted survive independently')
  assert.equal(composed.profit_usd, KERNEL.profit_usd,
    'credit is never subtracted from profit -- it is already inside it (owner ruling, Sep 6 2026)')
  ok('credit is a positive note, floored at zero, and is subtracted from nothing')

  console.log(`\nALL PASS (${checks} checks) -- the shift report carries the registration and the business figures, and neither one moves the other`)
})().catch((error) => { console.error(error); process.exit(1) })

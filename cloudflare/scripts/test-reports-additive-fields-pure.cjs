// The additive report columns the reports-redesign lane asked a2/stats for
// (registry brief, Sep 6 2026). Every one of them is ADDITIVE: it rides on an
// existing row and no existing field's meaning changes. That contract is the
// first thing this file asserts -- the canonical money is recomputed by hand
// and pinned alongside the new columns, so a later change that "improves" a
// revenue figure while adding a column shows up here.
//
// The columns, and the wrong answer each one is defined against:
//   by=product  category_id / category_name / barcode / on_hand_qty
//               -- on_hand is branch-scoped through branch_stock when the
//                  report is, catalog-wide otherwise. Reading the catalog
//                  column in a branch-scoped report is the classic bug (this
//                  project has two stock ledgers and they diverge).
//   by=customer is_new / gender / phone
//               -- "new" is first-sale-EVER inside the window, not first sale
//                  inside the window, which would relabel every long-standing
//                  customer as newly acquired in every range.
//   by=cashier  new_customer_count / return_customer_count /
//               unregistered_count / paid_tx_count / cancelled_tx_count
//               -- a walk-in has no identity and is not an acquisition;
//                  an awaiting_payment receipt is not paid.
//   by=branch   customer_count / items_sold_qty
//               -- distinct IDENTIFIED customers: COALESCE(customer_id, 0)
//                  would fold every walk-in into one phantom customer.
//   by=courier  paid_fee_usd / receivable_fee_usd / paid_by_method
//               -- and the two must sum back to charged_fee_usd.
//
// Each of those wrong answers is COMPUTED from the same fixture and asserted
// to differ, so no assertion here can pass by accident.
//
// Run (from cloudflare/): node scripts/test-reports-additive-fields-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')

const srcPath = path.join(__dirname, '..', 'src', 'lib', 'salesAnalytics.ts')
const stripped = ('// @ts-nocheck\n' + fs.readFileSync(srcPath, 'utf8'))
  .replace(/^import \{ getDb \} from '\.\/db'\r?\n/m, 'const getDb = (env) => env.__db\n')
  .replace(/^import type \{ Env \} from '\.\.\/index'\r?\n/m, '')
  .replace(/env: Env/g, 'env')
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-additive-'))
fs.writeFileSync(path.join(tmpDir, 'salesAnalytics.ts'), stripped)
fs.writeFileSync(path.join(tmpDir, 'businessDateWindow.ts'), fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'businessDateWindow.ts'), 'utf8'))
const tscBin = path.join(__dirname, '..', 'node_modules', 'typescript', 'bin', 'tsc')
execSync(`node ${tscBin} --module commonjs --target es2020 --outDir ${tmpDir} ${path.join(tmpDir, 'salesAnalytics.ts')} ${path.join(tmpDir, 'businessDateWindow.ts')}`, { stdio: 'inherit' })
const lib = require(path.join(tmpDir, 'salesAnalytics.js'))

const db = new Database(':memory:')
db.exec(`
  CREATE TABLE sales (
    id INTEGER PRIMARY KEY, created_at TEXT, sale_status TEXT, receipt_number TEXT,
    subtotal_usd REAL, discount_usd REAL, membership_discount_usd REAL, tax_usd REAL,
    total_usd REAL, total_khr REAL, delivery_fee_usd REAL, delivery_fee_paid_by TEXT,
    is_delivery INTEGER, delivery_actual_cost_usd REAL, delivery_contact_id INTEGER, delivery_contact_name TEXT,
    branch_id INTEGER, branch_name TEXT, customer_id INTEGER, customer_name TEXT, customer_phone TEXT,
    cashier_id INTEGER, cashier_name TEXT, payment_method TEXT, amount_paid_usd REAL);
  CREATE TABLE sale_items (id INTEGER PRIMARY KEY, sale_id INTEGER, quantity REAL, cost_price_usd REAL,
    total_usd REAL, branch_id INTEGER, product_id INTEGER, product_name TEXT,
    product_discount_usd REAL DEFAULT 0, manual_discount_usd REAL DEFAULT 0);
  CREATE TABLE returns (id INTEGER PRIMARY KEY, sale_id INTEGER, total_refund_usd REAL, total_refund_khr REAL,
    status TEXT, return_scope TEXT, created_at TEXT, branch_id INTEGER,
    supplier_compensation_usd REAL, supplier_loss_usd REAL, reason TEXT);
  CREATE TABLE return_items (id INTEGER PRIMARY KEY, return_id INTEGER, quantity REAL, cost_price_usd REAL,
    return_to_stock INTEGER, stock_action TEXT);
  CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, phone TEXT, gender TEXT);
  CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, barcode TEXT, category TEXT, stock_quantity REAL);
  CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE branch_stock (id INTEGER PRIMARY KEY, product_id INTEGER, branch_id INTEGER, quantity REAL);
  CREATE TABLE delivery_contacts (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE fees (id INTEGER PRIMARY KEY, fee_type TEXT, label TEXT, amount_usd REAL, amount_khr REAL,
    fee_date TEXT, sale_id INTEGER, branch_id INTEGER, delivery_contact_id INTEGER, created_at TEXT);
`)

const AT = (m, d) => `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} 05:00:00`
const ins = db.prepare(`INSERT INTO sales
  (id, created_at, sale_status, receipt_number, subtotal_usd, discount_usd, membership_discount_usd, tax_usd,
   total_usd, total_khr, delivery_fee_usd, delivery_fee_paid_by, is_delivery, delivery_contact_id, delivery_contact_name,
   branch_id, branch_name, customer_id, customer_name, customer_phone, cashier_id, cashier_name, payment_method)
  VALUES (@id,@created_at,@sale_status,@receipt_number,@subtotal_usd,0,0,0,
   @subtotal_usd,0,@delivery_fee_usd,'customer',@is_delivery,@delivery_contact_id,@delivery_contact_name,
   @branch_id,@branch_name,@customer_id,@customer_name,NULL,@cashier_id,@cashier_name,@payment_method)`)
const sale = (o) => ins.run({
  delivery_fee_usd: 0, is_delivery: 0, delivery_contact_id: null, delivery_contact_name: null,
  customer_id: null, customer_name: 'Walk-in', payment_method: 'cash', receipt_number: String(o.id), ...o,
})

db.prepare('INSERT INTO customers (id, name, phone, gender) VALUES (?,?,?,?)').run(10, 'Alice', '011', 'f')
db.prepare('INSERT INTO customers (id, name, phone, gender) VALUES (?,?,?,?)').run(11, 'Bob', '012', 'm')
db.prepare('INSERT INTO delivery_contacts (id, name) VALUES (?,?)').run(9, 'Rith')
db.prepare('INSERT INTO products (id, name, barcode, category, stock_quantity) VALUES (?,?,?,?,?)').run(1, 'Cola', 'B1', 'Drinks', 7)
db.prepare('INSERT INTO products (id, name, barcode, category, stock_quantity) VALUES (?,?,?,?,?)').run(2, 'Mug', '', null, 3)
db.prepare('INSERT INTO categories (id, name) VALUES (?,?)').run(1, 'Drinks')
db.prepare('INSERT INTO branch_stock (id, product_id, branch_id, quantity) VALUES (?,?,?,?)').run(1, 1, 1, 5)
db.prepare('INSERT INTO branch_stock (id, product_id, branch_id, quantity) VALUES (?,?,?,?)').run(2, 1, 2, 2)

// Alice's FIRST sale is in July -- outside the window. She is a returning
// customer in August, and any "first sale in the range" reading calls her new.
sale({ id: 1, created_at: AT(7, 5), sale_status: 'completed', subtotal_usd: 50, branch_id: 1, branch_name: 'shop', customer_id: 10, customer_name: 'Alice', cashier_id: 1, cashier_name: 'aza' })
sale({ id: 2, created_at: AT(8, 5), sale_status: 'completed', subtotal_usd: 100, branch_id: 1, branch_name: 'shop', customer_id: 10, customer_name: 'Alice', cashier_id: 1, cashier_name: 'aza' })
// Bob is acquired inside the window, by sok, and comes back inside it too.
sale({ id: 3, created_at: AT(8, 6), sale_status: 'completed', subtotal_usd: 60, branch_id: 1, branch_name: 'shop', customer_id: 11, customer_name: 'Bob', cashier_id: 2, cashier_name: 'sok' })
// A walk-in: no identity, so neither new nor returning.
sale({ id: 4, created_at: AT(8, 7), sale_status: 'completed', subtotal_usd: 20, branch_id: 2, branch_name: 'branch-2', cashier_id: 1, cashier_name: 'aza' })
// Unpaid credit: recognized (inside revenue), but not PAID.
sale({ id: 5, created_at: AT(8, 8), sale_status: 'awaiting_payment', subtotal_usd: 30, branch_id: 2, branch_name: 'branch-2', customer_id: 11, customer_name: 'Bob', cashier_id: 2, cashier_name: 'sok' })
// Voided, and large: it must reach cancelled_tx_count and nothing else.
sale({ id: 6, created_at: AT(8, 9), sale_status: 'cancelled', subtotal_usd: 999, branch_id: 1, branch_name: 'shop', customer_id: 10, customer_name: 'Alice', cashier_id: 1, cashier_name: 'aza' })
// Two deliveries by the same courier: one settled, one still owed.
sale({ id: 7, created_at: AT(8, 10), sale_status: 'completed', subtotal_usd: 40, branch_id: 1, branch_name: 'shop', customer_id: 10, customer_name: 'Alice', cashier_id: 1, cashier_name: 'aza', is_delivery: 1, delivery_fee_usd: 3, delivery_contact_id: 9, delivery_contact_name: 'Rith', payment_method: 'cash' })
sale({ id: 8, created_at: AT(8, 11), sale_status: 'awaiting_payment', subtotal_usd: 40, branch_id: 1, branch_name: 'shop', customer_id: 11, customer_name: 'Bob', cashier_id: 2, cashier_name: 'sok', is_delivery: 1, delivery_fee_usd: 3, delivery_contact_id: 9, delivery_contact_name: 'Rith', payment_method: 'aba' })

const item = db.prepare('INSERT INTO sale_items (id, sale_id, quantity, cost_price_usd, total_usd, branch_id, product_id, product_name) VALUES (?,?,?,?,?,?,?,?)')
item.run(1, 1, 1, 10, 50, 1, 1, 'Cola')
item.run(2, 2, 2, 20, 100, 1, 1, 'Cola')
item.run(3, 3, 1, 15, 60, 1, 2, 'Mug')
item.run(4, 4, 3, 2, 20, 2, 1, 'Cola')
item.run(5, 5, 1, 5, 30, 2, 2, 'Mug')
item.run(6, 6, 1, 500, 999, 1, 1, 'Cola')
item.run(7, 7, 1, 8, 40, 1, 1, 'Cola')
item.run(8, 8, 1, 8, 40, 1, 1, 'Cola')

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }
const byKey = (rows, key) => rows.find((r) => r.key === key)

;(async () => {
const AUG = { startDate: '2026-08-01', endDate: '2026-08-31', branchId: null }
const AUG_B1 = { ...AUG, branchId: 1 }
const env = { __db: db }

// ---- 0. the contract: the money is unchanged --------------------------------
const totals = await lib.getSalesTotals(env, AUG)
check(`the canonical money is what it was: revenue $${totals.revenue_usd} over ${totals.tx_count} recognized receipts, 1 voided`,
  totals.revenue_usd === 290 && totals.tx_count === 6 && totals.cancelled_tx_count === 1 && totals.refund_usd === 0)

// ---- 1. by=product ----------------------------------------------------------
const products = await lib.getProductSalesRanking(env, AUG, 50)
const cola = products.find((r) => r.product_id === 1)
const mug = products.find((r) => r.product_id === 2)
check(`the sold quantities are unchanged (Cola ${cola.qty}, Mug ${mug.qty}) -- the void is not in them`,
  cola.qty === 7 && mug.qty === 2)
check('Cola carries its barcode and its category, resolved to a categories row by name',
  cola.barcode === 'B1' && cola.category_name === 'Drinks' && cola.category_id === 1)
check('a product with no category gets an empty name and a NULL id, not a fabricated one',
  mug.category_name === '' && mug.category_id === null && mug.barcode === '')
check(`unscoped, on_hand_qty is the catalog column (Cola ${cola.on_hand_qty}, Mug ${mug.on_hand_qty})`,
  cola.on_hand_qty === 7 && mug.on_hand_qty === 3)

const productsB1 = await lib.getProductSalesRanking(env, AUG_B1, 50)
const colaB1 = productsB1.find((r) => r.product_id === 1)
check(`branch-scoped, on_hand_qty is that branch's stock (${colaB1.on_hand_qty}), not the catalog's ${cola.on_hand_qty}`,
  colaB1.on_hand_qty === 5)
check('POSITIVE CONTROL: the two ledgers really do disagree here, so the branch scope is doing work',
  colaB1.on_hand_qty !== cola.on_hand_qty)
const mugB1 = productsB1.find((r) => r.product_id === 2)
check('a product with no row in branch_stock reads 0 there, not its catalog total',
  mugB1.on_hand_qty === 0 && mug.on_hand_qty === 3)

// ---- 2. by=customer ---------------------------------------------------------
const customers = await lib.getSalesGroupedTotals(env, AUG, 'customer')
const alice = byKey(customers, 'id:10')
const bob = byKey(customers, 'id:11')
const walkIn = byKey(customers, 'name:walk-in')
check('Bob, whose first sale ever is inside the window, is new', bob.is_new === true)
check('Alice, who first bought in July, is NOT new in August', alice.is_new === false)
// POSITIVE CONTROL: the reading this is defined against.
const naiveNew = db.prepare(`SELECT customer_id FROM sales
  WHERE date(created_at, '+7 hours') BETWEEN '2026-08-01' AND '2026-08-31'
    AND customer_id IS NOT NULL AND COALESCE(sale_status, 'completed') <> 'cancelled'
  GROUP BY customer_id
  HAVING MIN(datetime(created_at)) = (SELECT MIN(datetime(created_at)) FROM sales s2 WHERE s2.customer_id = sales.customer_id
    AND date(s2.created_at, '+7 hours') BETWEEN '2026-08-01' AND '2026-08-31')`).all()
check(`POSITIVE CONTROL: "first sale in the RANGE" would call ${naiveNew.length} of 2 customers new, including Alice`,
  naiveNew.length === 2)
check('the identity columns come off the customer record', alice.gender === 'f' && alice.phone === '011' && bob.gender === 'm' && bob.phone === '012')
check('a walk-in group has no identity to report and is not marked new',
  walkIn.is_new === false && walkIn.gender === '' && walkIn.phone === '')
check(`the customer rows still sum to the window revenue ($${customers.reduce((n, r) => n + r.revenue_usd, 0)})`,
  Math.round(customers.reduce((n, r) => n + r.revenue_usd, 0) * 100) / 100 === totals.revenue_usd)

// ---- 3. by=cashier ----------------------------------------------------------
const cashiers = await lib.getSalesGroupedTotals(env, AUG, 'cashier')
const aza = byKey(cashiers, 'id:1')
const sok = byKey(cashiers, 'id:2')
check(`aza acquired nobody and served one returning customer (${aza.new_customer_count} / ${aza.return_customer_count})`,
  aza.new_customer_count === 0 && aza.return_customer_count === 1)
check(`sok acquired Bob and also served him again in the same window (${sok.new_customer_count} / ${sok.return_customer_count})`,
  sok.new_customer_count === 1 && sok.return_customer_count === 1)
check(`the walk-in receipt is counted as unregistered by its own cashier, not as an acquisition (aza ${aza.unregistered_count}, sok ${sok.unregistered_count})`,
  aza.unregistered_count === 1 && sok.unregistered_count === 0)
check(`paid_tx_count excludes unpaid credit (aza ${aza.paid_tx_count} of ${aza.tx_count}, sok ${sok.paid_tx_count} of ${sok.tx_count})`,
  aza.paid_tx_count === 3 && aza.tx_count === 3 && sok.paid_tx_count === 1 && sok.tx_count === 3)
check(`the voided receipt lands on its cashier's cancelled_tx_count and nowhere else (aza ${aza.cancelled_tx_count})`,
  aza.cancelled_tx_count === 1 && sok.cancelled_tx_count === 0 && aza.revenue_usd === 160)

// ---- 4. by=branch -----------------------------------------------------------
const branches = await lib.getSalesGroupedTotals(env, AUG, 'branch')
const b1 = byKey(branches, '1')
const b2 = byKey(branches, '2')
check(`branch 1 served 2 identified customers and moved ${b1.items_sold_qty} units`,
  b1.customer_count === 2 && b1.items_sold_qty === 5)
check(`branch 2's walk-in is not a customer, so it counts 1, not 2 (${b2.customer_count}), and moved ${b2.items_sold_qty} units`,
  b2.customer_count === 1 && b2.items_sold_qty === 4)
const naiveBranch2 = db.prepare(`SELECT COUNT(DISTINCT COALESCE(customer_id, 0)) AS n FROM sales
  WHERE branch_id = 2 AND date(created_at, '+7 hours') BETWEEN '2026-08-01' AND '2026-08-31'
    AND COALESCE(sale_status, 'completed') <> 'cancelled'`).get()
check(`POSITIVE CONTROL: folding walk-ins into one phantom customer would say ${naiveBranch2.n}`,
  naiveBranch2.n === 2 && naiveBranch2.n !== b2.customer_count)
check('the voided receipt does not add a branch customer either', b1.cancelled_tx_count === 1 && b1.customer_count === 2)

// ---- 5. by=courier ----------------------------------------------------------
const couriers = await lib.getDeliveryContactTotals(env, AUG)
const rith = couriers.find((r) => r.delivery_contact_id === 9)
check(`the courier's charged fees are unchanged ($${rith.charged_fee_usd} over ${rith.deliveries} deliveries)`,
  rith.charged_fee_usd === 6 && rith.deliveries === 2)
check(`half of it is settled and half is still receivable ($${rith.paid_fee_usd} / $${rith.receivable_fee_usd})`,
  rith.paid_fee_usd === 3 && rith.receivable_fee_usd === 3)
check('and the split always adds back to the charged total -- every recognized sale is one or the other',
  Math.round((rith.paid_fee_usd + rith.receivable_fee_usd) * 100) / 100 === rith.charged_fee_usd)
check(`paid_by_method reports only what was actually taken (${JSON.stringify(rith.paid_by_method)})`,
  rith.paid_by_method.length === 1 && rith.paid_by_method[0].payment_method === 'cash'
  && rith.paid_by_method[0].count === 1 && rith.paid_by_method[0].fee_usd === 3)
check('POSITIVE CONTROL: the unpaid delivery was on a DIFFERENT method, so an unfiltered breakdown would list two',
  db.prepare("SELECT COUNT(DISTINCT payment_method) AS n FROM sales WHERE delivery_contact_id = 9").get().n === 2)

// ---- 6. overview / periods totals ------------------------------------------
const days = await lib.getBusinessSummaryDayRows(env, AUG)
check(`cancelled_tx_count is on the day rows the /periods roll-up sums (${days.reduce((n, r) => n + r.cancelled_tx_count, 0)})`,
  days.reduce((n, r) => n + r.cancelled_tx_count, 0) === 1)
check('every day row carries the key, so a generic numeric roll-up carries it too',
  days.every((r) => typeof r.cancelled_tx_count === 'number'))

// ---- 7. item discount is no longer optional ---------------------------------
const src = fs.readFileSync(srcPath, 'utf8')
check('DeriveTotalsOptions.itemDiscountUsd is REQUIRED, so a new caller cannot silently report a zero line-discount',
  /\n  itemDiscountUsd: number\n/.test(src.replace(/\r/g, '')) && !/itemDiscountUsd\?: number/.test(src))
check('and every kernel entry point passes it',
  (src.match(/itemDiscountUsd:/g) || []).length >= 5)

console.log(`\nALL ${passed} CHECKS PASSED`)
})().catch((e) => { console.error(e); process.exit(1) })

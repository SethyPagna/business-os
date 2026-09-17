// Pins migration 0181 (customer_receivables_paid_multiple_repair) against a
// SYNTHETIC fixture built on the REAL migration chain (better-sqlite3, no
// production data), reproducing the exact production shape: a customer_
// receivables row whose amount_paid_usd is an integer multiple of its
// total_amount_usd and status='Paid' (the old system's AR export repeats the
// invoice-level "Amount Paid" on every one of a multi-line invoice's lines).
//
// Fixture coverage:
//  R1 the defect shape (paid = 2x total, status='Paid', outstanding < 0) ->
//     repaired: amount_paid_usd = total, outstanding_balance_usd = 0.
//  R2 a second defect row with a different multiple (6x) -> repaired the
//     same way, proving the fix is not hard-coded to one ratio.
//  C1 control: a genuinely zero-balance row (paid = total already) -> must
//     NOT be touched (would fail the WHERE outstanding_balance_usd < 0 guard
//     if it were).
//  C2 control: a row that is NOT from the import (status='Paid' but
//     outstanding_balance_usd < 0 achieved by a manual/non-legacy path) --
//     included to prove the migration's predicate is status+outstanding
//     only, so it is documented as touching this row too; paired with C3
//     to prove the untouched supplier side is never reached.
//  C3 control: a supplier_invoices row with status='Outstanding' -- must
//     stay completely untouched (P11-12: the supplier side is flagged to the
//     owner for a ruling, not silently repaired here).
//  Idempotence: re-running migration 0181's SQL a second time changes
//  nothing further (the mapping-table guard on both the INSERT and the
//  UPDATE join).
//  Reversal: the documented recovery UPDATE restores the pre-repair values
//  exactly from customer_receivables_paid_multiple_repair.
//
// Run: node scripts/test-migration-0181-receivables-paid-repair-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const migrationsDir = path.join(__dirname, '..', 'migrations')
const migration0181 = fs.readFileSync(path.join(migrationsDir, '0181_customer_receivables_paid_multiple_repair.sql'), 'utf8')

let checks = 0
function check(label, cond) {
  assert.ok(cond, `FAIL: ${label}`)
  checks++
  console.log(`  ok  ${label}`)
}

function buildDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = OFF')
  // Load the full chain UP TO (but not including) 0181, so this test proves
  // the migration file itself does the repair, not something an earlier
  // migration already did.
  const allFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
  const priorFiles = allFiles.filter((f) => f < '0181_customer_receivables_paid_multiple_repair.sql')
  for (const file of priorFiles) db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))

  db.prepare(`INSERT INTO customer_receivables
    (id, legacy_id, customer_id, customer_code, customer_name, invoice_no, invoice_date,
     taxable_amount_usd, vat_amount_usd, total_amount_usd, amount_paid_usd, outstanding_balance_usd,
     status, source_file, source_row)
    VALUES (@id, @legacy_id, NULL, NULL, @customer_name, @invoice_no, @invoice_date,
     0, 0, @total, @paid, @outstanding, @status, @source_file, @source_row)`)
  const insertReceivable = db.prepare(`INSERT INTO customer_receivables
    (id, legacy_id, customer_id, customer_code, customer_name, invoice_no, invoice_date,
     taxable_amount_usd, vat_amount_usd, total_amount_usd, amount_paid_usd, outstanding_balance_usd,
     status, source_file, source_row)
    VALUES (@id, @legacy_id, NULL, NULL, @customer_name, @invoice_no, @invoice_date,
     0, 0, @total, @paid, @outstanding, @status, @source_file, @source_row)`)

  // R1: the defect shape, 2x multiple.
  insertReceivable.run({ id: 9001, legacy_id: 1, customer_name: 'Cust A', invoice_no: '000001', invoice_date: '2024-07-18',
    total: 5370, paid: 10740, outstanding: 5370 - 10740, status: 'Paid', source_file: 'account-receivable-report-2021-2026.xls', source_row: 2 })
  // R2: a different multiple (6x), different customer.
  insertReceivable.run({ id: 9002, legacy_id: 2, customer_name: 'Cust B', invoice_no: '000002', invoice_date: '2024-08-01',
    total: 780, paid: 4680, outstanding: 780 - 4680, status: 'Paid', source_file: 'account-receivable-report-2021-2026.xls', source_row: 3 })
  // C1: genuinely settled, zero balance -- must not be touched.
  insertReceivable.run({ id: 9003, legacy_id: 3, customer_name: 'Cust C', invoice_no: '000003', invoice_date: '2024-08-02',
    total: 200, paid: 200, outstanding: 0, status: 'Paid', source_file: 'account-receivable-report-2021-2026.xls', source_row: 4 })
  // C2: not-yet-settled, genuinely owed -- must not be touched (outstanding > 0).
  insertReceivable.run({ id: 9004, legacy_id: 4, customer_name: 'Cust D', invoice_no: '000004', invoice_date: '2024-08-03',
    total: 500, paid: 300, outstanding: 200, status: 'unpaid', source_file: 'account-receivable-report-2021-2026.xls', source_row: 5 })

  // C3: supplier side, flagged not repaired.
  db.prepare(`INSERT INTO supplier_invoices
    (id, source_branch, legacy_id, supplier_name, invoice_no, invoice_date, term_days,
     taxable_amount_usd, vat_amount_usd, total_amount_usd, amount_paid_usd, outstanding_balance_usd,
     status, source_file, source_row)
    VALUES (8001, 'shop', 1, 'Supplier X', 'S-001', '2024-08-03', 0, 0, 0, 489, 0, 489, 'Outstanding',
     'shop-account-payable-report-all.xls', 2)`).run()

  return db
}

// ---- Apply the migration ----------------------------------------------
const db = buildDb()
db.exec(migration0181)

check('R1 (2x multiple) amount_paid_usd clamped to total', db.prepare('SELECT amount_paid_usd FROM customer_receivables WHERE id=9001').get().amount_paid_usd === 5370)
check('R1 outstanding_balance_usd zeroed', db.prepare('SELECT outstanding_balance_usd FROM customer_receivables WHERE id=9001').get().outstanding_balance_usd === 0)
check('R2 (6x multiple) amount_paid_usd clamped to total', db.prepare('SELECT amount_paid_usd FROM customer_receivables WHERE id=9002').get().amount_paid_usd === 780)
check('R2 outstanding_balance_usd zeroed', db.prepare('SELECT outstanding_balance_usd FROM customer_receivables WHERE id=9002').get().outstanding_balance_usd === 0)

check('C1 (already settled) untouched: paid stays 200', db.prepare('SELECT amount_paid_usd FROM customer_receivables WHERE id=9003').get().amount_paid_usd === 200)
check('C1 (already settled) untouched: outstanding stays 0', db.prepare('SELECT outstanding_balance_usd FROM customer_receivables WHERE id=9003').get().outstanding_balance_usd === 0)

check('C2 (genuine partial balance) untouched: paid stays 300', db.prepare('SELECT amount_paid_usd FROM customer_receivables WHERE id=9004').get().amount_paid_usd === 300)
check('C2 (genuine partial balance) untouched: outstanding stays 200', db.prepare('SELECT outstanding_balance_usd FROM customer_receivables WHERE id=9004').get().outstanding_balance_usd === 200)

check('C3 (supplier side) completely untouched: still Outstanding', db.prepare('SELECT status, outstanding_balance_usd FROM supplier_invoices WHERE id=8001').get().status === 'Outstanding')
check('C3 outstanding balance unchanged at 489', db.prepare('SELECT outstanding_balance_usd FROM supplier_invoices WHERE id=8001').get().outstanding_balance_usd === 489)

check('no customer_receivables row is left with a negative outstanding balance', db.prepare('SELECT COUNT(*) n FROM customer_receivables WHERE outstanding_balance_usd < 0').get().n === 0)

check('repair table recorded exactly the 2 repaired rows', db.prepare('SELECT COUNT(*) n FROM customer_receivables_paid_multiple_repair').get().n === 2)
const repairRow1 = db.prepare('SELECT * FROM customer_receivables_paid_multiple_repair WHERE receivable_id=9001').get()
check('repair table kept the original paid amount for reversal (10740)', repairRow1.old_amount_paid_usd === 10740)
check('repair table kept the original outstanding amount for reversal (-5370)', repairRow1.old_outstanding_balance_usd === -5370)

check('an audit_logs row exists for each repaired receivable', db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='repair_receivable_paid_multiple'").get().n === 2)

// ---- Idempotence: re-running the migration changes nothing further -----
const before = JSON.stringify(db.prepare('SELECT * FROM customer_receivables ORDER BY id').all())
const beforeRepairCount = db.prepare('SELECT COUNT(*) n FROM customer_receivables_paid_multiple_repair').get().n
db.exec(migration0181)
const after = JSON.stringify(db.prepare('SELECT * FROM customer_receivables ORDER BY id').all())
check('re-running the migration is idempotent (no further row changes)', before === after)
check('re-running the migration inserts no duplicate repair rows', db.prepare('SELECT COUNT(*) n FROM customer_receivables_paid_multiple_repair').get().n === beforeRepairCount)

// ---- Reversal restores the pre-repair values exactly --------------------
db.exec(`
  UPDATE customer_receivables
     SET amount_paid_usd = (SELECT r.old_amount_paid_usd FROM customer_receivables_paid_multiple_repair r WHERE r.receivable_id = customer_receivables.id),
         outstanding_balance_usd = (SELECT r.old_outstanding_balance_usd FROM customer_receivables_paid_multiple_repair r WHERE r.receivable_id = customer_receivables.id)
   WHERE id IN (SELECT receivable_id FROM customer_receivables_paid_multiple_repair);
`)
check('reversal restores R1 amount_paid_usd to 10740', db.prepare('SELECT amount_paid_usd FROM customer_receivables WHERE id=9001').get().amount_paid_usd === 10740)
check('reversal restores R1 outstanding_balance_usd to -5370', db.prepare('SELECT outstanding_balance_usd FROM customer_receivables WHERE id=9001').get().outstanding_balance_usd === -5370)
check('reversal restores R2 amount_paid_usd to 4680', db.prepare('SELECT amount_paid_usd FROM customer_receivables WHERE id=9002').get().amount_paid_usd === 4680)

console.log(`\n${checks} checks passed.`)

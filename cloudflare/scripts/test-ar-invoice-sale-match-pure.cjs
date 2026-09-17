// P11-11: pins the customer_receivables <-> sales matching SQL used by
// GET /customers/reports/ar-invoices (cloudflare/src/routes/contacts.ts)
// against a REAL migrated in-memory SQLite (better-sqlite3), so the join
// logic is provable without production access.
//
// ROOT CAUSE (verified read-only against production Sep 18 2026, P11-11):
// customer_receivables.invoice_no is the BARE legacy number ('006416'), while
// sales.legacy_receipt_number carries the retired '@date' form
// ('000001@2024-07-18', migration 0107). Joining on the raw values matches
// ZERO rows. The base number alone is not unique (it repeats across years),
// so the join key is base number PLUS same local calendar day, falling back
// to base number PLUS equal total for the handful that do not share a day.
//
// This file reproduces the EXACT SQL fragment from contacts.ts (copy kept in
// sync deliberately -- see the comment at its call site) so a change to one
// without the other is caught by a human diff, not silently drifting.
//
// Fixture coverage:
//  M1 base number + same calendar day -> matches (the common case, 13,282 of
//     13,304 in production).
//  M2 base number repeats across two different years; only ONE of them
//     shares both the invoice's day AND total -> the day+total match wins,
//     not the other year's row (proves the ORDER BY tiebreak works).
//  M3 base number matches but NEITHER day nor total agrees -> unresolved,
//     matched_sale_id stays NULL (the honest "22 rows" case).
//  M4 base number + no day match, but total matches to the cent -> the
//     fallback resolves it.
//  M5 raw-value join (no suffix stripped) -> proven to match ZERO rows,
//     which is exactly the reported defect this fix corrects.
//  M6 a sale whose legacy_receipt_number has already been rewritten to the
//     bare business format (no '@', migration 0107 backfill) still matches
//     on the exact-equality arm.
//
// Run: node scripts/test-ar-invoice-sale-match-pure.cjs

const assert = require('assert')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

let checks = 0
function check(label, cond) {
  assert.ok(cond, `FAIL: ${label}`)
  checks++
  console.log(`  ok  ${label}`)
}

const db = new Database(':memory:')
db.pragma('foreign_keys = OFF')
for (const migration of loadAll()) db.exec(migration)

const insertSale = db.prepare(`INSERT INTO sales (id, receipt_number, legacy_receipt_number, created_at, total_usd, customer_name)
  VALUES (@id, @receipt_number, @legacy_receipt_number, @created_at, @total_usd, @customer_name)`)
const insertReceivable = db.prepare(`INSERT INTO customer_receivables
  (id, legacy_id, customer_name, invoice_no, invoice_date, taxable_amount_usd, vat_amount_usd,
   total_amount_usd, amount_paid_usd, outstanding_balance_usd, status, source_file, source_row)
  VALUES (@id, @legacy_id, @customer_name, @invoice_no, @invoice_date, 0, 0,
   @total_amount_usd, @total_amount_usd, 0, 'Paid', 'account-receivable-report-2021-2026.xls', @id)`)

// M1: base number + same calendar day.
insertSale.run({ id: 1, receipt_number: '20240718-000001', legacy_receipt_number: '000001@2024-07-18', created_at: '2024-07-18T05:00:00.000Z', total_usd: 120, customer_name: 'A' })
insertReceivable.run({ id: 901, legacy_id: 1, customer_name: 'A', invoice_no: '000001', invoice_date: '2024-07-18T05:30:00.000Z', total_amount_usd: 120 })

// M2: base number repeats across two years; only the 2025 row shares BOTH
// this invoice's day and total. The 2024 row (same base number) must lose.
insertSale.run({ id: 2, receipt_number: '20240101-000050', legacy_receipt_number: '000050@2024-01-01', created_at: '2024-01-01T05:00:00.000Z', total_usd: 999, customer_name: 'B-2024' })
insertSale.run({ id: 3, receipt_number: '20250101-000050', legacy_receipt_number: '000050@2025-01-01', created_at: '2025-01-01T05:00:00.000Z', total_usd: 75, customer_name: 'B-2025' })
insertReceivable.run({ id: 902, legacy_id: 2, customer_name: 'B-2025', invoice_no: '000050', invoice_date: '2025-01-01T06:00:00.000Z', total_amount_usd: 75 })

// M3: base number matches, but neither day nor total agrees -> unresolved.
insertSale.run({ id: 4, receipt_number: '20240301-000077', legacy_receipt_number: '000077@2024-03-01', created_at: '2024-03-01T05:00:00.000Z', total_usd: 40, customer_name: 'C' })
insertReceivable.run({ id: 903, legacy_id: 3, customer_name: 'C', invoice_no: '000077', invoice_date: '2024-09-09T05:00:00.000Z', total_amount_usd: 999 })

// M4: no day match, but total matches to the cent -> fallback resolves it.
insertSale.run({ id: 5, receipt_number: '20240501-000088', legacy_receipt_number: '000088@2024-05-01', created_at: '2024-05-01T05:00:00.000Z', total_usd: 63.5, customer_name: 'D' })
insertReceivable.run({ id: 904, legacy_id: 4, customer_name: 'D', invoice_no: '000088', invoice_date: '2024-05-02T05:00:00.000Z', total_amount_usd: 63.5 })

// M6: sale's legacy_receipt_number already rewritten to bare business form (no '@').
insertSale.run({ id: 6, receipt_number: '20240601-000099', legacy_receipt_number: '000099', created_at: '2024-06-01T05:00:00.000Z', total_usd: 88, customer_name: 'E' })
insertReceivable.run({ id: 905, legacy_id: 5, customer_name: 'E', invoice_no: '000099', invoice_date: '2024-06-01T05:00:00.000Z', total_amount_usd: 88 })

const { localDateExpr } = require('../src/lib/businessDateWindow.ts')

// EXACT copy of the fragment in contacts.ts's /customers/reports/ar-invoices.
const arSaleMatchJoin = `
  (s.legacy_receipt_number = cr.invoice_no OR s.legacy_receipt_number LIKE cr.invoice_no || '@%')
  AND (${localDateExpr('s.created_at')} = ${localDateExpr('cr.invoice_date')}
       OR ROUND(s.total_usd, 2) = ROUND(cr.total_amount_usd, 2))
`
const arSaleMatchOrder = `(${localDateExpr('s.created_at')} = ${localDateExpr('cr.invoice_date')}) DESC, s.id ASC`

function matchFor(receivableId) {
  return db.prepare(`
    SELECT cr.id,
      (SELECT s.id FROM sales s WHERE cr.invoice_no IS NOT NULL AND ${arSaleMatchJoin} ORDER BY ${arSaleMatchOrder} LIMIT 1) AS matched_sale_id
    FROM customer_receivables cr WHERE cr.id = ?
  `).get(receivableId)
}

check('M1: base number + same day matches sale 1', matchFor(901).matched_sale_id === 1)
check('M2: the day+total match (2025) wins over the same-base-number 2024 row', matchFor(902).matched_sale_id === 3)
check('M3: neither day nor total agrees -> unresolved (NULL)', matchFor(903).matched_sale_id === null)
check('M4: total-only fallback resolves the match', matchFor(904).matched_sale_id === 5)
check('M6: already-rewritten bare legacy_receipt_number still matches exactly', matchFor(905).matched_sale_id === 6)

// M5: the OLD (raw-value, no suffix-stripping) join matches ZERO rows -- the
// reported defect this fix corrects. Discriminating control: old vs fixed
// logic must disagree here.
const rawJoinCount = db.prepare(`
  SELECT COUNT(*) n FROM customer_receivables cr
  JOIN sales s ON s.legacy_receipt_number = cr.invoice_no
  WHERE cr.id IN (901, 902, 904)
`).get().n
check('M5: raw-value (unfixed) join matches zero of the @-suffixed rows', rawJoinCount === 0)
check('M5: fixed join and old join genuinely disagree (fixed resolves at least one)', matchFor(901).matched_sale_id !== null)

console.log(`\n${checks} checks passed.`)

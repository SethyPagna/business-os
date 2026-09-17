// P11-11: pins the customer_receivables <-> sales matching logic used by
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
// SHAPE: this reproduces the exact two-step lookup from contacts.ts --
// (1) a literal IN-list lookup against migration 0182's expression index
// (idx_sales_legacy_receipt_base) for this page's distinct invoice numbers,
// (2) the day/total tiebreak done in JS over that small candidate set. A
// single correlated subquery per customer_receivables row was tried first
// and rejected: EXPLAIN QUERY PLAN showed SQLite SEEKs an expression index
// against a LITERAL but falls back to a full SCAN of `sales` when the
// right-hand side is a correlated column from another table (see M7/M8
// below and migration 0182's header comment) -- exactly what the "avoid
// heavy unindexed joins" ground rule forbids on a live-shop database.
//
// Fixture coverage:
//  M1 base number + same calendar day -> matches (the common case, 13,282 of
//     13,304 in production).
//  M2 base number repeats across two different years; only ONE of them
//     shares both the invoice's day AND total -> the day+total match wins,
//     not the other year's row (proves the tiebreak works).
//  M3 base number matches but NEITHER day nor total agrees -> unresolved,
//     matched_sale_id stays NULL (the honest "22 rows" case).
//  M4 base number + no day match, but total matches to the cent -> the
//     fallback resolves it (dates that don't align at all, not just a
//     guessable '@date' suffix -- the case a suffix-guessing UNION cannot
//     cover).
//  M5 raw-value join (no suffix stripped) -> proven to match ZERO rows,
//     which is exactly the reported defect this fix corrects.
//  M6 a sale whose legacy_receipt_number has already been rewritten to the
//     bare business format (no '@', migration 0107 backfill) still matches
//     on the exact-equality arm.
//  M7/M8 EXPLAIN QUERY PLAN: the literal IN-list lookup SEEKs
//     idx_sales_legacy_receipt_base; a correlated-column equivalent falls
//     back to a full SCAN (the defect this two-step shape avoids).
//
// Run: node scripts/test-ar-invoice-sale-match-pure.cjs

const assert = require('assert')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')
const { localDateOf } = require('../src/lib/businessDateWindow.ts')

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

// M4: no day match at all (different month), but total matches to the cent.
insertSale.run({ id: 5, receipt_number: '20240501-000088', legacy_receipt_number: '000088@2024-05-01', created_at: '2024-05-01T05:00:00.000Z', total_usd: 63.5, customer_name: 'D' })
insertReceivable.run({ id: 904, legacy_id: 4, customer_name: 'D', invoice_no: '000088', invoice_date: '2024-11-20T05:00:00.000Z', total_amount_usd: 63.5 })

// M6: sale's legacy_receipt_number already rewritten to bare business form (no '@').
insertSale.run({ id: 6, receipt_number: '20240601-000099', legacy_receipt_number: '000099', created_at: '2024-06-01T05:00:00.000Z', total_usd: 88, customer_name: 'E' })
insertReceivable.run({ id: 905, legacy_id: 5, customer_name: 'E', invoice_no: '000099', invoice_date: '2024-06-01T05:00:00.000Z', total_amount_usd: 88 })

// EXACT copy of the fragment in contacts.ts's /customers/reports/ar-invoices.
const arSaleBaseExpr = (col) =>
  `CASE WHEN instr(${col}, '@') > 0 THEN substr(${col}, 1, instr(${col}, '@') - 1) ELSE ${col} END`

function lookupCandidatesByBase(invoiceNos) {
  const byBase = new Map()
  if (!invoiceNos.length) return byBase
  const placeholders = invoiceNos.map(() => '?').join(', ')
  const candidates = db.prepare(`
    SELECT s.id, s.receipt_number, s.created_at, s.total_usd, (${arSaleBaseExpr('s.legacy_receipt_number')}) AS base
    FROM sales s
    WHERE (${arSaleBaseExpr('s.legacy_receipt_number')}) IN (${placeholders})
  `).all(invoiceNos)
  for (const row of candidates) {
    const list = byBase.get(row.base)
    if (list) list.push(row)
    else byBase.set(row.base, [row])
  }
  return byBase
}

function matchSale(cr, byBase) {
  if (!cr.invoice_no) return null
  const candidates = byBase.get(cr.invoice_no)
  if (!candidates || !candidates.length) return null
  const crDay = localDateOf(cr.invoice_date)
  const crTotal = Math.round((Number(cr.total_amount_usd) || 0) * 100)
  let best = null
  let bestDayMatch = false
  for (const cand of candidates) {
    const dayMatch = localDateOf(cand.created_at) === crDay
    const totalMatch = Math.round((Number(cand.total_usd) || 0) * 100) === crTotal
    if (!dayMatch && !totalMatch) continue
    if (!best || (dayMatch && !bestDayMatch) || (dayMatch === bestDayMatch && cand.id < best.id)) {
      best = cand
      bestDayMatch = dayMatch
    }
  }
  return best
}

function matchFor(receivableId) {
  const cr = db.prepare('SELECT * FROM customer_receivables WHERE id = ?').get(receivableId)
  const byBase = lookupCandidatesByBase(cr.invoice_no ? [cr.invoice_no] : [])
  const match = matchSale(cr, byBase)
  return { matched_sale_id: match ? match.id : null }
}

check('M1: base number + same day matches sale 1', matchFor(901).matched_sale_id === 1)
check('M2: the day+total match (2025) wins over the same-base-number 2024 row', matchFor(902).matched_sale_id === 3)
check('M3: neither day nor total agrees -> unresolved (NULL)', matchFor(903).matched_sale_id === null)
check('M4: total-only fallback resolves the match across unrelated dates', matchFor(904).matched_sale_id === 5)
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

// M7/M8: "avoid heavy unindexed joins" (ground rule). A page-scale IN-list of
// LITERAL invoice numbers must SEEK migration 0182's expression index...
const invoiceNos = ['000001', '000050', '000077', '000088', '000099']
const inListPlan = db.prepare(`EXPLAIN QUERY PLAN
  SELECT s.id, (${arSaleBaseExpr('s.legacy_receipt_number')}) AS base FROM sales s
  WHERE (${arSaleBaseExpr('s.legacy_receipt_number')}) IN (${invoiceNos.map(() => '?').join(',')})
`).all(...invoiceNos)
const inListSeeks = inListPlan.filter((row) => /SEARCH s USING (COVERING )?INDEX idx_sales_legacy_receipt_base/.test(row.detail))
const inListScans = inListPlan.filter((row) => /SCAN s/.test(row.detail))
check('M7: the literal IN-list lookup SEEKs idx_sales_legacy_receipt_base', inListSeeks.length === 1)
check('M7: the literal IN-list lookup never falls back to a SCAN of sales', inListScans.length === 0)

// ...while the single-correlated-subquery-per-row shape that was rejected
// falls back to a full SCAN -- proving why the two-step lookup is required,
// not merely stylistic.
const correlatedPlan = db.prepare(`EXPLAIN QUERY PLAN
  SELECT (SELECT s.id FROM sales s WHERE (${arSaleBaseExpr('s.legacy_receipt_number')}) = cr.invoice_no LIMIT 1)
  FROM customer_receivables cr
`).all()
const correlatedScans = correlatedPlan.filter((row) => /SCAN s USING (COVERING )?INDEX idx_sales_legacy_receipt_base/.test(row.detail))
check('M8: the rejected correlated-subquery-per-row shape falls back to a SCAN (why it was rejected)', correlatedScans.length === 1)

console.log(`\n${checks} checks passed.`)

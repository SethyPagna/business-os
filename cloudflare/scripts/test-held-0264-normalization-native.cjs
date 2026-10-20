'use strict'
// Lane 6.0.891 (slice S6): the HELD migration ops/scripts/migration/held/0264_sale_status_normalization.sql,
// run on the full local chain (0001.., one transaction per file) with a seeded sales table of every
// status shape. It must:
//   * leave no retired status (partial_return, returned, awaiting_delivery) anywhere,
//   * keep revenue, pending (Not Paid) and collected figures identical, read the OLD way (return status
//     + status_before_return) and the NEW way (status alone) -- the figures the till and reports show,
//   * turn the return statuses into return_state tags and awaiting_delivery into the delivery tag,
//   * bump a revision only for the sales it touches, never flag a past full return, change loyalty
//     accrual only at or below the reset watermark,
//   * abort (rolling everything back) when a PRE guard fails or a mutated mapping breaks a POST guard,
//   * leave guard triggers that reject a retired write, fenced off in restore mode.
//
// 0263 (lane 6.0.890) is not in this checkout yet. When a 0263_*.sql exists in cloudflare/migrations the
// chain applies it; otherwise STUB_0263 below stands in for the columns and ledger table the plan names
// (sales.return_state, return_review_state, return_reviewed_at/_by_id/_by_name, sales.delivery_pending,
// sale_status_normalization_ledger). The stub is NOT the production migration.
//
// Run (from cloudflare/): node scripts/test-held-0264-normalization-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const root = path.join(__dirname, '..', '..')
const migrations = path.join(__dirname, '..', 'migrations')
const heldPath = path.join(root, 'ops', 'scripts', 'migration', 'held', '0264_sale_status_normalization.sql')
const heldText = fs.readFileSync(heldPath, 'utf8')
let passed = 0
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`) }

// STUB of lane 6.0.890's 0263 -- column and table names from PLAN-SALE-STATUS-TAGS.md section 3.
const STUB_0263 = `
ALTER TABLE sales ADD COLUMN return_state TEXT CHECK (return_state IS NULL OR return_state IN ('partial','full'));
ALTER TABLE sales ADD COLUMN return_review_state TEXT CHECK (return_review_state IS NULL OR return_review_state IN ('pending','confirmed'));
ALTER TABLE sales ADD COLUMN return_reviewed_at TEXT;
ALTER TABLE sales ADD COLUMN return_reviewed_by_id INTEGER;
ALTER TABLE sales ADD COLUMN return_reviewed_by_name TEXT;
ALTER TABLE sales ADD COLUMN delivery_pending INTEGER NOT NULL DEFAULT 0 CHECK (delivery_pending IN (0,1));
CREATE TABLE sale_status_normalization_ledger (
  sale_id INTEGER PRIMARY KEY,
  sale_status_before TEXT, status_before_return_before TEXT, status_before_cancel_before TEXT,
  sale_status_after TEXT, status_before_cancel_after TEXT, return_state_after TEXT,
  loyalty_accrual_before INTEGER, migrated_at TEXT
);`

function applyText(db, text) {
  db.exec('BEGIN')
  try { db.exec(text); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error }
}

function chain() {
  const db = new DatabaseSync(':memory:')
  const files = fs.readdirSync(migrations).filter(f => f.endsWith('.sql')).sort()
  for (const file of files) {
    try { applyText(db, fs.readFileSync(path.join(migrations, file), 'utf8')) } catch (error) { throw new Error(`${file}: ${error.message}`) }
  }
  if (!files.some(f => f.startsWith('0263_'))) applyText(db, STUB_0263)
  return db
}

const WATERMARK = 50
// A maintenance row needs the stock-epoch permit (migration 0243); restore mode is what fences the 0251 / 0264 triggers.
function restoreMode(db, on) {
  if (on) {
    db.exec("INSERT OR REPLACE INTO system_flags(key, value) SELECT 'stock_transaction_permit', value FROM system_flags WHERE key = 'stock_schema_epoch'")
    db.exec(`INSERT INTO system_flags(key, value) VALUES ('maintenance', '{"mode":"restore"}')`)
  } else {
    db.exec("DELETE FROM system_flags WHERE key IN ('maintenance', 'stock_transaction_permit')")
  }
}
function sale(db, row) {
  const cols = { total_usd: 10, subtotal_usd: row.total_usd ?? 10, sale_status: 'completed', ...row }
  if (!('subtotal_usd' in row)) cols.subtotal_usd = cols.total_usd
  const keys = Object.keys(cols)
  db.prepare(`INSERT INTO sales(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => cols[k]))
}
// loyalty_sale_birth_off zeroes accrual at insert while loyalty is off; restore mode is the only fence, as a backup restore does.
function earningSale(db, row) {
  restoreMode(db, true)
  try { sale(db, { ...row, loyalty_accrual: 1 }) } finally { restoreMode(db, false) }
}
function item(db, row) {
  const keys = Object.keys(row)
  db.prepare(`INSERT INTO sale_items(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => row[k]))
}
function ret(db, id, saleId, status, refund, lines) {
  db.prepare("INSERT INTO returns(id, sale_id, return_number, status, return_scope, total_refund_usd) VALUES (?,?,?,?,'customer',?)").run(id, saleId, `R-${id}`, status, refund)
  for (const [saleItemId, productId, quantity] of lines) db.prepare('INSERT INTO return_items(return_id, sale_item_id, product_id, quantity) VALUES (?,?,?,?)').run(id, saleItemId, productId, quantity)
}

// Expected result per seeded sale: [sale_status, status_before_cancel, return_state, delivery_pending]
const EXPECT = {
  1: ['completed', null, null, 0],
  2: ['awaiting_payment', null, null, 0],
  3: ['cancelled', 'completed', null, 0],
  4: ['awaiting_payment', null, 'partial', 0],
  5: ['completed', null, 'full', 0],
  6: ['completed', null, 'full', 0],
  7: ['completed', null, 'partial', 0],
  8: ['completed', null, null, 1],
  9: ['cancelled', 'awaiting_payment', 'partial', 0],
  10: ['cancelled', 'completed', null, 1],
  11: ['completed', null, 'partial', 0],
  12: ['completed', null, null, 0],
  13: ['completed', null, 'partial', 0],
  14: ['completed', null, null, 0],
  17: ['completed', null, 'full', 0],
  60: ['completed', null, 'full', 0],
  61: ['awaiting_payment', null, 'partial', 0],
}

function seed(db) {
  db.prepare("UPDATE system_flags SET value = json_set(value, '$.sales', ?) WHERE key = 'loyalty_points_reset'").run(WATERMARK)
  sale(db, { id: 1, receipt_number: 'S1', total_usd: 10 })
  sale(db, { id: 2, receipt_number: 'S2', total_usd: 7, sale_status: 'awaiting_payment' })
  sale(db, { id: 3, receipt_number: 'S3', total_usd: 5, sale_status: 'cancelled', status_before_cancel: 'completed' })
  // 4: Not Paid with a partial return -> stays Not Paid, partial tag
  sale(db, { id: 4, receipt_number: 'S4', total_usd: 20, sale_status: 'partial_return', status_before_return: 'awaiting_payment' })
  item(db, { id: 401, sale_id: 4, product_id: 1, quantity: 2 }); item(db, { id: 402, sale_id: 4, product_id: 2, quantity: 2 })
  ret(db, 41, 4, 'completed', 4, [[401, 1, 1]])
  // 5: paid, fully returned by a return row
  sale(db, { id: 5, receipt_number: 'S5', total_usd: 12, sale_status: 'returned', status_before_return: 'completed' })
  item(db, { id: 501, sale_id: 5, product_id: 1, quantity: 1 })
  ret(db, 51, 5, 'completed', 12, [[501, 1, 1]])
  // 6: imported returned sale, payment state lost (NULL), no return rows -- only returned_quantity
  sale(db, { id: 6, receipt_number: 'S6', total_usd: 9, sale_status: 'returned', status_before_return: null })
  item(db, { id: 601, sale_id: 6, product_id: 1, quantity: 3, returned_quantity: 3 })
  // 7: partial_return label with no evidence at all
  sale(db, { id: 7, receipt_number: 'S7', total_usd: 8, sale_status: 'partial_return' })
  // 8: delivery queue
  sale(db, { id: 8, receipt_number: 'S8', total_usd: 6, sale_status: 'awaiting_delivery' })
  // 9: cancelled while partial_return and Not Paid
  sale(db, { id: 9, receipt_number: 'S9', total_usd: 11, sale_status: 'cancelled', status_before_cancel: 'partial_return', status_before_return: 'awaiting_payment' })
  // 10: cancelled while awaiting_delivery
  sale(db, { id: 10, receipt_number: 'S10', total_usd: 4, sale_status: 'cancelled', status_before_cancel: 'awaiting_delivery' })
  // 11: returned delivery order
  sale(db, { id: 11, receipt_number: 'S11', total_usd: 14, sale_status: 'partial_return', status_before_return: 'awaiting_delivery' })
  // 12: blank status reads completed
  sale(db, { id: 12, receipt_number: 'S12', total_usd: 3, sale_status: '' })
  // 13: a payment-state sale that carries return evidence -> tag only, status untouched
  sale(db, { id: 13, receipt_number: 'S13', total_usd: 10 })
  item(db, { id: 1301, sale_id: 13, product_id: 1, quantity: 2 })
  ret(db, 131, 13, 'completed', 2, [[1301, 1, 1]])
  // 14: only a cancelled return -> no tag
  sale(db, { id: 14, receipt_number: 'S14', total_usd: 10 })
  item(db, { id: 1401, sale_id: 14, product_id: 1, quantity: 2 })
  ret(db, 141, 14, 'cancelled', 2, [[1401, 1, 1]])
  // 17: pre-reset returned sale with accrual 1 -> accrual zeroed by the 0251 trigger, allowed below the watermark
  earningSale(db, { id: 17, receipt_number: 'S17', total_usd: 6, sale_status: 'returned', status_before_return: 'completed' })
  item(db, { id: 1701, sale_id: 17, product_id: 1, quantity: 1 }); ret(db, 171, 17, 'completed', 6, [[1701, 1, 1]])
  // 60/61: above the watermark: accrual is already 0 (born with loyalty off); 61 stays Not Paid with accrual 1 (no trigger effect)
  sale(db, { id: 60, receipt_number: 'S60', total_usd: 5, sale_status: 'returned', status_before_return: 'completed', loyalty_accrual: 0 })
  item(db, { id: 6001, sale_id: 60, product_id: 1, quantity: 1 }); ret(db, 601, 60, 'completed', 5, [[6001, 1, 1]])
  earningSale(db, { id: 61, receipt_number: 'S61', total_usd: 15, sale_status: 'partial_return', status_before_return: 'awaiting_payment' })
  item(db, { id: 6101, sale_id: 61, product_id: 1, quantity: 2 }); ret(db, 611, 61, 'completed', 3, [[6101, 1, 1]])
}

// The reporting expressions, restated from lib/salesAnalytics.ts (pinned to the source below).
const STATUS = "COALESCE(NULLIF(s.sale_status, ''), 'completed')"
const REPORTING_OLD = `CASE WHEN ${STATUS} IN ('partial_return', 'returned') AND s.status_before_return = 'awaiting_payment' THEN 'awaiting_payment' ELSE ${STATUS} END`
const REPORTING_NEW = STATUS
const NET = `(MAX(COALESCE(s.subtotal_usd,0) - COALESCE(s.discount_usd,0) - COALESCE(s.membership_discount_usd,0), 0)
  - COALESCE((SELECT SUM(r.total_refund_usd) FROM returns r WHERE r.sale_id = s.id AND COALESCE(r.status,'completed') <> 'cancelled' AND COALESCE(r.return_scope,'customer') = 'customer'), 0))`
function kernel(db, reporting) {
  const one = where => db.prepare(`SELECT COUNT(*) AS n, ROUND(COALESCE(SUM(${NET}), 0), 4) AS usd FROM sales s WHERE ${where}`).get()
  return {
    revenue: { ...one(`${STATUS} <> 'cancelled'`) },
    pending: { ...one(`(${reporting}) = 'awaiting_payment'`) },
    collected: { ...one(`(${reporting}) NOT IN ('cancelled', 'awaiting_payment')`) },
  }
}

function failedGuards(db) {
  const patched = heldText.replace('ok INTEGER NOT NULL CHECK (ok = 1)', 'ok INTEGER NOT NULL')
  assert.notEqual(patched, heldText)
  db.exec('BEGIN')
  try {
    db.exec(patched)
    return db.prepare('SELECT check_name FROM sale_status_norm_guard_0264 WHERE ok <> 1 ORDER BY rowid').all().map(r => r.check_name)
  } finally { db.exec('ROLLBACK') }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'held0264-'))
let n = 0
const base = chain()
seed(base)
const seededFile = path.join(dir, 'seeded.sqlite')
base.exec(`VACUUM INTO '${seededFile.replace(/\\/g, '/')}'`)
function fresh() { const file = path.join(dir, `copy-${++n}.sqlite`); fs.copyFileSync(seededFile, file); return new DatabaseSync(file) }

check('the file is held (not in the migration chain), LF-only, and ships PRE / POST / RECOVERY notes', () => {
  assert.equal(fs.existsSync(path.join(migrations, '0264_sale_status_normalization.sql')), false)
  assert.equal(heldText.includes('\r'), false, 'LF only')
  for (const word of ['HELD', 'PRE (abort', 'POST (abort', 'RECOVERY']) assert.ok(heldText.includes(word), word)
})
check('the reporting expressions used here are the ones lib/salesAnalytics.ts has', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'salesAnalytics.ts'), 'utf8')
  for (const line of [
    "function saleStatusExpr(p: string): string { return `COALESCE(NULLIF(${p}sale_status, ''), 'completed')` }",
    "function recognizedExpr(p: string): string { return `${saleStatusExpr(p)} <> 'cancelled'` }",
    "AND ${retainedStatusExpr} = 'awaiting_payment' THEN 'awaiting_payment' ELSE ${saleStatusExpr(p)} END`",
    "function awaitingExpr(p: string, retainedStatusExpr = 'NULL'): string { return `(${reportingSaleStatusExpr(p, retainedStatusExpr)}) = 'awaiting_payment'` }",
    "function collectedSaleExpr(p: string, retainedStatusExpr = 'NULL'): string { return `(${reportingSaleStatusExpr(p, retainedStatusExpr)}) NOT IN ('cancelled', 'awaiting_payment')` }",
  ]) assert.ok(src.includes(line), line)
})

// ---- the happy path ----
const db = fresh()
const revisions = () => Object.fromEntries(db.prepare('SELECT sale_id, revision FROM sale_write_revisions').all().map(r => [r.sale_id, r.revision]))
const preRows = Object.fromEntries(db.prepare('SELECT * FROM sales').all().map(r => [r.id, { ...r }]))
const preRevisions = revisions()
const preOld = kernel(db, REPORTING_OLD)
applyText(db, heldText)

check('no retired status is left in sale_status or status_before_cancel', () => {
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sales WHERE sale_status IS NULL OR sale_status IN ('','partial_return','returned','awaiting_delivery') OR status_before_cancel IN ('partial_return','returned','awaiting_delivery')").get().n, 0)
  assert.deepEqual(db.prepare('SELECT DISTINCT sale_status FROM sales ORDER BY 1').all().map(r => r.sale_status), ['awaiting_payment', 'cancelled', 'completed'])
})
check('every shape maps as expected: Not Paid stays Not Paid; paid and lost payment state read completed; tags are set', () => {
  for (const [id, [status, beforeCancel, returnState, delivery]] of Object.entries(EXPECT)) {
    const row = db.prepare('SELECT sale_status, status_before_cancel, return_state, delivery_pending FROM sales WHERE id = ?').get(Number(id))
    assert.deepEqual([row.sale_status, row.status_before_cancel, row.return_state, row.delivery_pending], [status, beforeCancel, returnState, delivery], `sale ${id}`)
  }
})
check('kernel revenue / pending / collected are identical before and after, read the old way and the new way', () => {
  const afterOld = kernel(db, REPORTING_OLD)
  const afterNew = kernel(db, REPORTING_NEW)
  assert.deepEqual(afterOld, preOld)
  assert.deepEqual(afterNew, preOld)
  assert.ok(preOld.pending.n >= 3 && preOld.pending.usd > 0, 'the fixture has Not Paid sales (including returned ones) to lose')
  assert.equal(preOld.revenue.usd > preOld.pending.usd, true)
})
check('the ledger holds one before/after row per changed sale and nothing else changed status', () => {
  const ledger = db.prepare('SELECT * FROM sale_status_normalization_ledger ORDER BY sale_id').all()
  const changed = Object.entries(preRows).filter(([, r]) => r.sale_status !== EXPECT[r.id]?.[0] || r.status_before_cancel !== EXPECT[r.id]?.[1]).map(([id]) => Number(id))
  assert.deepEqual(ledger.map(r => r.sale_id), changed)
  const four = ledger.find(r => r.sale_id === 4)
  assert.deepEqual([four.sale_status_before, four.status_before_return_before, four.sale_status_after, four.return_state_after], ['partial_return', 'awaiting_payment', 'awaiting_payment', 'partial'])
  const nine = ledger.find(r => r.sale_id === 9)
  assert.deepEqual([nine.status_before_cancel_before, nine.status_before_cancel_after], ['partial_return', 'awaiting_payment'])
  assert.ok(ledger.every(r => r.migrated_at))
})
check('status_before_return and updated_at are never written; amounts are untouched', () => {
  for (const [id, before] of Object.entries(preRows)) {
    const after = db.prepare('SELECT status_before_return, updated_at, total_usd, amount_paid_usd FROM sales WHERE id = ?').get(Number(id))
    assert.deepEqual({ ...after }, { status_before_return: before.status_before_return, updated_at: before.updated_at, total_usd: before.total_usd, amount_paid_usd: before.amount_paid_usd }, `sale ${id}`)
  }
})
check('a past fully returned sale is not flagged: return_review_state stays NULL everywhere', () => {
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sales WHERE return_review_state IS NOT NULL').get().n, 0)
  assert.equal(db.prepare('SELECT return_state FROM sales WHERE id = 5').get().return_state, 'full')
})
check('revisions: +1 for each changed or tagged sale (+1 more where the loyalty trigger zeroes an accrual), unchanged for every other sale', () => {
  const after = revisions()
  const touched = new Set([...db.prepare('SELECT sale_id FROM sale_status_normalization_ledger').all().map(r => r.sale_id), 13])
  for (const id of Object.keys(preRows).map(Number)) {
    // the 0251 trigger zeroing an accrual is a second write to the sale
    const zeroed = db.prepare('SELECT loyalty_accrual FROM sales WHERE id = ?').get(id).loyalty_accrual !== preRows[id].loyalty_accrual ? 1 : 0
    assert.equal((after[id] ?? 0) - (preRevisions[id] ?? 0), touched.has(id) ? 1 + zeroed : 0, `sale ${id}`)
  }
})
check('loyalty: accrual changes only at or below the watermark, only to 0; sales above it and outside the ledger keep theirs', () => {
  assert.equal(db.prepare('SELECT loyalty_accrual FROM sales WHERE id = 17').get().loyalty_accrual, 0)
  assert.equal(db.prepare('SELECT loyalty_accrual FROM sales WHERE id = 61').get().loyalty_accrual, 1, 'Not Paid stays unearned, the trigger does not fire for it')
  assert.equal(db.prepare('SELECT loyalty_accrual FROM sales WHERE id = 60').get().loyalty_accrual, 0)
  for (const [id, before] of Object.entries(preRows)) {
    const accrual = db.prepare('SELECT loyalty_accrual FROM sales WHERE id = ?').get(Number(id)).loyalty_accrual
    if (accrual !== before.loyalty_accrual) assert.ok(Number(id) <= WATERMARK && accrual === 0, `sale ${id} changed above the watermark`)
  }
  assert.equal(db.prepare("SELECT value FROM system_flags WHERE key = 'loyalty_sale_earning:17:'").get().value, 'skipped')
})
check('every POST guard row is recorded as passed', () => {
  const rows = db.prepare('SELECT check_name, ok FROM sale_status_norm_guard_0264').all()
  assert.ok(rows.length >= 18)
  assert.ok(rows.every(r => r.ok === 1))
  for (const name of ['pre_vocab_known', 'pre_loyalty_off', 'post_pending_unchanged', 'post_expected_class', 'post_loyalty_pre_reset_only']) assert.ok(rows.some(r => r.check_name === name), name)
})

// ---- guard triggers ----
check('a retired status can no longer be inserted or updated into sales; the payment states still can', () => {
  for (const status of ['partial_return', 'returned', 'awaiting_delivery']) {
    assert.throws(() => db.prepare('INSERT INTO sales(sale_status) VALUES (?)').run(status), /sale_status_return_retired/, status)
    assert.throws(() => db.prepare('UPDATE sales SET sale_status = ? WHERE id = 1').run(status), /sale_status_return_retired/, status)
    assert.throws(() => db.prepare('UPDATE sales SET status_before_cancel = ? WHERE id = 3').run(status), /sale_status_return_retired/, status)
  }
  db.exec("UPDATE sales SET sale_status = 'awaiting_payment' WHERE id = 1")
  db.exec("UPDATE sales SET sale_status = 'completed' WHERE id = 1")
  db.exec("INSERT INTO sales(sale_status) VALUES ('completed')")
})
check('restore mode fences the guard off (a backup restore may bring old statuses back for normalization)', () => {
  restoreMode(db, true)
  db.exec("INSERT INTO sales(id, sale_status) VALUES (900, 'returned')")
  restoreMode(db, false)
  assert.throws(() => db.exec("UPDATE sales SET sale_status = 'returned' WHERE id = 900"), /sale_status_return_retired/)
  db.exec("DELETE FROM sales WHERE id = 900")
})
check('MUTANT: a guard without the restore fence blocks restore, so the fence assertion above discriminates', () => {
  const m = fresh()
  applyText(m, heldText.split("  AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')\nBEGIN").join('\nBEGIN'))
  restoreMode(m, true)
  assert.throws(() => m.exec("INSERT INTO sales(id, sale_status) VALUES (900, 'returned')"), /sale_status_return_retired/)
  m.close()
})

// ---- PRE guards ----
function expectAbort(label, mutate, guard) {
  const c = fresh()
  mutate(c)
  const tablesBefore = c.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get().n
  const rowsBefore = JSON.stringify(c.prepare('SELECT id, sale_status, status_before_cancel FROM sales ORDER BY id').all())
  assert.throws(() => applyText(c, heldText), /CHECK constraint failed/, label)
  assert.equal(c.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get().n, tablesBefore, `${label}: nothing created`)
  assert.equal(JSON.stringify(c.prepare('SELECT id, sale_status, status_before_cancel FROM sales ORDER BY id').all()), rowsBefore, `${label}: nothing written`)
  assert.equal(failedGuards(c)[0], guard, label)
  c.close()
}
check('PRE: an unknown sale_status, loyalty switched on, restore mode, a used ledger and a post-reset accrual each abort with nothing written', () => {
  expectAbort('unknown status', c => c.exec("UPDATE sales SET sale_status = 'weird' WHERE id = 1"), 'pre_vocab_known')
  expectAbort('loyalty on', c => c.exec("INSERT INTO settings(key, value) VALUES ('loyalty_points_enabled', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'"), 'pre_loyalty_off')
  expectAbort('restore mode', c => restoreMode(c, true), 'pre_not_restore_mode')
  expectAbort('ledger used', c => c.exec("INSERT INTO sale_status_normalization_ledger(sale_id) VALUES (1)"), 'pre_ledger_empty')
  expectAbort('post-reset accrual', c => earningSale(c, { id: 62, receipt_number: 'S62', total_usd: 5, sale_status: 'returned', status_before_return: 'completed' }), 'pre_no_post_reset_accrual')
})
check('PRE: a sale the 0161 money-precision trigger would reject is named before any write', () => {
  const c = fresh()
  // a legacy row whose money no longer foots: it passes its own era but the UPDATE trigger would refuse it
  c.exec('DROP TRIGGER sales_money_precision_update_0161')
  c.exec('UPDATE sales SET calculated_total_usd = 3 WHERE id = 7')
  assert.throws(() => applyText(c, heldText), /CHECK constraint failed/)
  assert.equal(failedGuards(c)[0], 'pre_money_updatable')
  c.close()
})

// ---- mutants: the POST guard must catch a wrong mapping ----
check('MUTANT: mapping a returned Not Paid sale to Completed (the wrong conversion) aborts the file on the POST guards', () => {
  const needle = "    WHEN s.sale_status = 'awaiting_payment' OR (s.sale_status IN ('partial_return', 'returned') AND s.status_before_return = 'awaiting_payment')\n      THEN 'awaiting_payment'\n"
  assert.ok(heldText.includes(needle))
  const mutant = heldText.replace(needle, "    WHEN s.sale_status = 'awaiting_payment'\n      THEN 'awaiting_payment'\n")
  const c = fresh()
  assert.throws(() => applyText(c, mutant), /CHECK constraint failed/)
  const failed = (() => {
    c.exec('BEGIN')
    try { c.exec(mutant.replace('ok INTEGER NOT NULL CHECK (ok = 1)', 'ok INTEGER NOT NULL')); return c.prepare('SELECT check_name FROM sale_status_norm_guard_0264 WHERE ok <> 1').all().map(r => r.check_name) } finally { c.exec('ROLLBACK') }
  })()
  for (const name of ['post_expected_class', 'post_pending_unchanged']) assert.ok(failed.includes(name), `${name} in ${failed}`)
  c.close()
})
check('MUTANT: a ledger that skips cancelled sales with a retired status_before_cancel leaves one behind and aborts', () => {
  const needle = "  OR s.status_before_cancel IN ('partial_return', 'returned', 'awaiting_delivery');\n\n-- Every row"
  assert.ok(heldText.includes(needle))
  const mutant = heldText.replace(needle, ';\n\n-- Every row')
  const c = fresh()
  assert.throws(() => applyText(c, mutant), /CHECK constraint failed/)
  c.exec('BEGIN')
  try {
    c.exec(mutant.replace('ok INTEGER NOT NULL CHECK (ok = 1)', 'ok INTEGER NOT NULL'))
    const failed = c.prepare('SELECT check_name FROM sale_status_norm_guard_0264 WHERE ok <> 1').all().map(r => r.check_name)
    assert.ok(failed.includes('post_no_retired_status') && failed.includes('post_ledger_complete'), String(failed))
  } finally { c.exec('ROLLBACK') }
  c.close()
})

// ---- recovery notes work ----
check('the RECOVERY statements in the header restore sale_status, status_before_cancel and the delivery tag from the ledger', () => {
  const start = heldText.indexOf('--   DROP TRIGGER IF EXISTS sales_status_vocab_ins;')
  const end = heldText.indexOf('sales.sale_status);', start) + 'sales.sale_status);'.length
  assert.ok(start > 0 && end > start)
  const recovery = heldText.slice(start, end).split('\n').map(line => line.replace(/^--\s{0,3}/, '')).join('\n')
  const c = fresh()
  applyText(c, heldText)
  c.exec(recovery)
  for (const [id, before] of Object.entries(preRows)) {
    const row = c.prepare('SELECT sale_status, status_before_cancel, delivery_pending FROM sales WHERE id = ?').get(Number(id))
    assert.equal(row.sale_status, before.sale_status, `sale ${id} status`)
    assert.equal(row.status_before_cancel, before.status_before_cancel, `sale ${id} before-cancel`)
  }
  assert.equal(c.prepare('SELECT delivery_pending FROM sales WHERE id = 8').get().delivery_pending, 0)
  c.close()
})
check('the file is not re-runnable: a second apply fails and changes nothing', () => {
  const before = JSON.stringify(db.prepare('SELECT id, sale_status, status_before_cancel, return_state FROM sales ORDER BY id').all())
  assert.throws(() => applyText(db, heldText), /already exists/)
  assert.equal(JSON.stringify(db.prepare('SELECT id, sale_status, status_before_cancel, return_state FROM sales ORDER BY id').all()), before)
})

db.close(); base.close()
fs.rmSync(dir, { recursive: true, force: true })
console.log(`GREEN held 0264 normalization: ${passed} checks`)

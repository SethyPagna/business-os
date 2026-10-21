'use strict'
// Lane 6.0.891 (slice S0): the DRAFT held 0265 (ops/scripts/migration/held/0265_return_owed_backfill.sql), the
// re-reviewed successor of held 0238, run after held 0264 on the full local chain. It writes the 0260 columns of
// pre-0260 returns, never a sale, and walks a sale's returns in id order against its remaining debt.
// 0263 is stubbed exactly as in test-held-0264-normalization-native.cjs when the real file is not in the chain.
//
// Run (from cloudflare/): node scripts/test-held-0265-draft-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const migrations = path.join(__dirname, '..', 'migrations')
const held = path.join(__dirname, '..', '..', 'ops', 'scripts', 'migration', 'held')
const text0264 = fs.readFileSync(path.join(held, '0264_sale_status_normalization.sql'), 'utf8')
const text0265 = fs.readFileSync(path.join(held, '0265_return_owed_backfill.sql'), 'utf8')
let passed = 0
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`) }
function applyText(db, text) {
  db.exec('BEGIN')
  try { db.exec(text); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error }
}
const STUB_0263 = `
ALTER TABLE sales ADD COLUMN return_state TEXT CHECK (return_state IS NULL OR return_state IN ('partial','full'));
ALTER TABLE sales ADD COLUMN return_review_state TEXT CHECK (return_review_state IS NULL OR return_review_state IN ('pending','confirmed'));
ALTER TABLE sales ADD COLUMN return_reviewed_at TEXT;
ALTER TABLE sales ADD COLUMN return_reviewed_by_id INTEGER;
ALTER TABLE sales ADD COLUMN return_reviewed_by_name TEXT;
ALTER TABLE sales ADD COLUMN delivery_pending INTEGER NOT NULL DEFAULT 0 CHECK (delivery_pending IN (0,1));
CREATE TABLE sale_status_normalization_ledger (
  sale_id INTEGER PRIMARY KEY, sale_status_before TEXT, status_before_return_before TEXT, status_before_cancel_before TEXT,
  sale_status_after TEXT, status_before_cancel_after TEXT, return_state_after TEXT, loyalty_accrual_before INTEGER, migrated_at TEXT
);`

function chain() {
  const db = new DatabaseSync(':memory:')
  const files = fs.readdirSync(migrations).filter(f => f.endsWith('.sql')).sort()
  for (const file of files) {
    try { applyText(db, fs.readFileSync(path.join(migrations, file), 'utf8')) } catch (error) { throw new Error(`${file}: ${error.message}`) }
  }
  if (!files.some(f => f.startsWith('0263_'))) applyText(db, STUB_0263)
  return db
}
function sale(db, row) {
  const cols = { total_usd: 10, subtotal_usd: 10, sale_status: 'completed', exchange_rate: 4100, ...row }
  const keys = Object.keys(cols)
  db.prepare(`INSERT INTO sales(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => cols[k]))
}
let seq = 0
function ret(db, id, saleId, refund, extra = {}) {
  const cols = { id, sale_id: saleId, return_number: `R-${id}-${++seq}`, status: 'completed', return_scope: 'customer', total_refund_usd: refund,
    money_precision_version: 0, calculated_refund_usd: null, rounding_adjustment_usd: 0, ...extra }
  const keys = Object.keys(cols)
  db.prepare(`INSERT INTO returns(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => cols[k]))
}

function seed(db) {
  sale(db, { id: 1, sale_status: 'awaiting_payment' }); ret(db, 11, 1, 4)                                   // owner example: $10 Not Paid, $4 back
  sale(db, { id: 2, sale_status: 'awaiting_payment', amount_paid_usd: 3 }); ret(db, 21, 2, 4)              // partly paid: owes $3 after
  sale(db, { id: 3, sale_status: 'awaiting_payment', amount_paid_usd: 7 }); ret(db, 31, 3, 4)              // $3 owed, $1 was cash
  sale(db, { id: 4, sale_status: 'awaiting_payment' }); ret(db, 41, 4, 6); ret(db, 42, 4, 6)               // sequence: 6 then 4
  sale(db, { id: 5, amount_paid_usd: 10 }); ret(db, 51, 5, 4)                                              // paid sale
  sale(db, { id: 6, sale_status: 'awaiting_payment' }); ret(db, 61, 6, 4, { status: 'cancelled' })         // cancelled return
  sale(db, { id: 7, sale_status: 'partial_return', status_before_return: 'awaiting_payment' }); ret(db, 71, 7, 4) // pre-0264 shape
  sale(db, { id: 8, sale_status: 'awaiting_payment', exchange_rate: 0 }); ret(db, 81, 8, 2)                // money unreadable: refused
  sale(db, { id: 9, sale_status: 'awaiting_payment', amount_paid_khr: 41000 }); ret(db, 91, 9, 3)          // debt already covered: all cash
  sale(db, { id: 10, sale_status: 'awaiting_payment' }); ret(db, 101, 10, 4, { refund_currency: 'USD', owed_reduction_usd: 4 }); ret(db, 102, 10, 7) // 0260 code first
  sale(db, { id: 11 }); ret(db, 111, 11, 3, { return_scope: 'supplier' })                                  // supplier return: not ours
}

const EXPECT = { 11: 4, 21: 4, 31: 3, 41: 6, 42: 4, 51: 0, 71: 4, 91: 0, 102: 6 }
const rows = db => Object.fromEntries(db.prepare('SELECT id, refund_currency, owed_reduction_usd FROM returns').all().map(r => [r.id, { currency: r.refund_currency, owed: r.owed_reduction_usd }]))

const base = chain()
seed(base)
const pre = rows(base)
const salesJson = db => JSON.stringify(db.prepare('SELECT * FROM sales ORDER BY id').all())

check('the draft is held (not in the chain), LF-only, and writes no sale (no UPDATE sales / sale_status assignment)', () => {
  assert.equal(fs.existsSync(path.join(migrations, '0265_return_owed_backfill.sql')), false)
  assert.equal(text0265.includes('\r'), false)
  const code = text0265.split('\n').filter(l => !l.startsWith('--')).join('\n')
  assert.equal(/UPDATE\s+sales\b/i.test(code), false)
  assert.equal(/'(returned|partial_return)'/.test(code.replace(/IN \('partial_return', 'returned', 'awaiting_delivery'\)/, '')), false)
})
check('PRE: it refuses to run before 0264 (a retired status is still in sales) and writes nothing', () => {
  const fresh = chain(); seed(fresh)
  assert.throws(() => applyText(fresh, text0265), /CHECK constraint failed/)
  assert.deepEqual(rows(fresh), pre)
  assert.equal(fresh.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'return_owed_backfill_0265'").get().n, 0)
  fresh.close()
})

applyText(base, text0264)
const afterSales = salesJson(base)
applyText(base, text0265)
const got = rows(base)

check('each pre-0260 return on a Not Paid sale gets the debt it lowered (owner example, partial payment, excess cash, sequence, counted-first)', () => {
  for (const [id, owed] of Object.entries(EXPECT)) {
    assert.equal(got[id].owed, owed, `return ${id}`)
    assert.equal(got[id].currency, 'USD', `return ${id} currency`)
  }
})
check('returns on a paid sale default to USD / 0; what the 0260 code wrote, a cancelled return, a refused sale and a supplier return are left alone', () => {
  assert.deepEqual(got[51], { currency: 'USD', owed: 0 })
  assert.deepEqual(got[101], { currency: 'USD', owed: 4 })
  assert.deepEqual(got[61], pre[61])
  assert.deepEqual(got[81], pre[81], 'sale 8 money cannot be read')
  assert.deepEqual(got[111], pre[111])
  assert.equal(base.prepare("SELECT value FROM return_owed_pre_0265 WHERE metric = 'null_currency_remaining'").get().value, 1)
})
check('the debt lowered never exceeds the debt, and the refund totals are untouched', () => {
  assert.equal(got[11].owed + got[41].owed + got[42].owed, 14)
  assert.equal(base.prepare('SELECT ROUND(SUM(total_refund_usd), 4) AS usd FROM returns').get().usd, 4 + 4 + 4 + 12 + 4 + 4 + 4 + 2 + 3 + 11 + 3)
  for (const r of base.prepare('SELECT id, total_refund_usd, owed_reduction_usd FROM returns').all()) assert.ok(r.owed_reduction_usd <= r.total_refund_usd, `return ${r.id}`)
})
check('no sale row is written: statuses, amounts and tags are exactly as 0264 left them', () => {
  assert.equal(salesJson(base), afterSales)
  assert.equal(base.prepare("SELECT sale_status FROM sales WHERE id = 7").get().sale_status, 'awaiting_payment')
})
check('MUTANT: walking a sale\'s returns newest first moves the debt onto the wrong return', () => {
  const mutant = text0265.replace('ROW_NUMBER() OVER (PARTITION BY c.sale_id ORDER BY c.id) AS n', 'ROW_NUMBER() OVER (PARTITION BY c.sale_id ORDER BY c.id DESC) AS n')
  assert.notEqual(mutant, text0265)
  const db = chain(); seed(db); applyText(db, text0264); applyText(db, mutant)
  const m = rows(db)
  assert.notEqual(m[41].owed, EXPECT[41])
  assert.equal(m[41].owed + m[42].owed, 10, 'still the debt in total')
  db.close()
})
check('the file is not re-runnable: a second apply fails and changes nothing', () => {
  const before = JSON.stringify(rows(base))
  assert.throws(() => applyText(base, text0265), /already exists/)
  assert.equal(JSON.stringify(rows(base)), before)
})

base.close()
console.log(`GREEN held 0265 draft: ${passed} checks`)

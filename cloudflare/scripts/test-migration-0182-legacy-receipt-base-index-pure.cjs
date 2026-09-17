// Pins migration 0182 (idx_sales_legacy_receipt_base) against a SYNTHETIC
// fixture built on the REAL migration chain (better-sqlite3, no production
// data).
//
// 0182 exists for one reason: P11-11's AR -> sale lookup matches
// customer_receivables.invoice_no (always the BARE legacy number, '006416')
// against sales.legacy_receipt_number, which carries either the retired
// old-system label '000001@2024-07-18' (migration 0107) or the bare number
// with no '@' at all. The match therefore needs the "base number" expression,
// and 0107's index on the RAW column cannot serve it -- so the lookup
// degrades to a full SCAN of every legacy sale, per page of receivables.
//
// What this file proves, in order:
//  1. The index does not exist before 0182 and does after it (so 0182, not
//     an earlier migration, is what creates it).
//  2. POSITIVE CONTROL -- the same query on a chain-minus-0182 database
//     SCANs. Without this, "it SEEKs" would be indistinguishable from
//     SQLite happening to pick any plan, and the guard would pass even if
//     0182 were reverted to a no-op.
//  3. With 0182 the identical query SEEKs via idx_sales_legacy_receipt_base.
//  4. The expression the CALL SITE builds (contacts.ts's arSaleBaseExpr) is
//     character-for-character the expression the index is built on. SQLite
//     only recognizes an expression index on an exact match, so a cosmetic
//     edit to either side silently costs the seek -- this is the check that
//     catches that, and it is the whole reason the migration is worth having.
//  5. Correctness, not just speed: a suffixed row and a bare row both resolve
//     to their base number, and a base number shared by two different years
//     returns BOTH candidate sales (the day/total tiebreak is the caller's
//     job, deliberately not the index's).
//  6. Re-applying 0182 is idempotent, and the documented RECOVERY drop works.
//  7. The migration file is LF-only, per the repository's D1 rule.
//
// Run: node scripts/test-migration-0182-legacy-receipt-base-index-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')

const migrationsDir = path.join(__dirname, '..', 'migrations')
const MIGRATION_FILE = '0182_sales_legacy_receipt_base_index.sql'
const INDEX_NAME = 'idx_sales_legacy_receipt_base'
const migration0182 = fs.readFileSync(path.join(migrationsDir, MIGRATION_FILE), 'utf8')

let checks = 0
function check(label, cond) {
  assert.ok(cond, `FAIL: ${label}`)
  checks++
  console.log(`  ok  ${label}`)
}

// The base-number expression, written exactly once here and reused for both
// the plan probes and the call-site comparison below.
const baseExpr = (col) =>
  `CASE WHEN instr(${col}, '@') > 0 THEN substr(${col}, 1, instr(${col}, '@') - 1) ELSE ${col} END`

const LOOKUP_SQL = `SELECT s.id FROM sales s WHERE ${baseExpr('s.legacy_receipt_number')} = '006416'`

function buildDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = OFF')
  // Load the full chain UP TO (but not including) 0182, so the index can only
  // come from 0182 itself.
  const priorFiles = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => f < MIGRATION_FILE)
  for (const file of priorFiles) db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))

  // Enough legacy rows that SQLite's planner has a real reason to prefer an
  // index; ANALYZE afterwards so the choice is made on statistics, not on a
  // one-row table where any plan is as good as another.
  const insert = db.prepare(
    'INSERT INTO sales (id, created_at, legacy_receipt_number, total_usd) VALUES (?, ?, ?, ?)',
  )
  const many = db.transaction(() => {
    for (let i = 1; i <= 800; i++) {
      const n = String(i).padStart(6, '0')
      insert.run(i, `2024-07-18 10:00:00`, `${n}@2024-07-18`, 10 + i)
    }
    // 006416 in two different years -- the production shape that forces the
    // caller's day/total tiebreak (33,033 such repeated pairs were measured).
    insert.run(9001, '2024-07-18 11:00:00', '006416@2024-07-18', 53.7)
    insert.run(9002, '2025-03-04 09:00:00', '006416@2025-03-04', 12.5)
    // A post-0107 sale: bare number, no '@' at all.
    insert.run(9003, '2026-01-09 08:00:00', '006416', 99)
    // A sale with no legacy number at all, to prove NULL does not match.
    insert.run(9004, '2026-01-10 08:00:00', null, 1)
  })
  many()
  db.exec('ANALYZE')
  return db
}

function planFor(db, sql) {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(' | ')
}

// ---- 1 + 2. Before 0182: no index, and the lookup SCANs -------------------
const db = buildDb()
check(
  `${INDEX_NAME} does not exist before 0182 runs`,
  db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name=?").get(INDEX_NAME).n === 0,
)

const planBefore = planFor(db, LOOKUP_SQL)
check(
  `POSITIVE CONTROL -- without 0182 the base-number lookup SCANs sales (${planBefore})`,
  /SCAN/.test(planBefore) && !new RegExp(INDEX_NAME).test(planBefore),
)

// ---- 3. After 0182: the index exists and the same query SEEKs -------------
db.exec(migration0182)
check(
  `0182 creates ${INDEX_NAME} (POST ASSERTION in the migration header: expected 1)`,
  db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name=?").get(INDEX_NAME).n === 1,
)

db.exec('ANALYZE')
const planAfter = planFor(db, LOOKUP_SQL)
check(
  `with 0182 the identical query SEEKs via ${INDEX_NAME} (${planAfter})`,
  new RegExp(`SEARCH.*${INDEX_NAME}`).test(planAfter),
)

// ---- 4. The call site builds the EXACT indexed expression -----------------
// SQLite matches an expression index only on an exact expression match, so
// this is the check that stops a cosmetic edit on either side from quietly
// turning the seek back into the scan that 0182 was written to remove.
const contactsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'contacts.ts'), 'utf8')
const callSiteLine = contactsSource
  .split(/\r?\n/)
  .find((line) => line.includes('instr(${col}') && line.includes('substr(${col}'))
assert.ok(callSiteLine, 'contacts.ts no longer has an arSaleBaseExpr template line -- did the AR lookup change?')
const callSiteExpr = callSiteLine.trim().replace(/^`/, '').replace(/`,?$/, '').replace(/\$\{col\}/g, 'legacy_receipt_number')
check(
  'contacts.ts arSaleBaseExpr is character-for-character the expression 0182 indexes',
  callSiteExpr === baseExpr('legacy_receipt_number'),
)

const indexSqlInFile = migration0182.replace(/--[^\n]*\n/g, ' ').replace(/\s+/g, ' ').trim()
check(
  'the migration indexes that same expression (same functions, same argument order)',
  indexSqlInFile.includes(baseExpr('legacy_receipt_number').replace(/\s+/g, ' ')),
)

// ---- 5. Correctness of what the seek returns ------------------------------
const hits = db.prepare(
  `SELECT s.id, s.created_at, s.total_usd FROM sales s WHERE ${baseExpr('s.legacy_receipt_number')} = '006416' ORDER BY s.id`,
).all()
check('the base number resolves suffixed AND bare rows alike (9001, 9002, 9003)',
  hits.map((r) => r.id).join(',') === '9001,9002,9003')
check('a base number repeated across years returns BOTH candidates, so the caller can tiebreak on day + total',
  hits.filter((r) => r.created_at.startsWith('2024')).length === 1 &&
  hits.filter((r) => r.created_at.startsWith('2025')).length === 1)
check('a sale with no legacy receipt number never matches a base number',
  !hits.some((r) => r.id === 9004))
check('a truncated base number is not swept in as a prefix match',
  db.prepare(`SELECT COUNT(*) n FROM sales s WHERE ${baseExpr('s.legacy_receipt_number')} = '00641'`).get().n === 0)

// ---- 6. Idempotence and the documented recovery ---------------------------
db.exec(migration0182)
check('re-running 0182 is idempotent (CREATE INDEX IF NOT EXISTS, still exactly one index)',
  db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name=?").get(INDEX_NAME).n === 1)
check('0182 changes no row (it is purely additive)',
  db.prepare('SELECT COUNT(*) n FROM sales').get().n === 804)

db.exec(`DROP INDEX IF EXISTS ${INDEX_NAME}`)
check('the documented RECOVERY drop removes the index and leaves every row intact',
  db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name=?").get(INDEX_NAME).n === 0 &&
  db.prepare('SELECT COUNT(*) n FROM sales').get().n === 804)

// ---- 7. The repository's LF-only rule for migration SQL -------------------
check('0182 is LF-only, per the D1 migration rule',
  !migration0182.includes(String.fromCharCode(13)))

console.log(`\n${checks} checks passed.`)

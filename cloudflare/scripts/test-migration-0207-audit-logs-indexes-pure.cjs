// Pins migration 0207 (the audit page's two audit_logs indexes) on the REAL
// migration chain (better-sqlite3, synthetic rows, no production data).
//
//  1. Neither index exists before 0207; both exist after it.
//  2. POSITIVE CONTROL: without 0207 the keyset page walk scans + temp-sorts,
//     and the per-user walk scans.
//  3. With 0207 both seek through an index with no temp sort, with NO ANALYZE.
//  4. Results are identical with and without the indexes; no audit row changes.
//  5. Re-applying is idempotent; the documented recovery drops both.
//  6. The file is LF-only and is the only file claiming number 0207.
//
// Run: node scripts/test-migration-0207-audit-logs-indexes-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')

const migrationsDir = path.join(__dirname, '..', 'migrations')
const FILE = '0207_audit_logs_indexes.sql'
const migration = fs.readFileSync(path.join(migrationsDir, FILE), 'utf8')
const INDEXES = ['idx_audit_logs_created', 'idx_audit_logs_user_created']

let checks = 0
function check(label, cond) {
  assert.ok(cond, `FAIL: ${label}`)
  checks++
  console.log(`  ok  ${label}`)
}

const PAGE_SQL = `SELECT id, user_id, action, created_at FROM audit_logs
  WHERE created_at >= '2026-09-05 00:00:00' AND created_at < '2026-09-20 00:00:00'
    AND (created_at < ? OR (created_at = ? AND id < ?))
  ORDER BY created_at DESC, id DESC LIMIT 51`
const PAGE_ARGS = ['2026-09-18 05:00:00', '2026-09-18 05:00:00', 100000]
const USER_SQL = `SELECT id, action, created_at FROM audit_logs
  WHERE user_id = 3 AND created_at >= '2026-09-05 00:00:00' AND created_at < '2026-09-20 00:00:00'
  ORDER BY created_at DESC, id DESC LIMIT 51`

const db = new Database(':memory:')
db.pragma('foreign_keys = OFF')
for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort().filter((f) => f < FILE)) {
  db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
}
const insertAudit = db.prepare('INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
db.transaction(() => {
  for (let i = 1; i <= 3000; i++) {
    insertAudit.run(i % 6, `u${i % 6}`, i % 2 ? 'update' : 'login', 'sale', String(i), '{}', `2026-09-${String(1 + (i % 25)).padStart(2, '0')} 0${i % 10}:00:00`)
  }
})()

const plan = (sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(PAGE_ARGS.length && /\?/.test(sql) ? PAGE_ARGS : []).map((r) => r.detail).join(' | ')
const count = (name) => db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name=?").get(name).n

for (const name of INDEXES) check(`${name} does not exist before 0207`, count(name) === 0)
const pageBefore = plan(PAGE_SQL)
const userBefore = plan(USER_SQL)
check(`POSITIVE CONTROL: the page walk scans + temp-sorts without 0207 (${pageBefore})`, /SCAN audit_logs/.test(pageBefore) && /TEMP B-TREE/.test(pageBefore))
check(`POSITIVE CONTROL: the per-user walk does not use the new index without 0207 (${userBefore})`, !/idx_audit_logs_user_created/.test(userBefore))
const rowsBefore = [db.prepare(PAGE_SQL).all(...PAGE_ARGS), db.prepare(USER_SQL).all()]
const auditCount = db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n

db.exec(migration)
for (const name of INDEXES) check(`${name} exists after 0207`, count(name) === 1)
const pageAfter = plan(PAGE_SQL)
const userAfter = plan(USER_SQL)
check(`the page walk seeks idx_audit_logs_created with no temp sort (${pageAfter})`, /SEARCH audit_logs USING (COVERING )?INDEX idx_audit_logs_created/.test(pageAfter) && !/TEMP B-TREE/.test(pageAfter))
check(`the per-user walk seeks idx_audit_logs_user_created (${userAfter})`, /SEARCH audit_logs USING (COVERING )?INDEX idx_audit_logs_user_created \(user_id=\? AND created_at>\? AND created_at<\?\)/.test(userAfter))

const rowsAfter = [db.prepare(PAGE_SQL).all(...PAGE_ARGS), db.prepare(USER_SQL).all()]
check('page rows identical with the indexes', JSON.stringify(rowsAfter[0]) === JSON.stringify(rowsBefore[0]) && rowsBefore[0].length === 51)
check('per-user rows identical with the indexes', JSON.stringify(rowsAfter[1]) === JSON.stringify(rowsBefore[1]) && rowsBefore[1].length > 0)
check('0207 changed no audit row', db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n === auditCount)

db.exec(migration)
check('re-applying 0207 is idempotent', INDEXES.every((name) => count(name) === 1))
db.exec('DROP INDEX IF EXISTS idx_audit_logs_created; DROP INDEX IF EXISTS idx_audit_logs_user_created;')
check('documented recovery removes both indexes', INDEXES.every((name) => count(name) === 0))

check('0207 is LF-only', !migration.includes('\r'))
const claimants = fs.readdirSync(migrationsDir).filter((f) => f.startsWith('0207_'))
check('exactly one file claims number 0207', claimants.length === 1 && claimants[0] === FILE)

console.log(`\n${checks} checks passed`)

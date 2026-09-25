// Pins migration 0196 (the two audit_logs indexes) on the REAL migration
// chain (better-sqlite3, synthetic rows, no production data).
//
//  1. Neither index exists before 0196; both exist after it.
//  2. POSITIVE CONTROL: without 0196 the sales-list history count and the
//     new-country alert query SCAN audit_logs.
//  3. With 0196 both SEEK through their index (the alert query without a
//     temp b-tree), with NO ANALYZE -- production never runs ANALYZE, so the
//     plan must win on the schema alone.
//  4. Results are identical with and without the indexes.
//  5. Re-applying is idempotent; the documented recovery drops both.
//  6. The file is LF-only.
//
// Run: node scripts/test-migration-0196-audit-log-indexes-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')

const migrationsDir = path.join(__dirname, '..', 'migrations')
const FILE = '0196_audit_logs_indexes.sql'
const migration = fs.readFileSync(path.join(migrationsDir, FILE), 'utf8')
const INDEXES = ['idx_audit_logs_entity_entity_id', 'idx_audit_logs_action_created']

let checks = 0
function check(label, cond) {
  assert.ok(cond, `FAIL: ${label}`)
  checks++
  console.log(`  ok  ${label}`)
}

// The two production query shapes, verbatim in their WHERE/ORDER.
const HISTORY_SQL = `SELECT s.id, (SELECT COUNT(*) FROM audit_logs a
  WHERE a.entity = 'sale' AND a.entity_id = CAST(s.id AS TEXT)) AS n
  FROM sales s ORDER BY s.id`
const ALERT_SQL = `SELECT id, user_id, user_name, details, created_at FROM audit_logs
  WHERE action = 'device_login_new_country' AND created_at > datetime('2026-09-25 12:00:00', '-1 day')
  ORDER BY created_at DESC LIMIT 20`

const db = new Database(':memory:')
db.pragma('foreign_keys = OFF')
for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort().filter((f) => f < FILE)) {
  db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
}
const insertSale = db.prepare('INSERT INTO sales (id, receipt_number, created_at, total_usd) VALUES (?, ?, ?, 1)')
const insertAudit = db.prepare('INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, created_at) VALUES (1, ?, ?, ?, ?, ?, ?)')
db.transaction(() => {
  for (let i = 1; i <= 50; i++) insertSale.run(i, `R${i}`, '2026-09-20 03:00:00')
  for (let i = 1; i <= 3000; i++) {
    const kind = i % 3 === 0 ? ['update', 'sale', String(1 + (i % 50))] : i % 3 === 1 ? ['login', 'user', String(i % 7)] : ['update', 'product', String(i)]
    insertAudit.run(`u${i % 5}`, kind[0], kind[1], kind[2], '{}', `2026-09-${String(1 + (i % 25)).padStart(2, '0')} 0${i % 10}:00:00`)
  }
  for (let i = 0; i < 12; i++) insertAudit.run('u1', 'device_login_new_country', 'user', '1', `{"n":${i}}`, `2026-09-${i < 6 ? '25' : '10'} 0${i}:30:00`)
})()

const plan = (sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(' | ')
const count = (name) => db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name=?").get(name).n

// 1 + 2
for (const name of INDEXES) check(`${name} does not exist before 0196`, count(name) === 0)
const historyBefore = plan(HISTORY_SQL)
const alertBefore = plan(ALERT_SQL)
check(`POSITIVE CONTROL: history count scans audit_logs without 0196 (${historyBefore})`, /SCAN a\b/.test(historyBefore))
check(`POSITIVE CONTROL: alert query scans + temp-sorts without 0196 (${alertBefore})`, /SCAN audit_logs/.test(alertBefore) && /TEMP B-TREE/.test(alertBefore))
const rowsBefore = [db.prepare(HISTORY_SQL).all(), db.prepare(ALERT_SQL).all()]
const auditCount = db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n

// 3
db.exec(migration)
for (const name of INDEXES) check(`${name} exists after 0196`, count(name) === 1)
const historyAfter = plan(HISTORY_SQL)
const alertAfter = plan(ALERT_SQL)
check(`history count seeks idx_audit_logs_entity_entity_id (${historyAfter})`, /SEARCH a USING (COVERING )?INDEX idx_audit_logs_entity_entity_id \(entity=\? AND entity_id=\?\)/.test(historyAfter))
check(`alert query seeks idx_audit_logs_action_created with no temp sort (${alertAfter})`, /SEARCH audit_logs USING INDEX idx_audit_logs_action_created \(action=\? AND created_at>\?\)/.test(alertAfter) && !/TEMP B-TREE/.test(alertAfter))

// 4
const rowsAfter = [db.prepare(HISTORY_SQL).all(), db.prepare(ALERT_SQL).all()]
check('history counts identical with the index', JSON.stringify(rowsAfter[0]) === JSON.stringify(rowsBefore[0]) && rowsBefore[0].some((r) => r.n > 0))
check('alert rows identical with the index', JSON.stringify(rowsAfter[1]) === JSON.stringify(rowsBefore[1]) && rowsBefore[1].length === 6)
check('0196 changed no audit row', db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n === auditCount)

// 5
db.exec(migration)
check('re-applying 0196 is idempotent', INDEXES.every((name) => count(name) === 1))
db.exec('DROP INDEX IF EXISTS idx_audit_logs_entity_entity_id; DROP INDEX IF EXISTS idx_audit_logs_action_created;')
check('documented recovery removes both indexes', INDEXES.every((name) => count(name) === 0))

// 6
check('0196 is LF-only', !migration.includes('\r'))

console.log(`\n${checks} checks passed`)

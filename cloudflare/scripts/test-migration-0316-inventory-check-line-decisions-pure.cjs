'use strict'
// Pins migration 0316 (inventory_check_approvals.line_decisions_json) on the REAL migration chain: the column is added with its default and JSON-object check, a row that existed
// before reads '{}', PRE and POST fire, the four 0286 triggers still hold, and the file is shaped the way the D1 runner splits it.
//
// Run (from cloudflare/): node scripts/test-migration-0316-inventory-check-line-decisions-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const directory = path.join(__dirname, '../migrations')
const migration = '0316_inventory_check_line_decisions.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const files = fs.readdirSync(directory).filter(file => file.endsWith('.sql') && file < migration).sort()
const chain = () => { const db = new DatabaseSync(':memory:'); for (const file of files) db.exec(fs.readFileSync(path.join(directory, file), 'utf8')); return db }
const code = text => text.replace(/^--.*$/gm, '')
const T = 'inventory_check_approvals'
let passed = 0
const check = (name, run) => { run(); passed++; console.log(`PASS ${name}`) }
const seed = db => {
  db.exec("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,scope_json,started_at,updated_at,closed_at) VALUES('s1',1,1,7,'t','closed','{}','2026-11-02T01:00:00Z','2026-11-02T01:00:00Z','2026-11-02T01:00:00Z')")
  db.exec("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,updated_at) VALUES('s1',5,1,'{}',3,'{}','issue',5,'x','2026-11-02T01:00:00Z')")
  db.exec(`INSERT INTO ${T}(session_id,organization_id,branch_id,lines,submitted_by,submitted_at) VALUES('s1',1,1,1,7,'2026-11-02T01:00:00Z')`)
}
const decisions = (db, id = 's1') => db.prepare(`SELECT line_decisions_json AS j FROM ${T} WHERE session_id=?`).get(id).j

check('the file is LF-only, numbered 0316 once, keeps rowid, has PRE / POST / RECOVERY with the partial-apply procedure, and no ANALYZE', () => {
  assert.equal(sql.includes('\r'), false)
  assert.equal(/WITHOUT\s+ROWID/i.test(code(sql)), false)
  assert.match(sql, /^-- PRE:/m); assert.match(sql, /^-- POST:/m); assert.match(sql, /^-- RECOVERY:/m); assert.match(sql, /^-- Cost:/m)
  assert.match(sql, /Partial apply/); assert.match(sql, /d1_migrations/); assert.match(sql, /Recorded but the column absent/); assert.match(sql, /Not recorded but the column exists/)
  assert.equal(/\bANALYZE\b|PRAGMA\s+optimize/i.test(code(sql)), false)
  assert.deepEqual(fs.readdirSync(directory).filter(file => file.startsWith('0316_')), [migration])
})

check('it is exactly PRE, one ALTER TABLE ADD COLUMN, POST: no comment-only statement, at most 5 compound terms', () => {
  const statements = code(sql).split(';').map(part => part.trim()).filter(Boolean)
  assert.equal(statements.length, 3)
  assert.match(statements[0], /^SELECT CASE WHEN/)
  assert.match(statements[1], /^ALTER TABLE inventory_check_approvals ADD COLUMN line_decisions_json TEXT NOT NULL DEFAULT '\{\}' CHECK/)
  assert.match(statements[2], /^SELECT CASE WHEN/)
  for (const statement of statements) assert.ok((statement.match(/\b(UNION|INTERSECT|EXCEPT)\b/gi) || []).length < 5, 'at most 5 compound SELECT terms')
})

check('the column is added with default {} and a JSON-object check; a row that existed before reads {}; nothing else changes', () => {
  const db = chain(); seed(db)
  const before = db.prepare(`SELECT * FROM ${T}`).all().map(row => ({ ...row }))
  const objects = db.prepare('SELECT type,name FROM sqlite_master ORDER BY name').all().map(row => `${row.type}:${row.name}`)
  db.exec(sql)
  assert.equal(decisions(db), '{}')
  assert.deepEqual(db.prepare(`SELECT * FROM ${T}`).all().map(row => { const { line_decisions_json, ...rest } = row; return rest }), before, 'every other column of the existing row is as it was')
  assert.deepEqual(db.prepare('SELECT type,name FROM sqlite_master ORDER BY name').all().map(row => `${row.type}:${row.name}`), objects, 'no table, index or trigger was added or dropped')
  const info = db.prepare(`SELECT * FROM pragma_table_info('${T}') WHERE name='line_decisions_json'`).get()
  assert.deepEqual({ type: info.type, notnull: info.notnull, dflt: info.dflt_value }, { type: 'TEXT', notnull: 1, dflt: "'{}'" })
  assert.throws(() => db.prepare(`UPDATE ${T} SET line_decisions_json=? WHERE session_id='s1'`).run('not json'), /CHECK/)
  assert.throws(() => db.prepare(`UPDATE ${T} SET line_decisions_json=? WHERE session_id='s1'`).run('[]'), /CHECK/)
  assert.throws(() => db.prepare(`UPDATE ${T} SET line_decisions_json=NULL WHERE session_id='s1'`).run(), /NOT NULL/)
  assert.ok(db.prepare('SELECT rowid FROM inventory_check_approvals').get(), 'a rowid table')
})

check('PRE aborts a second run and a database without the 0286 table; POST fires on a row holding a decision', () => {
  const db = chain(); db.exec(sql)
  assert.throws(() => db.exec(sql), /inventory_check_line_decisions_0316_pre|duplicate column/)
  const bare = new DatabaseSync(':memory:')
  assert.throws(() => bare.exec(sql), /inventory_check_line_decisions_0316_pre/)
  const dirty = chain(); seed(dirty)
  const post = sql.slice(sql.lastIndexOf('SELECT CASE WHEN'))
  dirty.exec(sql); dirty.prepare(`UPDATE ${T} SET line_decisions_json='{"5":{"decision":"reject"}}'`).run()
  assert.throws(() => dirty.exec(post), /inventory_check_line_decisions_0316_post/, 'the POST assertion sees a non-empty decision column')
})

check('the 0286 triggers still hold: a pending row takes a decision, a decided row never changes again, the identity columns stay frozen, and a claimed row can still take a line decision', () => {
  const db = chain(); seed(db); db.exec(sql)
  db.prepare(`UPDATE ${T} SET line_decisions_json=? WHERE session_id='s1'`).run('{"5":{"decision":"reject","by":7}}')
  assert.equal(decisions(db), '{"5":{"decision":"reject","by":7}}')
  assert.throws(() => db.prepare(`UPDATE ${T} SET lines=9 WHERE session_id='s1'`).run(), /inventory_check_approval_immutable/)
  db.prepare(`UPDATE ${T} SET status='approved',decided_by=9,decided_by_name='admin',decided_at='2026-11-02T02:00:00Z',decision_request_id='dec-12345678' WHERE session_id='s1'`).run()
  assert.throws(() => db.prepare(`UPDATE ${T} SET line_decisions_json='{}' WHERE session_id='s1'`).run(), /inventory_check_approval_immutable/, 'frozen once decided, like every column')
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND tbl_name=?").get(T).n, 4)
  const claimed = chain(); seed(claimed); claimed.exec(sql)
  claimed.prepare(`UPDATE ${T} SET applying_request_id='k',applying_by=7,applying_at='2026-11-02T01:30:00Z' WHERE session_id='s1'`).run()
  claimed.prepare(`UPDATE ${T} SET line_decisions_json='{"5":{"decision":"modify","counted":4}}' WHERE session_id='s1'`).run()
  assert.equal(decisions(claimed), '{"5":{"decision":"modify","counted":4}}', 'a decision on a line of a claimed approval is allowed by the table; the Worker guards the line itself')
})

console.log(`PASS test-migration-0316-inventory-check-line-decisions-pure (${passed})`)

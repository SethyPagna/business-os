'use strict'
// Pins migration 0286 (inventory_check_approvals) on the REAL migration chain: a new table only, the PRE/POST assertions fire, the three
// 0259 tables are byte-for-byte unchanged, and the table's own rules hold (status, line count, decided-row immutability, identity columns,
// delete only while the restore maintenance flag is set).
//
// Run: node scripts/test-migration-0286-inventory-check-approvals-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const directory = path.join(__dirname, '../migrations')
const migration = '0286_inventory_check_approvals.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
assert.equal(sql.includes('\r'), false, 'trigger and migration SQL is LF-only')
const files = fs.readdirSync(directory).filter(file => file.endsWith('.sql') && file < migration).sort()
const chain = () => { const db = new DatabaseSync(':memory:'); for (const file of files) db.exec(fs.readFileSync(path.join(directory, file), 'utf8')); return db }

let passed = 0
const check = (name, run) => { run(); passed++; console.log(`PASS ${name}`) }
const T = 'inventory_check_approvals'
const HISTORY = ['inventory_check_sessions', 'inventory_check_items', 'inventory_check_events']
const dump = (db, table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => ({ ...row }))
const objects = db => db.prepare("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => ({ ...row }))

function seed(db) {
  db.exec("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,scope_json,started_at,updated_at,closed_at) VALUES('s1',1,1,7,'t','closed','{}','2026-11-02T01:00:00Z','2026-11-02T01:00:00Z','2026-11-02T01:00:00Z')")
  db.exec("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,updated_at) VALUES('s1',5,1,'{}',3,'{}','issue',5,'Count differs from stock','2026-11-02T01:00:00Z')")
  db.exec("INSERT INTO inventory_check_events(session_id,product_id,actor_id,action,request_id,request_hash,before_json,after_json,result_json,created_at) VALUES('s1',NULL,7,'create','req-12345678','h','{}','{}','{}','2026-11-02T01:00:00Z')")
}
const insertPending = (db, id = 's1', extra = '') => db.prepare(`INSERT INTO ${T}(session_id,organization_id,branch_id,lines,submitted_by,submitted_at${extra ? ',' + extra.split('=')[0] : ''}) VALUES(?,1,1,2,7,'2026-11-02T01:00:00Z'${extra ? ',' + extra.split('=')[1] : ''})`).run(id)
const decide = (db, status = 'approved') => db.prepare(`UPDATE ${T} SET status=?,decided_by=9,decided_by_name='admin',decided_at='2026-11-02T02:00:00Z',decision_request_id='dec-12345678',applied_json='{"lines":{"5":{"before":3,"target":5,"after":5,"at":"x"}}}' WHERE session_id='s1'`).run(status)

check('the table is new, adds one table, two indexes and four triggers, and changes no history row', () => {
  const db = chain(); seed(db)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name=?').get(T).n, 0, 'absent before')
  const before = Object.fromEntries(HISTORY.map(table => [table, dump(db, table)]))
  const beforeObjects = objects(db)
  db.exec(sql)
  for (const table of HISTORY) assert.deepEqual(dump(db, table), before[table], `${table} unchanged`)
  const added = objects(db).filter(row => !beforeObjects.some(old => old.name === row.name))
  assert.deepEqual(added, [
    { type: 'table', name: T },
    { type: 'trigger', name: 'inventory_check_approvals_claim' },
    { type: 'trigger', name: 'inventory_check_approvals_decided' },
    { type: 'trigger', name: 'inventory_check_approvals_identity' },
    { type: 'trigger', name: 'inventory_check_approvals_no_delete' },
    { type: 'index', name: 'inventory_check_approvals_pending' },
    { type: 'index', name: 'inventory_check_approvals_progress' },
  ].sort((a, b) => a.name.localeCompare(b.name)), 'exactly the table, its two indexes and its four triggers')
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${T}`).get().n, 0, 'no approval row is created by the migration (existing submissions stay as they are)')
})

check('the PRE assertion aborts a second run and a database without the 0259 tables', () => {
  const db = chain(); db.exec(sql)
  assert.throws(() => db.exec(sql), /inventory_check_approvals_0286_pre|already exists/)
  const bare = new DatabaseSync(':memory:')
  assert.throws(() => bare.exec(sql), /inventory_check_approvals_0286_pre/)
  assert.equal(bare.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name=?').get(T).n, 0, 'nothing created on a failed PRE')
})

check('status, line count, the pending/decided pairing, the note length and the applied document are constrained', () => {
  const db = chain(); seed(db); db.exec(sql)
  insertPending(db)
  assert.throws(() => db.prepare(`UPDATE ${T} SET status='maybe' WHERE session_id='s1'`).run(), /CHECK|constraint/i)
  const second = (id, tail) => db.prepare(`INSERT INTO ${T}(session_id,organization_id,branch_id,lines,submitted_by,submitted_at${tail.cols}) VALUES(?,1,1,${tail.lines ?? 1},7,'2026-11-02T01:00:00Z'${tail.vals})`).run(id)
  db.exec("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,scope_json,started_at,updated_at) VALUES('s2',1,1,7,'t','closed','{}','2026-11-02T01:00:00Z','2026-11-02T01:00:00Z')")
  assert.throws(() => second('s2', { cols: '', vals: '', lines: 0 }), /CHECK|constraint/i, 'lines must be positive')
  assert.throws(() => second('s2', { cols: ",status", vals: ",'approved'" }), /CHECK|constraint/i, 'a decided row needs who, when and the request id')
  assert.throws(() => second('s2', { cols: ',decided_by', vals: ',9' }), /CHECK|constraint/i, 'a pending row cannot carry a decision')
  assert.throws(() => second('s2', { cols: ',applied_json', vals: ",'[1]'" }), /CHECK|constraint/i, 'the applied document is an object')
  assert.throws(() => second('s2', { cols: ',applied_json', vals: ",'nope'" }), /CHECK|constraint/i, 'the applied document is JSON')
  assert.throws(() => second('s2', { cols: ',decision_note', vals: `,'${'x'.repeat(501)}'` }), /CHECK|constraint/i, 'the note is at most 500 characters')
  assert.throws(() => second('missing', { cols: '', vals: '' }), /FOREIGN KEY|constraint/i, 'an approval belongs to a session')
})

check('a pending row gains applied entries and is decided once; a decided row never changes again', () => {
  const db = chain(); seed(db); db.exec(sql)
  insertPending(db)
  db.prepare(`UPDATE ${T} SET applied_json='{"lines":{"5":{"before":3,"target":5,"after":5,"at":"x"}}}' WHERE session_id='s1'`).run()
  decide(db)
  const row = db.prepare(`SELECT * FROM ${T}`).get()
  assert.equal(row.status, 'approved'); assert.equal(row.decided_by_name, 'admin')
  assert.throws(() => db.prepare(`UPDATE ${T} SET decision_note='again' WHERE session_id='s1'`).run(), /inventory_check_approval_immutable/)
  assert.throws(() => db.prepare(`UPDATE ${T} SET status='rejected' WHERE session_id='s1'`).run(), /inventory_check_approval_immutable/)
  assert.throws(() => db.prepare(`UPDATE ${T} SET applied_json='{}' WHERE session_id='s1'`).run(), /inventory_check_approval_immutable/)
  const rejected = chain(); seed(rejected); rejected.exec(sql); insertPending(rejected); decide(rejected, 'rejected')
  assert.throws(() => rejected.prepare(`UPDATE ${T} SET status='approved' WHERE session_id='s1'`).run(), /inventory_check_approval_immutable/, 'a rejected row cannot be approved later')
})

check('the identity columns never change, even on a pending row', () => {
  const db = chain(); seed(db); db.exec(sql); insertPending(db)
  for (const set of ["session_id='s9'", 'organization_id=2', 'branch_id=2', 'lines=3', 'submitted_by=8', "submitted_at='2026-11-03T00:00:00Z'", "baselines_json='{\"5\":99}'"]) {
    assert.throws(() => db.prepare(`UPDATE ${T} SET ${set} WHERE session_id='s1'`).run(), /inventory_check_approval_immutable/, set)
  }
})

check('applying is claimed before stock moves: the claim names a request, an approver and a time, forbids rejecting, changes hands only by a counted takeover, and is released only while nothing is planned or applied', () => {
  const db = chain(); seed(db); db.exec(sql); insertPending(db)
  const row = () => ({ ...db.prepare(`SELECT applying_request_id,applying_by,applying_at,takeovers,plan_json,applied_json,status,closed_json FROM ${T}`).get() })
  const claim = "applying_request_id='approve-request-01',applying_by=9,applying_at='2026-11-02T01:30:00Z',plan_json='{\"5\":{\"before\":3,\"target\":5}}'"
  assert.deepEqual(row(), { applying_request_id: null, applying_by: null, applying_at: null, takeovers: 0, plan_json: '{}', applied_json: '{}', status: 'pending', closed_json: null }, 'a new approval is unclaimed, with an empty plan and no takeover')
  assert.throws(() => db.prepare(`UPDATE ${T} SET applying_request_id='only-the-id'`).run(), /CHECK|constraint/i, 'a claim names the request AND the approver AND the time')
  assert.throws(() => db.prepare(`UPDATE ${T} SET applying_request_id='an-id-1234',applying_by=9`).run(), /CHECK|constraint/i, 'a claim without a time is not a claim')
  assert.throws(() => db.prepare(`UPDATE ${T} SET plan_json='[1]'`).run(), /CHECK|constraint/i, 'the plan is an object')
  assert.throws(() => db.prepare(`UPDATE ${T} SET baselines_json='nope'`).run(), /CHECK|constraint/i, 'the baselines are JSON')
  assert.throws(() => db.prepare(`UPDATE ${T} SET takeovers=1`).run(), /inventory_check_approval_immutable/, 'an unclaimed approval has nothing to take over')
  db.prepare(`UPDATE ${T} SET ${claim}`).run()
  db.prepare(`UPDATE ${T} SET plan_json='{"5":{"before":3,"target":6}}',applying_at='2026-11-02T01:31:00Z'`).run()
  assert.throws(() => db.prepare(`UPDATE ${T} SET applying_request_id='approve-request-02'`).run(), /inventory_check_approval_immutable/, 'the claim never changes request by itself')
  assert.throws(() => db.prepare(`UPDATE ${T} SET applying_by=10`).run(), /inventory_check_approval_immutable/, 'nor hands without a counted takeover')
  assert.throws(() => db.prepare(`UPDATE ${T} SET applying_by=10,takeovers=2,plan_json='{}'`).run(), /inventory_check_approval_immutable/, 'a takeover counts exactly one')
  assert.throws(() => db.prepare(`UPDATE ${T} SET applying_by=10,takeovers=1`).run(), /inventory_check_approval_immutable/, 'a takeover starts from an empty plan: the lines are planned afresh')
  assert.throws(() => db.prepare(`UPDATE ${T} SET takeovers=1`).run(), /inventory_check_approval_immutable/, 'the count never moves without the claim moving')
  assert.throws(() => db.prepare(`UPDATE ${T} SET applying_request_id=NULL,applying_by=NULL,applying_at=NULL`).run(), /inventory_check_approval_immutable/, 'and is not released while a plan is stored')
  assert.throws(() => db.exec("UPDATE inventory_check_approvals SET status='rejected',decided_by=9,decided_at='x',decision_request_id='x'"), /inventory_check_approval_immutable/, 'a claimed approval is never rejected')
  assert.throws(() => db.exec("UPDATE inventory_check_approvals SET closed_json='{}'"), /CHECK|constraint/i, 'closed_json belongs to a decided row')
  db.prepare(`UPDATE ${T} SET applying_by=10,applying_request_id='take-request-02',applying_at='2026-11-02T01:50:00Z',takeovers=1,plan_json='{}'`).run()
  assert.deepEqual(row(), { applying_request_id: 'take-request-02', applying_by: 10, applying_at: '2026-11-02T01:50:00Z', takeovers: 1, plan_json: '{}', applied_json: '{}', status: 'pending', closed_json: null }, 'another approver took it over, counted')
  assert.throws(() => db.prepare(`UPDATE ${T} SET takeovers=0`).run(), /inventory_check_approval_immutable/, 'the count never goes back')
  db.prepare(`UPDATE ${T} SET plan_json='{}',applying_request_id=NULL,applying_by=NULL,applying_at=NULL`).run()
  assert.deepEqual(row(), { applying_request_id: null, applying_by: null, applying_at: null, takeovers: 1, plan_json: '{}', applied_json: '{}', status: 'pending', closed_json: null }, 'released: nothing planned, nothing applied')
  db.prepare(`UPDATE ${T} SET ${claim}`).run()
  db.prepare(`UPDATE ${T} SET applied_json='{"lines":{"5":{"before":3,"target":5,"after":5,"at":"x"}}}',plan_json='{}'`).run()
  assert.throws(() => db.prepare(`UPDATE ${T} SET applying_request_id=NULL,applying_by=NULL,applying_at=NULL`).run(), /inventory_check_approval_immutable/, 'and never once a line was applied')
  // A claimed approval ends by being approved, or by being CLOSED: no stock moves, the applied lines stay and the rest are recorded as not applied. A close may leave the status rejected only when it says so.
  const closed = '{"lines":{"6":"inventory_check_count_below_damaged"}}'
  db.prepare(`UPDATE ${T} SET status='rejected',decided_by=9,decided_by_name='admin',decided_at='2026-11-02T02:00:00Z',decision_request_id='close-12345678',closed_json=?`).run(closed)
  assert.equal(row().status, 'rejected', 'a closed claimed approval may be recorded as not applied'); assert.equal(row().closed_json, closed)
  assert.throws(() => db.prepare(`UPDATE ${T} SET closed_json='{}'`).run(), /inventory_check_approval_immutable/, 'and is then frozen like any decided row')
  const approved = chain(); seed(approved); approved.exec(sql); insertPending(approved); approved.prepare(`UPDATE ${T} SET ${claim}`).run()
  approved.prepare(`UPDATE ${T} SET applied_json='{"lines":{"5":{"before":3,"target":5,"after":5,"at":"x"}}}',plan_json='{}'`).run()
  decide(approved)
  assert.equal(approved.prepare(`SELECT status FROM ${T}`).get().status, 'approved', 'a claimed approval is decided by being approved')
  const objectOnly = chain(); seed(objectOnly); objectOnly.exec(sql); insertPending(objectOnly)
  assert.throws(() => objectOnly.exec("UPDATE inventory_check_approvals SET status='rejected',decided_by=9,decided_at='x',decision_request_id='x',closed_json='[1]'"), /CHECK|constraint/i, 'closed_json is a JSON object')
})

check('a row is deleted only while the restore maintenance flag is set', () => {
  const db = chain(); seed(db); db.exec(sql); insertPending(db)
  assert.throws(() => db.prepare(`DELETE FROM ${T}`).run(), /inventory_check_approval_immutable/)
  db.prepare("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'").run()
  db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)").run(JSON.stringify({ mode: 'restore', token: 't' }))
  db.prepare(`DELETE FROM ${T}`).run()
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${T}`).get().n, 0, 'restore may clear the table')
})

check('lines replaced by a newer count: superseded_json is an object that starts empty, can grow while the approval is pending (claimed or not) and is frozen with the decision', () => {
  const db = chain(); seed(db); db.exec(sql)
  insertPending(db)
  const replaced = () => db.prepare(`SELECT superseded_json AS json FROM ${T}`).get().json
  assert.equal(replaced(), '{}', 'a new approval replaced nothing')
  assert.throws(() => db.prepare(`UPDATE ${T} SET superseded_json='[1]'`).run(), /CHECK|constraint/i, 'an object, not an array')
  assert.throws(() => db.prepare(`UPDATE ${T} SET superseded_json='not json'`).run(), /CHECK|constraint|malformed/i, 'valid JSON only')
  db.prepare(`UPDATE ${T} SET superseded_json=json_patch(superseded_json,'{"5":"s2"}')`).run()
  assert.equal(replaced(), '{"5":"s2"}', 'a newer count replaces a line of a pending approval')
  db.prepare(`UPDATE ${T} SET applying_request_id='approve-request-01',applying_by=9,applying_at='2026-11-02T01:30:00Z',plan_json='{"6":{"before":3,"target":5}}'`).run()
  db.prepare(`UPDATE ${T} SET superseded_json=json_patch(superseded_json,'{"7":"s3"}')`).run()
  assert.equal(replaced(), '{"5":"s2","7":"s3"}', 'a claimed approval can lose a line that was not planned')
  db.prepare(`UPDATE ${T} SET status='approved',decided_by=9,decided_by_name='admin',decided_at='2026-11-02T02:00:00Z',decision_request_id='dec-12345678',applied_json='{"lines":{"6":{"before":3,"target":5,"after":5,"at":"x"}}}',plan_json='{}'`).run()
  assert.throws(() => db.prepare(`UPDATE ${T} SET superseded_json='{}'`).run(), /inventory_check_approval_immutable/, 'frozen with the decision')
  // An approval every line of which was replaced is rejected in the commit that replaced the last one (an unclaimed row may be rejected, with no stock applied).
  const fresh = chain(); seed(fresh); fresh.exec(sql); insertPending(fresh)
  fresh.prepare(`UPDATE ${T} SET superseded_json='{"5":"s2"}',status='rejected',decided_by=7,decided_by_name='counter',decided_at='2026-11-02T02:00:00Z',decision_request_id='req-12345678'`).run()
  assert.equal(fresh.prepare(`SELECT status FROM ${T}`).get().status, 'rejected')
})

check('the progress index serves the question "did another approval of this branch apply anything since this count" by decided or last claimed time', () => {
  const db = chain(); db.exec(sql)
  const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT session_id FROM ${T} a WHERE a.branch_id=1 AND COALESCE(a.decided_at,a.applying_at)>'2026-11-02T01:00:00Z'`).all().map(row => row.detail).join(' | ')
  assert.match(plan, /inventory_check_approvals_progress/, plan)
})

const chainColumns = (() => { const db = chain(); return Object.fromEntries(HISTORY.map(table => [table, db.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('${table}')`).get().n])) })()
check('the pending index serves the organization queue and nothing else is added to the history tables', () => {
  const db = chain(); db.exec(sql)
  const prepared = db.prepare(`EXPLAIN QUERY PLAN SELECT session_id FROM ${T} WHERE organization_id=1 AND status='pending' ORDER BY submitted_at DESC`)
  assert.match(prepared.all().map(row => row.detail).join(' | '), /inventory_check_approvals_pending/)
  for (const table of HISTORY) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('${table}')`).get().n, chainColumns[table], `${table} gained no column`)
})

console.log(`${passed} groups passed`)

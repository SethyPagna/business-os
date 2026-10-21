'use strict'
// Pins migration 0268 (restore carve-out for inventory-check and branch-cutover history guards, lane 6.0.917)
// on the real chain of every earlier migration (0267 belongs to another lane and may be absent):
// the six triggers differ from their 0259/0224/0225 definitions ONLY in the WHEN clause, outside a restore
// every table still refuses what it refused before, and under the restore flag the delete + re-insert a
// restore performs succeeds. The UPDATE guards are not carved out.
//
// Run: node scripts/test-migration-0268-restore-history-carveout-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const directory = path.join(__dirname, '../migrations')
const migration = '0268_restore_history_trigger_carveout.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const PREDICATE = "NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')"
const CHANGED = ['inventory_check_events_no_delete', 'inventory_check_sessions_no_delete', 'inventory_check_items_no_delete',
  'branch_cutovers_no_delete', 'branch_cutovers_initial', 'branch_cutovers_no_active_insert']

const base = new Database(':memory:')
for (const file of fs.readdirSync(directory).filter(f => f.endsWith('.sql') && f < migration).sort()) base.exec(fs.readFileSync(path.join(directory, file), 'utf8'))
const schema = base.serialize()
base.close()
const open = (migrated = true) => { const db = new Database(schema); if (migrated) db.exec(sql); return db }

let passed = 0
function check(name, run) { run(); passed++; console.log(`PASS ${name}`) }
const norm = text => text.replace(/\s+/g, ' ').trim()
const marks = CHANGED.map(() => '?').join(',')
const triggerSql = db => Object.fromEntries(db.prepare(`SELECT name, sql FROM sqlite_master WHERE type='trigger' AND name IN (${marks})`)
  .all(...CHANGED).map(r => [r.name, norm(r.sql)]))
const split = text => {
  const m = text.match(/^(CREATE TRIGGER \S+ BEFORE (?:INSERT|DELETE) ON \S+) (?:WHEN (.*?) )?(BEGIN .*)$/)
  assert.ok(m, text)
  return { head: m[1], when: m[2] || null, body: m[3] }
}
// maintenance writes need the stock-transaction permit (0243), as the roundtrip test grants it.
function setMaintenance(db, value) {
  db.prepare("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'").run()
  try {
    db.prepare("DELETE FROM system_flags WHERE key='maintenance'").run()
    if (value) db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)").run(JSON.stringify(value))
  } finally { db.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'").run() }
}
const restoreOn = db => setMaintenance(db, { mode: 'restore', token: 't' })
const restoreOff = db => setMaintenance(db, null)

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const hex = 'a'.repeat(64)
function insertCutover(db, n) {
  db.prepare(`INSERT INTO branch_cutovers(operation_id,begin_request_id,actor_id,organization_id,control_incarnation,maintenance_token,
    source_branch_id,target_branch_id,intent_json,intent_digest,source_preimage_json,target_preimage_json,maintenance_flag_json,
    capture_digest,snapshot_digest,verification_digest,created_at,updated_at)
    VALUES(?,?,7,'org',?,?,1,2,'{}',?,'{"id":1}','{"id":2}','{}',?,?,?,'2026-10-01 00:00:00','2026-10-01 00:00:00')`)
    .run(uuid(n), `begin_request_${n}`, uuid(90), uuid(91), hex, hex, hex, hex)
}
// capturing -> snapshots -> verifying -> ready -> completed through the real transition triggers.
function completeCutover(db, n) {
  const id = uuid(n)
  const step = (phase, set = '') => db.prepare(`UPDATE branch_cutovers SET phase=?, revision=revision+1${set} WHERE operation_id=?`).run(phase, id)
  step('snapshots', `, manifest_json='{}', manifest_digest='${hex}'`)
  step('verifying'); step('ready')
  step('completed', `, terminal_json='{"version":1,"operationId":"${id}","kind":"completed"}'`)
}
function seedHistory(db) {
  db.prepare(`INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,scope_json,started_at,updated_at)
    VALUES('s1',1,1,7,'Count','{}','2026-10-01','2026-10-01'),('s2',1,1,7,'Second','{}','2026-10-02','2026-10-02')`).run()
  db.prepare(`INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json)
    VALUES('s1',11,1,'{}',3,'{}'),('s1',12,1,'{}',4,'{}')`).run()
  db.prepare(`INSERT INTO inventory_check_events(session_id,product_id,actor_id,action,request_id,request_hash,before_json,after_json,result_json,created_at)
    VALUES('s1',NULL,7,'create','r1','h','{}','{}','{}','2026-10-01')`).run()
  insertCutover(db, 1); completeCutover(db, 1)
}
const tables = ['inventory_check_sessions', 'inventory_check_items', 'inventory_check_events', 'branch_cutovers']
const dumpOf = db => JSON.stringify(tables.map(t => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()))

check('the file is LF-only and carries its PRE, POST and RECOVERY notes', () => {
  assert.equal(sql.includes('\r'), false)
  for (const word of ['PRE:', 'POST:', 'RECOVERY:']) assert.ok(sql.includes(word), word)
})

check('only the WHEN clause of the six triggers changed; heads and bodies are identical', () => {
  const before = triggerSql(open(false)), after = triggerSql(open())
  assert.deepEqual(Object.keys(before).sort(), [...CHANGED].sort())
  assert.deepEqual(Object.keys(after).sort(), [...CHANGED].sort())
  for (const name of CHANGED) {
    const b = split(before[name]), a = split(after[name])
    assert.equal(a.head, b.head, name)
    assert.equal(a.body, b.body, name)
    assert.ok(!before[name].includes("'restore'"), name)
    assert.equal(a.when, b.when ? `(${b.when}) AND ${PREDICATE}` : PREDICATE, name)
  }
})

check('every other trigger is untouched, and none was added or removed', () => {
  const rest = db => db.prepare(`SELECT name, sql FROM sqlite_master WHERE type='trigger' AND name NOT IN (${marks}) ORDER BY name`).all(...CHANGED)
  assert.deepEqual(rest(open()), rest(open(false)))
  const count = db => db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger'").get().n
  assert.equal(count(open()), count(open(false)))
})

check('PRE/POST: rows of the four tables are identical before and after (schema only)', () => {
  const db = open(false)
  seedHistory(db)
  const before = dumpOf(db)
  db.exec(sql)
  assert.equal(dumpOf(db), before)
})

check('outside a restore every table still refuses DELETE, also under a maintenance flag of another mode', () => {
  for (const flag of [null, { mode: 'import' }]) {
    const db = open(); seedHistory(db)
    if (flag) setMaintenance(db, flag)
    for (const [t, error] of [['inventory_check_events', /inventory_check_history_immutable/], ['inventory_check_items', /inventory_check_history_immutable/],
      ['inventory_check_sessions', /inventory_check_history_immutable/], ['branch_cutovers', /branch_cutover_no_delete/]]) {
      assert.throws(() => db.prepare(`DELETE FROM ${t}`).run(), error, `${t} ${flag}`)
    }
    assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_check_sessions').get().n, 2)
  }
})

check('UPDATE stays refused with and without the restore flag (the update guards are not carved out)', () => {
  for (const on of [false, true]) {
    const db = open(); seedHistory(db)
    if (on) restoreOn(db)
    assert.throws(() => db.prepare("UPDATE inventory_check_events SET request_id='x'").run(), /inventory_check_history_immutable/)
    assert.throws(() => db.prepare("UPDATE inventory_check_sessions SET title='x'").run(), /inventory_check_baseline_immutable/)
    assert.throws(() => db.prepare('UPDATE inventory_check_items SET baseline_quantity=99').run(), /inventory_check_baseline_immutable/)
    assert.throws(() => db.prepare("UPDATE branch_cutovers SET updated_at='x'").run(), /branch_cutover_(terminal_immutable|invalid_transition)/)
  }
})

check('outside a restore branch_cutovers refuses a second active cutover and a non-fresh insert', () => {
  const db = open(); seedHistory(db)
  insertCutover(db, 2)
  assert.throws(() => insertCutover(db, 3), /branch_cutover_active_insert_refused/)
  db.prepare("UPDATE branch_cutovers SET phase='aborted', revision=1, terminal_json=? WHERE operation_id=?")
    .run(`{"version":1,"operationId":"${uuid(2)}","kind":"aborted"}`, uuid(2))
  const copy = db.prepare('SELECT * FROM branch_cutovers WHERE operation_id=?').get(uuid(1))
  const columns = Object.keys(copy)
  const put = () => db.prepare(`INSERT INTO branch_cutovers(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`)
    .run(...columns.map(c => c === 'operation_id' ? uuid(4) : c === 'begin_request_id' ? 'begin_request_4' : c === 'terminal_json' ? copy[c].replace(uuid(1), uuid(4)) : copy[c]))
  assert.throws(put, /branch_cutover_invalid_initial_state/)
  restoreOn(db)
  put() // the same row is exactly what a restore re-inserts
})

function roundTrip(withUnfinished) {
  const source = open(); seedHistory(source)
  if (withUnfinished) insertCutover(source, 2)
  const before = dumpOf(source)
  const rows = Object.fromEntries(tables.map(t => [t, source.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]))
  // The live database differs and has no unfinished cutover: the restore flag cannot be set while one is active.
  const db = open(); seedHistory(db)
  db.prepare("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,scope_json,started_at,updated_at) VALUES('live',1,1,7,'Live','{}','x','x')").run()
  assert.notEqual(dumpOf(db), before)
  restoreOn(db)
  for (const t of [...tables].reverse()) db.prepare(`DELETE FROM ${t}`).run()
  assert.equal(db.prepare('SELECT COUNT(*) n FROM branch_cutovers').get().n, 0)
  for (const t of tables) for (const row of rows[t]) {
    const columns = Object.keys(row)
    db.prepare(`INSERT INTO ${t}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...columns.map(c => row[c]))
  }
  assert.equal(dumpOf(db), before)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM branch_cutovers WHERE phase='completed'").get().n, 1)
  return db
}

check('under the restore flag a full delete and re-insert of the four tables is byte-identical, completed cutover included', () => {
  const db = roundTrip(false)
  restoreOff(db)
  assert.throws(() => db.prepare('DELETE FROM branch_cutovers').run(), /branch_cutover_no_delete/, 'guards are live again once the flag is gone')
  assert.throws(() => db.prepare('DELETE FROM inventory_check_sessions').run(), /inventory_check_history_immutable/)
})

check('a restored UNFINISHED cutover round-trips byte-identically but pins the 0224 flag guard: the restore flag cannot be released (needs an owner ruling)', () => {
  const db = roundTrip(true)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM branch_cutovers WHERE phase='capturing'").get().n, 1)
  assert.throws(() => restoreOff(db), /branch_cutover_active_control_protected/)
})

check('the one-active-cutover unique index still holds during a restore', () => {
  const db = open(); restoreOn(db)
  insertCutover(db, 1)
  assert.throws(() => insertCutover(db, 2), /UNIQUE/)
})



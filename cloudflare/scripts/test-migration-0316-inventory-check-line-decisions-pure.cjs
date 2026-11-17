'use strict'
// Pins migration 0316 (inventory_check_approvals.line_decisions_json and .line_set_json) on the REAL migration chain: both columns are added, the stored line set is backfilled for PENDING approvals only
// (by the creation rule, and only where it agrees with `lines`), PRE and POST fire, the four 0286 triggers still hold (the identity trigger now also freezes the set), the file is shaped the way the D1
// runner splits it, and the RECOVERY text works when it is executed: the full undo restores the 0286 shape, and every partial apply can be undone or finished.
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
// The statements of the file: a statement ends at a semicolon at the end of a line (the one trigger keeps its body on one line, as 0286 does).
const statements = code(sql).split(/;[ \t]*\n/).map(part => part.trim()).filter(Boolean)
const T = 'inventory_check_approvals'
let passed = 0
const check = (name, run) => { run(); passed++; console.log(`PASS ${name}`) }
const NOW = '2026-11-02T01:00:00Z'
const session = (db, id, branch = 1) => db.exec(`INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,scope_json,started_at,updated_at,closed_at) VALUES('${id}',1,${branch},7,'t','closed','{}','${NOW}','${NOW}','${NOW}')`)
const item = (db, id, product, seen, counted, branch = 1) => db.exec(`INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,updated_at) VALUES('${id}',${product},${branch},'{}',${seen},'{}','issue',${counted},'x','${NOW}')`)
const dateLine = (db, id, product, batch, seen, counted) => db.exec(`INSERT INTO inventory_check_lot_lines(session_id,product_id,branch_id,batch_id,scope,seen_quantity,counted_quantity,seen_source,created_at) VALUES('${id}',${product},1,${batch},'lot',${seen},${counted},'screen','${NOW}')`)
const approval = (db, id, lines, status = 'pending') => db.exec(`INSERT INTO ${T}(session_id,organization_id,branch_id,lines,submitted_by,submitted_at) VALUES('${id}',1,1,${lines},7,'${NOW}');
  ${status === 'pending' ? '' : `UPDATE ${T} SET status='${status}',decided_by=9,decided_by_name='admin',decided_at='${NOW}',decision_request_id='dec-12345678' WHERE session_id='${id}';`}`)
/** s-plain: one plain line (3 of 5). s-offset: dates that offset each other (A 6 of 5, B 3 of 4) beside a matching product. s-claimed: a claimed pending approval. s-decided: already approved. s-odd: lines does not agree with the items. */
const seed = db => {
  session(db, 's-plain'); item(db, 's-plain', 5, 3, 5); approval(db, 's-plain', 1)
  session(db, 's-offset'); item(db, 's-offset', 1, 9, 9); dateLine(db, 's-offset', 1, 10, 5, 6); dateLine(db, 's-offset', 1, 11, 4, 3); item(db, 's-offset', 2, 6, 6); approval(db, 's-offset', 1)
  session(db, 's-claimed'); item(db, 's-claimed', 5, 3, 4); item(db, 's-claimed', 6, 8, 8); approval(db, 's-claimed', 1)
  db.exec(`UPDATE ${T} SET applying_request_id='k',applying_by=7,applying_at='${NOW}' WHERE session_id='s-claimed'`)
  session(db, 's-decided'); item(db, 's-decided', 5, 3, 5); approval(db, 's-decided', 1, 'approved')
  session(db, 's-odd'); item(db, 's-odd', 5, 3, 5); approval(db, 's-odd', 2)
}
const col = (db, name, id) => db.prepare(`SELECT ${name} AS v FROM ${T} WHERE session_id=?`).get(id).v
const shape = db => ({ columns: db.prepare(`SELECT name,type,"notnull" AS nn,dflt_value AS d FROM pragma_table_info('${T}') ORDER BY cid`).all().map(row => ({ ...row })),
  objects: db.prepare("SELECT type,name,sql FROM sqlite_master WHERE tbl_name=? ORDER BY type,name").all(T).map(row => ({ ...row, sql: String(row.sql).replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',') })) })
/** The lines of the RECOVERY text that are SQL: "--     <statement>;" */
const recoverySql = sql.split('\n').filter(line => /^--     (DROP TRIGGER|CREATE TRIGGER|ALTER TABLE)/.test(line)).map(line => line.replace(/^--     /, '').replace(/\s*(--.*)?$/, ''))
const undo = (db) => { for (const line of recoverySql) { try { db.exec(line) } catch (error) { if (!/no such column|no such trigger/i.test(String(error.message))) throw error } } }

check('the file is LF-only, numbered 0316 once, keeps rowid, has PRE / POST / RECOVERY / Cost with the partial-apply procedure, no ANALYZE, and does not claim to read or write no row', () => {
  assert.equal(sql.includes('\r'), false)
  assert.equal(/WITHOUT\s+ROWID/i.test(code(sql)), false)
  assert.match(sql, /^-- PRE:/m); assert.match(sql, /^-- POST:/m); assert.match(sql, /^-- RECOVERY:/m); assert.match(sql, /^-- Cost:/m); assert.match(sql, /^-- Backfill:/m)
  assert.match(sql, /Partial apply/); assert.match(sql, /d1_migrations/); assert.match(sql, /Recorded and something is missing/); assert.match(sql, /Not recorded and anything else/)
  assert.equal(/\bANALYZE\b|PRAGMA\s+optimize/i.test(code(sql)), false)
  assert.equal(/no row is read or written/i.test(sql), false, 'the header must not say no row is read or written: the CHECK is tested against existing rows and the backfill writes')
  assert.match(sql, /tests an added CHECK against the rows already in the table/)
  assert.deepEqual(fs.readdirSync(directory).filter(file => file.startsWith('0316_')), [migration])
  // The rollback note says what is true: the previous Worker ignores the decisions column, so it is not "rollback-safe" once approvers have used it, and the pre-rollback check it names exists.
  assert.equal(/Rollback-safe/.test(sql), false, 'the file does not claim the previous Worker is safe on approvals that use the new columns')
  assert.match(sql, /APPLY a line an approver rejected/); assert.match(sql, /pending_with_line_decisions must be 0/)
  const queries = { postflight: ['pending_without_line_set', 'items_with_approval_time'], 'pre-rollback': ['pending_with_line_decisions'] }
  for (const [name, columns] of Object.entries(queries)) {
    const query = path.join(__dirname, `../../ops/queries/inventory-check-approvals-${name}.sql`)
    assert.ok(fs.existsSync(query), `the ops query the note names exists: ${name}`)
    assert.ok(sql.includes(`inventory-check-approvals-${name}.sql`), `the note names the ${name} query by file`)
    const queryText = fs.readFileSync(query, 'utf8')
    for (const column of columns) assert.ok(queryText.includes(column) && sql.includes(column), `the note and the ${name} query both name ${column}`)
  }
  assert.equal(fs.existsSync(path.join(__dirname, '../../ops/queries/inventory-check-approvals-line-set.sql')), false, 'the single combined query is retired: its rollback column does not belong in a postflight')
  assert.equal(sql.includes('inventory-check-approvals-line-set'), false, 'the note names no retired query')
})

check('it is PRE, two ALTER TABLE ADD COLUMN, the two backfill UPDATEs, the identity trigger swap and POST: no comment-only statement, at most 5 compound terms, one statement per step', () => {
  assert.equal(statements.length, 8)
  assert.match(statements[0], /^SELECT CASE WHEN/)
  assert.match(statements[1], /^ALTER TABLE inventory_check_approvals ADD COLUMN line_decisions_json TEXT NOT NULL DEFAULT '\{\}' CHECK/)
  assert.match(statements[2], /^ALTER TABLE inventory_check_approvals ADD COLUMN line_set_json TEXT CHECK\(line_set_json IS NULL OR/)
  assert.match(statements[3], /^UPDATE inventory_check_approvals SET line_set_json = .* WHERE status = 'pending' AND lines = /s)
  assert.match(statements[4], /^UPDATE inventory_check_items SET updated_at = \(SELECT s\.started_at .* WHERE state = 'done' AND session_id IN \(SELECT a\.session_id FROM inventory_check_approvals a\)/s)
  assert.match(statements[5], /^DROP TRIGGER inventory_check_approvals_identity$/)
  assert.match(statements[6], /^CREATE TRIGGER inventory_check_approvals_identity BEFORE UPDATE OF\s+session_id,organization_id,branch_id,lines,submitted_by,submitted_at,baselines_json,line_set_json ON inventory_check_approvals\s+BEGIN SELECT RAISE\(ABORT,'inventory_check_approval_immutable'\); END$/)
  assert.match(statements[7], /^SELECT CASE WHEN/)
  for (const statement of statements) assert.ok((statement.match(/\b(UNION|INTERSECT|EXCEPT)\b/gi) || []).length < 5, 'at most 5 compound SELECT terms')
  assert.equal(statements.some(statement => /^\s*$/.test(code(statement))), false)
})

check('both columns are added; the set is backfilled for PENDING approvals by the creation rule (a plain difference, dates that offset, a claimed row) and only where it agrees with lines; decided and odd rows stay NULL; nothing else changes', () => {
  const db = chain(); seed(db)
  const before = db.prepare(`SELECT * FROM ${T} ORDER BY session_id`).all().map(row => ({ ...row }))
  const kinds = db.prepare("SELECT type,name FROM sqlite_master WHERE type<>'trigger' ORDER BY name").all().map(row => `${row.type}:${row.name}`)
  db.exec(sql)
  assert.deepEqual(JSON.parse(col(db, 'line_set_json', 's-plain')), { 5: 1 })
  assert.deepEqual(JSON.parse(col(db, 'line_set_json', 's-offset')), { 1: 1 }, 'a product whose dates differ with equal totals is a line; the matching product is not')
  assert.deepEqual(JSON.parse(col(db, 'line_set_json', 's-claimed')), { 5: 1 }, 'a claimed pending row takes the backfill')
  assert.equal(col(db, 'line_set_json', 's-decided'), null, 'a decided row is frozen and is never a waiting line')
  assert.equal(col(db, 'line_set_json', 's-odd'), null, 'lines disagrees with the items: not recorded, the earlier rule applies')
  for (const id of ['s-plain', 's-offset', 's-claimed', 's-decided', 's-odd']) assert.equal(col(db, 'line_decisions_json', id), '{}')
  assert.deepEqual(db.prepare(`SELECT * FROM ${T} ORDER BY session_id`).all().map(row => { const { line_decisions_json, line_set_json, ...rest } = row; return rest }), before, 'every other column of every row is as it was')
  assert.deepEqual(db.prepare("SELECT type,name FROM sqlite_master WHERE type<>'trigger' ORDER BY name").all().map(row => `${row.type}:${row.name}`), kinds, 'no table or index was added or dropped')
  const decisions = db.prepare(`SELECT * FROM pragma_table_info('${T}') WHERE name='line_decisions_json'`).get(), set = db.prepare(`SELECT * FROM pragma_table_info('${T}') WHERE name='line_set_json'`).get()
  assert.deepEqual({ type: decisions.type, notnull: decisions.notnull, dflt: decisions.dflt_value }, { type: 'TEXT', notnull: 1, dflt: "'{}'" })
  assert.deepEqual({ type: set.type, notnull: set.notnull, dflt: set.dflt_value }, { type: 'TEXT', notnull: 0, dflt: null })
  assert.ok(db.prepare(`SELECT rowid FROM ${T}`).get(), 'a rowid table')
})

check('the items of approvals: an item an earlier flip rewrote gets its count time and counter back; every other item is untouched; POST sees an item left rewritten', () => {
  const db = chain()
  const LATER = '2026-11-17T04:00:00.000Z'
  const mk = (id, scope, by) => db.exec(`INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,scope_json,started_at,updated_at,closed_at) VALUES('${id}',1,1,${by},'t','closed','${scope}','${NOW}','${NOW}','${NOW}')`)
  const put = (id, product, state, at, by) => db.exec(`INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at) VALUES('${id}',${product},1,'{}',5,'{}','${state}',4,${state === 'issue' ? "'miscount'" : 'NULL'},1,${by},'${at}')`)
  mk('f-flipped', '{"membership":"submission"}', 8); put('f-flipped', 1, 'done', LATER, 9); put('f-flipped', 2, 'done', NOW, 8); put('f-flipped', 3, 'issue', NOW, 8); approval(db, 'f-flipped', 1, 'approved')
  mk('f-pending', '{"membership":"submission"}', 8); put('f-pending', 1, 'done', LATER, 9); approval(db, 'f-pending', 1)
  mk('f-obs', '{}', 8); put('f-obs', 1, 'done', LATER, 9) // an open-session observation made later, by another person: its own time and observer
  const before = db.prepare('SELECT session_id,product_id,state,updated_at,updated_by,revision FROM inventory_check_items ORDER BY session_id,product_id').all().map(row => ({ ...row }))
  db.exec(sql)
  const after = db.prepare('SELECT session_id,product_id,state,updated_at,updated_by,revision FROM inventory_check_items ORDER BY session_id,product_id').all().map(row => ({ ...row }))
  for (const row of after) {
    const was = before.find(old => old.session_id === row.session_id && old.product_id === row.product_id)
    if (row.product_id === 1 && (row.session_id === 'f-flipped' || row.session_id === 'f-pending')) assert.deepEqual(row, { ...was, updated_at: NOW, updated_by: 8 }, `${row.session_id}: restored to the count time and the counter, state and revision as they were`)
    else assert.deepEqual(row, was, `${row.session_id}/${row.product_id} is untouched`)
  }
  // POST fires when a Done item of an approval's session carries another time.
  db.prepare("UPDATE inventory_check_items SET updated_at=? WHERE session_id='f-flipped' AND product_id=2").run(LATER)
  assert.throws(() => db.exec(statements[7]), /inventory_check_line_decisions_0316_post/)
  // A second run of the statement changes nothing (safe to repeat).
  db.prepare("UPDATE inventory_check_items SET updated_at=? WHERE session_id='f-flipped' AND product_id=2").run(NOW)
  const settled = JSON.stringify(db.prepare('SELECT * FROM inventory_check_items ORDER BY session_id,product_id').all())
  db.exec(statements[4] + ';')
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM inventory_check_items ORDER BY session_id,product_id').all()), settled)
})

check('the CHECKs: a decision column holds a JSON object and never NULL; the set holds a JSON object or NULL', () => {
  const db = chain(); seed(db); db.exec(sql)
  assert.throws(() => db.prepare(`UPDATE ${T} SET line_decisions_json=? WHERE session_id='s-plain'`).run('not json'), /CHECK/)
  assert.throws(() => db.prepare(`UPDATE ${T} SET line_decisions_json=? WHERE session_id='s-plain'`).run('[]'), /CHECK/)
  assert.throws(() => db.prepare(`UPDATE ${T} SET line_decisions_json=NULL WHERE session_id='s-plain'`).run(), /NOT NULL/)
  db.exec('DROP TRIGGER inventory_check_approvals_identity') // only to reach the CHECK of the set
  assert.throws(() => db.prepare(`UPDATE ${T} SET line_set_json=? WHERE session_id='s-plain'`).run('[1]'), /CHECK/)
  assert.throws(() => db.prepare(`UPDATE ${T} SET line_set_json=? WHERE session_id='s-plain'`).run('not json'), /CHECK/)
  db.prepare(`UPDATE ${T} SET line_set_json=NULL WHERE session_id='s-plain'`).run()
})

check('PRE aborts a second run and a database without the 0286 table; POST fires on a row holding a decision, on a set recorded for a decided row, and on a missing identity-trigger column', () => {
  const db = chain(); db.exec(sql)
  assert.throws(() => db.exec(sql), /inventory_check_line_decisions_0316_pre|duplicate column/)
  const bare = new DatabaseSync(':memory:')
  assert.throws(() => bare.exec(sql), /inventory_check_line_decisions_0316_pre/)
  const post = statements[7]
  const dirty = chain(); seed(dirty); dirty.exec(sql); dirty.prepare(`UPDATE ${T} SET line_decisions_json='{"5":{"decision":"reject"}}' WHERE session_id='s-plain'`).run()
  assert.throws(() => dirty.exec(post), /inventory_check_line_decisions_0316_post/, 'the POST assertion sees a non-empty decision column')
  const decided = chain(); seed(decided); decided.exec(sql); decided.exec('DROP TRIGGER inventory_check_approvals_identity; DROP TRIGGER inventory_check_approvals_decided')
  decided.exec(`UPDATE ${T} SET line_set_json='{"5":1}' WHERE session_id='s-decided'`)
  assert.throws(() => decided.exec(post), /inventory_check_line_decisions_0316_post/, 'the POST assertion sees a set on a decided row')
  const old = chain(); old.exec(sql); old.exec('DROP TRIGGER inventory_check_approvals_identity; CREATE TRIGGER inventory_check_approvals_identity BEFORE UPDATE OF session_id ON inventory_check_approvals BEGIN SELECT RAISE(ABORT,\'x\'); END')
  assert.throws(() => old.exec(post), /inventory_check_line_decisions_0316_post/, 'the POST assertion sees an identity trigger that does not name the set')
})

check('the 0286 triggers still hold: a pending row takes a decision, the set and the identity columns stay frozen, a decided row never changes again, a claimed row can still take a line decision', () => {
  const db = chain(); seed(db); db.exec(sql)
  db.prepare(`UPDATE ${T} SET line_decisions_json=? WHERE session_id='s-plain'`).run('{"5":{"decision":"reject","by":7}}')
  assert.equal(col(db, 'line_decisions_json', 's-plain'), '{"5":{"decision":"reject","by":7}}')
  assert.throws(() => db.prepare(`UPDATE ${T} SET lines=9 WHERE session_id='s-plain'`).run(), /inventory_check_approval_immutable/)
  assert.throws(() => db.prepare(`UPDATE ${T} SET line_set_json='{"5":1,"6":1}' WHERE session_id='s-plain'`).run(), /inventory_check_approval_immutable/, 'the set never changes after the approval is created')
  assert.throws(() => db.prepare(`UPDATE ${T} SET line_set_json=NULL WHERE session_id='s-plain'`).run(), /inventory_check_approval_immutable/)
  db.prepare(`UPDATE ${T} SET status='approved',decided_by=9,decided_by_name='admin',decided_at='${NOW}',decision_request_id='dec-12345679' WHERE session_id='s-plain'`).run()
  assert.throws(() => db.prepare(`UPDATE ${T} SET line_decisions_json='{}' WHERE session_id='s-plain'`).run(), /inventory_check_approval_immutable/, 'frozen once decided, like every column')
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND tbl_name=?").get(T).n, 4)
  db.prepare(`UPDATE ${T} SET line_decisions_json='{"5":{"decision":"modify","counted":4}}' WHERE session_id='s-claimed'`).run()
  assert.equal(col(db, 'line_decisions_json', 's-claimed'), '{"5":{"decision":"modify","counted":4}}', 'a decision on a line of a claimed approval is allowed by the table; the Worker guards the line itself')
})

check('RECOVERY, executed: the full undo restores the 0286 table shape exactly (columns and the four triggers, the identity trigger as it was) and the file then applies again', () => {
  const original = chain(), pristine = shape(original)
  const db = chain(); seed(db); db.exec(sql)
  assert.ok(recoverySql.length >= 4, `the undo statements are in the header (${recoverySql.length})`)
  undo(db)
  const after = shape(db)
  assert.deepEqual(after.columns, pristine.columns); assert.deepEqual(after.objects, pristine.objects)
  db.exec(sql) // applies again over the seeded rows
  assert.deepEqual(JSON.parse(col(db, 'line_set_json', 's-offset')), { 1: 1 })
})

check('RECOVERY, executed: a crash after ANY statement of the file is either undone (then the file applies again) or finished by hand from the file (same end state as a full apply)', () => {
  const full = chain(); seed(full); full.exec(sql)
  for (let done = 1; done < statements.length - 1; done++) { // a crash after each statement but the last (POST)
    const partial = chain(); seed(partial)
    for (const statement of statements.slice(0, done)) partial.exec(statement + ';')
    // Not recorded: undo (the facts are not the untouched ones) and rerun.
    const undone = chain(); seed(undone); for (const statement of statements.slice(0, done)) undone.exec(statement + ';')
    undo(undone)
    assert.deepEqual(shape(undone), shape(chain()), `after ${done} statement(s) the undo restores the 0286 shape`)
    undone.exec(sql)
    assert.deepEqual(shape(undone), shape(full), `after ${done} statement(s): undo, then rerun, gives the full result`)
    // Recorded: run the missing statements by hand, in file order, skipping what the facts say is already there.
    const have = name => partial.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('${T}') WHERE name=?`).get(name).n === 1
    const identityWithSet = () => partial.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name='inventory_check_approvals_identity' AND sql LIKE '%line_set_json%'").get().n === 1
    if (!have('line_decisions_json')) partial.exec(statements[1] + ';')
    if (!have('line_set_json')) partial.exec(statements[2] + ';')
    partial.exec(statements[3] + ';') // the UPDATE is safe to repeat
    partial.exec(statements[4] + ';') // so is the second
    if (!identityWithSet()) { partial.exec('DROP TRIGGER IF EXISTS inventory_check_approvals_identity;'); partial.exec(statements[6] + ';') }
    assert.deepEqual(shape(partial), shape(full), `after ${done} statement(s): finishing by hand gives the full result`)
    assert.doesNotThrow(() => partial.exec(statements[7] + ';'), 'POST holds')
  }
})

console.log(`PASS test-migration-0316-inventory-check-line-decisions-pure (${passed})`)

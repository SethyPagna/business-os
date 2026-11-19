'use strict'
// Pins migration 0319 on the REAL migration chain: schema only, the PRE assertion fires, and two PARTIAL indexes. inventory_check_sessions_open_task holds only open rows by organization, kind and branch:
// the three reads that care about open tasks only (the auto-close's candidates, the cap guard of the issue, the board's open list) SEEK it, so none of them reads a closed task or an old session.
// inventory_check_sessions_task_board holds only tasks by organization, branch, status, closed_at and id: the board's closed list SEEKS it and stops after its few rows, so it never reads the tasks closed before. Each plan is also run without the index, so the pin can tell the difference. The measured rows are in test-d1-task-index-plan-native.cjs.
//
// The SQL is the Worker's own: the test loads lib/inventoryCheckTasks.ts and captures the statements it builds.
//
// Run: node scripts/test-migration-0319-inventory-check-open-task-index-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')

const directory = path.join(__dirname, '../migrations')
const migration = '0319_inventory_check_open_task_index.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
assert.equal(sql.includes('\r'), false, 'the migration is LF-only')
assert.equal(/WITHOUT ROWID/i.test(sql), false, 'a table without rowid breaks backups; this adds only an index')
const files = fs.readdirSync(directory).filter(file => file.endsWith('.sql') && file < migration).sort()
const chain = () => { const db = new DatabaseSync(':memory:'); for (const file of files) db.exec(fs.readFileSync(path.join(directory, file), 'utf8')); return db }
const plan = (db, statement, params) => { const prepared = db.prepare(`EXPLAIN QUERY PLAN ${statement}`); prepared.setAllowUnknownNamedParameters(true); return prepared.all(params).map(row => row.detail).join(' | ') }
const NAME = 'inventory_check_sessions_open_task', BOARD = 'inventory_check_sessions_task_board'
const unhinted = statement => statement.replace(/INDEXED BY inventory_check_sessions_open_task/g, '')

function loadTasks() {
  const cache = new Map()
  const load = (file) => {
    if (cache.has(file)) return cache.get(file).exports
    const module = { exports: {} }
    cache.set(file, module)
    new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(
      (request) => request.startsWith('.') ? load(path.resolve(path.dirname(file), request.endsWith('.ts') ? request : request + '.ts')) : require(request), module, module.exports)
    return module.exports
  }
  return load(path.join(__dirname, '../src/lib/inventoryCheckTasks.ts'))
}
const tasks = loadTasks()
async function captured(run) {
  let text = ''
  await run({ prepare(statement) { text = statement; return { all: async () => [], get: async () => null } } })
  return text
}

let passed = 0
const check = async (name, run) => { await run(); passed++; console.log(`PASS ${name}`) }

;(async () => {
  await check('the file is schema only, adds exactly two partial indexes, and no row changes', () => {
    const db = chain()
    db.exec("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,scope_json,started_at,updated_at) VALUES('s',1,1,1,'t','{\"membership\":\"task\"}','2026-11-18','2026-11-18')")
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name=?').get(NAME).n, 0, 'absent before')
    const before = db.prepare('SELECT * FROM inventory_check_sessions').all().map(row => ({ ...row }))
    const objects = db.prepare("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name)
    db.exec(sql)
    assert.deepEqual(db.prepare('SELECT * FROM inventory_check_sessions').all().map(row => ({ ...row })), before, 'rows unchanged')
    const added = db.prepare("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().filter(row => !objects.includes(row.name)).map(row => ({ ...row }))
    assert.deepEqual(added, [{ type: 'index', name: NAME }, { type: 'index', name: BOARD }], 'exactly the two indexes are added')
    assert.match(db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(NAME).sql, /WHERE status = 'open'$/, 'a partial index on the open rows')
    const columns = db.prepare(`SELECT cid,name FROM pragma_index_xinfo('${NAME}') WHERE key=1 ORDER BY seqno`).all()
    assert.deepEqual(columns.map(column => column.cid), [1, -2, 2], 'organization_id, the kind expression, branch_id')
    assert.match(db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(BOARD).sql, /WHERE json_extract\(scope_json, '\$\.membership'\) = 'task'$/, 'a partial index on the tasks only')
    const board = db.prepare(`SELECT name FROM pragma_index_xinfo('${BOARD}') WHERE key=1 ORDER BY seqno`).all().map(column => column.name)
    assert.deepEqual(board, ['organization_id', 'branch_id', 'status', 'closed_at', 'id'], 'organization, branch, status, closed_at, id')
  })

  await check('the PRE assertion aborts when either index already exists or the table lacks a column; a rerun is refused', () => {
    const db = chain(); db.exec(sql)
    assert.throws(() => db.exec(sql), /inventory_check_open_task_index_0319_pre/)
    for (const [name, drop] of [[NAME, BOARD], [BOARD, NAME]]) { const half = chain(); half.exec(sql); half.exec(`DROP INDEX ${drop}`); assert.throws(() => half.exec(sql), /inventory_check_open_task_index_0319_pre/, `${name} alone blocks the file`) }
    const bare = new DatabaseSync(':memory:'); bare.exec('CREATE TABLE inventory_check_sessions(id TEXT, organization_id INTEGER)')
    assert.throws(() => bare.exec(sql), /inventory_check_open_task_index_0319_pre/)
    assert.equal(bare.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN (?,?)').get(NAME, BOARD).n, 0, 'nothing is created when PRE fails')
  })

  const autoClose = tasks.autoCloseTaskStatements().statements[0].sql
  const capSql = `SELECT (${tasks.OPEN_TASK_COUNT_SQL}) AS n`
  const listSql = await captured(db => tasks.readTaskRows(db, { organization: null, branchId: 1, shown: 30, closedShown: 5 }))
  const AUTO = { org: 1, branchId: 1, task: null, src: 's', actorId: 1, actorName: 'a', key: 'k', hash: 'h', now: 'n' }

  await check('without the indexes the reads scan the sessions (the control, hints dropped)', () => {
    const db = chain()
    assert.doesNotMatch(plan(db, unhinted(autoClose), AUTO), new RegExp(NAME))
    assert.doesNotMatch(plan(db, unhinted(capSql), { organization: 1, branchId: 1 }), new RegExp(NAME))
    assert.doesNotMatch(plan(db, listSql.replace(/INDEXED BY \w+/g, ''), { org: 1, branchId: 1, shown: 30, closedShown: 5 }), new RegExp(BOARD), 'the control does not use the task index')
    assert.throws(() => plan(db, capSql, { organization: 1, branchId: 1 }), /no such index/, 'the hint names an index that does not exist here')
  })

  await check('with the index the candidates, the cap guard and the open list SEEK it by organization, kind and branch, for an organization and for NULL', () => {
    const db = chain(); db.exec(sql)
    for (const org of [1, null]) {
      const auto = plan(db, autoClose, { ...AUTO, org })
      assert.match(auto, new RegExp(`SEARCH t USING INDEX ${NAME} \\(organization_id=\\? AND <expr>=\\? AND branch_id=\\?\\)`), `candidates: ${auto}`)
      assert.match(auto, /SEARCH w USING (COVERING )?INDEX inventory_check_items_state \(session_id=\? AND state=\?\)/, `the write's own counts: ${auto}`)
      assert.match(auto, /SEARCH m USING (COVERING )?INDEX sqlite_autoindex_inventory_check_items_1 \(session_id=\? AND product_id=\? AND branch_id=\?\)/, `each task's item by primary key: ${auto}`)
      assert.match(auto, /SEARCH x USING INDEX inventory_check_items_product_latest \(product_id=\? AND branch_id=\? AND updated_at>\?\)/, `the done check: ${auto}`)
      assert.doesNotMatch(auto, /inventory_check_sessions_kind_task|SCAN t|inventory_check_items_product_latest \(product_id=\? AND branch_id=\? AND updated_at\?\)/, `no scan of the history: ${auto}`)
      const cap = plan(db, capSql, { organization: org, branchId: 1 })
      assert.match(cap, new RegExp(`SEARCH s USING INDEX ${NAME} \\(organization_id=\\? AND <expr>=\\? AND branch_id=\\?\\)`), `cap guard: ${cap}`)
      const list = plan(db, listSql, { org, branchId: 1, shown: 30, closedShown: 5 })
      assert.match(list, new RegExp(`SEARCH s USING INDEX ${NAME} \\(organization_id=\\? AND <expr>=\\? AND branch_id=\\?\\)`), `open list: ${list}`)
      const closed = list.split('CO-ROUTINE closed_t')[1].split('SCAN closed_t')[0]
      assert.match(closed, new RegExp(`^ \\| SEARCH s USING INDEX ${BOARD} \\(organization_id=\\? AND branch_id=\\? AND status=\\?\\)`), `the closed list seeks the task index by organization, branch and status: ${list}`)
      assert.doesNotMatch(closed, /TEMP B-TREE|SCAN s/, `and reads it in its own order, with no sort and no scan: ${list}`)
      assert.match(list, /SEARCH pk USING INDEX inventory_check_sessions_kind_task \(organization_id=\? AND <expr>=\? AND <expr>=\?\)/, `the pickup join seeks by task on 0318, never the open index: ${list}`)
    }
  })

  await check('the index holds only open rows: a closed session is not in it, the same SELECT answers the same with and without it', () => {
    const db = chain(); db.exec(sql)
    const put = (id, status, kind) => db.prepare("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,scope_json,started_at,updated_at) VALUES(?,1,1,1,'t',?,?,'2026-11-18','2026-11-18')").run(id, status, JSON.stringify({ membership: kind }))
    put('a', 'open', 'task'); put('b', 'closed', 'task'); put('c', 'open', 'pickup'); put('d', 'open', 'task')
    const q = "SELECT s.id FROM inventory_check_sessions s %s WHERE s.organization_id IS 1 AND json_extract(s.scope_json,'$.membership')='task' AND s.branch_id=1 AND s.status='open' ORDER BY s.id"
    const withIt = db.prepare(q.replace('%s', 'INDEXED BY ' + NAME)).all().map(row => row.id), without = db.prepare(q.replace('%s', 'NOT INDEXED')).all().map(row => row.id)
    assert.deepEqual(withIt, ['a', 'd']); assert.deepEqual(without, withIt)
  })

  await check('the task index holds only tasks, and the closed list answers the same with and without it (other kinds, other branches and organizations are left out)', () => {
    const db = chain(); db.exec(sql)
    const put = (id, org, branch, status, kind, closedAt) => db.prepare("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,scope_json,started_at,updated_at,closed_at) VALUES(?,?,?,1,'t',?,?,'2026-11-18','2026-11-18',?)").run(id, org, branch, status, JSON.stringify({ membership: kind }), closedAt)
    put('a', 1, 1, 'closed', 'task', '2026-11-18T01'); put('b', 1, 1, 'closed', 'task', '2026-11-18T03'); put('c', 1, 1, 'closed', 'pickup', '2026-11-18T05'); put('d', 1, 1, 'closed', 'submission', '2026-11-18T06')
    put('e', 1, 2, 'closed', 'task', '2026-11-18T07'); put('f', 2, 1, 'closed', 'task', '2026-11-18T08'); put('g', 1, 1, 'open', 'task', null); put('h', 1, 1, 'closed', 'task', '2026-11-18T03')
    const q = "SELECT s.id FROM inventory_check_sessions s %s WHERE s.organization_id IS 1 AND json_extract(s.scope_json,'$.membership')='task' AND s.branch_id=1 AND s.status='closed' ORDER BY s.closed_at DESC, s.id DESC LIMIT 3"
    const withIt = db.prepare(q.replace('%s', 'INDEXED BY ' + BOARD)).all().map(row => row.id), without = db.prepare(q.replace('%s', 'NOT INDEXED')).all().map(row => row.id)
    assert.deepEqual(withIt, ['h', 'b', 'a']); assert.deepEqual(without, withIt)
  })

  console.log(`${passed} groups passed`)
})().catch(error => { console.error(error); process.exitCode = 1 })

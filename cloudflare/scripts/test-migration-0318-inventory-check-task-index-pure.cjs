'use strict'
// Pins migration 0318 (inventory_check_sessions_kind_task: organization, kind, task as expressions over scope_json) on the REAL migration chain:
// schema only, the PRE and POST assertions fire, and the two reads the count tasks make (the branch's task list and the one-picker check) SEEK the index
// instead of reading every session ever made. Each plan is also run without the index, so the pin can tell the difference.
//
// The SQL is the Worker's own: the test loads lib/inventoryCheckTasks.ts and captures the statements it prepares, so a change to them is judged here.
//
// Run: node scripts/test-migration-0318-inventory-check-task-index-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')

const directory = path.join(__dirname, '../migrations')
const migration = '0318_inventory_check_task_index.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
assert.equal(sql.includes('\r'), false, 'the migration is LF-only')
assert.equal(/WITHOUT ROWID/i.test(sql), false, 'a table without rowid breaks backups; this adds only an index')
const files = fs.readdirSync(directory).filter(file => file.endsWith('.sql') && file < migration).sort()
const chain = () => { const db = new DatabaseSync(':memory:'); for (const file of files) db.exec(fs.readFileSync(path.join(directory, file), 'utf8')); return db }
const plan = (db, statement, params) => { const prepared = db.prepare(`EXPLAIN QUERY PLAN ${statement}`); prepared.setAllowUnknownNamedParameters(true); return prepared.all(params).map(row => row.detail).join(' | ') }
const NAME = 'inventory_check_sessions_kind_task'

// The Worker's statements, captured.
function loadTasks() {
  // The module imports siblings (./productStockGuard): resolve each relative import to its .ts file, as test-d1-task-index-plan-native.cjs does.
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
  await check('the file is schema only, adds exactly one index, and no row changes', () => {
    const db = chain()
    db.exec("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,scope_json,started_at,updated_at) VALUES('s',1,1,1,'t','{\"membership\":\"task\"}','2026-11-18','2026-11-18')")
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name=?').get(NAME).n, 0, 'absent before')
    const before = db.prepare('SELECT * FROM inventory_check_sessions').all().map(row => ({ ...row }))
    const objects = db.prepare("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name)
    db.exec(sql)
    assert.deepEqual(db.prepare('SELECT * FROM inventory_check_sessions').all().map(row => ({ ...row })), before, 'rows unchanged')
    const added = db.prepare("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().filter(row => !objects.includes(row.name)).map(row => ({ ...row }))
    assert.deepEqual(added, [{ type: 'index', name: NAME }], 'exactly one object is added')
    const columns = db.prepare(`SELECT cid,name FROM pragma_index_xinfo('${NAME}') WHERE key=1 ORDER BY seqno`).all()
    assert.deepEqual(columns.map(column => column.cid), [1, -2, -2], 'organization_id, then two expressions')
  })

  await check('the PRE assertion aborts when the index already exists or the table lacks a column; the file is not idempotent by design (a rerun is refused)', () => {
    const db = chain(); db.exec(sql)
    assert.throws(() => db.exec(sql), /inventory_check_task_index_0318_pre/)
    const bare = new DatabaseSync(':memory:'); bare.exec('CREATE TABLE inventory_check_sessions(id TEXT, organization_id INTEGER)')
    assert.throws(() => bare.exec(sql), /inventory_check_task_index_0318_pre/)
    assert.equal(bare.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name=?').get(NAME).n, 0, 'nothing is created when PRE fails')
  })

  const listSql = await captured(db => tasks.readTaskRows(db, { organization: null, branchId: 1, shown: 30, closedShown: 5 }))
  const pickupSql = `SELECT ${tasks.OPEN_PICKUP_SQL('@task', '@org')} AS picked`
  const countsSql = `SELECT s.id FROM inventory_check_sessions s WHERE s.organization_id IS @org AND ${tasks.kindOf('s')}='task' AND ${tasks.taskOf('s')} IS NULL`
  const submissionsOfTask = `SELECT s.id FROM inventory_check_sessions s WHERE s.organization_id IS @org AND ${tasks.kindOf('s')}='submission' AND ${tasks.taskOf('s')}=@task`

  await check('without the index the task list and the picker check scan the sessions table (the control)', () => {
    const db = chain()
    // (the open tasks are read through the partial index of 0319, which does not exist here: the control drops the hint)
    assert.match(plan(db, listSql.replace(/INDEXED BY \w+/g, ''), { org: 1, branchId: 1, shown: 30, closedShown: 5 }), /SCAN s|SCAN inventory_check_sessions|USING INDEX inventory_check_sessions_recent|SCAN page/)
    assert.doesNotMatch(plan(db, pickupSql.replace(/INDEXED BY \w+/g, ''), { org: 1, task: 'x' }), new RegExp(NAME))
  })

  await check('with the index the pickup join of the task list and the picker check SEEK it by organization, kind and task, for an organization and for NULL', () => {
    const db = chain(); db.exec(sql); db.exec(fs.readFileSync(path.join(directory, '0319_inventory_check_open_task_index.sql'), 'utf8'))
    for (const org of [1, null]) {
      const list = plan(db, listSql, { org, branchId: 1, shown: 30, closedShown: 5 })
      assert.match(list, new RegExp(`SEARCH pk USING INDEX ${NAME} \\(organization_id=\\? AND <expr>=\\? AND <expr>=\\?\\)`), `the pickup join of the task list seeks it by task: ${list}`)
      assert.equal((list.match(new RegExp(`USING INDEX ${NAME}`, 'g')) || []).length, 1, `only the pickup join reads it (the open list and the closed list read the partial indexes of 0319): ${list}`)
      const picker = plan(db, pickupSql, { org, task: 'x' })
      assert.match(picker, new RegExp(`SEARCH pk USING INDEX ${NAME} \\(organization_id=\\? AND <expr>=\\? AND <expr>=\\?\\)`), `picker check: ${picker}`)
      assert.match(plan(db, submissionsOfTask, { org, task: 'x' }), new RegExp(`USING INDEX ${NAME}`), 'the submissions that counted one task are found by the same index')
      assert.match(plan(db, countsSql, { org }), new RegExp(`USING INDEX ${NAME}`))
    }
  })

  await check('the expression text of the Worker matches the index (whitespace aside): a different spelling would scan', () => {
    const db = chain(); db.exec(sql)
    assert.match(plan(db, "SELECT 1 FROM inventory_check_sessions s WHERE s.organization_id IS 1 AND json_extract(s.scope_json,'$.membership')='pickup' AND json_extract(s.scope_json,'$.task')='x'", {}), new RegExp(NAME))
    assert.doesNotMatch(plan(db, "SELECT 1 FROM inventory_check_sessions s WHERE s.organization_id IS 1 AND s.scope_json->>'membership'='pickup'", {}), new RegExp(`${NAME} \\(organization_id=\\? AND <expr>=\\? AND`))
  })

  console.log(`${passed} groups passed`)
})().catch(error => { console.error(error); process.exitCode = 1 })

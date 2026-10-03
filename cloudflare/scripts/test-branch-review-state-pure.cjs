const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const ts = require('typescript')
const moduleCache = new Map()
let currentDb
function compile(source) {
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
}
function evaluate(source, dependencies, result) {
  return new Function(...Object.keys(dependencies), 'exports', `${compile(source)};return ${result}`)(...Object.values(dependencies), {})
}
function sourceTree(relative) {
  return ts.createSourceFile(relative, fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), ts.ScriptTarget.Latest, true)
}
function functionSource(tree, name) {
  return tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(tree)
}
const toDbBool = evaluate(functionSource(sourceTree('lib/db.ts'), 'toDbBool'), {}, 'toDbBool')
function adapter(db) {
  return {
    prepare: sql => ({
      get: async params => Array.isArray(params) ? db.prepare(sql).get(...params) : db.prepare(sql).get(params || {}),
      all: async params => Array.isArray(params) ? db.prepare(sql).all(...params) : db.prepare(sql).all(params || {}),
      run: async params => { const result = db.prepare(sql).run(params || {}); return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) } },
    }),
    batch: async statements => execute(db, statements),
  }
}
function load(name) {
  if (moduleCache.has(name)) return moduleCache.get(name)
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compile(fs.readFileSync(path.join(__dirname, '../src/lib', `${name}.ts`), 'utf8')))(request => {
    if (request === './db') return { toDbBool, getDb: () => adapter(currentDb) }
    if (request.startsWith('./')) return load(request.slice(2))
    throw new Error(`Unexpected import ${request}`)
  }, module, module.exports)
  moduleCache.set(name, module.exports)
  return module.exports
}
function execute(db, statements) {
  db.exec('BEGIN')
  try { for (const { sql, params } of statements) db.prepare(sql).run(params || {}); db.exec('COMMIT') }
  catch (error) { db.exec('ROLLBACK'); throw error }
}
function world() {
  currentDb = openDb(loadAll()).db
  currentDb.exec("INSERT INTO branches(id,name,location,notes,is_active,is_default,updated_at) VALUES(1,'Shop','Market','before',1,1,'same'),(2,'Warehouse','Depot','bulk',1,0,'same')")
  return currentDb
}
const writes = load('branchWrites')
function routeHandler(method, routePath, dependencies = {}) {
  const tree = sourceTree('routes/branches.ts')
  const statement = tree.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(tree) === `app.${method}` && node.expression.arguments[0]?.text === routePath)
  assert.ok(statement, `actual ${method} ${routePath}`)
  const callback = statement.expression.arguments[1].getText(tree)
  return evaluate(`const handler = ${callback}`, {
    ...writes, ...load('permissions'), ...load('conflictControl'), ...load('canonicalBranchIdentity'), ...load('reviewGate'),
    ...load('businessMaintenanceGuard'), getDb: () => adapter(currentDb), audit: async () => {}, broadcast: async () => {}, actorSnapshot: () => 'User', ...dependencies,
  }, 'handler')
}
function context(body, user = { id: 7, permissions: JSON.stringify({ branches: true }) }) {
  return { env: {}, req: { param: () => '1', json: async () => body }, get: () => user,
    json: (value, status = 200) => ({ status, value }), executionCtx: { waitUntil: () => {} } }
}

const migrationPath = path.join(__dirname, '../migrations/0223_branch_lifecycle_identity.sql')
let failures = 0
async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`) }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`) }
}

async function main() {
  await check('0223 preserves every prior table value and accepts legacy fresh seeding', () => {
    assert.ok(fs.existsSync(migrationPath), 'authorized additive migration exists')
    const d1 = openDb(loadAll({ through: 222 }))
    const db = d1.db
    db.exec(`INSERT INTO branches(id,name,notes,is_active,is_default,updated_at) VALUES(1,'Shop','sales',1,1,'same'),(2,'Warehouse','stock',1,0,'same');
      INSERT INTO pending_actions(section,action_type,entity_type,entity_id,payload_json) VALUES('branches','update','branch',1,'{"notes":"waiting"}');
      INSERT INTO stock_session_operations(id,actor_id,request_id,mode,request_json) VALUES('keep',1,'keep','stock_in','{}');`)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .map(({ name }) => ({ name, columns: db.prepare(`PRAGMA table_info("${name}")`).all().map(row => row.name) }))
    const snapshot = () => JSON.stringify(tables.map(({ name, columns }) => db.prepare(`SELECT ${columns.map(column => `"${column}"`).join(',')} FROM "${name}"`).all()))
    const before = snapshot()
    const sql = fs.readFileSync(migrationPath, 'utf8')
    assert.equal(sql.includes('\r'), false)
    db.exec(sql)
    assert.equal(snapshot(), before)
    assert.deepEqual(db.prepare('SELECT role,canonical_key,successor_branch_id FROM branches').all().map(row => Object.values(row)), [[null, null, null], [null, null, null]])
    assert.equal(db.prepare('SELECT expected_entity_state_json FROM pending_actions').get().expected_entity_state_json, null)
    db.exec("INSERT INTO branches(name,is_active,is_default) VALUES('Legacy',1,0)")
    assert.equal(db.prepare("SELECT role FROM branches WHERE name='Legacy'").get().role, null)
    db.close()
  })
  await check('0223 rejects malformed lifecycle identity and keeps stable keys', () => {
    assert.ok(fs.existsSync(migrationPath), 'authorized additive migration exists')
    const db = openDb(loadAll()).db
    db.exec("PRAGMA foreign_keys=ON; INSERT INTO branches(id,name,is_active,is_default,canonical_key) VALUES(1,'Shop',1,1,'shop'),(2,'Warehouse',1,0,'warehouse')")
    for (const sql of ["UPDATE branches SET role='bad' WHERE id=1", "UPDATE branches SET canonical_key='warehouse' WHERE id=1", "INSERT INTO branches(name,canonical_key) VALUES('duplicate','shop')", "UPDATE branches SET successor_branch_id=2 WHERE id=1", "UPDATE branches SET is_active=0,successor_branch_id=2 WHERE id=1", "UPDATE branches SET is_active=0,is_default=0,successor_branch_id=1 WHERE id=1", "UPDATE branches SET is_active=0,is_default=0,successor_branch_id=99 WHERE id=1", "UPDATE branches SET is_active=0,is_default=0,successor_branch_id=1.5 WHERE id=2"]) assert.throws(() => db.exec(sql), sql)
    db.exec('UPDATE branches SET is_active=0,is_default=0,successor_branch_id=2 WHERE id=1')
    assert.equal(db.prepare('SELECT successor_branch_id FROM branches WHERE id=1').get().successor_branch_id, 2)
    assert.throws(() => db.exec("INSERT INTO pending_actions(section,action_type,entity_type,expected_entity_state_json) VALUES('branches','update','branch','not JSON')"))
    db.close()
  })
  await check('same-second read-to-batch metadata race rolls back', () => {
    const db = world()
    const current = db.prepare('SELECT * FROM branches WHERE id=1').get()
    const statements = writes.branchUpdateStatements(1, { notes: 'stale' }, current)
    db.exec("UPDATE branches SET notes='later' WHERE id=1")
    assert.throws(() => execute(db, statements))
    assert.equal(db.prepare('SELECT notes FROM branches WHERE id=1').get().notes, 'later')
    db.close()
  })
  await check('content token rejects same-second and missing client expectations', async () => {
    const db = world()
    const before = db.prepare('SELECT * FROM branches WHERE id=1').get()
    const token = await writes.branchEditEtag(before)
    await writes.assertBranchEditEtag(before, token)
    db.exec("UPDATE branches SET notes='later' WHERE id=1")
    const current = db.prepare('SELECT * FROM branches WHERE id=1').get()
    await assert.rejects(writes.assertBranchEditEtag(current, token), error => error.code === 'branch_edit_conflict')
    await assert.rejects(writes.assertBranchEditEtag(current, undefined), error => error.code === 'branch_edit_conflict')
    db.close()
  })
  await check('real review gate stores server expectation outside client payload', async () => {
    const db = world()
    const expected = JSON.stringify({ kind: 'branch-edit-state', version: 1, entity_id: 1, state: { id: 1 } })
    const gate = load('reviewGate')
    const id = await gate.maybeQueueForReview({}, { id: 7, permissions: JSON.stringify({ branches: 'review', 'branches:edit': true }) }, 'branches', {
      actionType: 'update', entityType: 'branch', entityId: 1, payload: { notes: 'desired', expected_entity_state_json: 'forged' }, expectedEntityStateJson: expected,
    })
    const row = db.prepare('SELECT * FROM pending_actions WHERE id=?').get(id)
    assert.equal(row.expected_entity_state_json, expected)
    assert.equal(JSON.parse(row.payload_json).expected_entity_state_json, 'forged')
    assert.equal(await gate.maybeQueueForReview({}, { id: 7, permissions: JSON.stringify({ branches: true, 'branches:edit': 'review' }) }, 'branches', { actionType: 'update', entityType: 'branch', payload: {} }), null)
    db.close()
  })
  await check('actual branch PUT refuses missing or stale content token and real review gate uses server baseline', async () => {
    const db = world()
    const put = routeHandler('put', '/:id')
    const original = db.prepare('SELECT * FROM branches WHERE id=1').get()
    const expectedEditEtag = await writes.branchEditEtag(original)
    assert.equal((await put(context({ notes: 'missing' }))).status, 409)
    db.exec("UPDATE branches SET notes='same-second later' WHERE id=1")
    assert.equal((await put(context({ notes: 'stale', expectedEditEtag }))).status, 409)
    const current = db.prepare('SELECT * FROM branches WHERE id=1').get()
    const response = await put(context({ notes: 'queued', expectedEditEtag: await writes.branchEditEtag(current), expected_entity_state_json: 'forged' }, { id: 7, permissions: JSON.stringify({ branches: 'review', 'branches:edit': true }) }))
    assert.equal(response.status, 202)
    const row = db.prepare('SELECT * FROM pending_actions').get()
    assert.equal(row.expected_entity_state_json, writes.branchExpectedStateJson(current))
    assert.equal(db.prepare('SELECT notes FROM branches WHERE id=1').get().notes, 'same-second later')
    db.close()
  })
  if (failures) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })

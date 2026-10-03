const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')

function sourceTree(relative) {
  const source = fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8')
  return ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true)
}
function evaluate(source, dependencies, result) {
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(dependencies), 'exports', `${compiled}; return ${result}`)(...Object.values(dependencies), {})
}
function functionSource(tree, name) {
  const node = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(node, `actual ${name} exists`)
  return node.getText(tree)
}
const toDbBool = evaluate(functionSource(sourceTree('lib/db.ts'), 'toDbBool'), {}, 'toDbBool')

const modules = new Map()
function load(relative) {
  if (modules.has(relative)) return modules.get(relative)
  const source = fs.readFileSync(path.join(__dirname, '../src/lib', `${relative}.ts`), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((request) => {
    if (request === './db') return { toDbBool }
    if (request.startsWith('./')) return load(request.slice(2))
    throw new Error(`Unexpected import ${request}`)
  }, module, module.exports)
  modules.set(relative, module.exports)
  return module.exports
}

const writes = load('branchWrites')
const roles = load('branchRoles')
function world() {
  const db = new DatabaseSync(':memory:')
  db.limits.exprDepth = 100
  db.exec(`CREATE TABLE branches(id INTEGER PRIMARY KEY, name TEXT NOT NULL, location TEXT, phone TEXT, manager TEXT, notes TEXT,
    is_default INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, updated_at TEXT, role TEXT, canonical_key TEXT, successor_branch_id INTEGER);
    INSERT INTO branches(id,name,notes,is_active,is_default,role,canonical_key,successor_branch_id) VALUES
    (1,'LC Store','current',1,1,'shop','warehouse',NULL),(2,'Old Shop','past',0,0,'shop','shop',1);
    CREATE TABLE sales(branch_id INTEGER,branch_name TEXT,updated_at TEXT);
    CREATE TABLE inventory_movements(branch_id INTEGER,branch_name TEXT);
    CREATE TABLE returns(branch_id INTEGER,branch_name TEXT);
    CREATE TABLE stock_row_moves(branch_id INTEGER,branch_name TEXT);
    INSERT INTO sales VALUES(2,'Shop','old'); INSERT INTO sales VALUES(1,'Warehouse','old');
    INSERT INTO inventory_movements VALUES(2,'Shop'); INSERT INTO returns VALUES(1,'Warehouse');
    UPDATE branches SET updated_at='2026-10-01 00:00:00';`)
  return db
}
function plan(db, id, changes) {
  const rows = db.prepare('SELECT * FROM branches ORDER BY id').all()
  const current = rows.find(row => row.id === id)
  return writes.branchUpdateStatements(id, { ...current, ...changes }, current, rows)
}
function execute(db, statements) {
  db.exec('BEGIN')
  try { statements.forEach(({ sql, params }) => db.prepare(sql).run(params || {})); db.exec('COMMIT') }
  catch (error) { db.exec('ROLLBACK'); throw error }
}
function dump(db) {
  return JSON.stringify(['branches', 'sales', 'inventory_movements', 'returns', 'stock_row_moves'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()))
}
let failures = 0
function test(name, run) {
  try { run(); console.log(`PASS ${name}`) }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`) }
}

test('retired description updates preserve identity, default and historical labels', () => {
  const db = world()
  execute(db, plan(db, 2, { notes: 'legacy records' }))
  execute(db, plan(db, 1, { notes: 'current sales' }))
  assert.deepEqual({ ...db.prepare('SELECT name,is_active,is_default,notes FROM branches WHERE id=2').get() }, { name: 'Old Shop', is_active: 0, is_default: 0, notes: 'legacy records' })
  assert.deepEqual(db.prepare('SELECT branch_name FROM sales ORDER BY branch_id').all().map(row => row.branch_name), ['Warehouse', 'Shop'])
  assert.equal(db.prepare('SELECT branch_name FROM inventory_movements').get().branch_name, 'Shop')
  assert.equal(db.prepare('SELECT branch_name FROM returns').get().branch_name, 'Warehouse')
  db.close()
})
test('retired metadata cannot reactivate, rename, become default or change lifecycle fields', () => {
  const db = world()
  const before = dump(db)
  for (const change of [{ is_active: 1 }, { name: 'Shop' }, { is_default: 1 }, { role: 'warehouse' }, { canonical_key: 'warehouse' }, { successor_branch_id: null }]) {
    assert.throws(() => execute(db, plan(db, 2, change)), error => error.code === 'canonical_branch_identity_locked')
    assert.equal(dump(db), before)
  }
  db.close()
})
test('missing and cyclic successors refuse metadata unchanged', () => {
  for (const sql of ["UPDATE branches SET successor_branch_id=99 WHERE id=2", "UPDATE branches SET successor_branch_id=2 WHERE id=2", "UPDATE branches SET is_active=0,successor_branch_id=2 WHERE id=1"]) {
    const db = world(); db.exec(sql)
    const before = dump(db)
    assert.throws(() => execute(db, plan(db, 2, { notes: 'must not save' })), error => error.code === 'canonical_branch_identity_locked')
    assert.equal(dump(db), before); db.close()
  }
})
test('lifecycle and successor races abort metadata atomically', () => {
  for (const sql of ["UPDATE branches SET role='warehouse' WHERE id=2", "UPDATE branches SET canonical_key='warehouse' WHERE id=2", "UPDATE branches SET successor_branch_id=99 WHERE id=2", "UPDATE branches SET is_active=0 WHERE id=1"]) {
    const db = world()
    const statements = plan(db, 2, { notes: 'must not save' })
    db.exec(sql)
    const before = dump(db)
    assert.throws(() => execute(db, statements))
    assert.equal(dump(db), before); db.close()
  }
})

test('directory reread cannot replace the source successor authority', () => {
  const db = world()
  db.exec('UPDATE branches SET successor_branch_id=99 WHERE id=2')
  const current = db.prepare('SELECT * FROM branches WHERE id=2').get()
  const directory = db.prepare('SELECT * FROM branches ORDER BY id').all()
    .map(row => row.id === 2 ? { ...row, successor_branch_id: 1 } : row)
  const before = dump(db)
  assert.throws(() => execute(db, writes.branchUpdateStatements(2, { notes: 'must not save' }, current, directory)),
    error => error.code === 'canonical_branch_identity_locked')
  assert.equal(dump(db), before)
  db.close()
})
test('roles honor explicit metadata and reject invalid explicit authority', () => {
  assert.equal(roles.branchCanSell({ name: 'LC Store', role: 'shop' }), true)
  assert.equal(roles.branchCanSell({ name: 'Shop', role: 'warehouse' }), false)
  assert.equal(roles.branchCanSell({ name: 'Shop', role: 'invalid' }), false)
  assert.equal(roles.branchCanSell({ name: 'Shop', role: null }), true)
})

test('partial metadata preserves omitted fields and the sole active default', () => {
  const db = world()
  db.exec("UPDATE branches SET location='Market',phone='012',manager='Dara' WHERE id=1")
  const current = db.prepare('SELECT * FROM branches WHERE id=1').get()
  execute(db, writes.branchUpdateStatements(1, { notes: 'only notes' }, current))
  const after = db.prepare('SELECT * FROM branches WHERE id=1').get()
  for (const key of ['location', 'phone', 'manager', 'is_default', 'name', 'is_active']) assert.equal(after[key], current[key], key)
  assert.equal(after.notes, 'only notes')
  execute(db, writes.branchUpdateStatements(1, { phone: null, notes: '' }, after))
  const cleared = db.prepare('SELECT * FROM branches WHERE id=1').get()
  assert.equal(cleared.phone, null)
  assert.equal(cleared.notes, null)
  assert.equal(cleared.location, 'Market')
  assert.equal(cleared.is_default, 1)
  db.close()
})

test('explicit default removal preserves one active default or rolls back', () => {
  const db = world()
  const current = db.prepare('SELECT * FROM branches WHERE id=1').get()
  const before = dump(db)
  assert.throws(() => execute(db, writes.branchUpdateStatements(1, { is_default: 0, notes: 'must rollback' }, current)))
  assert.equal(dump(db), before)
  db.exec("UPDATE branches SET name='Shop',is_active=1,successor_branch_id=NULL WHERE id=2")
  execute(db, writes.branchUpdateStatements(1, { is_default: 0 }, current))
  assert.deepEqual(db.prepare('SELECT id FROM branches WHERE is_active=1 AND is_default=1').all().map(row => row.id), [2])
  db.close()
})

test('malformed explicit role values fail closed', () => {
  for (const role of [['shop'], ['warehouse'], { toString: () => 'shop' }, 1, true]) {
    assert.equal(roles.branchCanSell({ name: 'Shop', role }), false)
    assert.equal(roles.branchCanBeTransferSource({ name: 'Shop', role }), false)
  }
})

test('branch Undo record and operate use the current granular edit grant', () => {
  const permissions = load('permissions')
  const undoTree = sourceTree('lib/undoAppliers.ts')
  const registry = undoTree.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []).find(node => node.name.getText(undoTree) === 'APPLIERS')
  const entry = registry.initializer.properties.find(node => node.name?.text === 'branch.update')
  const applier = evaluate(`const definition = ${entry.initializer.getText(undoTree)}`, {}, '({name:"branch.update", ...definition})')
  const tier = evaluate(functionSource(undoTree, 'applierPermissionTier'), permissions, 'applierPermissionTier')
  const route = sourceTree('routes/actionHistory.ts')
  const deps = { ...permissions, resolveUndoApplier: () => applier, applierPermissionTier: tier,
    TRANSFER_OPERATION_KIND: 'transfer', STOCK_SESSION_KIND: 'stock', CUSTOMER_GENDER_RESTORATION_KIND: 'gender',
    hasAcquisitionCostInput: () => false, historyPayloadObject: value => value, isServerManagedPayload: () => false }
  const canRecord = evaluate(`${functionSource(route, 'canUseNamedAppliers')}\n${functionSource(route, 'canRecordHistory')}`, deps, 'canRecordHistory')
  let gate
  function visit(node) {
    if (ts.isIfStatement(node) && node.expression.getText(route).includes('applierPermissionTier(user, applier)')) gate = node
    ts.forEachChild(node, visit)
  }
  visit(route)
  assert.ok(gate, 'actual operate permission gate exists')
  const operate = evaluate(`function operate(user) { ${gate.getText(route)}; return {status:200} }`, {
    ...deps, applier, replayChangesProductImages: false, c: { json: (_body, status) => ({ status }) },
  }, 'operate')
  const user = { permissions: JSON.stringify({ branches: true, 'branches:edit': true }) }
  const payload = { applier: 'branch.update', id: 2, fields: { notes: 'restore' } }
  for (const [section, edit, allowed] of [[true, false, false], ['review', true, false], [true, true, true], [true, false, false]]) {
    user.permissions = JSON.stringify({ branches: section, 'branches:edit': edit })
    assert.equal(canRecord(user, { scope: 'branches', entity: 'branch', undo_payload: payload, redo_payload: payload }), allowed)
    assert.equal(operate(user).status, allowed ? 200 : 403)
  }
})
function reviewHandler(db, beforeBatch = () => {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/reviewApply.ts'), 'utf8')
  const tree = ts.createSourceFile('reviewApply.ts', source, ts.ScriptTarget.Latest, true)
  const statement = tree.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(tree) === 'registerApplier'
    && node.expression.arguments.slice(0, 3).map(arg => arg.text).join('/') === 'branches/update/branch')
  assert.ok(statement, 'real review branch registration exists')
  const compiled = ts.transpileModule(statement.getText(tree), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  let handler
  const adapter = {
    prepare: sql => ({ get: async params => db.prepare(sql).get(params || {}), all: async params => db.prepare(sql).all(params || {}) }),
    batch: async statements => { beforeBatch(); execute(db, statements) },
  }
  const conflict = load('conflictControl')
  const requesterError = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'ReviewRequesterPermissionError')
  const dependencies = { ...writes, ...conflict, ...load('permissions'), ...load('audit'),
    ReviewRequesterPermissionError: evaluate(requesterError.getText(tree), {}, 'ReviewRequesterPermissionError'),
    registerApplier: (_section, _action, _entity, callback) => { handler = callback },
    getDb: () => adapter, audit: async () => {}, notify: async () => {} }
  new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies))
  db.exec(`CREATE TABLE roles(id INTEGER PRIMARY KEY,code TEXT,permissions TEXT);
    CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,role_id INTEGER,permissions TEXT,is_active INTEGER,deleted_at TEXT);
    INSERT INTO users VALUES(8,'requester',NULL,'{"branches":"review"}',1,NULL);
    CREATE TABLE pending_actions(id INTEGER PRIMARY KEY,section TEXT,action_type TEXT,entity_type TEXT,entity_id INTEGER,
      requested_by INTEGER,payload_json TEXT,summary TEXT,expected_entity_state_json TEXT,status TEXT,
      reviewed_by INTEGER,reviewed_by_name TEXT,reviewed_at TEXT,updated_at TEXT);
    CREATE TABLE user_sessions(id INTEGER,user_id INTEGER,device_name TEXT,device_tz TEXT,revoked_at TEXT,last_seen_at TEXT);
    CREATE TABLE audit_logs(user_id INTEGER,user_name TEXT,action TEXT,entity TEXT,entity_id TEXT,details TEXT,table_name TEXT,
      record_id TEXT,old_value TEXT,new_value TEXT,device_name TEXT,device_tz TEXT);`)
  return body => {
    const baseline = writes.branchExpectedStateJson(db.prepare('SELECT * FROM branches WHERE id=2').get())
    db.prepare(`INSERT INTO pending_actions(id,section,action_type,entity_type,entity_id,requested_by,payload_json,expected_entity_state_json,status)
      VALUES(1,'branches','update','branch',2,8,?,?,'open')`).run(JSON.stringify(body), baseline)
    return handler({}, db.prepare('SELECT * FROM pending_actions WHERE id=1').get(), { id: 7, name: 'Reviewer' })
  }
}
async function reviewTests() {
  for (const [name, run] of [
    ['real approval handler edits retired description', async () => {
      const db = world()
      await reviewHandler(db)({ notes: 'approved', expected_updated_at: '2026-10-01 00:00:00' })
      assert.equal(db.prepare('SELECT notes FROM branches WHERE id=2').get().notes, 'approved')
      assert.equal(db.prepare('SELECT branch_name FROM sales WHERE branch_id=2').get().branch_name, 'Shop')
      db.close()
    }],
    ['real approval partial edit preserves metadata and active default', async () => {
      const db = world()
      db.exec("UPDATE branches SET is_default=0 WHERE id=1; UPDATE branches SET is_active=1,is_default=1,successor_branch_id=NULL,location='Market',phone='012',manager='Dara' WHERE id=2")
      await reviewHandler(db)({ notes: 'approved partial', expected_updated_at: '2026-10-01 00:00:00' })
      const after = db.prepare('SELECT * FROM branches WHERE id=2').get()
      assert.equal(after.notes, 'approved partial')
      assert.equal(after.location, 'Market')
      assert.equal(after.phone, '012')
      assert.equal(after.manager, 'Dara')
      assert.equal(after.is_default, 1)
      db.close()
    }],
    ['real approval handler refuses stale metadata before any effect', async () => {
      const db = world()
      db.exec("UPDATE branches SET name='Shop',is_active=1,successor_branch_id=NULL WHERE id=2")
      const before = dump(db)
      await assert.rejects(reviewHandler(db)({ notes: 'stale', expected_updated_at: '2026-09-01 00:00:00' }), error => error.status === 409)
      assert.equal(dump(db), before); db.close()
    }],
    ['real approval handler fences a successor change inside the write', async () => {
      const db = world()
      const approve = reviewHandler(db, () => db.exec('UPDATE branches SET is_active=0 WHERE id=1'))
      await assert.rejects(approve({ notes: 'raced' }), error => error.code === 'branch_edit_conflict')
      assert.equal(db.prepare('SELECT notes FROM branches WHERE id=2').get().notes, 'past'); db.close()
    }],
  ]) {
    try { await run(); console.log(`PASS ${name}`) }
    catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`) }
  }
  if (failures) process.exitCode = 1
}
reviewTests().catch(error => { console.error(error); process.exitCode = 1 })

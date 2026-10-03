const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')

const modules = new Map()
function load(relative) {
  if (modules.has(relative)) return modules.get(relative)
  const source = fs.readFileSync(path.join(__dirname, '../src/lib', `${relative}.ts`), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((request) => {
    if (request === './db') return { toDbBool: (value, fallback = 1) => value == null || value === '' ? fallback : ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase()) ? 1 : 0 }
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
  new Function('registerApplier', 'getDb', 'branchUpdateStatements', 'assertUpdatedAtMatch', 'getExpectedUpdatedAt', 'audit', 'notify', compiled)(
    (_section, _action, _entity, callback) => { handler = callback }, () => adapter, writes.branchUpdateStatements,
    conflict.assertUpdatedAtMatch, conflict.getExpectedUpdatedAt, async () => {}, async () => {},
  )
  return body => handler({}, { entity_id: 2, payload_json: JSON.stringify(body) }, { id: 7, name: 'Reviewer' })
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
      await assert.rejects(approve({ notes: 'raced' }), /NOT NULL/)
      assert.equal(db.prepare('SELECT notes FROM branches WHERE id=2').get().notes, 'past'); db.close()
    }],
  ]) {
    try { await run(); console.log(`PASS ${name}`) }
    catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`) }
  }
  if (failures) process.exitCode = 1
}
reviewTests().catch(error => { console.error(error); process.exitCode = 1 })

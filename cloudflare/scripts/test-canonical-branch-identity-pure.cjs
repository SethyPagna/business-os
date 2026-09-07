const assert = require('assert')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const Database = require('better-sqlite3')

function transpile(relPath) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', relPath), 'utf8')
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  }).outputText
}

function loadModule(relPath, requireShim) {
  const module = { exports: {} }
  new Function('exports', 'require', 'module', transpile(relPath))(module.exports, requireShim, module)
  return module.exports
}

function toDbBool(value, fallback = 1) {
  if (value == null || value === '') return fallback
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number') return value ? 1 : 0
  const normalized = String(value).trim().toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(normalized) ? 1 : 0
}

const roles = loadModule('lib/branchRoles.ts', require)
const identity = loadModule('lib/canonicalBranchIdentity.ts', (id) => {
  if (id === './db') return { toDbBool }
  if (id === './branchRoles') return roles
  return require(id)
})
const writes = loadModule('lib/branchWrites.ts', (id) => {
  if (id === './db') return { toDbBool }
  if (id === './canonicalBranchIdentity') return identity
  return require(id)
})

function freshDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE branches (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, location TEXT, phone TEXT,
      manager TEXT, notes TEXT, is_default INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1, updated_at TEXT
    );
    CREATE TABLE sales (branch_id INTEGER, branch_name TEXT, updated_at TEXT);
    CREATE TABLE inventory_movements (branch_id INTEGER, branch_name TEXT);
    CREATE TABLE returns (branch_id INTEGER, branch_name TEXT);
    CREATE TABLE stock_row_moves (branch_id INTEGER, branch_name TEXT);
    INSERT INTO branches(id,name,location,is_default,is_active) VALUES
      (1,'Shop','old',1,1),(2,'Warehouse','bulk',0,1),(3,'Legacy Depot','legacy',1,0);
  `)
  return db
}

function runBatch(db, statements) {
  db.transaction(() => {
    for (const statement of statements) {
      const prepared = db.prepare(statement.sql)
      if (statement.params == null) prepared.run()
      else if (Array.isArray(statement.params)) prepared.run(...statement.params)
      else prepared.run(statement.params)
    }
  })()
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  await check('only Shop and Warehouse are canonical identities', () => {
    assert.equal(identity.canonicalBranchName(' shop '), 'Shop')
    assert.equal(identity.canonicalBranchName('WAREHOUSE'), 'Warehouse')
    for (const value of ['Main Store', 'Depot', '', null, undefined]) {
      assert.equal(identity.canonicalBranchName(value), null)
      assert.equal(identity.isCanonicalBranchName(value), false)
    }
  })

  await check('metadata/default edits preserve identity and leave legacy defaults untouched', () => {
    const db = freshDb()
    const current = db.prepare('SELECT id,name,is_active FROM branches WHERE id=2').get()
    runBatch(db, writes.branchUpdateStatements(2, {
      name: ' warehouse ', is_active: 'true', location: 'new', notes: 'metadata', is_default: 1,
    }, current))
    assert.deepStrictEqual(db.prepare('SELECT name,location,notes,is_default,is_active FROM branches WHERE id=2').get(), {
      name: 'Warehouse', location: 'new', notes: 'metadata', is_default: 1, is_active: 1,
    })
    assert.equal(db.prepare('SELECT is_default FROM branches WHERE id=1').get().is_default, 0)
    assert.equal(db.prepare('SELECT is_default FROM branches WHERE id=3').get().is_default, 1)
  })

  await check('rename, deactivation, and legacy-row conversion fail before SQL is built', () => {
    const shop = { id: 1, name: 'Shop', is_active: 1 }
    assert.throws(() => writes.branchUpdateStatements(1, { name: 'Depot' }, shop), identity.CanonicalBranchIdentityError)
    assert.throws(() => writes.branchUpdateStatements(1, { is_active: 0 }, shop), identity.CanonicalBranchIdentityError)
    assert.throws(
      () => writes.branchUpdateStatements(3, { name: 'Shop', is_active: 1 }, { id: 3, name: 'Legacy Depot', is_active: 0 }),
      identity.CanonicalBranchIdentityError,
    )
    assert.throws(() => identity.assertCanonicalBranchSetMutationAllowed(), identity.CanonicalBranchIdentityError)
  })

  await check('an identity race aborts the whole metadata/default batch', () => {
    for (const mutate of [
      (db) => db.prepare("UPDATE branches SET name='Renamed elsewhere' WHERE id=2").run(),
      (db) => db.prepare('UPDATE branches SET is_active=0 WHERE id=2').run(),
      (db) => db.prepare('DELETE FROM branches WHERE id=2').run(),
    ]) {
      const db = freshDb()
      const current = db.prepare('SELECT id,name,is_active FROM branches WHERE id=2').get()
      const statements = writes.branchUpdateStatements(2, { location: 'should rollback', is_default: 1 }, current)
      mutate(db)
      assert.throws(() => runBatch(db, statements), /NOT NULL/)
      assert.equal(db.prepare('SELECT is_default FROM branches WHERE id=1').get().is_default, 1, 'default clear rolled back')
      const row = db.prepare('SELECT location FROM branches WHERE id=2').get()
      if (row) assert.notEqual(row.location, 'should rollback')
    }
  })

  await check('route and replay surfaces enforce before queue and through the atomic writer', () => {
    const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'branches.ts'), 'utf8')
    const review = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'reviewApply.ts'), 'utf8')
    const undo = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'undoAppliers.ts'), 'utf8')
    const post = route.slice(route.indexOf("app.post('/'"), route.indexOf("app.put('/:id'"))
    const put = route.slice(route.indexOf("app.put('/:id'"), route.indexOf("app.delete('/:id'"))
    const remove = route.slice(route.indexOf("app.delete('/:id'"))
    assert.doesNotMatch(post, /maybeQueueForReview|INSERT INTO branches/)
    assert.doesNotMatch(remove, /maybeQueueForReview|DELETE FROM branches/)
    assert.match(post, /CANONICAL_BRANCH_IDENTITY_CODE/)
    assert.match(remove, /CANONICAL_BRANCH_IDENTITY_CODE/)
    assert.ok(put.indexOf('prepareCanonicalBranchUpdate') < put.indexOf('maybeQueueForReview'))
    assert.match(put, /branchUpdateStatements\(id, body, current\)/)
    assert.match(review, /branchUpdateStatements\(id, body, current\)/)
    assert.match(undo, /branchUpdateStatements\(id, fields, existing\)/)
    assert.equal((review.match(/assertCanonicalBranchSetMutationAllowed\(\)/g) || []).length, 2)
  })

  console.log(`\n${passed} canonical branch identity checks passed.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

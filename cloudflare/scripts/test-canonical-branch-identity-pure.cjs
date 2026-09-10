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
    CREATE TABLE transfer_effects (id INTEGER PRIMARY KEY, note TEXT NOT NULL);
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

  await check('transfer authority requires one active row for each canonical role', () => {
    const db = freshDb()
    const rows = db.prepare(identity.CANONICAL_TRANSFER_BRANCHES_SQL).all()
    const pair = identity.resolveCanonicalTransferPair(rows)
    assert.equal(pair.shop.id, 1)
    assert.equal(pair.warehouse.id, 2)
    assert.equal(identity.isCanonicalTransferSelection(pair, 2, 1), true)
    assert.equal(identity.isCanonicalTransferSelection(pair, 1, 2), true)
    assert.equal(identity.isCanonicalTransferSelection(pair, 1, 1), false)
    assert.equal(identity.isCanonicalTransferSelection(pair, 2, 2), false)
    assert.equal(identity.isCanonicalTransferSelection(pair, 3, 1), false)

    db.prepare("INSERT INTO branches(id,name,is_active) VALUES (4,' shop ',1)").run()
    assert.throws(
      () => identity.resolveCanonicalTransferPair(db.prepare(identity.CANONICAL_TRANSFER_BRANCHES_SQL).all()),
      identity.CanonicalBranchConfigurationError,
    )
    db.prepare('UPDATE branches SET is_active=0 WHERE id=4').run()
    db.prepare('UPDATE branches SET is_active=0 WHERE id=2').run()
    assert.throws(
      () => identity.resolveCanonicalTransferPair(db.prepare(identity.CANONICAL_TRANSFER_BRANCHES_SQL).all()),
      identity.CanonicalBranchConfigurationError,
    )
  })

  await check('both transfer directions commit, while canonical ambiguity rolls back every effect', () => {
    const mutations = [
      (db) => db.prepare("INSERT INTO branches(id,name,is_active) VALUES (4,'SHOP',1)").run(),
      (db) => db.prepare('UPDATE branches SET is_active=0 WHERE id=2').run(),
      (db) => db.prepare("UPDATE branches SET name='Dispatch' WHERE id=2").run(),
      (db) => db.prepare('DELETE FROM branches WHERE id=1').run(),
    ]
    for (const [fromBranchId, toBranchId] of [[2, 1], [1, 2]]) {
      for (const mutate of mutations) {
        const db = freshDb()
        identity.resolveCanonicalTransferPair(db.prepare(identity.CANONICAL_TRANSFER_BRANCHES_SQL).all())
        const statements = [
          identity.canonicalTransferAuthorityGuardStatement(fromBranchId, toBranchId),
          { sql: "INSERT INTO transfer_effects(note) VALUES ('must roll back')" },
        ]
        mutate(db)
        assert.throws(() => runBatch(db, statements), /NOT NULL/)
        assert.equal(db.prepare('SELECT COUNT(*) AS total FROM transfer_effects').get().total, 0)
      }
    }

    const db = freshDb()
    runBatch(db, [
      identity.canonicalTransferAuthorityGuardStatement(2, 1),
      { sql: "INSERT INTO transfer_effects(note) VALUES ('warehouse-to-shop')" },
      identity.canonicalTransferAuthorityGuardStatement(1, 2),
      { sql: "INSERT INTO transfer_effects(note) VALUES ('shop-to-warehouse')" },
    ])
    assert.deepStrictEqual(
      db.prepare('SELECT note FROM transfer_effects ORDER BY rowid').all().map((row) => row.note),
      ['warehouse-to-shop', 'shop-to-warehouse'],
    )

    for (const [fromBranchId, toBranchId] of [[1, 1], [2, 2], [3, 1], [1, 3]]) {
      const refused = freshDb()
      assert.throws(() => runBatch(refused, [
        identity.canonicalTransferAuthorityGuardStatement(fromBranchId, toBranchId),
        { sql: "INSERT INTO transfer_effects(note) VALUES ('must not commit')" },
      ]), /NOT NULL/)
      assert.equal(refused.prepare('SELECT COUNT(*) AS total FROM transfer_effects').get().total, 0)
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
    const transferOperation = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'transferOperation.ts'), 'utf8')
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
    assert.equal((route.match(/resolveCanonicalTransferPair\(/g) || []).length, 2)
    assert.equal((route.match(/await planTransferOperation\(/g) || []).length, 2, 'both branch transfer routes delegate their final atomic plan')
    assert.equal((transferOperation.match(/canonicalTransferAuthorityGuardStatement\(/g) || []).length, 2,
      'the centralized planner guards both the forward batch and every undo/redo batch')
    assert.match(transferOperation, /const statements: Statement\[\] = \[canonicalTransferAuthorityGuardStatement\(args\.fromBranchId, args\.toBranchId\)/,
      'the canonical authority check must remain the first forward transfer statement')
    assert.match(undo, /await import\('\.\/transferOperation'\)/,
      'undo/redo must resolve through the same centralized transfer operation')
  })

  console.log(`\n${passed} canonical branch identity checks passed.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

// Lane LE (branch cutover): the successor helper and the role reader.
//
// resolveActiveSuccessor(rows, id) answers "where does a stock effect recorded
// against this branch land": an active branch answers itself (so nothing
// changes while both branches are active), a retired branch answers its active
// successor, anything unresolvable answers null and the caller refuses.
//
// The rows here are read from a real SQLite `branches` table built from the
// 0223 shape, not hand-written objects, so the integer flags and NULLs are the
// ones D1 hands the Worker.
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const Database = require('better-sqlite3')

function loadModule(relPath, requireShim) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', relPath), 'utf8')
  const out = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  }).outputText
  const module = { exports: {} }
  new Function('exports', 'require', 'module', out)(module.exports, requireShim, module)
  return module.exports
}

function toDbBool(value, fallback = 1) {
  if (value == null || value === '') return fallback
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number') return value ? 1 : 0
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase()) ? 1 : 0
}

const roles = loadModule('lib/branchRoles.ts', require)
const identity = loadModule('lib/canonicalBranchIdentity.ts', (id) => {
  if (id === './db') return { toDbBool }
  if (id === './branchRoles') return roles
  throw new Error(`unexpected import ${id}`)
})

function fixture(rows) {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE branches (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT, canonical_key TEXT,
    successor_branch_id INTEGER, is_default INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1
  )`)
  const insert = db.prepare('INSERT INTO branches(id,name,role,canonical_key,successor_branch_id,is_default,is_active) VALUES(?,?,?,?,?,?,?)')
  for (const r of rows) insert.run(r.id, r.name, r.role ?? null, r.canonical_key ?? null, r.successor ?? null, r.is_default ?? 0, r.is_active ?? 1)
  const read = () => db.prepare('SELECT * FROM branches ORDER BY id').all()
  return { db, read }
}

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

// Both branches active, as in production today and until the cutover.
const LEGACY = [
  { id: 1, name: 'Warehouse', is_default: 1 },
  { id: 2, name: 'Shop' },
]
// The same directory after the backfill (role = canonical key = lowercased name).
const BACKFILLED = [
  { id: 1, name: 'Warehouse', role: 'warehouse', canonical_key: 'warehouse', is_default: 1 },
  { id: 2, name: 'Shop', role: 'shop', canonical_key: 'shop' },
]
// The final state after the cutover finalizer.
const FINAL = [
  { id: 1, name: 'LC Store', role: 'shop', canonical_key: 'warehouse', is_default: 1 },
  { id: 2, name: 'Old Shop', role: 'shop', canonical_key: 'shop', is_active: 0, is_default: 0, successor: 1 },
]

check('the canonicalBranchIdentity export is the shared helper', () => {
  assert.strictEqual(identity.resolveActiveSuccessor, roles.resolveActiveSuccessor)
})

check('inert while both branches are active: identity for every id, legacy or backfilled', () => {
  for (const rows of [LEGACY, BACKFILLED]) {
    const f = fixture(rows)
    const read = f.read()
    for (const id of [1, 2]) {
      assert.deepStrictEqual(identity.resolveActiveSuccessor(read, id), { effectBranchId: id, addressedBranchId: id, viaSuccessor: false })
    }
    // the selling successor of an active selling branch is itself; the warehouse never sells
    assert.deepStrictEqual(roles.resolveSellingSuccessor(read, 2), { effectBranchId: 2, addressedBranchId: 2, viaSuccessor: false })
    assert.strictEqual(roles.resolveSellingSuccessor(read, 1), null)
    f.db.close()
  }
})

check('after the cutover Old Shop resolves to LC Store and LC Store to itself', () => {
  const f = fixture(FINAL)
  const read = f.read()
  assert.deepStrictEqual(identity.resolveActiveSuccessor(read, 2), { effectBranchId: 1, addressedBranchId: 2, viaSuccessor: true })
  assert.deepStrictEqual(identity.resolveActiveSuccessor(read, 1), { effectBranchId: 1, addressedBranchId: 1, viaSuccessor: false })
  assert.deepStrictEqual(roles.resolveSellingSuccessor(read, 2), { effectBranchId: 1, addressedBranchId: 2, viaSuccessor: true })
  f.db.close()
})

check('the effect branch of a SALE must be able to sell: the same chain onto a warehouse refuses', () => {
  const f = fixture([
    { id: 1, name: 'Warehouse', role: 'warehouse', canonical_key: 'warehouse' },
    { id: 2, name: 'Old Shop', role: 'shop', canonical_key: 'shop', is_active: 0, is_default: 0, successor: 1 },
  ])
  const read = f.read()
  assert.deepStrictEqual(identity.resolveActiveSuccessor(read, 2), { effectBranchId: 1, addressedBranchId: 2, viaSuccessor: true }, 'a restock may land on any active branch')
  assert.strictEqual(roles.resolveSellingSuccessor(read, 2), null, 'a sale may not')
  f.db.close()
})

check('broken chains refuse (null): missing, cyclic, inactive, self-successor, unknown id', () => {
  const cases = [
    ['retired with no successor', [{ id: 1, name: 'LC Store' }, { id: 2, name: 'Old Shop', is_active: 0 }], 2],
    ['successor row missing', [{ id: 2, name: 'Old Shop', is_active: 0, successor: 7 }], 2],
    ['successor inactive', [{ id: 1, name: 'LC Store', is_active: 0 }, { id: 2, name: 'Old Shop', is_active: 0, successor: 1 }], 2],
    ['retired branch names itself', [{ id: 2, name: 'Old Shop', is_active: 0, successor: 2 }], 2],
    ['two-branch cycle', [{ id: 2, name: 'A', is_active: 0, successor: 3 }, { id: 3, name: 'B', is_active: 0, successor: 2 }], 2],
    ['unknown id', FINAL, 9],
  ]
  for (const [label, rows, id] of cases) {
    const f = fixture(rows)
    assert.strictEqual(identity.resolveActiveSuccessor(f.read(), id), null, label)
    f.db.close()
  }
})

check('the role reader answers from the row: renamed branch sells by role, NULL role falls back to the name as before', () => {
  const finalRows = fixture(FINAL).read()
  assert.strictEqual(roles.branchCanSellNow(finalRows[0]), true, 'LC Store (role shop, active)')
  assert.strictEqual(roles.branchCanSellNow(finalRows[1]), false, 'Old Shop (role shop, retired)')
  // before the backfill there is no role: the name decides, exactly as today
  const legacyRows = fixture(LEGACY).read()
  assert.strictEqual(roles.branchCanSellNow(legacyRows.find((r) => r.name === 'Shop')), true)
  assert.strictEqual(roles.branchCanSellNow(legacyRows.find((r) => r.name === 'Warehouse')), false)
  // a renamed row without a role is NOT guessed to be a shop
  assert.strictEqual(roles.branchCanSellNow({ ...finalRows[0], role: null }), false)
  // the string overload is the legacy name-only reader: it cannot see the role,
  // which is exactly why the till must pass rows (the defect this lane fixes)
  assert.strictEqual(roles.branchCanSell('LC Store'), false)
  assert.strictEqual(roles.branchCanSell(finalRows[0]), true)
})

check('walker unchanged for the branch edit paths: prepareCanonicalBranchUpdate still validates the same chains', () => {
  const rows = fixture(FINAL).read()
  const retired = rows[1]
  // a retired canonical row with a valid successor keeps its metadata editable
  const prepared = identity.prepareCanonicalBranchUpdate(retired, {}, rows)
  assert.strictEqual(prepared.canonicalName, 'Shop')
  // a broken chain still refuses the edit
  assert.throws(() => identity.prepareCanonicalBranchUpdate({ ...retired, successor_branch_id: 77 }, {}, rows), identity.CanonicalBranchIdentityError)
})

console.log(`${passed} checks passed`)

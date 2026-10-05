// Lane LE (branch cutover): who may be a transfer endpoint is decided by the
// branch ROLE, falling back to the name only while the role is NULL.
//
// Two jobs:
//   1. PARITY: while both branches are active (every row has role NULL today,
//      or role = lowercased name after the identity backfill) the new guard,
//      pair resolver and directory query answer EXACTLY as the code at
//      bb639041 did. The GOLDEN_* constants below are that code, verbatim.
//   2. DISCRIMINATION: once a branch is renamed, the old name-only code
//      refuses a valid pair (RED on bb639041) and the role-aware code accepts
//      it; and in the cutover end state (one active branch) both refuse.
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
const guards = loadModule('lib/branchRoleGuards.ts', (id) => {
  if (id === './branchRoles') return roles
  throw new Error(`unexpected import ${id}`)
})

// ---- GOLDEN: the name-only implementation at bb639041 ----------------------
const GOLDEN_DIRECTORY_SQL = `
  SELECT id, name, is_active
  FROM branches
  WHERE LOWER(TRIM(name)) IN ('shop', 'warehouse')
  ORDER BY id ASC
`
function goldenGuardSql() {
  const n = (kind) => `LOWER(TRIM(name)) = '${kind}'`
  return `INSERT INTO branches (name)
      SELECT NULL
      WHERE NOT (
        (SELECT COUNT(*) FROM branches
          WHERE COALESCE(is_active, 0) = 1
            AND ${n('warehouse')}) = 1
        AND (SELECT COUNT(*) FROM branches
          WHERE COALESCE(is_active, 0) = 1
            AND ${n('shop')}) = 1
        AND (
          (
            EXISTS (SELECT 1 FROM branches WHERE id = @transfer_from_branch_id AND COALESCE(is_active, 0) = 1 AND ${n('warehouse')})
            AND EXISTS (SELECT 1 FROM branches WHERE id = @transfer_to_branch_id AND COALESCE(is_active, 0) = 1 AND ${n('shop')})
          )
          OR (
            EXISTS (SELECT 1 FROM branches WHERE id = @transfer_from_branch_id AND COALESCE(is_active, 0) = 1 AND ${n('shop')})
            AND EXISTS (SELECT 1 FROM branches WHERE id = @transfer_to_branch_id AND COALESCE(is_active, 0) = 1 AND ${n('warehouse')})
          )
        )
      )`
}
function goldenPair(rows) {
  const active = rows.filter((row) => toDbBool(row.is_active, 0) === 1)
  const shops = active.filter((row) => identity.canonicalBranchName(row.name) === 'Shop')
  const warehouses = active.filter((row) => identity.canonicalBranchName(row.name) === 'Warehouse')
  if (shops.length !== 1 || warehouses.length !== 1) throw new identity.CanonicalBranchConfigurationError()
  return { shop: shops[0], warehouse: warehouses[0] }
}
// -----------------------------------------------------------------------------

function fixture(rows) {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE branches (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT, canonical_key TEXT,
    successor_branch_id INTEGER, is_default INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1
  )`)
  const insert = db.prepare('INSERT INTO branches(id,name,role,canonical_key,successor_branch_id,is_default,is_active) VALUES(?,?,?,?,?,?,?)')
  for (const r of rows) insert.run(r.id, r.name, r.role ?? null, r.canonical_key ?? null, r.successor ?? null, r.is_default ?? 0, r.is_active ?? 1)
  return db
}
// Runs a guard statement the way D1 does: a refused guard is a NOT NULL failure.
function guardPasses(db, statement) {
  try { db.prepare(statement.sql).run(statement.params); return true } catch (error) {
    if (/NOT NULL constraint failed/.test(String(error.message))) return false
    throw error
  }
}
const newGuard = (from, to) => identity.canonicalTransferAuthorityGuardStatement(from, to)
const oldGuard = (from, to) => ({ sql: goldenGuardSql(), params: { transfer_from_branch_id: from, transfer_to_branch_id: to } })
const pairOutcome = (fn, rows) => { try { const p = fn(rows); return { shop: p.shop.id, warehouse: p.warehouse.id } } catch (e) { return { error: e.code } } }

let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }

// ---- 1. parity matrix: role NULL, and role = lowercased trimmed name --------
const NAMES = ['Shop', 'Warehouse', ' shop ', 'WAREHOUSE', 'Depot', 'Kiosk', 'Shop 2']
const ROLE_MODES = {
  'role NULL (today)': () => null,
  'role = lowercased name (after backfill)': (name) => {
    const k = String(name).trim().toLowerCase()
    return k === 'shop' || k === 'warehouse' ? k : null
  },
}
check('parity: guard, pair and directory agree with bb639041 for every two-branch state while role is NULL or the backfilled name', () => {
  let cases = 0
  for (const [modeLabel, roleFor] of Object.entries(ROLE_MODES)) {
    for (const a of NAMES) for (const b of NAMES) for (const aActive of [1, 0]) for (const bActive of [1, 0]) {
      const rows = [
        { id: 1, name: a, role: roleFor(a), is_active: aActive },
        { id: 2, name: b, role: roleFor(b), is_active: bActive },
      ]
      const db = fixture(rows)
      const read = db.prepare('SELECT * FROM branches ORDER BY id').all()
      const label = `${modeLabel}: ${JSON.stringify(rows.map((r) => [r.name, r.is_active]))}`
      for (const [from, to] of [[1, 2], [2, 1], [1, 1], [2, 2], [1, 9]]) {
        assert.strictEqual(guardPasses(db, newGuard(from, to)), guardPasses(db, oldGuard(from, to)), `${label} guard ${from}->${to}`)
      }
      const oldDir = db.prepare(GOLDEN_DIRECTORY_SQL).all()
      const newDir = db.prepare(identity.CANONICAL_TRANSFER_BRANCHES_SQL).all()
      assert.deepStrictEqual(newDir.map((r) => r.id), oldDir.map((r) => r.id), `${label} directory`)
      assert.deepStrictEqual(pairOutcome(identity.resolveCanonicalTransferPair, newDir), pairOutcome(goldenPair, oldDir), `${label} pair`)
      for (const [from, to] of [[0, 1], [1, 0], [1, 1]]) {
        const f = read[from], t = read[to]
        const golden = roles.branchCanTransferBetween(f.name, t.name) ? null : guards.TRANSFER_DIRECTION_ERROR
        assert.strictEqual(guards.transferDirectionError(f, t), golden, `${label} direction`)
      }
      db.close(); cases += 1
    }
  }
  assert.strictEqual(cases, NAMES.length * NAMES.length * 4 * Object.keys(ROLE_MODES).length, `matrix size ${cases}`)
})

// ---- 2. discrimination: a renamed branch keeps its identity -----------------
const RENAMED = [
  { id: 1, name: 'Main Store', role: 'warehouse', canonical_key: 'warehouse', is_default: 1 },
  { id: 2, name: 'Front Counter', role: 'shop', canonical_key: 'shop' },
]
check('renamed pair: the role-aware guard accepts both directions; the name-only golden refuses (RED control)', () => {
  const db = fixture(RENAMED)
  for (const [from, to] of [[1, 2], [2, 1]]) {
    assert.strictEqual(guardPasses(db, newGuard(from, to)), true, `role-aware ${from}->${to}`)
    assert.strictEqual(guardPasses(db, oldGuard(from, to)), false, `bb639041 control ${from}->${to}`)
  }
  assert.strictEqual(guardPasses(db, newGuard(1, 1)), false, 'same branch is still not a pair')
  const rows = db.prepare(identity.CANONICAL_TRANSFER_BRANCHES_SQL).all()
  assert.deepStrictEqual(rows.map((r) => r.id), [1, 2], 'directory finds both by role')
  assert.deepStrictEqual(db.prepare(GOLDEN_DIRECTORY_SQL).all(), [], 'the old directory query finds neither (control)')
  const pair = identity.resolveCanonicalTransferPair(rows)
  assert.deepStrictEqual([pair.shop.id, pair.warehouse.id], [2, 1])
  assert.strictEqual(identity.isCanonicalTransferSelection(pair, 1, 2), true)
  assert.strictEqual(identity.isCanonicalTransferSelection(pair, 2, 1), true)
  assert.strictEqual(guards.transferDirectionError(db.prepare('SELECT * FROM branches WHERE id=1').get(), db.prepare('SELECT * FROM branches WHERE id=2').get()), null)
  assert.strictEqual(guards.transferDirectionError('Main Store', 'Front Counter'), guards.TRANSFER_DIRECTION_ERROR, 'names alone cannot see the role (why the routes now pass rows)')
  db.close()
})

check('an explicit role wins over a misleading name; an invalid role is nobody', () => {
  const db = fixture([
    { id: 1, name: 'Shop', role: 'warehouse' },
    { id: 2, name: 'Warehouse', role: 'shop' },
  ])
  assert.strictEqual(guardPasses(db, newGuard(1, 2)), true)
  const rows = db.prepare(identity.CANONICAL_TRANSFER_BRANCHES_SQL).all()
  const pair = identity.resolveCanonicalTransferPair(rows)
  assert.deepStrictEqual([pair.shop.id, pair.warehouse.id], [2, 1], 'the role, not the name, picks the endpoint')
  db.close()
  const bad = fixture([{ id: 1, name: 'Warehouse', role: '' }, { id: 2, name: 'Shop' }])
  assert.strictEqual(guardPasses(bad, newGuard(1, 2)), false, "role '' is an invalid role, not a fallback to the name")
  bad.close()
})

// ---- 3. cutover end state: nothing to transfer, refused, never mis-pairs ----
const FINAL = [
  { id: 1, name: 'LC Store', role: 'shop', canonical_key: 'warehouse', is_default: 1 },
  { id: 2, name: 'Old Shop', role: 'shop', canonical_key: 'shop', is_active: 0, successor: 1 },
]
check('cutover end state: one active branch -> every transfer refused by guard, pair resolver and direction rule', () => {
  const db = fixture(FINAL)
  for (const [from, to] of [[1, 2], [2, 1], [1, 1], [2, 2]]) {
    assert.strictEqual(guardPasses(db, newGuard(from, to)), false, `guard ${from}->${to}`)
    assert.strictEqual(guardPasses(db, oldGuard(from, to)), false, `golden agrees ${from}->${to}`)
  }
  const rows = db.prepare(identity.CANONICAL_TRANSFER_BRANCHES_SQL).all()
  assert.throws(() => identity.resolveCanonicalTransferPair(rows), identity.CanonicalBranchConfigurationError)
  const [lc, old] = db.prepare('SELECT * FROM branches ORDER BY id').all()
  assert.strictEqual(guards.transferDirectionError(lc, old), guards.TRANSFER_DIRECTION_ERROR, 'two shop-role rows are not a pair')
  db.close()
})

check('the routes hand the direction rule branch ROWS, never names', () => {
  for (const file of ['routes/branches.ts', 'routes/inventory.ts']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8')
    assert.doesNotMatch(source, /transferDirectionError\(\s*fromBranch\?\.name/, `${file} must not pass names`)
    assert.match(source, /transferDirectionError\(fromBranch, toBranch\)/, `${file} passes the rows`)
    assert.match(source, /SELECT id, name, role FROM branches WHERE id = @id/, `${file} reads the role`)
  }
})

console.log(`${passed} checks passed`)

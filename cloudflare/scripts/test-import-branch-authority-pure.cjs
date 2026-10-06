// Real SQLite regression coverage for the canonical import branch authority
// helper. The import engine and dated-count writers use this wrapper at every
// write boundary so a branch rename/deactivation/duplicate cannot slip between
// preview validation and the D1 batch that mutates catalog or stock data.

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

function transpile(relPath) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  return {
    sourcePath,
    outputText: ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      fileName: sourcePath,
    }).outputText,
  }
}

const cache = new Map()
const relMap = {
  './db': () => ({}),
  './db.ts': () => ({}),
  './branchRoles': () => loadReal('lib/branchRoles.ts'),
  './branchRoles.ts': () => loadReal('lib/branchRoles.ts'),
}
const originalCompile = Module.prototype._compile
Module.prototype._compile = function (content, filename) {
  if (filename.includes(`${path.sep}cloudflare${path.sep}src${path.sep}lib${path.sep}`)) {
    const originalRequire = this.require.bind(this)
    this.require = (id) => (relMap[id] ? relMap[id]() : originalRequire(id))
  }
  return originalCompile.call(this, content, filename)
}

function loadReal(relPath) {
  if (cache.has(relPath)) return cache.get(relPath)
  const { sourcePath, outputText } = transpile(relPath)
  const mod = new Module(sourcePath, module)
  mod.filename = sourcePath
  mod.paths = Module._nodeModulePaths(path.dirname(sourcePath))
  cache.set(relPath, mod.exports)
  mod._compile(outputText, sourcePath)
  return mod.exports
}

const {
  indexCanonicalImportBranches,
  resolveCanonicalImportBranch,
  resolveImportBranchRequest,
  validateCanonicalImportBranchIds,
  withCanonicalImportBranchWriteGuard,
} = loadReal('lib/importBranchAuthority.ts')

function freshDb() {
  const sqlite = openDb(loadAll())
  let beforeBatch = null
  const db = {
    prepare: sqlite.prepare.bind(sqlite),
    async batch(statements) {
      if (beforeBatch) {
        const hook = beforeBatch
        beforeBatch = null
        hook(sqlite)
      }
      return sqlite.batch(statements)
    },
  }
  return { sqlite, db, setBeforeBatch(hook) { beforeBatch = hook } }
}

function seedCanonicalBranches(sqlite) {
  sqlite.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Shop', 1, 1)").run()
  sqlite.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (2, 'Warehouse', 1, 0)").run()
}

async function main() {
  {
    const index = indexCanonicalImportBranches([
      { id: 1, name: 'Shop', is_active: 1, is_default: 1 },
      { id: 2, name: ' shop ', is_active: 1, is_default: 0 },
    ])
    assert.strictEqual(resolveCanonicalImportBranch(index, ''), null, 'blank input cannot use a default whose canonical role is duplicated')
    assert.strictEqual(resolveCanonicalImportBranch(index, 'Shop'), null, 'explicit canonical name cannot select an ambiguous role')
  }

  {
    const { sqlite, db } = freshDb()
    seedCanonicalBranches(sqlite)
    assert.strictEqual(await validateCanonicalImportBranchIds(db, [1, 2]), null)
    const guarded = withCanonicalImportBranchWriteGuard(db, [1])
    await guarded.prepare("INSERT INTO products (name, is_active) VALUES ('Valid import', 1)").run()
    assert.strictEqual(sqlite.prepare("SELECT COUNT(*) AS n FROM products WHERE name = 'Valid import'").get().n, 1)
  }

  for (const scenario of [
    {
      name: 'deactivated selected Shop',
      mutate: (sqlite) => sqlite.prepare('UPDATE branches SET is_active = 0 WHERE id = 1').run(),
    },
    {
      name: 'renamed selected Shop',
      mutate: (sqlite) => sqlite.prepare("UPDATE branches SET name = 'Main' WHERE id = 1").run(),
    },
    {
      name: 'deleted selected Shop',
      mutate: (sqlite) => sqlite.prepare('DELETE FROM branches WHERE id = 1').run(),
    },
    {
      name: 'second normalized active Shop',
      mutate: (sqlite) => sqlite.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (3, ' shop ', 1, 0)").run(),
    },
  ]) {
    const { sqlite, db, setBeforeBatch } = freshDb()
    seedCanonicalBranches(sqlite)
    assert.strictEqual(await validateCanonicalImportBranchIds(db, [1]), null, `pre-read is valid before ${scenario.name}`)
    const guarded = withCanonicalImportBranchWriteGuard(db, [1])
    setBeforeBatch(scenario.mutate)
    await assert.rejects(
      () => guarded.prepare("INSERT INTO products (name, is_active) VALUES ('Must not persist', 1)").run(),
      /overflow|constraint|canonical/i,
      `${scenario.name} must fail inside the same atomic batch`,
    )
    assert.strictEqual(sqlite.prepare("SELECT COUNT(*) AS n FROM products WHERE name = 'Must not persist'").get().n, 0)
  }

  {
    const { sqlite, db, setBeforeBatch } = freshDb()
    seedCanonicalBranches(sqlite)
    const guarded = withCanonicalImportBranchWriteGuard(db, [1])
    setBeforeBatch((database) => database.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (3, 'SHOP', 1, 0)").run())
    await assert.rejects(() => guarded.batch([
      { sql: "INSERT INTO products (name, is_active) VALUES ('Batch write one', 1)" },
      { sql: "INSERT INTO products (name, is_active) VALUES ('Batch write two', 1)" },
    ]), /overflow|constraint|canonical/i)
    assert.strictEqual(sqlite.prepare("SELECT COUNT(*) AS n FROM products WHERE name LIKE 'Batch write %'").get().n, 0, 'the guard and all writes share one rollback boundary')
  }

  // ---- CUTOVER-LC G-G: the sheet's branch word is an IDENTITY, never a display name -------------
  const BEFORE = [
    { id: 1, name: 'Warehouse', role: null, canonical_key: null, is_active: 1, is_default: 1 },
    { id: 2, name: 'Shop', role: null, canonical_key: null, is_active: 1, is_default: 0 },
  ]
  // After the consolidation: Warehouse renamed LC Store and given role shop (canonical_key stays warehouse);
  // Shop retired as Old Shop with LC Store as successor. The names are labels and no longer say shop/warehouse.
  const AFTER = [
    { id: 1, name: 'LC Store', role: 'shop', canonical_key: 'warehouse', is_active: 1, is_default: 1, successor_branch_id: null },
    { id: 2, name: 'Old Shop', role: 'shop', canonical_key: 'shop', is_active: 0, is_default: 0, successor_branch_id: 1 },
  ]
  const ask = (rows, word) => {
    const found = resolveImportBranchRequest(indexCanonicalImportBranches(rows), word)
    return found ? { id: found.branch.id, addressed: found.addressedName } : null
  }
  // Before: today's sheets, byte-for-byte the old answers (no provenance label, nothing redirected).
  assert.deepStrictEqual(ask(BEFORE, 'shop'), { id: 2, addressed: null })
  assert.deepStrictEqual(ask(BEFORE, 'Warehouse'), { id: 1, addressed: null })
  assert.deepStrictEqual(ask(BEFORE, ''), { id: 1, addressed: null }, 'blank = the one default')
  assert.deepStrictEqual(ask(BEFORE, 'store'), { id: 2, addressed: null }, 'store = the one selling branch (the role-shop one)')
  // After: old sheets keep working. shop AND warehouse both land on LC Store; shop keeps its provenance.
  assert.deepStrictEqual(ask(AFTER, 'warehouse'), { id: 1, addressed: null }, 'warehouse is LC Store itself (canonical_key), not a lookup by name')
  assert.deepStrictEqual(ask(AFTER, 'shop'), { id: 1, addressed: 'Shop' }, 'shop routes to the successor and remembers it was addressed to Shop')
  assert.deepStrictEqual(ask(AFTER, 'store'), { id: 1, addressed: null })
  assert.deepStrictEqual(ask(AFTER, 'LC Store'), { id: 1, addressed: null }, 'an exact active name still resolves')
  assert.deepStrictEqual(ask(AFTER, ''), { id: 1, addressed: null })
  assert.strictEqual(ask(AFTER, 'Old Shop'), null, 'a retired branch is never named directly; it is reached through the shop word')
  // Refusals: ambiguity, a retired branch with no successor, and a retired chain that ends nowhere.
  assert.strictEqual(ask([...AFTER, { id: 3, name: 'Second', role: 'shop', canonical_key: 'warehouse', is_active: 1, is_default: 0 }], 'warehouse'), null, 'two active branches carrying one identity refuse')
  assert.strictEqual(ask([AFTER[0], { ...AFTER[1], successor_branch_id: null }], 'shop'), null, 'a retired Shop with no successor cannot receive stock')
  assert.strictEqual(ask([{ ...AFTER[0], is_active: 0 }, AFTER[1]], 'shop'), null, 'a successor that is itself inactive refuses')
  // Wrong implementation: the name-literal lookup the engine used before. It cannot answer the post-cutover sheet,
  // so this fixture would have caught it.
  const byName = (rows, word) => rows.filter((r) => r.is_active === 1 && r.name.trim().toLowerCase() === word).length === 1
  assert.strictEqual(byName(BEFORE, 'shop'), true, 'control: the name lookup is right before the cutover')
  assert.strictEqual(byName(AFTER, 'warehouse'), false, 'control: and wrong after it (LC Store is not named warehouse)')
  assert.strictEqual(byName(AFTER, 'shop'), false, 'control: and cannot route shop to the successor')

  // The in-batch guard follows the role as well: a renamed LC Store (role shop) is a valid import target, and a
  // second active branch with the same role between preview and commit still rolls the batch back.
  for (const rows of [BEFORE, AFTER]) {
    const { sqlite, db, setBeforeBatch } = freshDb()
    sqlite.prepare('DELETE FROM branches').run()
    for (const row of rows) {
      sqlite.prepare('INSERT INTO branches (id, name, role, canonical_key, is_active, is_default, successor_branch_id) VALUES (?,?,?,?,?,?,?)')
        .run([row.id, row.name, row.role ?? null, row.canonical_key ?? null, row.is_active, row.is_default, row.successor_branch_id ?? null])
    }
    const target = rows.find((r) => r.is_active === 1 && r.is_default === 1).id
    assert.strictEqual(await validateCanonicalImportBranchIds(db, [target]), null, 'the guard accepts the renamed selling branch by role')
    const guarded = withCanonicalImportBranchWriteGuard(db, [target])
    await guarded.prepare("INSERT INTO products (name, is_active) VALUES ('Role guard ok', 1)").run()
    assert.strictEqual(sqlite.prepare("SELECT COUNT(*) AS n FROM products WHERE name = 'Role guard ok'").get().n, 1)
    if (rows === AFTER) {
      assert.match(String(await validateCanonicalImportBranchIds(db, [2])), /inactive/, 'the retired Old Shop is not a write target')
      setBeforeBatch((database) => database.prepare("INSERT INTO branches (id, name, role, is_active, is_default) VALUES (9, 'Another till', 'shop', 1, 0)").run())
      await assert.rejects(() => guarded.prepare("INSERT INTO products (name, is_active) VALUES ('Role guard rolled back', 1)").run(), /overflow|constraint|canonical|branch/i)
      assert.strictEqual(sqlite.prepare("SELECT COUNT(*) AS n FROM products WHERE name = 'Role guard rolled back'").get().n, 0)
    }
  }

  console.log('PASS canonical import branch analysis and same-batch write authority under real SQLite')
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})

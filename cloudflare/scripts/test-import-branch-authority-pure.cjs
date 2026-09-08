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

  console.log('PASS canonical import branch analysis and same-batch write authority under real SQLite')
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})

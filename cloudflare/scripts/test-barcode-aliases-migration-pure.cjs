// DB-backed proofs for migrations/0105_barcode_aliases.sql and
// src/lib/barcodeAliases.ts's listAliases/addAliases, against REAL SQLite
// (better-sqlite3, the engine D1 runs on) -- same method as
// test-migration-chain-fresh-pure.cjs: the actual migration files, applied
// in filename order, exactly as `wrangler d1 migrations apply` would.
//
// Proves, in order:
//   1. the full chain (through 0105) applies to a fresh database
//   2. 0105 alone is idempotent -- applying it a SECOND time is a no-op,
//      not an error (every statement is IF NOT EXISTS)
//   3. ON DELETE CASCADE: deleting a product deletes its aliases
//   4. the non-unique index on barcode_normalized: the SAME alias barcode
//      is allowed on TWO DIFFERENT products (mirrors products.barcode's
//      own deliberately-non-unique posture)
//   5. UNIQUE(product_id, barcode_normalized): the SAME product cannot
//      accumulate a duplicate row for the SAME alias
//   6. barcodeAliases.ts's addAliases/listAliases/buildAliasExactClause
//      work end-to-end against this real schema (a plain SQL EXISTS query
//      built by buildAliasExactClause actually finds the right product)
//
// Run: node scripts/test-barcode-aliases-migration-pure.cjs

const path = require('path')
const fs = require('fs')
const assert = require('assert')
const ts = require('typescript')
const Database = require('better-sqlite3')

const migrationsDir = path.join(__dirname, '..', 'migrations')
const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
assert.ok(migrationFiles.includes('0105_barcode_aliases.sql'), 'migrations/0105_barcode_aliases.sql must exist')

function freshDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  for (const file of migrationFiles) {
    sqlite.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
  }
  return sqlite
}

let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }

check('the full migration chain (through 0105) applies to a fresh database', () => {
  const sqlite = freshDb()
  const row = sqlite.prepare('PRAGMA integrity_check').get()
  assert.strictEqual(row.integrity_check, 'ok')
  sqlite.close()
})

check('0105 alone is idempotent -- applying its SQL a second time does not throw', () => {
  const sqlite = freshDb()
  const sql = fs.readFileSync(path.join(migrationsDir, '0105_barcode_aliases.sql'), 'utf8')
  assert.doesNotThrow(() => sqlite.exec(sql), 'a re-apply of 0105 must be a no-op, not an error')
  const row = sqlite.prepare('PRAGMA integrity_check').get()
  assert.strictEqual(row.integrity_check, 'ok')
  sqlite.close()
})

check('ON DELETE CASCADE: deleting a product deletes its aliases', () => {
  const sqlite = freshDb()
  sqlite.prepare(`INSERT INTO products (id, name, barcode) VALUES (1, 'Widget', '0')`).run()
  sqlite.prepare(`INSERT INTO barcode_aliases (product_id, barcode, barcode_normalized, source) VALUES (1, '6923644012345', '6923644012345', 'test')`).run()
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) AS n FROM barcode_aliases WHERE product_id = 1').get().n, 1)
  sqlite.prepare('DELETE FROM products WHERE id = 1').run()
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) AS n FROM barcode_aliases WHERE product_id = 1').get().n, 0, 'the alias row must be gone once its product is deleted')
  sqlite.close()
})

check('the non-unique index allows the SAME alias barcode on TWO DIFFERENT products', () => {
  const sqlite = freshDb()
  sqlite.prepare(`INSERT INTO products (id, name, barcode) VALUES (1, 'Shade A', '0')`).run()
  sqlite.prepare(`INSERT INTO products (id, name, barcode) VALUES (2, 'Shade B', '0')`).run()
  assert.doesNotThrow(() => {
    sqlite.prepare(`INSERT INTO barcode_aliases (product_id, barcode, barcode_normalized, source) VALUES (1, '041554089073', '041554089073', 'test')`).run()
    sqlite.prepare(`INSERT INTO barcode_aliases (product_id, barcode, barcode_normalized, source) VALUES (2, '041554089073', '041554089073', 'test')`).run()
  }, 'two different products sharing one alias barcode must be allowed, same as products.barcode itself')
  assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) AS n FROM barcode_aliases WHERE barcode_normalized = '041554089073'`).get().n, 2)
  sqlite.close()
})

check('UNIQUE(product_id, barcode_normalized): the SAME product cannot get a duplicate row for the SAME alias', () => {
  const sqlite = freshDb()
  sqlite.prepare(`INSERT INTO products (id, name, barcode) VALUES (1, 'Widget', '0')`).run()
  sqlite.prepare(`INSERT INTO barcode_aliases (product_id, barcode, barcode_normalized, source) VALUES (1, '6923644012345', '6923644012345', 'test')`).run()
  assert.throws(
    () => sqlite.prepare(`INSERT INTO barcode_aliases (product_id, barcode, barcode_normalized, source) VALUES (1, '6923644012345', '6923644012345', 'test')`).run(),
    /UNIQUE constraint failed/,
  )
  sqlite.close()
})

// -- barcodeAliases.ts against this real schema --------------------------

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'barcodeAliases.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'barcodeAliases.ts',
})
const moduleObj = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))
const { listAliases, addAliases, buildAliasExactClause } = moduleObj.exports

// Thin async wrapper matching D1Compat's get/all/run contract
// (src/lib/db.ts) over a real better-sqlite3 handle -- better-sqlite3
// natively supports the same `@name` named-parameter syntax D1/this
// codebase's SQL already uses, so no translation layer is needed to get a
// faithful async get/all/run surface.
function wrapAsD1(sqlite) {
  return {
    prepare(sql) {
      const stmt = sqlite.prepare(sql)
      return {
        async all(params) { return stmt.all(params || {}) },
        async get(params) { return stmt.get(params || {}) },
        async run(params) {
          const r = stmt.run(params || {})
          return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) }
        },
      }
    },
  }
}

async function runAsyncChecks() {
  await (async () => {
    const sqlite = freshDb()
    sqlite.prepare(`INSERT INTO products (id, name, barcode) VALUES (1, 'Aveeno Eye Cream 14ml', '0')`).run()
    const db = wrapAsD1(sqlite)

    const firstInsertCount = await addAliases(db, 1, ['381371163816'], 'import:codex')
    assert.strictEqual(firstInsertCount, 1, 'addAliases should report exactly one new row inserted')

    const secondInsertCount = await addAliases(db, 1, ['381371163816'], 'import:codex')
    assert.strictEqual(secondInsertCount, 0, 'addAliases must be idempotent -- the same alias again inserts nothing')
    assert.strictEqual(sqlite.prepare('SELECT COUNT(*) AS n FROM barcode_aliases').get().n, 1, 'no duplicate row was created')

    const placeholderCount = await addAliases(db, 1, ['0', '', '12'], 'import:codex')
    assert.strictEqual(placeholderCount, 0, 'placeholders/short values are never stored as aliases')

    const dedupedWithinCall = await addAliases(db, 1, ['999888777666', '999888777666'], 'import:codex')
    assert.strictEqual(dedupedWithinCall, 1, 'the same alias passed twice in one call inserts only once')

    const aliases = await listAliases(db, 1)
    assert.strictEqual(aliases.length, 2)
    assert.deepStrictEqual(aliases.map((a) => a.barcode).sort(), ['381371163816', '999888777666'])
    assert.strictEqual(aliases[0].source, 'import:codex')
    console.log('PASS addAliases is idempotent, drops placeholders, dedupes within one call; listAliases reads them back')
    passed += 1
    sqlite.close()
  })()

  await (async () => {
    const sqlite = freshDb()
    sqlite.prepare(`INSERT INTO products (id, name, barcode) VALUES (195, 'Aveeno Eye Cream 14ml', '0')`).run()
    sqlite.prepare(`INSERT INTO products (id, name, barcode) VALUES (196, 'Unrelated Product', '111111')`).run()
    const db = wrapAsD1(sqlite)
    await addAliases(db, 195, ['381371163816'], 'import:codex')

    const bindings = {}
    const clause = buildAliasExactClause('381371163816', bindings)
    const rows = await db.prepare(`SELECT id, name FROM products WHERE ${clause}`).all(bindings)
    assert.strictEqual(rows.length, 1)
    assert.strictEqual(rows[0].id, 195)

    const bindingsMiss = {}
    const clauseMiss = buildAliasExactClause('000000000000', bindingsMiss)
    const rowsMiss = await db.prepare(`SELECT id FROM products WHERE ${clauseMiss}`).all(bindingsMiss)
    assert.strictEqual(rowsMiss.length, 0, 'an alias nobody has must find nothing')
    console.log('PASS buildAliasExactClause finds the right product by alias, and only that product, via a real query against the migrated schema')
    passed += 1
    sqlite.close()
  })()
}

runAsyncChecks().then(() => {
  console.log(`\n${passed} passed`)
}).catch((error) => {
  console.error(error)
  process.exit(1)
})

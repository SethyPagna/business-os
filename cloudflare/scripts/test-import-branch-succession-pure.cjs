// U-branch: every import touchpoint routes a sheet's branch through the
// successor rule, and records the retired branch it addressed.
//
// Real migrations -- with and without 0198 (branch successor/role) -- on an in-memory
// SQLite; the REAL lib modules (importBranchAuthority, stockActionImport,
// stockActionCatalog, datedStockCountResolve) are transpiled and run.
//
// The fixtures are production's ids: Warehouse is id 1 (the survivor, renamed
// Store), Shop is id 2 (retired, successor 1).
//
// Discriminating cases (each would pass under a plausible wrong version):
//   * shop + warehouse on one row after the merge must SUM onto Store (7), not
//     let the later column replace the earlier (4) or plan two actions;
//   * a reconcile count carried only by the shop column must be refused, not
//     overwrite Store's quantity with the Shop figure;
//   * 'store' must follow the NAME Store after the merge but mean Shop before;
//   * redirect provenance must be written once however often apply re-runs a
//     chunk, and never while every branch is active.
//
// Run (from cloudflare/): node scripts/test-import-branch-succession-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
const MIGRATIONS = path.join(__dirname, '..', 'migrations')
const SCHEMA_FILE = '0198_branch_successor_role.sql'
// The chain split around 0198: branch rows are seeded before it, the way
// production meets it, so its name-seeded role/canonical_key is exercised.
const chainFiles = (keep) => fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && keep(f)).sort()
  .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
assert.ok(loadAll().includes(fs.readFileSync(path.join(MIGRATIONS, SCHEMA_FILE), 'utf8')), '0198 is in the applied chain')

const cache = new Map()
function loadReal(relPath) {
  if (cache.has(relPath)) return cache.get(relPath)
  const sourcePath = path.join(SRC, relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  const mod = new Module(sourcePath, module)
  mod.filename = sourcePath
  mod.paths = Module._nodeModulePaths(path.dirname(sourcePath))
  cache.set(relPath, mod.exports)
  const dir = path.posix.dirname(relPath)
  const originalRequire = mod.require.bind(mod)
  mod.require = (id) => {
    if (id.startsWith('./') || id.startsWith('../')) {
      const target = path.posix.normalize(path.posix.join(dir, id.replace(/\.ts$/, ''))) + '.ts'
      if (fs.existsSync(path.join(SRC, target))) return loadReal(target)
    }
    return originalRequire(id)
  }
  mod._compile(outputText, sourcePath)
  return mod.exports
}

const authority = loadReal('lib/importBranchAuthority.ts')
const catalog = loadReal('lib/stockActionCatalog.ts')
const dated = loadReal('lib/datedStockCountResolve.ts')

function freshDb({ held = false, merged = false } = {}) {
  const raw = openDb(chainFiles((f) => f < SCHEMA_FILE))
  raw.exec(`INSERT INTO branches (id, name, is_default, is_active) VALUES (1, 'Warehouse', 0, 1), (2, 'Shop', 1, 1);
    INSERT INTO products (id, name, barcode, is_active) VALUES (10, 'Serum', 'ABC', 1);
    INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (10, 1, 20), (10, 2, 5);`)
  if (held || merged) raw.exec(fs.readFileSync(path.join(MIGRATIONS, SCHEMA_FILE), 'utf8'))
  for (const sql of chainFiles((f) => f > SCHEMA_FILE)) raw.exec(sql)
  if (merged) {
    // The branch half of the held 0199 consolidation (its stock half is
    // covered by test-migration-0198-0199-branch-consolidation-pure.cjs).
    raw.exec(`UPDATE branches SET name = 'Store', role = 'shop', is_default = 1 WHERE id = 1;
      UPDATE branches SET is_active = 0, is_default = 0, successor_branch_id = 1 WHERE id = 2;`)
  }
  const db = {
    prepare(sql) {
      const stmt = raw.prepare(sql)
      return {
        get: (params) => stmt.get(params),
        all: (params) => stmt.all(params) ?? [],
        run: (params) => {
          const r = stmt.run(params)
          return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
        },
      }
    },
    batch: (items) => raw.batch(items),
    batchOnce: (items) => raw.batch(items),
  }
  return { raw, db }
}

async function branchIndex(db) {
  return authority.indexCanonicalImportBranches(await db.prepare('SELECT * FROM branches').all())
}
function answer(resolution) {
  return resolution ? [Number(resolution.branch.id), resolution.origin ? Number(resolution.origin.id) : null] : null
}
function sheetRow(overrides) {
  return { _rowNumber: 2, name: 'Serum', barcode: 'ABC', date: '2026-09-26', action: 'add', cost_price: '2', supplier: 'Acme', ...overrides }
}
function refs(result) {
  return result.data.branchRefs.map((ref) => ({ branchId: ref.branchId, value: ref.value, origin: ref.originBranchId ?? null }))
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  for (const held of [false, true]) {
    await check(`before the merge (${held ? '0198 applied, inert' : 'without 0198'}) every column resolves as it always has`, async () => {
      const { db } = freshDb({ held })
      const index = await branchIndex(db)
      assert.deepStrictEqual(answer(authority.resolveCanonicalImportBranchWithOrigin(index, 'shop')), [2, null])
      assert.deepStrictEqual(answer(authority.resolveCanonicalImportBranchWithOrigin(index, 'Warehouse')), [1, null])
      assert.deepStrictEqual(answer(authority.resolveCanonicalImportBranchWithOrigin(index, 'store')), [2, null], 'store is the old Shop alias')
      const [both] = await catalog.classifyUnifiedStockActions(db, [sheetRow({ shop: '3', warehouse: '4' })], '{}')
      assert.deepStrictEqual(refs(both), [{ branchId: 2, value: 3, origin: null }, { branchId: 1, value: 4, origin: null }])
      const [storeOnly] = await catalog.classifyUnifiedStockActions(db, [sheetRow({ store: '5' })], '{}')
      assert.deepStrictEqual(refs(storeOnly), [{ branchId: 2, value: 5, origin: null }])
      // shop + store both mean Shop: one summed entry, not two plans.
      const [pair] = await catalog.classifyUnifiedStockActions(db, [sheetRow({ shop: '1', store: '2' })], '{}')
      assert.deepStrictEqual(refs(pair), [{ branchId: 2, value: 3, origin: null }])
      assert.strictEqual(authority.stockSheetRedirectStatements('job-pre', [both, storeOnly, pair].map((r) => ({ ...r, rowNumber: r.rowNumber }))).length, 0,
        'no provenance while every branch is active')
    })
  }

  await check('after the merge: warehouse -> Store, shop -> Store recording Shop, store -> Store by name', async () => {
    const { db } = freshDb({ merged: true })
    const index = await branchIndex(db)
    assert.deepStrictEqual(answer(authority.resolveCanonicalImportBranchWithOrigin(index, 'warehouse')), [1, null])
    assert.deepStrictEqual(answer(authority.resolveCanonicalImportBranchWithOrigin(index, ' SHOP ')), [1, 2])
    assert.deepStrictEqual(answer(authority.resolveCanonicalImportBranchWithOrigin(index, 'Store')), [1, null])
    assert.deepStrictEqual(answer(authority.resolveCanonicalImportBranchWithOrigin(index, '')), [1, null], 'blank takes the unique default')
    assert.strictEqual(authority.resolveCanonicalImportBranchWithOrigin(index, 'Depot'), null, 'an arbitrary name never becomes a target')
    assert.strictEqual(await authority.validateCanonicalImportBranchIds(db, [1]), null)
    assert.match(await authority.validateCanonicalImportBranchIds(db, [2]), /inactive/)
  })

  await check('after the merge a direct sheet row with shop + warehouse SUMS onto Store (7) and records Shop', async () => {
    const { db } = freshDb({ merged: true })
    const [row] = await catalog.classifyUnifiedStockActions(db, [sheetRow({ shop: '3', warehouse: '4' })], '{}')
    assert.deepStrictEqual(refs(row), [{ branchId: 1, value: 7, origin: 2 }])
    assert.deepStrictEqual(row.data.branchRefs[0].slots, ['shop', 'warehouse'])
    assert.notStrictEqual(row.action, 'error', row.data.errors.join('; '))
    const [storeOnly] = await catalog.classifyUnifiedStockActions(db, [sheetRow({ store: '5' })], '{}')
    assert.deepStrictEqual(refs(storeOnly), [{ branchId: 1, value: 5, origin: null }], 'a store column is not a redirect')
  })

  await check('after the merge a reconcile count carried only by the shop column is refused; warehouse/store counts are not', async () => {
    const { db } = freshDb({ merged: true })
    const policy = '{"stock_action_mode":"reconcile"}'
    const [shopOnly] = await catalog.classifyUnifiedStockActions(db, [sheetRow({ shop: '9', action: '' })], policy)
    assert.strictEqual(shopOnly.action, 'error')
    assert.ok(shopOnly.data.errors.some((message) => /moved into Store/.test(message)), shopOnly.data.errors.join('; '))
    for (const column of ['warehouse', 'store']) {
      const [ok] = await catalog.classifyUnifiedStockActions(db, [sheetRow({ [column]: '9', action: '' })], policy)
      assert.ok(!ok.data.errors.some((message) => /moved into/.test(message)), `${column}: ${ok.data.errors.join('; ')}`)
    }
  })

  await check('dated counts: a count addressed to the retired Shop is left unresolved (branch_retired), never applied to Store', async () => {
    const merged = freshDb({ merged: true })
    const rows = [
      { rowNumber: 2, date: '2026-09-20', branchName: 'Shop', productName: 'Serum', count: 4 },
      { rowNumber: 3, date: '2026-09-20', branchName: 'Warehouse', productName: 'Serum', count: 6 },
      { rowNumber: 4, date: '2026-09-20', branchName: 'Store', productName: 'Serum', count: 8 },
    ]
    const after = await dated.resolveDatedStockCountRows(merged.db, rows)
    assert.deepStrictEqual(after.unresolved.map((u) => [u.rowNumber, u.reason]), [[2, 'branch_retired']])
    assert.deepStrictEqual(after.resolved.map((r) => [r.rowNumber, r.branchId]).sort(), [[3, 1], [4, 1]])
    const before = await dated.resolveDatedStockCountRows(freshDb().db, rows.slice(0, 2))
    assert.deepStrictEqual(before.resolved.map((r) => [r.rowNumber, r.branchId]).sort(), [[2, 2], [3, 1]])
  })

  await check('redirect provenance is written once per row, however often an apply chunk re-runs', async () => {
    const { db, raw } = freshDb({ merged: true })
    const [row] = await catalog.classifyUnifiedStockActions(db, [sheetRow({ shop: '3', warehouse: '4' })], '{}')
    const sheetStatements = authority.stockSheetRedirectStatements('job-7', [{ ...row, rowNumber: 2 }])
    assert.strictEqual(sheetStatements.length, 1)
    await db.batch(sheetStatements)
    await db.batch(authority.stockSheetRedirectStatements('job-7', [{ ...row, rowNumber: 2 }]))
    const importRows = [{ rowNumber: 5, data: { branch_id: 1, branch_name: 'Store', branch_origin_id: 2, branch_origin_name: 'Shop' } }]
    for (let pass = 0; pass < 2; pass += 1) await db.batch(authority.importBranchRedirectStatements('job-8', 'inventory', importRows, { id: 1, name: 'Admin' }))
    const recorded = raw.prepare('SELECT entity_type, entity_key, origin_branch_id, target_branch_id, context FROM branch_redirects ORDER BY id').all()
    assert.deepStrictEqual(recorded.map((r) => ({ ...r })), [
      { entity_type: 'stock_sheet_row', entity_key: 'job-7:2:1', origin_branch_id: 2, target_branch_id: 1, context: 'shop+warehouse' },
      { entity_type: 'import_row', entity_key: 'job-8:5', origin_branch_id: 2, target_branch_id: 1, context: 'inventory' },
    ])
    // An errored or skipped row applied nothing, so it records nothing.
    assert.strictEqual(authority.stockSheetRedirectStatements('job-9', [{ ...row, rowNumber: 3, action: 'error' }]).length, 0)
  })

  await check('the in-batch write guard admits Store as the sole active branch and refuses the retired Shop', async () => {
    const { db, raw } = freshDb({ merged: true })
    const write = { sql: "INSERT INTO branch_redirects(entity_type,entity_key,origin_branch_id,target_branch_id) VALUES ('probe',@k,2,1)", params: { k: 'ok' } }
    await authority.withCanonicalImportBranchWriteGuard(db, [1]).batch([write])
    await assert.rejects(authority.withCanonicalImportBranchWriteGuard(db, [2]).batch([{ ...write, params: { k: 'refused' } }]))
    assert.deepStrictEqual(raw.prepare("SELECT entity_key FROM branch_redirects WHERE entity_type='probe'").all().map((r) => r.entity_key), ['ok'])
  })

  console.log(`\n${passed} import branch succession checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

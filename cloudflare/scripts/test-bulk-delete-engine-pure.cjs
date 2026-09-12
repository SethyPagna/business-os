// Standalone unit tests for the pure, database-free pieces of
// src/lib/bulkDeleteEngine.ts:
//   - buildCoreDeleteStatements (soft vs hard delete SQL/params per entity)
//   - ENTITY_CONFIGS (shape/consistency of every registered entity type)
//
// Same reasoning as test-import-engine-pure.cjs's own header: no D1/
// wrangler test harness in this project, so rather than skip verification
// this transpiles the REAL source file with the `typescript` package
// already in node_modules and calls the actual exported functions/data,
// not a re-implementation. The four value imports bulkDeleteEngine.ts
// pulls in (getDb, runD1BatchInChunks, bumpVersion, broadcast) are never
// called by the two exports under test here (they're only used inside
// runBulkDeleteJob/createBulkDeleteJob, which need a live D1 and aren't
// pure) -- stubbed as no-ops purely so `require()` resolves, not because
// their real behavior matters to these assertions.
//
// Run: node scripts/test-bulk-delete-engine-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'bulkDeleteEngine.ts')
const source = fs.readFileSync(sourcePath, 'utf8')

const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: 'bulkDeleteEngine.ts',
})

// Loads a sibling lib/*.ts for real (transpiled) rather than stubbing it --
// used for './sqlBinding', whose chunking IS part of what these tests
// assert, so a stub would test the stub.
function loadRealLib(relName) {
  const libPath = path.join(__dirname, '..', 'src', 'lib', `${relName}.ts`)
  const { outputText: libOut } = ts.transpileModule(fs.readFileSync(libPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: `${relName}.ts`,
  })
  const libModule = { exports: {} }
  new Function('exports', 'require', 'module', libOut)(libModule.exports, require, libModule)
  return libModule.exports
}

// Stub require: only './db', './importEngine', './cache', and
// '../durable-objects/broadcastHub' are ever requested by the transpiled
// output (Env/D1Compat/BroadcastChannel are type-only imports, elided by
// the transpiler) -- anything else falls through to the real require.
function stubRequire(id) {
  if (id === './sqlBinding') return loadRealLib('sqlBinding')
  // N13: the actor snapshot kernel. Pure, no imports of its own, so it loads
  if (id === './actorSnapshot') return loadRealLib('actorSnapshot')
  if (id === './anonymousCustomer') return loadRealLib('anonymousCustomer')
  if (id === './db') return { getDb: () => { throw new Error('getDb should not be called by these pure tests') } }
  if (id === './importEngine') return { runD1BatchInChunks: async () => { throw new Error('runD1BatchInChunks should not be called by these pure tests') } }
  if (id === './cache') return { bumpVersion: async () => { throw new Error('bumpVersion should not be called by these pure tests') } }
  if (id === '../durable-objects/broadcastHub') return { broadcast: async () => { throw new Error('broadcast should not be called by these pure tests') } }
  return require(id)
}

const moduleObj = { exports: {} }
const wrapper = new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)
wrapper(moduleObj.exports, stubRequire, moduleObj, sourcePath, path.dirname(sourcePath))

const { buildCoreDeleteStatements, ENTITY_CONFIGS, bulkDeleteWriteOffCosts } = moduleObj.exports

{
  const statements = buildCoreDeleteStatements(ENTITY_CONFIGS.products, [1, 2, 3])
  assert.strictEqual(statements.length, 1, 'a chunk inside D1\'s parameter limit stays a single statement')
  const stmt = statements[0]
  assert.match(stmt.sql, /^UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id IN \(\?,\?,\?\)$/, 'products is a soft delete (UPDATE is_active=0), matching its single-row DELETE route\'s soft-delete behavior')
  assert.deepStrictEqual(stmt.params, [1, 2, 3], 'params are the raw chunk array for positional IN(...) binding, same shape db.batch() accepts elsewhere')
  console.log('PASS buildCoreDeleteStatements soft-deletes products via UPDATE is_active=0')
}

{
  // The regression this split exists for: BULK_DELETE_CHUNK_SIZE is 500,
  // D1 refuses any statement carrying more than 100 bound parameters, and
  // the old single-statement version turned that hard limit into "all 500
  // ids failed to delete" via runBulkDeleteJob's per-chunk catch.
  const ids = Array.from({ length: 500 }, (_, i) => i + 1)
  const statements = buildCoreDeleteStatements(ENTITY_CONFIGS.products, ids)
  const bound = statements.map((s) => s.params.length)
  assert.ok(bound.every((n) => n <= 100), `every statement must stay within D1's 100 bound parameters, got ${JSON.stringify(bound)}`)
  assert.deepStrictEqual(statements.flatMap((s) => [...s.params]), ids, 'every id is covered exactly once, in order, across the split statements')
  console.log('PASS buildCoreDeleteStatements splits a 500-id chunk into D1-legal statements without losing an id')
}

{
  for (const entityType of ['customers', 'suppliers', 'delivery_contacts']) {
    const statements = buildCoreDeleteStatements(ENTITY_CONFIGS[entityType], [10, 20])
    assert.strictEqual(statements.length, 1, `${entityType}: a two-id chunk is one statement`)
    const stmt = statements[0]
    const config = ENTITY_CONFIGS[entityType]
    assert.strictEqual(config.deleteMode, 'hard', `${entityType} must be configured as a hard delete -- these tables have no is_active column`)
    const markerGuard = entityType === 'customers' ? ' AND NOT \\(COALESCE\\(is_anonymous, 0\\) = 1\\)' : ''
    assert.match(stmt.sql, new RegExp(`^DELETE FROM ${config.table} WHERE id IN \\(\\?,\\?\\)${markerGuard}$`), `${entityType} must hard-delete (real DELETE), matching contacts.ts's existing single-row DELETE /:id for this table`)
    assert.deepStrictEqual(stmt.params, [10, 20], 'params are the raw chunk array')
  }
  console.log('PASS buildCoreDeleteStatements hard-deletes customers/suppliers/delivery_contacts via DELETE, matching their existing single-row routes (no is_active column on any of the three)')
}

{
  // Every registered entity must have a buildExtraStatements that resolves
  // to an array (never throws, never returns something unusable) when
  // called with an empty id list -- the shape runBulkDeleteJob always
  // spreads into a statement array via `[...deleteStatements, ...extraStatements]`.
  for (const entityType of Object.keys(ENTITY_CONFIGS)) {
    const config = ENTITY_CONFIGS[entityType]
    assert.ok(config.table && config.idColumn && config.auditEntity && config.cacheKey, `${entityType}'s config is missing a required field`)
    assert.ok(config.deleteMode === 'soft' || config.deleteMode === 'hard', `${entityType}'s deleteMode must be 'soft' or 'hard', got ${config.deleteMode}`)
    assert.strictEqual(typeof config.buildExtraStatements, 'function', `${entityType} must have a buildExtraStatements function`)
  }
  console.log('PASS every ENTITY_CONFIGS entry has a complete, well-typed config (table/idColumn/auditEntity/cacheKey/deleteMode/buildExtraStatements)')
}

{
  // customers/suppliers/delivery_contacts have no branch-stock or other
  // related rows to log (unlike products) -- their buildExtraStatements
  // must resolve to an empty array, not silently omit something or throw.
  // Passing `undefined` as `db` is deliberate: these three entities'
  // buildExtraStatements never touches its db argument (NO_EXTRA_STATEMENTS
  // ignores every argument) -- if it ever DID start reading `db`, calling
  // it here would throw, which is exactly the point: it would mean the
  // config stopped being the pure no-op these tests assume.
  for (const entityType of ['customers', 'suppliers', 'delivery_contacts']) {
    const config = ENTITY_CONFIGS[entityType]
    const returnValue = config.buildExtraStatements(undefined, [1, 2], 'test reason', { id: 1, name: 'Test User' })
    assert.ok(returnValue && typeof returnValue.then === 'function', `${entityType}'s buildExtraStatements must return a Promise`)
  }
  console.log('PASS customers/suppliers/delivery_contacts buildExtraStatements returns a promise with no db access (verified by not throwing on an undefined db)')
}

;(async () => {
  for (const entityType of ['customers', 'suppliers', 'delivery_contacts']) {
    const config = ENTITY_CONFIGS[entityType]
    const extra = await config.buildExtraStatements(undefined, [1, 2], 'test reason', { id: 1, name: 'Test User' })
    assert.deepStrictEqual(extra, [], `${entityType}'s buildExtraStatements must resolve to an empty array -- no branch-stock or related rows to log for contact tables`)
  }
  console.log('PASS customers/suppliers/delivery_contacts buildExtraStatements resolves to an empty array')

  {
    const selectedRows = [{
      productId: 41, branchId: 2, quantity: 3, productName: 'Write-off item', branchName: 'Warehouse',
      unitCostUsd: 0, unitCostKhr: 12000,
    }]
    const db = {
      prepare(sql) {
        assert.match(sql, /COALESCE\(p\.cost_price_usd,[\s\S]*?pb\.unit_cost_usd/)
        assert.match(sql, /p\.cost_price_khr AS unitCostKhr/)
        return { all: async () => selectedRows }
      },
    }
    const statements = await ENTITY_CONFIGS.products.buildExtraStatements(db, [41], 'Bulk cleanup', { id: 7, name: 'Sok' })
    assert.strictEqual(statements.length, 1)
    assert.match(statements[0].sql, /unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr/)
    assert.strictEqual(statements[0].params.unitCostUsd, 0, 'explicit catalogue zero stays zero')
    assert.strictEqual(statements[0].params.totalCostUsd, 0)
    assert.strictEqual(statements[0].params.unitCostKhr, 12000)
    assert.strictEqual(statements[0].params.totalCostKhr, 36000)
    selectedRows[0].unitCostKhr = 99000
    assert.strictEqual(statements[0].params.unitCostKhr, 12000, 'the built statement keeps its plan-time primitive snapshot if the source changes before apply')

    const rawDb = openDb(loadAll())
    rawDb.prepare("INSERT INTO products (id, name, is_active, stock_quantity) VALUES (41, 'Write-off item', 1, 3)").run()
    rawDb.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (2, 'Warehouse', 1, 1)").run()
    await assert.rejects(
      () => rawDb.batch([
        statements[0],
        { sql: 'INSERT INTO table_that_does_not_exist (id) VALUES (1)', params: {} },
      ]),
      /no such table/,
      'a later failure in the delete chunk must fail its atomic batch',
    )
    assert.strictEqual(
      rawDb.prepare('SELECT COUNT(*) AS count FROM inventory_movements WHERE product_id = 41').get().count,
      0,
      'the movement and its cost snapshot roll back with the failed delete chunk',
    )

    rawDb.prepare("INSERT INTO products (id, name, is_active, stock_quantity, cost_price_usd) VALUES (42, 'Lot-valued item', 1, 4, NULL)").run()
    rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (42, 2, 4)').run()
    rawDb.prepare("INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, unit_cost_usd, is_active) VALUES (4201, 42, '42:a', 'a', '2026-01-01', 5, 1)").run()
    rawDb.prepare("INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, unit_cost_usd, is_active) VALUES (4202, 42, '42:b', 'b', '2026-02-01', 7, 1)").run()
    rawDb.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (4201, 2, 1)').run()
    rawDb.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (4202, 2, 3)').run()
    const lotFallback = await ENTITY_CONFIGS.products.buildExtraStatements(rawDb, [42], 'Bulk cleanup', { id: 7, name: 'Sok' })
    assert.strictEqual(lotFallback[0].params.unitCostUsd, 6.5, 'blank product cost uses the plan-time quantity-weighted lot cost')
    assert.strictEqual(lotFallback[0].params.totalCostUsd, 26)

    rawDb.prepare("INSERT INTO products (id, name, is_active, stock_quantity, cost_price_usd) VALUES (43, 'Partly tracked item', 1, 5, NULL)").run()
    rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (43, 2, 5)').run()
    rawDb.prepare("INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, unit_cost_usd, is_active) VALUES (4301, 43, '43:a', 'a', '2026-01-01', 8, 1)").run()
    rawDb.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (4301, 2, 4)').run()
    const partialLotFallback = await ENTITY_CONFIGS.products.buildExtraStatements(rawDb, [43], 'Bulk cleanup', { id: 7, name: 'Sok' })
    assert.strictEqual(partialLotFallback[0].params.unitCostUsd, null, 'priced lots covering only part of branch stock are unknown, not extrapolated')
    assert.strictEqual(partialLotFallback[0].params.totalCostUsd, null)
    assert.throws(
      () => bulkDeleteWriteOffCosts({ quantity: 2, unitCostUsd: 1e308, unitCostKhr: null }),
      /outside the supported numeric range/,
      'an overflowing write-off total is rejected before a D1 statement is built',
    )
    console.log('PASS product bulk-delete write-off snapshots zero/nonzero costs and total in the same movement statement')
  }

  {
    // ENTITY_PERMISSION_MAP in lib/permissions.ts must already map each of
    // these audit-entity labels to the 'contacts' permission key -- checked
    // directly against that file's source rather than assumed, since a
    // mismatch here would mean audit-log entries for a bulk contact delete
    // silently fell back to whatever the default sensitivity mapping is.
    const permissionsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'permissions.ts'), 'utf8')
    for (const auditEntity of ['customer', 'supplier', 'delivery_contact']) {
      assert.match(permissionsSource, new RegExp(`\\['${auditEntity}', 'contacts'\\]`), `lib/permissions.ts's ENTITY_PERMISSION_MAP must map '${auditEntity}' to 'contacts'`)
    }
    console.log("PASS lib/permissions.ts's ENTITY_PERMISSION_MAP already covers every new hard-delete entity's audit label")
  }

  console.log('\nAll bulk-delete engine pure-logic checks passed.')
})().catch((error) => {
  console.error(error)
  process.exit(1)
})

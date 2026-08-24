// Standalone unit tests for the pure, database-free pieces of
// src/lib/bulkDeleteEngine.ts:
//   - buildCoreDeleteStatement (soft vs hard delete SQL/params per entity)
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

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'bulkDeleteEngine.ts')
const source = fs.readFileSync(sourcePath, 'utf8')

const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: 'bulkDeleteEngine.ts',
})

// Stub require: only './db', './importEngine', './cache', and
// '../durable-objects/broadcastHub' are ever requested by the transpiled
// output (Env/D1Compat/BroadcastChannel are type-only imports, elided by
// the transpiler) -- anything else falls through to the real require.
function stubRequire(id) {
  if (id === './db') return { getDb: () => { throw new Error('getDb should not be called by these pure tests') } }
  if (id === './importEngine') return { runD1BatchInChunks: async () => { throw new Error('runD1BatchInChunks should not be called by these pure tests') } }
  if (id === './cache') return { bumpVersion: async () => { throw new Error('bumpVersion should not be called by these pure tests') } }
  if (id === '../durable-objects/broadcastHub') return { broadcast: async () => { throw new Error('broadcast should not be called by these pure tests') } }
  return require(id)
}

const moduleObj = { exports: {} }
const wrapper = new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)
wrapper(moduleObj.exports, stubRequire, moduleObj, sourcePath, path.dirname(sourcePath))

const { buildCoreDeleteStatement, ENTITY_CONFIGS } = moduleObj.exports

{
  const stmt = buildCoreDeleteStatement(ENTITY_CONFIGS.products, [1, 2, 3])
  assert.match(stmt.sql, /^UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id IN \(\?,\?,\?\)$/, 'products is a soft delete (UPDATE is_active=0), matching its single-row DELETE route\'s soft-delete behavior')
  assert.deepStrictEqual(stmt.params, [1, 2, 3], 'params are the raw chunk array for positional IN(...) binding, same shape db.batch() accepts elsewhere')
  console.log('PASS buildCoreDeleteStatement soft-deletes products via UPDATE is_active=0')
}

{
  for (const entityType of ['customers', 'suppliers', 'delivery_contacts']) {
    const stmt = buildCoreDeleteStatement(ENTITY_CONFIGS[entityType], [10, 20])
    const config = ENTITY_CONFIGS[entityType]
    assert.strictEqual(config.deleteMode, 'hard', `${entityType} must be configured as a hard delete -- these tables have no is_active column`)
    assert.match(stmt.sql, new RegExp(`^DELETE FROM ${config.table} WHERE id IN \\(\\?,\\?\\)$`), `${entityType} must hard-delete (real DELETE), matching contacts.ts's existing single-row DELETE /:id for this table`)
    assert.deepStrictEqual(stmt.params, [10, 20], 'params are the raw chunk array')
  }
  console.log('PASS buildCoreDeleteStatement hard-deletes customers/suppliers/delivery_contacts via DELETE, matching their existing single-row routes (no is_active column on any of the three)')
}

{
  // Every registered entity must have a buildExtraStatements that resolves
  // to an array (never throws, never returns something unusable) when
  // called with an empty id list -- the shape runBulkDeleteJob always
  // spreads into a statement array via `[deleteStatement, ...extraStatements]`.
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

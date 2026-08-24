// Regression test for lib/datedStockCountDecisions.ts -- the decision-
// execution layer sitting downstream of lib/datedStockCountResolve.ts's
// analysis-only output. Same approach the other dated-stock-count test
// files already use: transpile the REAL lib file and run it against a
// real in-memory SQLite database with the real migrations applied.
//
// Run (from cloudflare/): node scripts/test-dated-stock-count-decisions-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

function freshDb() {
  const rawDb = openDb(loadAll())
  const db = {
    prepare(sql) {
      const stmt = rawDb.prepare(sql)
      return {
        get: (params) => stmt.get(params),
        all: (params) => stmt.all(params) ?? [],
        run: (params) => {
          const r = stmt.run(params)
          return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
        },
      }
    },
    async batch(items) {
      const results = []
      for (const item of items) {
        const stmt = rawDb.prepare(item.sql)
        const r = stmt.run(item.params || {})
        results.push({ changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) })
      }
      return results
    },
    async transaction(fn) { return fn(this) },
  }
  return { rawDb, db }
}

function transpile(relPath) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  return { sourcePath, outputText }
}

const cache = new Map()
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

// datedStockCountDecisions.ts's only relative imports (./db,
// ./datedStockCountResolve) are both `import type` -- erased by
// transpileModule, so no relMap of real requires is needed here.

const { applyDatedStockCountDecisions } = loadReal('lib/datedStockCountDecisions.ts')

let passed = 0
let failed = 0
function test(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
    passed += 1
  } catch (err) {
    console.log(`FAIL ${name}`)
    console.log(err.stack || err)
    failed += 1
  }
}
async function testAsync(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
    passed += 1
  } catch (err) {
    console.log(`FAIL ${name}`)
    console.log(err.stack || err)
    failed += 1
  }
}

function seedProduct(rawDb, { id, name, sku = null, barcode = null, usd = 0, khr = 0 }) {
  rawDb.prepare('INSERT INTO products (id, name, sku, barcode, selling_price_usd, selling_price_khr, is_active) VALUES (@id, @name, @sku, @barcode, @usd, @khr, 1)').run({ id, name, sku, barcode, usd, khr })
}

function unresolvedRow(overrides = {}) {
  return {
    rowNumber: 1,
    reason: 'product_not_found',
    raw: { rowNumber: 1, date: '2026-08-10', branchName: 'Main', productName: 'Widget', count: 5 },
    branchId: 1,
    suggestedActions: ['create_new'],
    ...overrides,
  }
}

function resolvedRow(overrides = {}) {
  return { rowNumber: 1, date: '2026-08-10', productId: 1, branchId: 1, count: 5, ...overrides }
}

async function main() {
  // ---- reconciliation guarantee: every unresolved row must land in
  // resolved, skipped, or errors -- never silently absent ----
  await testAsync('every unresolved row is accounted for (resolved+skipped+errors reconciles)', async () => {
    const { db } = freshDb()
    const unresolved = [
      unresolvedRow({ rowNumber: 1, reason: 'product_not_found', suggestedActions: ['create_new'] }),
      unresolvedRow({ rowNumber: 2, reason: 'invalid_date', suggestedActions: [], raw: { rowNumber: 2, date: 'bogus', branchName: 'Main', productName: 'X', count: 1 } }),
      unresolvedRow({ rowNumber: 3, reason: 'product_not_found', suggestedActions: ['create_new'] }),
    ]
    const decisions = [
      { rowNumber: 1, action: 'create_new' },
      { rowNumber: 3, action: 'skip' },
    ]
    const result = await applyDatedStockCountDecisions(db, [], unresolved, decisions)
    const newlyResolvedRowNumbers = result.resolved.map((r) => r.rowNumber)
    assert.ok(newlyResolvedRowNumbers.includes(1))
    assert.strictEqual(result.skipped.length, 1)
    assert.strictEqual(result.skipped[0].rowNumber, 3)
    assert.strictEqual(result.errors.length, 1)
    assert.strictEqual(result.errors[0].rowNumber, 2)
    // reconciliation: 3 unresolved in -> 1 resolved-from-decision + 1 skipped + 1 error
    assert.strictEqual(newlyResolvedRowNumbers.length + result.skipped.length + result.errors.length, 3)
  })

  await testAsync('a row with no decision provided becomes an error, not silently dropped', async () => {
    const { db } = freshDb()
    const unresolved = [unresolvedRow({ rowNumber: 1 })]
    const result = await applyDatedStockCountDecisions(db, [], unresolved, [])
    assert.strictEqual(result.errors.length, 1)
    assert.ok(/no decision/i.test(result.errors[0].error))
  })

  await testAsync('a decision action not in suggestedActions is rejected as an error', async () => {
    const { db } = freshDb()
    const unresolved = [unresolvedRow({ rowNumber: 1, suggestedActions: ['create_new'] })]
    const result = await applyDatedStockCountDecisions(db, [], unresolved, [{ rowNumber: 1, action: 'link_variant', candidateProductId: 99 }])
    assert.strictEqual(result.errors.length, 1)
    assert.ok(/not valid for this row/.test(result.errors[0].error))
  })

  // ---- create_new: genuinely new name, standalone row ----
  await testAsync('create_new inserts a standalone product using the row\'s own name', async () => {
    const { db, rawDb } = freshDb()
    const unresolved = [unresolvedRow({ rowNumber: 1, reason: 'product_not_found', suggestedActions: ['create_new'], raw: { rowNumber: 1, date: '2026-08-10', branchName: 'Main', productName: 'Brand New Thing', count: 7 } })]
    const result = await applyDatedStockCountDecisions(db, [], unresolved, [{ rowNumber: 1, action: 'create_new' }])
    assert.strictEqual(result.productsCreated.length, 1)
    assert.strictEqual(result.productsCreated[0].action, 'create_new')
    assert.strictEqual(result.productsCreated[0].name, 'Brand New Thing')
    const stored = rawDb.prepare('SELECT name, parent_id FROM products WHERE id = @id').get({ id: result.productsCreated[0].productId })
    assert.strictEqual(stored.name, 'Brand New Thing')
    assert.strictEqual(stored.parent_id, null)
    const newRow = result.resolved.find((r) => r.rowNumber === 1)
    assert.strictEqual(newRow.productId, result.productsCreated[0].productId)
    assert.strictEqual(newRow.count, 7)
  })

  await testAsync('create_new with no product name is an error, not a blank-name insert', async () => {
    const { db } = freshDb()
    const unresolved = [unresolvedRow({ rowNumber: 1, raw: { rowNumber: 1, date: '2026-08-10', branchName: 'Main', productName: '', count: 1 } })]
    const result = await applyDatedStockCountDecisions(db, [], unresolved, [{ rowNumber: 1, action: 'create_new' }])
    assert.strictEqual(result.errors.length, 1)
    assert.ok(/requires a product name/.test(result.errors[0].error))
  })

  // ---- link_variant: merge the count into the chosen candidate as-is ----
  await testAsync('link_variant attaches the row to the chosen candidate product, no new row', async () => {
    const { db, rawDb } = freshDb()
    seedProduct(rawDb, { id: 10, name: 'Existing Widget' })
    const unresolved = [unresolvedRow({ rowNumber: 1, reason: 'ambiguous_barcode', suggestedActions: ['link_variant', 'create_child', 'create_new'], candidateProductIds: [10] })]
    const result = await applyDatedStockCountDecisions(db, [], unresolved, [{ rowNumber: 1, action: 'link_variant', candidateProductId: 10 }])
    assert.strictEqual(result.productsCreated.length, 0)
    const newRow = result.resolved.find((r) => r.rowNumber === 1)
    assert.strictEqual(newRow.productId, 10)
    const count = rawDb.prepare('SELECT COUNT(*) as n FROM products').get().n
    assert.strictEqual(count, 1)
  })

  // ---- create_child: child row sharing the candidate's NAME (this
  // app's grouping convention), own sku/barcode -- per the user's own
  // clarification: same product w/ different details => child row;
  // different name => standalone (that's create_new, tested above). ----
  await testAsync('create_child inserts a new row reusing the candidate\'s name (child row via name-grouping)', async () => {
    const { db, rawDb } = freshDb()
    seedProduct(rawDb, { id: 20, name: 'Grouped Product', sku: 'PARENT-SKU' })
    const unresolved = [unresolvedRow({
      rowNumber: 1,
      reason: 'ambiguous_name',
      suggestedActions: ['link_variant', 'create_child', 'create_new'],
      candidateProductIds: [20],
      raw: { rowNumber: 1, date: '2026-08-10', branchName: 'Main', productName: 'Grouped Product', sku: 'CHILD-SKU', barcode: '111222', count: 3 },
    })]
    const result = await applyDatedStockCountDecisions(db, [], unresolved, [{ rowNumber: 1, action: 'create_child', candidateProductId: 20 }])
    assert.strictEqual(result.productsCreated.length, 1)
    assert.strictEqual(result.productsCreated[0].action, 'create_child')
    assert.strictEqual(result.productsCreated[0].name, 'Grouped Product')
    const stored = rawDb.prepare('SELECT name, sku, barcode, parent_id FROM products WHERE id = @id').get({ id: result.productsCreated[0].productId })
    // Same name as the parent (so the app's existing name-based grouping
    // picks it up automatically), own distinct sku/barcode, no explicit
    // parent_id needed since grouping here is name-driven.
    assert.strictEqual(stored.name, 'Grouped Product')
    assert.strictEqual(stored.sku, 'CHILD-SKU')
    assert.strictEqual(stored.barcode, '111222')
    const allNamed = rawDb.prepare('SELECT COUNT(*) as n FROM products WHERE name = @name').get({ name: 'Grouped Product' }).n
    assert.strictEqual(allNamed, 2)
  })

  // ---- name lock: a child row can never carry a different name than
  // its parent WITHOUT an explicit unlock+confirm -- per the user's own
  // instruction, an unconfirmed mismatch is rejected outright rather
  // than silently overridden either way. ----
  await testAsync('create_child rejects a decision that supplies a different name than the candidate, with no nameOverrideConfirmed', async () => {
    const { db, rawDb } = freshDb()
    seedProduct(rawDb, { id: 50, name: 'Locked Parent' })
    const unresolved = [unresolvedRow({ rowNumber: 1, reason: 'ambiguous_name', suggestedActions: ['link_variant', 'create_child', 'create_new'], candidateProductIds: [50] })]
    const result = await applyDatedStockCountDecisions(db, [], unresolved, [{ rowNumber: 1, action: 'create_child', candidateProductId: 50, name: 'A Totally Different Name' }])
    assert.strictEqual(result.productsCreated.length, 0)
    assert.strictEqual(result.errors.length, 1)
    assert.ok(/is locked to the parent product's name/.test(result.errors[0].error))
    assert.ok(/unlocking and confirming/.test(result.errors[0].error))
    assert.ok(/create_new/.test(result.errors[0].error))
    const count = rawDb.prepare('SELECT COUNT(*) as n FROM products').get().n
    assert.strictEqual(count, 1) // no stray row inserted
  })

  await testAsync('create_child accepts a decision whose name matches the candidate (case/whitespace-insensitive)', async () => {
    const { db, rawDb } = freshDb()
    seedProduct(rawDb, { id: 51, name: 'Matching Parent' })
    const unresolved = [unresolvedRow({ rowNumber: 1, reason: 'ambiguous_name', suggestedActions: ['link_variant', 'create_child', 'create_new'], candidateProductIds: [51] })]
    const result = await applyDatedStockCountDecisions(db, [], unresolved, [{ rowNumber: 1, action: 'create_child', candidateProductId: 51, name: '  matching parent  ' }])
    assert.strictEqual(result.errors.length, 0)
    assert.strictEqual(result.productsCreated.length, 1)
    assert.strictEqual(result.productsCreated[0].name, 'Matching Parent')
    assert.strictEqual(result.productsCreated[0].nameUnlocked, undefined) // matching name is never an "unlock", even with the flag omitted
  })

  // ---- name UNLOCK: an explicit nameOverrideConfirmed lets a human
  // deliberately break a child row off from its group with its own name
  // -- this session's escape hatch, mirroring ProductForm.tsx's own
  // click-to-unlock UI on an already-saved grouped product. ----
  await testAsync('create_child still rejects a mismatched name even with nameOverrideConfirmed omitted/false', async () => {
    const { db, rawDb } = freshDb()
    seedProduct(rawDb, { id: 60, name: 'Still Locked Parent' })
    const unresolved = [unresolvedRow({ rowNumber: 1, reason: 'ambiguous_name', suggestedActions: ['link_variant', 'create_child', 'create_new'], candidateProductIds: [60] })]
    const result = await applyDatedStockCountDecisions(db, [], unresolved, [{ rowNumber: 1, action: 'create_child', candidateProductId: 60, name: 'Renamed', nameOverrideConfirmed: false }])
    assert.strictEqual(result.productsCreated.length, 0)
    assert.strictEqual(result.errors.length, 1)
    assert.ok(/is locked to the parent product's name/.test(result.errors[0].error))
  })

  await testAsync('create_child with nameOverrideConfirmed uses the human\'s own name and breaks it off from the group', async () => {
    const { db, rawDb } = freshDb()
    seedProduct(rawDb, { id: 61, name: 'Unlocked Parent' })
    const unresolved = [unresolvedRow({
      rowNumber: 1,
      reason: 'ambiguous_name',
      suggestedActions: ['link_variant', 'create_child', 'create_new'],
      candidateProductIds: [61],
      raw: { rowNumber: 1, date: '2026-08-10', branchName: 'Main', productName: 'Unlocked Parent', sku: 'UNLOCKED-SKU', barcode: '999888', count: 2 },
    })]
    const result = await applyDatedStockCountDecisions(db, [], unresolved, [{ rowNumber: 1, action: 'create_child', candidateProductId: 61, name: 'Genuinely Different Name', nameOverrideConfirmed: true }])
    assert.strictEqual(result.errors.length, 0)
    assert.strictEqual(result.productsCreated.length, 1)
    assert.strictEqual(result.productsCreated[0].name, 'Genuinely Different Name')
    assert.strictEqual(result.productsCreated[0].nameUnlocked, true)
    const stored = rawDb.prepare('SELECT name, sku FROM products WHERE id = @id').get({ id: result.productsCreated[0].productId })
    assert.strictEqual(stored.name, 'Genuinely Different Name')
    assert.strictEqual(stored.sku, 'UNLOCKED-SKU')
    // Broke off from the group: no longer shares a name with the parent.
    const sameNameAsParent = rawDb.prepare('SELECT COUNT(*) as n FROM products WHERE name = @name').get({ name: 'Unlocked Parent' }).n
    assert.strictEqual(sameNameAsParent, 1) // only the original parent row
  })

  await testAsync('create_child with nameOverrideConfirmed but name actually matches the candidate is a normal (non-unlocked) child', async () => {
    const { db, rawDb } = freshDb()
    seedProduct(rawDb, { id: 62, name: 'Same Name Parent' })
    const unresolved = [unresolvedRow({ rowNumber: 1, reason: 'ambiguous_name', suggestedActions: ['link_variant', 'create_child', 'create_new'], candidateProductIds: [62] })]
    const result = await applyDatedStockCountDecisions(db, [], unresolved, [{ rowNumber: 1, action: 'create_child', candidateProductId: 62, name: 'Same Name Parent', nameOverrideConfirmed: true }])
    assert.strictEqual(result.errors.length, 0)
    assert.strictEqual(result.productsCreated.length, 1)
    assert.strictEqual(result.productsCreated[0].nameUnlocked, undefined) // confirmed flag is a no-op when the name didn't actually differ
  })

  await testAsync('create_child / link_variant with a candidateProductId NOT among the row\'s own candidates is rejected', async () => {
    const { db, rawDb } = freshDb()
    seedProduct(rawDb, { id: 30, name: 'Real Candidate' })
    seedProduct(rawDb, { id: 31, name: 'Unrelated Product' })
    const unresolved = [unresolvedRow({ rowNumber: 1, reason: 'ambiguous_barcode', suggestedActions: ['link_variant', 'create_child', 'create_new'], candidateProductIds: [30] })]
    const result = await applyDatedStockCountDecisions(db, [], unresolved, [{ rowNumber: 1, action: 'link_variant', candidateProductId: 31 }])
    assert.strictEqual(result.errors.length, 1)
    assert.ok(/own candidates/.test(result.errors[0].error))
  })

  await testAsync('create_child with a missing candidateProductId is an error', async () => {
    const { db } = freshDb()
    const unresolved = [unresolvedRow({ rowNumber: 1, reason: 'ambiguous_name', suggestedActions: ['link_variant', 'create_child', 'create_new'], candidateProductIds: [5] })]
    const result = await applyDatedStockCountDecisions(db, [], unresolved, [{ rowNumber: 1, action: 'create_child' }])
    assert.strictEqual(result.errors.length, 1)
  })

  // ---- skip: explicit, visible, never a silent drop ----
  await testAsync('skip is recorded explicitly and creates no product', async () => {
    const { db, rawDb } = freshDb()
    const unresolved = [unresolvedRow({ rowNumber: 1 })]
    const result = await applyDatedStockCountDecisions(db, [], unresolved, [{ rowNumber: 1, action: 'skip' }])
    assert.strictEqual(result.skipped.length, 1)
    assert.strictEqual(result.skipped[0].rowNumber, 1)
    const count = rawDb.prepare('SELECT COUNT(*) as n FROM products').get().n
    assert.strictEqual(count, 0)
  })

  // ---- reasons with no possible action (pre-branch-resolution failures) ----
  await testAsync('a row with empty suggestedActions (e.g. invalid_date) is an error even with a decision supplied', async () => {
    const { db } = freshDb()
    const unresolved = [unresolvedRow({ rowNumber: 1, reason: 'invalid_date', suggestedActions: [] })]
    const result = await applyDatedStockCountDecisions(db, [], unresolved, [{ rowNumber: 1, action: 'create_new' }])
    assert.strictEqual(result.errors.length, 1)
    assert.ok(/no possible action/.test(result.errors[0].error))
  })

  // ---- price-conflict decisions on already-resolved rows ----
  await testAsync('priceConflict with no decision defaults to the suggested resolution (merge = no write)', async () => {
    const { db, rawDb } = freshDb()
    seedProduct(rawDb, { id: 40, name: 'Priced Item', usd: 10, khr: 40000 })
    const resolved = [resolvedRow({ rowNumber: 1, productId: 40, priceConflict: { currentUsd: 10, currentKhr: 40000, importedUsd: 12, importedKhr: null, suggestedResolution: 'merge' } })]
    const result = await applyDatedStockCountDecisions(db, resolved, [], [])
    const stored = rawDb.prepare('SELECT selling_price_usd FROM products WHERE id = @id').get({ id: 40 })
    assert.strictEqual(stored.selling_price_usd, 10)
    assert.strictEqual(result.resolved.length, 1)
  })

  await testAsync('priceConflict with an explicit apply_new decision writes the imported price', async () => {
    const { db, rawDb } = freshDb()
    seedProduct(rawDb, { id: 41, name: 'Priced Item 2', usd: 10, khr: 40000 })
    const resolved = [resolvedRow({ rowNumber: 1, productId: 41, priceConflict: { currentUsd: 10, currentKhr: 40000, importedUsd: 15, importedKhr: 60000, suggestedResolution: 'merge' } })]
    const result = await applyDatedStockCountDecisions(db, resolved, [], [{ rowNumber: 1, action: 'skip', priceResolution: 'apply_new' }])
    const stored = rawDb.prepare('SELECT selling_price_usd, selling_price_khr FROM products WHERE id = @id').get({ id: 41 })
    assert.strictEqual(stored.selling_price_usd, 15)
    assert.strictEqual(stored.selling_price_khr, 60000)
  })

  await testAsync('a resolved row with no priceConflict is passed through untouched', async () => {
    const { db, rawDb } = freshDb()
    seedProduct(rawDb, { id: 42, name: 'No Conflict Item', usd: 5, khr: 20000 })
    const resolved = [resolvedRow({ rowNumber: 1, productId: 42 })]
    const result = await applyDatedStockCountDecisions(db, resolved, [], [])
    assert.strictEqual(result.resolved.length, 1)
    const stored = rawDb.prepare('SELECT selling_price_usd FROM products WHERE id = @id').get({ id: 42 })
    assert.strictEqual(stored.selling_price_usd, 5)
  })

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()

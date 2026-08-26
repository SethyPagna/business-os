// Regression test for lib/datedStockCountResolve.ts -- the raw-row ->
// real-id resolution layer sitting upstream of
// lib/datedStockCountRoute.ts's buildDatedStockCountPlan. Same approach
// the other dated-stock-count test files already use: transpile the REAL
// lib file and run it against a real in-memory SQLite database with the
// real migrations applied.
//
// Run (from cloudflare/): node scripts/test-dated-stock-count-resolve-pure.cjs

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

// datedStockCountResolve.ts's only real relative import is ./batchCode
// (self-contained, no further relative imports of its own).
const relMap = {
  './sqlBinding': () => loadReal('lib/sqlBinding.ts'),
  './sqlBinding.ts': () => loadReal('lib/sqlBinding.ts'),
  './batchCode': () => loadReal('lib/batchCode.ts'),
  './batchCode.ts': () => loadReal('lib/batchCode.ts'),
}
const originalCompile = Module.prototype._compile
Module.prototype._compile = function (content, filename) {
  if (filename.includes(`${path.sep}cloudflare${path.sep}src${path.sep}lib${path.sep}`)) {
    const originalRequire = this.require.bind(this)
    this.require = (id) => (relMap[id] ? relMap[id]() : originalRequire(id))
  }
  return originalCompile.call(this, content, filename)
}

const { resolveDatedStockCountRows, parseRawDatedCountRows, MAX_RAW_DATED_COUNT_ROWS } = loadReal('lib/datedStockCountResolve.ts')

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

function seedBranch(rawDb, id, name) {
  rawDb.prepare('INSERT INTO branches (id, name, is_active) VALUES (@id, @name, 1)').run({ id, name })
}
function seedProduct(rawDb, { id, name, sku = null, barcode = null }) {
  rawDb.prepare('INSERT INTO products (id, name, sku, barcode, is_active) VALUES (@id, @name, @sku, @barcode, 1)').run({ id, name, sku, barcode })
}
function row(overrides = {}) {
  return { rowNumber: 1, date: '2026-08-10', branchName: 'Main', productName: 'Widget', count: 5, ...overrides }
}

async function main() {
  test('parseRawDatedCountRows rejects a missing rows array', () => {
    const result = parseRawDatedCountRows({})
    assert.ok('error' in result)
    assert.ok(/non-empty array/.test(result.error))
  })

  test('parseRawDatedCountRows rejects an empty rows array', () => {
    const result = parseRawDatedCountRows({ rows: [] })
    assert.ok('error' in result)
  })

  test('parseRawDatedCountRows rejects more than MAX_RAW_DATED_COUNT_ROWS rows', () => {
    const rows = Array.from({ length: MAX_RAW_DATED_COUNT_ROWS + 1 }, (_, i) => ({ date: '2026-08-10', branchName: 'Main', sku: `S${i}`, count: 1 }))
    const result = parseRawDatedCountRows({ rows })
    assert.ok('error' in result)
    assert.ok(/Too many rows/.test(result.error))
  })

  test('parseRawDatedCountRows defaults rowNumber to array position (1-based) when absent or invalid', () => {
    const result = parseRawDatedCountRows({ rows: [{ date: '2026-08-10', branchName: 'Main', sku: 'A' }, { date: '2026-08-10', branchName: 'Main', sku: 'B', rowNumber: -1 }] })
    assert.ok('rows' in result)
    assert.strictEqual(result.rows[0].rowNumber, 1)
    assert.strictEqual(result.rows[1].rowNumber, 2)
  })

  test('parseRawDatedCountRows preserves an explicit valid rowNumber (e.g. original spreadsheet row)', () => {
    const result = parseRawDatedCountRows({ rows: [{ date: '2026-08-10', branchName: 'Main', sku: 'A', rowNumber: 42 }] })
    assert.strictEqual(result.rows[0].rowNumber, 42)
  })

  test('parseRawDatedCountRows trims string fields and normalizes blank optional identifiers to null', () => {
    const result = parseRawDatedCountRows({ rows: [{ date: ' 2026-08-10 ', branchName: '  Main  ', sku: '  ', barcode: null, productName: undefined, count: 5 }] })
    const r = result.rows[0]
    assert.strictEqual(r.branchName, 'Main')
    assert.strictEqual(r.sku, null)
    assert.strictEqual(r.barcode, null)
    assert.strictEqual(r.productName, null)
  })

  test('parseRawDatedCountRows leaves an unparseable count as NaN rather than coercing it, for resolveDatedStockCountRows to flag per-row', () => {
    const result = parseRawDatedCountRows({ rows: [{ date: '2026-08-10', branchName: 'Main', sku: 'A', count: 'not-a-number' }] })
    assert.ok(Number.isNaN(result.rows[0].count))
  })

  test('parseRawDatedCountRows leaves price fields undefined when no price column was supplied', () => {
    const result = parseRawDatedCountRows({ rows: [{ date: '2026-08-10', branchName: 'Main', sku: 'A', count: 1 }] })
    assert.strictEqual(result.rows[0].sellingPriceUsd, undefined)
    assert.strictEqual(result.rows[0].sellingPriceKhr, undefined)
  })

  test('parseRawDatedCountRows parses a supplied numeric or string price', () => {
    const result = parseRawDatedCountRows({ rows: [{ date: '2026-08-10', branchName: 'Main', sku: 'A', count: 1, sellingPriceUsd: '12.50', sellingPriceKhr: 50000 }] })
    assert.strictEqual(result.rows[0].sellingPriceUsd, 12.5)
    assert.strictEqual(result.rows[0].sellingPriceKhr, 50000)
  })

  test('parseRawDatedCountRows leaves an unparseable non-empty price as null, not 0 (0 would look like a real imported price)', () => {
    const result = parseRawDatedCountRows({ rows: [{ date: '2026-08-10', branchName: 'Main', sku: 'A', count: 1, sellingPriceUsd: 'garbage' }] })
    assert.strictEqual(result.rows[0].sellingPriceUsd, null)
  })

  await testAsync('a parsed row with a NaN count is reported invalid_count by resolveDatedStockCountRows, not silently dropped', async () => {
    const { db, rawDb } = freshDb()
    seedBranch(rawDb, 1, 'Main')
    const parsed = parseRawDatedCountRows({ rows: [{ date: '2026-08-10', branchName: 'Main', sku: 'A', count: 'garbage' }] })
    assert.ok('rows' in parsed)
    const { resolved, unresolved } = await resolveDatedStockCountRows(db, parsed.rows)
    assert.strictEqual(resolved.length, 0)
    assert.strictEqual(unresolved.length, 1)
    assert.strictEqual(unresolved[0].reason, 'invalid_count')
  })

  await testAsync('resolves by exact SKU match (case-insensitive), preferred over barcode/name', async () => {
    const { rawDb, db } = freshDb()
    seedBranch(rawDb, 1, 'Main')
    seedProduct(rawDb, { id: 10, name: 'Widget', sku: 'WID-001', barcode: '999' })
    const { resolved, unresolved } = await resolveDatedStockCountRows(db, [row({ sku: 'wid-001', barcode: 'not-this', productName: 'not this either' })])
    assert.strictEqual(unresolved.length, 0, JSON.stringify(unresolved))
    assert.strictEqual(resolved.length, 1)
    assert.strictEqual(resolved[0].productId, 10)
    assert.strictEqual(resolved[0].branchId, 1)
  })

  await testAsync('falls back to barcode when no SKU is given', async () => {
    const { rawDb, db } = freshDb()
    seedBranch(rawDb, 1, 'Main')
    seedProduct(rawDb, { id: 11, name: 'Gadget', barcode: '12345' })
    const { resolved, unresolved } = await resolveDatedStockCountRows(db, [row({ barcode: '12345', productName: 'unrelated name' })])
    assert.strictEqual(unresolved.length, 0, JSON.stringify(unresolved))
    assert.strictEqual(resolved[0].productId, 11)
  })

  await testAsync('falls back to exact case-insensitive name when no SKU or barcode is given', async () => {
    const { rawDb, db } = freshDb()
    seedBranch(rawDb, 1, 'Main')
    seedProduct(rawDb, { id: 12, name: 'Eye Shadow Palette' })
    const { resolved, unresolved } = await resolveDatedStockCountRows(db, [row({ productName: 'eye shadow palette' })])
    assert.strictEqual(unresolved.length, 0, JSON.stringify(unresolved))
    assert.strictEqual(resolved[0].productId, 12)
  })

  await testAsync('a barcode shared by two real products is reported ambiguous, not silently guessed', async () => {
    const { rawDb, db } = freshDb()
    seedBranch(rawDb, 1, 'Main')
    seedProduct(rawDb, { id: 13, name: 'Product A', barcode: '777' })
    seedProduct(rawDb, { id: 14, name: 'Product B', barcode: '777' })
    const { resolved, unresolved } = await resolveDatedStockCountRows(db, [row({ barcode: '777' })])
    assert.strictEqual(resolved.length, 0)
    assert.strictEqual(unresolved.length, 1)
    assert.strictEqual(unresolved[0].reason, 'ambiguous_barcode')
  })

  await testAsync('a name matching two real products is reported ambiguous_name with both candidates and link/create options, not silently guessed', async () => {
    const { rawDb, db } = freshDb()
    seedBranch(rawDb, 1, 'Main')
    seedProduct(rawDb, { id: 15, name: 'Duplicate Name' })
    seedProduct(rawDb, { id: 16, name: 'Duplicate Name' })
    const { resolved, unresolved } = await resolveDatedStockCountRows(db, [row({ productName: 'Duplicate Name' })])
    assert.strictEqual(resolved.length, 0)
    assert.strictEqual(unresolved.length, 1)
    assert.strictEqual(unresolved[0].reason, 'ambiguous_name')
    assert.deepStrictEqual([...unresolved[0].candidateProductIds].sort(), [15, 16])
    assert.deepStrictEqual(unresolved[0].suggestedActions, ['link_variant', 'create_child', 'create_new'])
  })

  await testAsync('a product_not_found row suggests create_new only', async () => {
    const { rawDb, db } = freshDb()
    seedBranch(rawDb, 1, 'Main')
    const { unresolved } = await resolveDatedStockCountRows(db, [row({ productName: 'Never Seen' })])
    assert.strictEqual(unresolved.length, 1)
    assert.strictEqual(unresolved[0].reason, 'product_not_found')
    assert.deepStrictEqual(unresolved[0].suggestedActions, ['create_new'])
  })

  await testAsync('an ambiguous_barcode row carries both candidateProductIds and link/create options', async () => {
    const { rawDb, db } = freshDb()
    seedBranch(rawDb, 1, 'Main')
    seedProduct(rawDb, { id: 30, name: 'A', barcode: '111' })
    seedProduct(rawDb, { id: 31, name: 'B', barcode: '111' })
    const { unresolved } = await resolveDatedStockCountRows(db, [row({ barcode: '111', productName: null })])
    assert.strictEqual(unresolved.length, 1)
    assert.strictEqual(unresolved[0].reason, 'ambiguous_barcode')
    assert.deepStrictEqual([...unresolved[0].candidateProductIds].sort(), [30, 31])
    assert.deepStrictEqual(unresolved[0].suggestedActions, ['link_variant', 'create_child', 'create_new'])
  })

  await testAsync('a row with no imported price never gets a priceConflict, even when the matched product has a stored price', async () => {
    const { rawDb, db } = freshDb()
    seedBranch(rawDb, 1, 'Main')
    seedProduct(rawDb, { id: 40, name: 'Widget' })
    rawDb.prepare('UPDATE products SET selling_price_usd = 9.99 WHERE id = 40').run()
    const { resolved } = await resolveDatedStockCountRows(db, [row({ productName: 'Widget' })])
    assert.strictEqual(resolved.length, 1)
    assert.strictEqual(resolved[0].priceConflict, undefined)
  })

  await testAsync('a row with an imported price matching the current price never gets a priceConflict', async () => {
    const { rawDb, db } = freshDb()
    seedBranch(rawDb, 1, 'Main')
    seedProduct(rawDb, { id: 41, name: 'Widget' })
    rawDb.prepare('UPDATE products SET selling_price_usd = 9.99 WHERE id = 41').run()
    const { resolved } = await resolveDatedStockCountRows(db, [row({ productName: 'Widget', sellingPriceUsd: 9.99 })])
    assert.strictEqual(resolved[0].priceConflict, undefined)
  })

  await testAsync('a row with an imported price differing from the current price gets a priceConflict defaulting to merge', async () => {
    const { rawDb, db } = freshDb()
    seedBranch(rawDb, 1, 'Main')
    seedProduct(rawDb, { id: 42, name: 'Widget' })
    rawDb.prepare('UPDATE products SET selling_price_usd = 9.99, selling_price_khr = 40000 WHERE id = 42').run()
    const { resolved } = await resolveDatedStockCountRows(db, [row({ productName: 'Widget', sellingPriceUsd: 12.5 })])
    assert.strictEqual(resolved.length, 1)
    assert.ok(resolved[0].priceConflict)
    assert.strictEqual(resolved[0].priceConflict.currentUsd, 9.99)
    assert.strictEqual(resolved[0].priceConflict.currentKhr, 40000)
    assert.strictEqual(resolved[0].priceConflict.importedUsd, 12.5)
    assert.strictEqual(resolved[0].priceConflict.importedKhr, null)
    assert.strictEqual(resolved[0].priceConflict.suggestedResolution, 'merge')
  })

  await testAsync('an unmatched product is reported, never auto-created', async () => {
    const { rawDb, db } = freshDb()
    seedBranch(rawDb, 1, 'Main')
    const { resolved, unresolved } = await resolveDatedStockCountRows(db, [row({ productName: 'Nonexistent Thing' })])
    assert.strictEqual(resolved.length, 0)
    assert.strictEqual(unresolved.length, 1)
    assert.strictEqual(unresolved[0].reason, 'product_not_found')
    const count = rawDb.prepare('SELECT COUNT(*) AS n FROM products').get().n
    assert.strictEqual(count, 0)
  })

  await testAsync('an unknown branch name is auto-created (matches importEngine.ts\'s existing convention) and reported in branchesCreated', async () => {
    const { rawDb, db } = freshDb()
    seedProduct(rawDb, { id: 17, name: 'Widget' })
    const { resolved, unresolved, branchesCreated } = await resolveDatedStockCountRows(db, [row({ branchName: 'New Warehouse', productName: 'Widget' })])
    assert.strictEqual(unresolved.length, 0, JSON.stringify(unresolved))
    assert.strictEqual(resolved.length, 1)
    assert.strictEqual(branchesCreated.length, 1)
    assert.strictEqual(branchesCreated[0].name, 'New Warehouse')
    const branchRow = rawDb.prepare('SELECT id, is_active FROM branches WHERE lower(name) = @name').get({ name: 'new warehouse' })
    assert.strictEqual(branchRow.id, resolved[0].branchId)
    assert.strictEqual(branchRow.is_active, 1)
  })

  await testAsync('an existing branch (any casing) is matched, not duplicated', async () => {
    const { rawDb, db } = freshDb()
    seedBranch(rawDb, 1, 'Main Branch')
    seedProduct(rawDb, { id: 18, name: 'Widget' })
    const { resolved, branchesCreated } = await resolveDatedStockCountRows(db, [row({ branchName: 'main branch', productName: 'Widget' })])
    assert.strictEqual(resolved[0].branchId, 1)
    assert.strictEqual(branchesCreated.length, 0)
    const count = rawDb.prepare('SELECT COUNT(*) AS n FROM branches').get().n
    assert.strictEqual(count, 1)
  })

  await testAsync('an invalid date is reported and does not reach the DB lookups', async () => {
    const { db } = freshDb()
    const { resolved, unresolved } = await resolveDatedStockCountRows(db, [row({ date: 'not-a-date' })])
    assert.strictEqual(resolved.length, 0)
    assert.strictEqual(unresolved.length, 1)
    assert.strictEqual(unresolved[0].reason, 'invalid_date')
  })

  await testAsync('an mm/dd/yyyy date is normalized to ISO, same as datedStockCountRoute.ts\'s own parser', async () => {
    const { rawDb, db } = freshDb()
    seedBranch(rawDb, 1, 'Main')
    seedProduct(rawDb, { id: 19, name: 'Widget' })
    const { resolved } = await resolveDatedStockCountRows(db, [row({ date: '08/16/2026', productName: 'Widget' })])
    assert.strictEqual(resolved[0].date, '2026-08-16')
  })

  await testAsync('a negative count is reported invalid_count', async () => {
    const { db } = freshDb()
    const { resolved, unresolved } = await resolveDatedStockCountRows(db, [row({ count: -1 })])
    assert.strictEqual(resolved.length, 0)
    assert.strictEqual(unresolved[0].reason, 'invalid_count')
  })

  await testAsync('a row with no sku/barcode/name at all is reported missing_identifier, without a wasted DB round trip for it', async () => {
    const { db } = freshDb()
    const { resolved, unresolved } = await resolveDatedStockCountRows(db, [row({ productName: null })])
    assert.strictEqual(resolved.length, 0)
    assert.strictEqual(unresolved[0].reason, 'missing_identifier')
  })

  await testAsync('multiple rows resolve independently -- one bad row does not block the others in the same batch', async () => {
    const { rawDb, db } = freshDb()
    seedBranch(rawDb, 1, 'Main')
    seedProduct(rawDb, { id: 20, name: 'Widget' })
    const { resolved, unresolved } = await resolveDatedStockCountRows(db, [
      row({ rowNumber: 1, productName: 'Widget' }),
      row({ rowNumber: 2, productName: 'Ghost Product' }),
    ])
    assert.strictEqual(resolved.length, 1)
    assert.strictEqual(resolved[0].rowNumber, 1)
    assert.strictEqual(unresolved.length, 1)
    assert.strictEqual(unresolved[0].rowNumber, 2)
  })

  console.log(`\n${passed} PASS, ${failed} FAIL`)
  process.exitCode = failed ? 1 : 0
}

main()

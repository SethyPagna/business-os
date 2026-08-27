// Standalone unit tests for the pure, database-free pieces of
// src/lib/importEngine.ts:
//   - productImportRowSignature (same-batch duplicate merge fix)
//   - makeStopwatch (per-phase import timing instrumentation)
//
// There's no D1/wrangler test harness in this project yet (see
// PORTING_STATUS.md), so rather than skip verification, this transpiles the
// REAL source file with the `typescript` package already in node_modules
// (no bundler/esbuild/rollup needed -- those aren't Linux-compatible in this
// sandbox) and calls the actual exported functions, not a re-implementation.
//
// Run: node scripts/test-import-engine-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'importEngine.ts')
const source = fs.readFileSync(sourcePath, 'utf8')

const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: 'importEngine.ts',
})

// importImageMatch.ts is pure (no D1/Env dependency -- see
// test-import-image-match.cjs's own note), and resolveRowImagePath below
// genuinely calls its normalizeImageMatchKey at runtime (importEngine.ts
// no longer keeps its own separate copy -- consolidated to the one
// shared implementation), so it must be the REAL transpiled module, not
// an empty stub, or resolveRowImagePath would silently call `undefined`.
const imageMatchSourcePath = path.join(__dirname, '..', 'src', 'lib', 'importImageMatch.ts')
const imageMatchSource = fs.readFileSync(imageMatchSourcePath, 'utf8')
const { outputText: imageMatchOutputText } = ts.transpileModule(imageMatchSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'importImageMatch.ts',
})
const imageMatchModuleObj = { exports: {} }
const imageMatchWrapper = new Function('exports', 'require', 'module', '__filename', '__dirname', imageMatchOutputText)
imageMatchWrapper(imageMatchModuleObj.exports, require, imageMatchModuleObj, imageMatchSourcePath, path.dirname(imageMatchSourcePath))

// contactOptions.ts is also pure (no D1/Env dependency, per its own file
// comment) and classifyContacts (tested below) genuinely calls its
// buildImportedContactState at runtime -- same reasoning as
// importImageMatch.ts above, real transpiled module, not an empty stub.
const contactOptionsSourcePath = path.join(__dirname, '..', 'src', 'lib', 'contactOptions.ts')
const contactOptionsSource = fs.readFileSync(contactOptionsSourcePath, 'utf8')
const { outputText: contactOptionsOutputText } = ts.transpileModule(contactOptionsSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'contactOptions.ts',
})
const contactOptionsModuleObj = { exports: {} }
const contactOptionsWrapper = new Function('exports', 'require', 'module', '__filename', '__dirname', contactOptionsOutputText)
contactOptionsWrapper(contactOptionsModuleObj.exports, require, contactOptionsModuleObj, contactOptionsSourcePath, path.dirname(contactOptionsSourcePath))

// salesStatus.ts is pure (no D1/Env dependency, per its own file comment)
// and classifySales (tested below) genuinely calls normalizeSaleStatus and
// reads RETURN_STATUSES/VALID_SALE_STATUSES at runtime -- same reasoning as
// contactOptions.ts above, real transpiled module.
const salesStatusSourcePath = path.join(__dirname, '..', 'src', 'lib', 'salesStatus.ts')
const salesStatusSource = fs.readFileSync(salesStatusSourcePath, 'utf8')
const { outputText: salesStatusOutputText } = ts.transpileModule(salesStatusSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'salesStatus.ts',
})
const salesStatusModuleObj = { exports: {} }
const salesStatusWrapper = new Function('exports', 'require', 'module', '__filename', '__dirname', salesStatusOutputText)
salesStatusWrapper(salesStatusModuleObj.exports, require, salesStatusModuleObj, salesStatusSourcePath, path.dirname(salesStatusSourcePath))

// batchCode.ts is pure (no D1/Env dependency) -- productBatches.ts's
// receiveBatchStock now derives lot_code/batch_key through it (dateToBatchCode/
// normalizeToIsoDate), so it needs to be the real transpiled module wherever
// productBatches.ts itself gets loaded below, not an empty stub.
// lib/productDetailRule.ts owns THE product identity rule (details =
// barcode + cost; selling/special resolved by taking the highest). It is
// pure -- no D1/Env -- and importEngine.ts delegates every identity decision
// to it, so it must be the real transpiled module here, not a stub, or every
// create-vs-merge assertion below would be testing nothing.
// productDescriptionSections.ts owns the import description whitelist (only
// five section labels come through; anything else is dropped). Pure -- no
// D1/Env -- so load the real module: stubbing it would make every imported
// description come back undefined.
const productDescriptionSectionsSourcePath = path.join(__dirname, '..', 'src', 'lib', 'productDescriptionSections.ts')
const { outputText: productDescriptionSectionsOutputText } = ts.transpileModule(fs.readFileSync(productDescriptionSectionsSourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'productDescriptionSections.ts',
})
const productDescriptionSectionsModuleObj = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', productDescriptionSectionsOutputText)(
  productDescriptionSectionsModuleObj.exports, require, productDescriptionSectionsModuleObj,
  productDescriptionSectionsSourcePath, path.dirname(productDescriptionSectionsSourcePath),
)

const productDetailRuleSourcePath = path.join(__dirname, '..', 'src', 'lib', 'productDetailRule.ts')
const { outputText: productDetailRuleOutputText } = ts.transpileModule(fs.readFileSync(productDetailRuleSourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'productDetailRule.ts',
})
const productDetailRuleModuleObj = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', productDetailRuleOutputText)(
  productDetailRuleModuleObj.exports, require, productDetailRuleModuleObj, productDetailRuleSourcePath, path.dirname(productDetailRuleSourcePath),
)
const { resolveMergedPricing } = productDetailRuleModuleObj.exports

const batchCodeSourcePath = path.join(__dirname, '..', 'src', 'lib', 'batchCode.ts')
const batchCodeSource = fs.readFileSync(batchCodeSourcePath, 'utf8')
const { outputText: batchCodeOutputText } = ts.transpileModule(batchCodeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'batchCode.ts',
})
const batchCodeModuleObj = { exports: {} }
const batchCodeWrapper = new Function('exports', 'require', 'module', '__filename', '__dirname', batchCodeOutputText)
batchCodeWrapper(batchCodeModuleObj.exports, require, batchCodeModuleObj, batchCodeSourcePath, path.dirname(batchCodeSourcePath))

// productBatches.ts's two statement-builder exports (decrementBatchStockStatement/
// incrementBatchStockStatement) are also pure string/object builders with no
// D1 calls of their own (see the file's own comment on why they're plain
// builders, not functions that touch `db`) -- real transpiled module so the
// sales-import apply-path stock-restore statements (tested below) are the
// actual SQL this ships, not a stand-in.
const productBatchesSourcePath = path.join(__dirname, '..', 'src', 'lib', 'productBatches.ts')
const productBatchesSource = fs.readFileSync(productBatchesSourcePath, 'utf8')
const { outputText: productBatchesOutputText } = ts.transpileModule(productBatchesSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'productBatches.ts',
})
const productBatchesModuleObj = { exports: {} }
const productBatchesWrapper = new Function('exports', 'require', 'module', '__filename', '__dirname', productBatchesOutputText)
const sqlBindingSourcePath = path.join(__dirname, '..', 'src', 'lib', 'sqlBinding.ts')
const sqlBindingSource = fs.readFileSync(sqlBindingSourcePath, 'utf8')
const { outputText: sqlBindingOutputText } = ts.transpileModule(sqlBindingSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'sqlBinding.ts',
})
const sqlBindingModuleObj = { exports: {} }
const sqlBindingWrapper = new Function('exports', 'require', 'module', '__filename', '__dirname', sqlBindingOutputText)
sqlBindingWrapper(sqlBindingModuleObj.exports, require, sqlBindingModuleObj, sqlBindingSourcePath, path.dirname(sqlBindingSourcePath))

function requireForProductBatches(request) {
  if (request === './productDetailRule') return productDetailRuleModuleObj.exports
  if (request === './productDescriptionSections') return productDescriptionSectionsModuleObj.exports
  if (request === './batchCode') return batchCodeModuleObj.exports
  if (request === './sqlBinding') return sqlBindingModuleObj.exports
  return require(request)
}
productBatchesWrapper(productBatchesModuleObj.exports, requireForProductBatches, productBatchesModuleObj, productBatchesSourcePath, path.dirname(productBatchesSourcePath))

// importNumbers.ts is pure (no D1/Env dependency -- see its own file
// header) and classifySales (tested below) genuinely calls
// parseImportNumericValue/normalizeImportMoney at runtime for quantities
// and prices -- same reasoning as contactOptions.ts above, real transpiled
// module rather than the empty-stub treatment this file's `stubbable` set
// otherwise gives './importNumbers' (fine for the tests above, which never
// exercise number parsing).
const importNumbersSourcePath = path.join(__dirname, '..', 'src', 'lib', 'importNumbers.ts')
const importNumbersSource = fs.readFileSync(importNumbersSourcePath, 'utf8')
const { outputText: importNumbersOutputText } = ts.transpileModule(importNumbersSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'importNumbers.ts',
})
const importNumbersModuleObj = { exports: {} }
const importNumbersWrapper = new Function('exports', 'require', 'module', '__filename', '__dirname', importNumbersOutputText)
importNumbersWrapper(importNumbersModuleObj.exports, require, importNumbersModuleObj, importNumbersSourcePath, path.dirname(importNumbersSourcePath))

// searchMatch.ts is pure (no D1/Env dependency) and importEngine.ts now
// calls its normalizeSearchText/compactSearchText directly at write time
// (see migrations/0037_product_search_compact_columns_01.sql's own comment)
// -- real transpiled module, same treatment as the other pure lib/ files
// above, so productImportRowSignature/apply-row code paths that touch it
// don't blow up on an untranspiled .ts import.
const searchMatchSourcePath = path.join(__dirname, '..', 'src', 'lib', 'searchMatch.ts')
const searchMatchSource = fs.readFileSync(searchMatchSourcePath, 'utf8')
const { outputText: searchMatchOutputText } = ts.transpileModule(searchMatchSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'searchMatch.ts',
})
const searchMatchModuleObj = { exports: {} }
const searchMatchWrapper = new Function('exports', 'require', 'module', '__filename', '__dirname', searchMatchOutputText)
searchMatchWrapper(searchMatchModuleObj.exports, require, searchMatchModuleObj, searchMatchSourcePath, path.dirname(searchMatchSourcePath))

// sqlBinding.ts is pure (no D1/Env dependency) and owns the chunk sizes
// that keep importEngine's IN(...) lookups inside D1's 100-bound-parameter
// limit -- loaded for real, since a stub would test the stub.

// The full file also imports real Cloudflare Workers modules (D1, durable
// objects, etc.) that don't exist / can't run outside a Worker. We only
// need the pure signature function, which has no such dependency, so
// satisfy `require()` for those other imports with harmless stubs purely
// so the module can load; none of their exports are exercised by this test.
const Module = require('module')
const originalResolve = Module._resolveFilename
const stubbable = new Set(['../index', './db', './importCsv', './cache', './stockActionCatalog', './stockActionSeal', './stockActionCommit', './stockActionResolver', './stockActionImport', '../durable-objects/broadcastHub'])
const originalLoad = Module._load
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === './importImageMatch') {
    return imageMatchModuleObj.exports // real module -- resolveRowImagePath actually calls into it
  }
  if (request === './contactOptions') {
    return contactOptionsModuleObj.exports // real module -- classifyContacts actually calls into it
  }
  if (request === './salesStatus') {
    return salesStatusModuleObj.exports // real module -- classifySales actually calls into it
  }
  if (request === './productBatches') {
    return productBatchesModuleObj.exports // real module -- sales-import apply path actually calls into it
  }
  if (request === './batchCode') {
    return batchCodeModuleObj.exports // real module -- importEngine.ts's own lot_code derivation calls into it
  }
  if (request === './productDescriptionSections') {
    return productDescriptionSectionsModuleObj.exports // real module -- owns the import description whitelist
  }
  if (request === './productDetailRule') {
    return productDetailRuleModuleObj.exports // real module -- owns the identity rule importEngine delegates to
  }
  if (request === './importNumbers') {
    return importNumbersModuleObj.exports // real module -- classifySales actually calls into it
  }
  if (request === './searchMatch') {
    return searchMatchModuleObj.exports // real module -- product write paths call normalizeSearchText/compactSearchText
  }
  if (request === './sqlBinding') {
    return sqlBindingModuleObj.exports // real module -- keeps IN(...) lookups inside D1's bound-parameter limit
  }
  if (request === './salesImportCommit') {
    return { MAX_HISTORICAL_SALE_LINES: 50, applyHistoricalSaleImport: async () => ({ alreadyApplied: false }) }
  }
  if (stubbable.has(request)) {
    return {} // empty stub -- fine, these truly aren't touched by the functions under test
  }
  return originalLoad.call(this, request, parent, isMain)
}

const moduleObj = { exports: {} }
const wrapper = new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)
wrapper(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))
Module._load = originalLoad

const { productImportRowSignature, makeStopwatch } = moduleObj.exports
assert.strictEqual(typeof productImportRowSignature, 'function', 'productImportRowSignature should be exported from importEngine.ts')

// -- Test 1: two brand-new rows, identical name/cost/price/barcode/branch,
// should produce the SAME signature (the reported bug: they used to become
// two separate product rows instead of one).
const rowA = {
  name: 'Blue Widget',
  barcode: '',
  purchase_price_usd: 1.5,
  purchase_price_khr: 0,
  selling_price_usd: 2.99,
  selling_price_khr: 0,
  branch_id: 7,
}
const rowB = { ...rowA } // second row in the same CSV, same everything
assert.strictEqual(
  productImportRowSignature(rowA),
  productImportRowSignature(rowB),
  'identical in-batch rows must collapse to the same signature so they merge into one product',
)

// -- Test 2: name differs only by case/whitespace -- should still match
// (mirrors normalizeProductGroupName's own trim + collapse + lowercase).
const rowC = { ...rowA, name: '  BLUE   Widget ' }
assert.strictEqual(
  productImportRowSignature(rowA),
  productImportRowSignature(rowC),
  'name differing only by case/whitespace should still be treated as a duplicate',
)

// -- Test 3: sub-cent floating point noise (e.g. 1.5 vs 1.500001 from a CSV
// round-trip) should not create a false "different" signature.
const rowD = { ...rowA, purchase_price_usd: 1.500001 }
assert.strictEqual(
  productImportRowSignature(rowA),
  productImportRowSignature(rowD),
  'sub-cent floating point noise in price should not break the duplicate match',
)

// -- Test 4: different branch -> MUST still merge. Branch is deliberately
// NOT part of this signature (see importEngine.ts's productImportRowSignature
// comment, and classifyProducts's byName/cost/price/barcode fallback): two
// same-chunk rows for one product across different branches are the same
// product, each just gets its own branch_stock entry once the second row
// resolves to the first's pre-allocated id. This replaces an earlier
// version of this test that asserted the opposite (a "branch must also
// match" rule that has since been removed as the actual bug this file's
// fix addressed) and no longer matches the code.
const rowE = { ...rowA, branch_id: 9 }
assert.strictEqual(
  productImportRowSignature(rowA),
  productImportRowSignature(rowE),
  'same name/price/cost/barcode at a DIFFERENT branch must still be merged into one product',
)

// -- Test 5: different SELLING price -> MUST merge. Selling and special
// price are not identity (see lib/productDetailRule.ts): they are what we
// plan to charge, adjustable for sales/POS, not what the item IS. Two rows
// for one article at two hoped-for prices are one product. This inverts an
// earlier assertion that treated a price difference as a different product,
// which forked ~700 duplicate rows out of a real catalog.
const rowF = { ...rowA, selling_price_usd: 3.49 }
assert.strictEqual(
  productImportRowSignature(rowA),
  productImportRowSignature(rowF),
  'a selling-price difference alone must still merge -- price is not identity',
)

// -- Test 5b: special price is likewise not identity.
const rowF2 = { ...rowA, special_price_usd: 2.99 }
assert.strictEqual(
  productImportRowSignature(rowA),
  productImportRowSignature(rowF2),
  'a special-price difference alone must still merge',
)

// -- Test 5c: when rows DO merge and disagree on price, the HIGHEST wins --
// merging must never drop a product below a price one of the merged rows
// expected to charge.
{
  const merged = resolveMergedPricing([
    { selling_price_usd: 3.49, special_price_usd: 2.00 },
    { selling_price_usd: 2.99, special_price_usd: 2.75 },
  ])
  assert.strictEqual(merged.selling_price_usd, 3.49, 'highest selling price must win a merge')
  assert.strictEqual(merged.special_price_usd, 2.75, 'each price field resolves independently to its own highest')
}

// -- Test 6: different barcode -> must NOT merge. Barcode is a detail.
const rowG = { ...rowA, barcode: '8801234567890' }
assert.notStrictEqual(
  productImportRowSignature(rowA),
  productImportRowSignature(rowG),
  'rows with different barcodes must NOT be merged',
)

// -- Test 7: different COST -> must NOT merge. Cost is a detail: it is what
// was actually spent to buy the item, real money out, and must never be
// silently replaced by another row's figure.
const rowH = { ...rowA, cost_price_usd: 99.5 }
assert.notStrictEqual(
  productImportRowSignature(rowA),
  productImportRowSignature(rowH),
  'rows with different cost prices must NOT be merged -- cost is a detail',
)

console.log('PASS productImportRowSignature merges true in-batch duplicates and keeps genuinely different rows apart')

// -- Stopwatch sanity checks (used to build summary_json.timings) --
assert.strictEqual(typeof makeStopwatch, 'function', 'makeStopwatch should be exported from importEngine.ts')
const sw = makeStopwatch()
const busyWaitMs = (ms) => { const end = Date.now() + ms; while (Date.now() < end) { /* spin */ } }
busyWaitMs(5)
sw.lap('phaseA')
busyWaitMs(5)
sw.lap('phaseB')
assert.ok(typeof sw.marks.phaseA === 'number' && sw.marks.phaseA >= 0, 'phaseA should record a non-negative duration')
assert.ok(typeof sw.marks.phaseB === 'number' && sw.marks.phaseB >= 0, 'phaseB should record a non-negative duration')
assert.strictEqual(Object.keys(sw.marks).length, 2, 'only the two laps taken should be present')

console.log('PASS makeStopwatch records per-phase lap durations')

// -- Image import matching (the "same image name = same product name" fix) --
// normalizeImageMatchKey itself lives in importImageMatch.ts (single shared
// copy -- see the consolidation note in importEngine.ts) and already has its
// own direct-normalization assertions in test-import-image-match.cjs; here
// we only need resolveRowImagePath, importEngine.ts's own export, whose
// job is calling that shared normalizer correctly end-to-end.
const { resolveRowImagePath } = moduleObj.exports
assert.strictEqual(typeof resolveRowImagePath, 'function', 'resolveRowImagePath should be exported from importEngine.ts')

const imagesByKey = new Map([
  // Key is 'coca cola' with a space, not 'coca-cola' with a hyphen -- Part
  // 242 made normalizeImageMatchKey fold hyphens into spaces too (same as
  // underscore already was), so this map (built the same way importEngine.ts
  // itself builds it, by normalizing every uploaded filename) now keys on
  // the space form. See importImageMatch.ts's normalizeImageMatchKey for
  // the full rationale.
  ['coca cola', '/uploads/coca-cola-171234-ab12cd34.jpg'],
  ['blue widget', '/uploads/blue-widget-171235-ff00aa11.webp'],
])

// Explicit image_filename_1 column, bare filename -> resolved via the job's uploaded-images map.
assert.strictEqual(
  resolveRowImagePath({ image_filename_1: 'Coca-Cola.jpg' }, 'Some Other Name', imagesByKey),
  '/uploads/coca-cola-171234-ab12cd34.jpg',
  'an explicit image_filename column resolves against the uploaded-images map by filename',
)

// No explicit image column at all -> falls back to matching the product's own name
// (this is what makes a plain "drop a folder of images, no CSV column" import work).
assert.strictEqual(
  resolveRowImagePath({}, 'Blue Widget', imagesByKey),
  '/uploads/blue-widget-171235-ff00aa11.webp',
  'falls back to matching an uploaded image directly against the product name',
)

// Already-hosted references (URL / data URI / /uploads path) pass through untouched.
assert.strictEqual(
  resolveRowImagePath({ image_filename_1: 'https://cdn.example.com/x.jpg' }, 'Anything', imagesByKey),
  'https://cdn.example.com/x.jpg',
  'a URL image reference is used as-is, not treated as a bare filename',
)
assert.strictEqual(
  resolveRowImagePath({ image_url_1: 'uploads/already-stored.jpg' }, 'Anything', imagesByKey),
  '/uploads/already-stored.jpg',
  'a bare uploads/ path reference gets a leading slash, not a filename lookup',
)

// No match anywhere -> null, not a throw, and existing product images must survive untouched.
assert.strictEqual(
  resolveRowImagePath({ image_filename_1: 'nothing-uploaded.jpg' }, 'Unmatched Product', imagesByKey),
  null,
  'an unresolvable reference returns null rather than throwing or guessing',
)

console.log('PASS resolveRowImagePath matches explicit filenames and falls back to product-name matching')

// -- Test: getProductImportMode -- reads the products-import 'replace_all'
// vs 'merge' (default) mode out of the job's policy_json. Pure JSON-parse
// logic, no D1 involved (the D1-dependent half -- runImportApply's actual
// end-of-run deactivation query -- has no fake-D1 harness in this project
// yet, same "not yet covered" state as the rest of runImportApply/
// runImportAnalyze; this covers the part that's actually extractable).
{
  const { getProductImportMode } = moduleObj.exports
  assert.strictEqual(typeof getProductImportMode, 'function', 'getProductImportMode should be exported from importEngine.ts')

  assert.strictEqual(getProductImportMode(null), 'merge', 'no policy at all defaults to merge (the pre-existing behavior, unchanged)')
  assert.strictEqual(getProductImportMode('{}'), 'merge', 'a policy object with no import_mode key defaults to merge')
  assert.strictEqual(getProductImportMode('{"import_mode":"merge"}'), 'merge', 'explicit merge stays merge')
  assert.strictEqual(getProductImportMode('{"import_mode":"replace_all"}'), 'replace_all', 'explicit replace_all is read through')
  assert.strictEqual(getProductImportMode('{"import_mode":"something_unrecognized"}'), 'merge', 'an unrecognized value falls back to the safe default (merge) rather than being trusted as-is')
  assert.strictEqual(getProductImportMode('not valid json'), 'merge', 'unparseable policy_json falls back to merge rather than throwing')

  console.log('PASS getProductImportMode reads replace_all/merge from policy_json with a safe merge default')
}

// -- replace_all scope guard: locks down that the deactivation query this
// mode runs only ever touches the `products` table -- never sales,
// returns, sale_items, discounts, or branch_stock. This is a source-text
// assertion rather than a behavioral one (no fake-D1 harness for
// runImportApply itself yet, see the file-header comment), but it directly
// answers "does replace_all really leave everything except products
// alone": if a future edit ever widens this UPDATE's scope or adds a
// second statement touching another table in this block, this test fails
// and that change needs a deliberate second look before shipping.
{
  assert.ok(
    /UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP\s*\n\s*WHERE is_active = 1 AND \(updated_at IS NULL OR updated_at < @cutoff\)/.test(source),
    'replace_all\'s deactivation query must be exactly this UPDATE against products -- no other table, no DELETE',
  )
  // Guards against a second statement sneaking into the same block that
  // would touch a different table (sales/returns/sale_items/branch_stock)
  // as part of "replace_all" -- the block between the mode check and the
  // next unrelated section should only ever prepare one statement.
  const blockStart = source.indexOf("getProductImportMode(job.policy_json) === 'replace_all'")
  assert.ok(blockStart !== -1, 'the replace_all block should still exist in runImportApply')
  const blockEnd = source.indexOf('Last chunk: cache invalidation', blockStart)
  const block = source.slice(blockStart, blockEnd)
  const dbPrepareCount = (block.match(/db\.prepare\(/g) || []).length
  assert.strictEqual(dbPrepareCount, 1, 'the replace_all block should issue exactly one query (the products deactivation) -- more than one means it started touching something beyond products')
  assert.ok(!/\bDELETE\s+FROM\b/i.test(block), 'replace_all must never hard-DELETE -- soft-deactivate only, so sales/returns/audit rows referencing a deactivated product stay valid')
  assert.ok(!/\bsale_items\b|\breturns\b|\bsales\b|\bbranch_stock\b|\bdiscounts?\b/i.test(block), 'the replace_all block must not reference sales, returns, sale_items, branch_stock, or discounts -- it only ever touches products')

  console.log('PASS replace_all deactivation is scoped to exactly one UPDATE against products -- no other table, no hard delete')
}

// -- Test: getProductImportMode/getProductImportReplaceColumns -- Replace
// mode's column-level sub-option (Part 320, chat). Same "safe default,
// never trust an unrecognized/unparseable value" posture as the
// replace_all test just above.
{
  const { getProductImportMode, getProductImportReplaceColumns, PRODUCT_REPLACE_COLUMNS } = moduleObj.exports
  assert.strictEqual(typeof getProductImportReplaceColumns, 'function', 'getProductImportReplaceColumns should be exported from importEngine.ts')
  assert.ok(Array.isArray(PRODUCT_REPLACE_COLUMNS) && PRODUCT_REPLACE_COLUMNS.length > 0, 'PRODUCT_REPLACE_COLUMNS should be exported and non-empty')

  assert.strictEqual(getProductImportMode('{"import_mode":"replace_columns"}'), 'replace_columns', 'explicit replace_columns is read through')

  assert.deepStrictEqual(getProductImportReplaceColumns(null), [], 'no policy at all -> no columns selected')
  assert.deepStrictEqual(getProductImportReplaceColumns('{"replace_columns":["selling_price_usd","selling_price_khr"]}'), ['selling_price_usd', 'selling_price_khr'], 'a valid column list is read through in order')
  assert.deepStrictEqual(
    getProductImportReplaceColumns('{"replace_columns":["selling_price_usd","stock_quantity","not_a_real_column"]}'),
    ['selling_price_usd'],
    'stock_quantity (a cross-branch aggregate, not a plain column) and an unrecognized column name are both silently dropped, not trusted as-is',
  )
  assert.deepStrictEqual(
    getProductImportReplaceColumns('{"replace_columns":["selling_price_usd","selling_price_usd"]}'),
    ['selling_price_usd'],
    'duplicate column names collapse to one',
  )
  assert.deepStrictEqual(getProductImportReplaceColumns('not valid json'), [], 'unparseable policy_json falls back to an empty column list rather than throwing')

  console.log('PASS getProductImportMode/getProductImportReplaceColumns handle replace_columns and its column allow-list safely')
}

// -- column-level replace scope guard: locks down that the column-scoped
// UPDATE this mode builds only ever touches `products`, and is genuinely
// scoped to the operator-selected columns rather than falling through to
// the exhaustive override_replace UPDATE. Source-text assertion, same
// "no fake-D1 harness for runImportApply itself" reasoning as the
// replace_all guard above.
{
  const blockStart = source.indexOf("productImportMode === 'replace_columns' && productReplaceColumns.length")
  assert.ok(blockStart !== -1, 'the column-replace block should exist in runImportApply')
  const blockEnd = source.indexOf("'merge_stock' means", blockStart)
  const block = source.slice(blockStart, blockEnd)
  assert.ok(/UPDATE products SET \$\{setClause\}/.test(block), 'column-replace must build its SET clause from the operator-selected columns, not a fixed exhaustive list')
  assert.ok(!/\bDELETE\s+FROM\b/i.test(block), 'column-replace must never hard-DELETE')
  assert.ok(!/\bsale_items\b|\breturns\b|\bsales\b|\bbranch_stock\b|\bdiscounts?\b|\bproduct_batches\b/i.test(block), 'column-replace must not touch stock/batches -- only the selected product columns')
  assert.ok(/col !== 'image_path' \|\| d\.image_path/.test(block), 'image_path keeps its existing "only if this row actually carries one" guard, same as the exhaustive replace path')

  console.log('PASS column-level replace is scoped to exactly the operator-selected products columns -- no stock/batch writes, no other table')
}

// -- Track F parity regression guard: the products materialize INSERT and
// UPDATE must name every column the manual Add/Edit form (ProductForm.tsx)
// can write, other than stock_quantity (deliberately excluded from UPDATE
// -- see this block's own comment in importEngine.ts on why a per-branch
// CSV row must never clobber the cross-branch aggregate) and image_gallery
// (a separate side table, synced through syncProductImageGallery, not a
// products column -- tracked as a distinct, still-open gap in
// progress.md's Track F). This is a source-text assertion, not a live-DB
// one (no fake-D1 harness for materializeImportChunk yet), but it directly
// guards the exact bug Track F found this session: special pricing, the
// discount/promotion fields, out_of_stock_threshold, and
// expiry_date/expiry_alert_days were parsed off the CSV row by
// normalizeProductImportRow and then silently never written -- present on
// the manual path, dropped on the import path. If a future edit to either
// statement drops one of these columns again, this test fails.
{
  const REQUIRED_PRODUCT_WRITE_COLUMNS = [
    'name', 'sku', 'barcode', 'category', 'unit', 'description', 'brand', 'supplier',
    'selling_price_usd', 'selling_price_khr', 'special_price_usd', 'special_price_khr',
    'cost_price_usd', 'cost_price_khr',
    'low_stock_threshold', 'out_of_stock_threshold',
    'discount_enabled', 'discount_type', 'discount_percent',
    'discount_amount_usd', 'discount_amount_khr', 'discount_label', 'discount_badge_color',
    'discount_starts_at', 'discount_ends_at',
    'expiry_date', 'expiry_alert_days',
    'is_active',
  ]

  const insertMatch = source.match(/INSERT INTO products \(([^)]+)\) VALUES/)
  assert.ok(insertMatch, 'materializeImportChunk should still build an INSERT INTO products(...) statement for new rows')
  const insertColumns = insertMatch[1].split(',').map((c) => c.trim())
  for (const column of REQUIRED_PRODUCT_WRITE_COLUMNS) {
    assert.ok(insertColumns.includes(column), `products INSERT (new rows) is missing column "${column}" -- a field the manual Add form can set would silently never reach an imported product`)
  }
  assert.ok(insertColumns.includes('stock_quantity'), 'the INSERT (unlike the UPDATE) does set stock_quantity directly -- correct for a brand-new row with no prior aggregate to protect')

  const updateMatch = source.match(/UPDATE products SET name=@name[^`]*WHERE id=@id/)
  assert.ok(updateMatch, 'materializeImportChunk should still build an UPDATE products SET ... WHERE id=@id statement for matched existing rows')
  const updateClause = updateMatch[0]
  for (const column of REQUIRED_PRODUCT_WRITE_COLUMNS) {
    assert.ok(new RegExp(`\\b${column}=@${column}\\b`).test(updateClause), `products UPDATE (existing rows) is missing "${column}=@${column}" -- a field editable through the manual Edit form would silently never update on re-import`)
  }
  assert.ok(!/\bstock_quantity=@stock_quantity\b/.test(updateClause), 'the UPDATE must still exclude stock_quantity -- it is a cross-branch aggregate re-derived from branch_stock a few statements later, never set directly from one CSV row (that would let one branch\'s import clobber another branch\'s total)')

  console.log('PASS products materialize INSERT/UPDATE cover every manual-form field (Track F parity) -- stock_quantity and image_gallery correctly excluded for their own documented reasons')
}

// -- Batch/lot-code consistency on restock imports: re-importing the same
// named batch (lot code) for a product that already has it must top up
// that SAME product_batches row (and refresh its received_at) instead of
// always inserting a fresh row keyed by a generated import-only key. This
// is a source-text assertion (same "no fake-D1 harness yet" reasoning as
// the guards above) that checks the shape of the merge_stock/override_add
// write branch rather than executing it.
{
  const branchStart = source.indexOf("} else if (mode === 'merge_stock' || mode === 'override_add') {")
  assert.ok(branchStart !== -1, 'the merge_stock/override_add restock branch should still exist in runImportApply')
  const branchEnd = source.indexOf('// Legacy/default:', branchStart)
  const block = source.slice(branchStart, branchEnd)

  assert.ok(/const batchByProductAndLot = new Map/.test(source), 'runImportApply should build a product+lot -> existing active batch lookup for restock rows')
  assert.ok(/lot_code IS NOT NULL AND lot_code != ''/.test(source), 'the lot lookup should only consider batches that actually carry a lot code')
  assert.ok(/WHERE is_active = 1 AND lot_code/.test(source), 'the lot lookup should only match ACTIVE batches, same as receiveBatchStock reactivating on an explicit match rather than matching a deactivated lot silently')

  assert.ok(/const matchedBatch = lotKey \? batchByProductAndLot\.get\(lotKey\) : null/.test(block), 'the restock branch should check the lot lookup before deciding whether to top up or create')
  assert.ok(/UPDATE product_batches SET received_at = @receivedAt, is_active = 1, updated_at = @updatedAt WHERE id = @id/.test(block), 'a matched lot code must refresh received_at on the SAME existing batch row, not just leave the original untouched')
  assert.ok(/ON CONFLICT\(batch_id, branch_id\) DO UPDATE SET quantity = quantity \+ excluded\.quantity/.test(block), 'a matched lot code must ADD to its existing branch_batch_stock row, not insert a second row for the same batch+branch')

  assert.ok(/batchKey: importLotCode \|\| `import:\$\{r\.existingId\}:\$\{nowIso\}:\$\{r\.rowNumber\}`/.test(block), 'a genuinely NEW batch created from a restock row should key itself by the lot code when one was given (so a later import or manual receive naming the same lot can match it too), falling back to the old unique generated key only when no lot code was supplied')
  assert.ok(/batchByProductAndLot\.set\(`\$\{r\.existingId\}\\u0001/.test(block), 'a newly-created batch within this branch should be recorded in the lookup so a second row in the SAME chunk naming the same product+lot tops it up too, instead of also creating a duplicate')

  console.log('PASS restock imports (merge_stock/override_add) match an existing ACTIVE batch by product+lot code and top it up (refreshing received_at, adding to branch_batch_stock) instead of always creating a new batch row, with a new batch keyed consistently by its lot code for future imports to match')
}

// -- Multi-branch new-product seeding: a brand-new product's CSV row only
// ever names ONE branch, but every OTHER active branch must still get an
// explicit 0-quantity branch_stock row (not silently no row at all) --
// same fix as seedBranchStockForNewProduct already applies to the manual
// Add Product form. Source-text assertion (no fake-D1 harness for
// runImportApply itself yet, see the replace_all guard's own comment
// above for why that's the established pattern here).
{
  const newProductBlockStart = source.indexOf('const newId = d.__importAssignedId as number')
  assert.ok(newProductBlockStart !== -1, 'the new-product create block should still exist in runImportApply')
  const newProductBlockEnd = source.indexOf("} else if (job.type === 'customers'", newProductBlockStart)
  const block = source.slice(newProductBlockStart, newProductBlockEnd)

  assert.ok(/SELECT id FROM branches WHERE is_active = 1/.test(source), 'runImportApply should fetch every active branch id (allActiveBranchIds) so it knows which branches still need a 0 row seeded')

  const chosenBranchInsertIdx = block.indexOf('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@id, @branchId, @qty)')
  assert.ok(chosenBranchInsertIdx !== -1, 'the chosen branch should still get its real-quantity branch_stock insert')

  const seedZeroIdx = block.indexOf('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@id, @branchId, 0)')
  assert.ok(seedZeroIdx !== -1, 'a brand-new product should get a 0-quantity branch_stock seed statement for every other active branch')
  assert.ok(seedZeroIdx > chosenBranchInsertIdx, 'the 0-quantity seed loop must be built AFTER the chosen branch\'s real-quantity insert -- an in-batch duplicate row for the same product naming one of these branches has to be able to overwrite the seed with a real value, not the other way around')

  assert.ok(/branchId === d\.branch_id\) continue/.test(block), 'the seed loop must skip the chosen branch itself -- it already has its real quantity from the statement above')
  assert.ok(/ON CONFLICT\(product_id, branch_id\) DO NOTHING/.test(block.slice(seedZeroIdx, seedZeroIdx + 300)), 'the 0-quantity seed insert must use DO NOTHING (never DO UPDATE) so it can never stomp a real quantity written by an earlier statement in the same batch')

  console.log('PASS a brand-new imported product seeds every OTHER active branch at 0 stock, not just the branch its CSV row named, matching seedBranchStockForNewProduct\'s existing fix for manual product creation')
}

// -- Everything above this point is synchronous; the new tests below need
// `await`, which top-level CommonJS (.cjs) doesn't allow -- wrap in an
// async IIFE and run it.
async function runAsyncTests() {

// -- Zombie-stuck-import fix: runD1BatchInChunks / isD1CpuLimitError /
// markJobFailed. These reproduce, with a fake D1, the exact failure
// sequence from the reported bug -- a large batch throwing
// "D1_ERROR: D1 DB exceeded its CPU time limit and was reset" -- and check
// that the fix (adaptive chunk-splitting, and a resilient failure-write)
// actually behaves as designed, not just that it typechecks.
const { runD1BatchInChunks, isD1CpuLimitError, markJobFailed } = moduleObj.exports
assert.strictEqual(typeof runD1BatchInChunks, 'function', 'runD1BatchInChunks should be exported from importEngine.ts')
assert.strictEqual(typeof isD1CpuLimitError, 'function', 'isD1CpuLimitError should be exported from importEngine.ts')
assert.strictEqual(typeof markJobFailed, 'function', 'markJobFailed should be exported from importEngine.ts')

assert.strictEqual(isD1CpuLimitError(new Error('D1_ERROR: D1 DB exceeded its CPU time limit and was reset.')), true)
assert.strictEqual(isD1CpuLimitError(new Error('D1_ERROR: UNIQUE constraint failed: products.barcode')), true, 'any D1_ERROR is treated as potentially budget-related, not just the CPU-limit wording')
assert.strictEqual(isD1CpuLimitError(new Error('Network request failed')), false)

// Fake D1: a batch() that fails whenever it's handed more than
// MAX_STATEMENTS_PER_BATCH statements at once (standing in for "this many
// statements blew the CPU budget"), succeeds otherwise, and records every
// call it received so the test can assert on the actual shape of what
// happened -- not just that no error escaped.
{
  const MAX_STATEMENTS_PER_BATCH = 40
  const batchCalls = []
  const fakeDb = {
    batch: async (statements) => {
      batchCalls.push(statements.length)
      if (statements.length > MAX_STATEMENTS_PER_BATCH) {
        throw new Error('D1_ERROR: D1 DB exceeded its CPU time limit and was reset.')
      }
      return statements.map(() => ({ success: true }))
    },
  }
  const statements = Array.from({ length: 300 }, (_, i) => ({ sql: 'INSERT INTO x VALUES (@i)', params: { i } }))
  const doneCalls = []
  await runD1BatchInChunks(fakeDb, statements, 300, (done, total) => { doneCalls.push([done, total]) })

  assert.ok(batchCalls.some((n) => n > MAX_STATEMENTS_PER_BATCH), 'the first attempt should be the original oversized chunk (proves it really tried the full size first, not a pre-shrunk one)')
  assert.ok(batchCalls.every((n, i) => i === 0 || n <= MAX_STATEMENTS_PER_BATCH || batchCalls.slice(0, i).some((m) => m > MAX_STATEMENTS_PER_BATCH)), 'every batch call after a failure should be a smaller retry, not a repeat of the same oversized one')
  const lastProgress = doneCalls[doneCalls.length - 1]
  assert.deepStrictEqual(lastProgress, [300, 300], 'progress callback should still reach 300/300 even though the run included failed-then-split sub-batches')
  console.log('PASS runD1BatchInChunks recovers from an over-budget batch by adaptively splitting it, instead of failing the whole import')
}

// A chunk that fails no matter how small it gets (a real, non-CPU-budget
// error) must still propagate -- the splitting logic should not silently
// swallow genuine failures.
{
  const fakeDb = { batch: async () => { throw new Error('D1_ERROR: UNIQUE constraint failed: products.barcode') } }
  await assert.rejects(
    () => runD1BatchInChunks(fakeDb, [{ sql: 'x', params: {} }, { sql: 'y', params: {} }]),
    /UNIQUE constraint failed/,
    'a genuine (non-recoverable) D1 error must still propagate, not be silently absorbed by the retry/split logic',
  )
  console.log('PASS runD1BatchInChunks still propagates a genuine (non-CPU-budget) D1 error')
}

// This is the actual bug from the report: the job's OWN failure-recording
// write also throws (simulating D1 being momentarily unavailable right
// after the CPU-limit reset). Before the fix, this left the job stuck at
// its last real status forever with no last_error. After the fix, it
// should retry and eventually succeed.
{
  let attempts = 0
  const runCalls = []
  const fakeDb = {
    prepare: (sql) => ({
      run: async (params) => {
        attempts += 1
        runCalls.push(params)
        if (attempts < 3) throw new Error('D1_ERROR: D1 DB is temporarily unavailable')
        return { success: true }
      },
    }),
  }
  await markJobFailed(fakeDb, 'job-123', 'D1_ERROR: D1 DB exceeded its CPU time limit and was reset.')
  assert.strictEqual(attempts, 3, 'markJobFailed should retry the status-write until it succeeds (here, on the 3rd attempt)')
  assert.strictEqual(runCalls[runCalls.length - 1].id, 'job-123')
  assert.ok(runCalls[runCalls.length - 1].error.includes('CPU time limit'), 'the real error message should still be recorded once the write succeeds')
  console.log('PASS markJobFailed retries the failure-recording write instead of leaving a job silently stuck')
}

// And if it's STILL failing after all retries (D1 genuinely down), it must
// not throw out of markJobFailed itself -- the caller (runImportApply's
// catch block) is already inside error handling; a second uncaught throw
// there would replace the real error and crash the queue consumer instead
// of just logging and moving on.
{
  const fakeDb = { prepare: () => ({ run: async () => { throw new Error('D1_ERROR: still down') } }) }
  await markJobFailed(fakeDb, 'job-456', 'original failure') // must resolve, not reject
  console.log('PASS markJobFailed does not throw even if every retry fails (logs and returns instead)')
}

// -- Restart-from-scratch fix: isFreshImportRun. Reproduces the actual bug
// -- a transient error mid-run (markJobFailed flips status to 'failed'
// before re-throwing) followed by Cloudflare's own message.retry()
// redelivery must be treated as a RESUME, not a new run, or chunk_cursor
// gets wiped back to 0 and every already-classified/applied row is lost.
{
  const { isFreshImportRun } = moduleObj.exports
  assert.strictEqual(typeof isFreshImportRun, 'function', 'isFreshImportRun should be exported from importEngine.ts')

  assert.strictEqual(isFreshImportRun('queued', 'analyzing'), true, 'a fresh POST /:id/start or /:id/retry (status=queued) must reset chunk state')
  assert.strictEqual(isFreshImportRun('analyzing', 'analyzing'), false, 'the phase\'s own self-continuation (status already analyzing) must resume, not reset')
  assert.strictEqual(isFreshImportRun('applying', 'applying'), false, 'the phase\'s own self-continuation (status already applying) must resume, not reset')
  assert.strictEqual(
    isFreshImportRun('failed', 'analyzing'),
    false,
    'THE BUG: a transient-error retry (markJobFailed already set status=failed, then message.retry() redelivered the same message) must resume from chunk_cursor, not be treated as a new run and wipe it back to 0',
  )
  assert.strictEqual(
    isFreshImportRun('failed', 'applying'),
    false,
    'same fix, apply phase',
  )
  console.log('PASS isFreshImportRun resumes after a transient-error retry instead of restarting the whole phase from scratch')
}

// -- classifyProducts: special-price/discount/out-of-stock-threshold/expiry
// field population (Track F parity, value-level -- companion to the
// source-text REQUIRED_PRODUCT_WRITE_COLUMNS check above). That earlier
// check only confirms the INSERT/UPDATE SQL *names* these columns; it does
// NOT confirm classifyProducts' `data` object actually carries a value for
// any of them. It didn't: a live run with every one of these fields set on
// the CSV row produced a `data` object missing all of them (confirmed
// directly, not just inferred), so the source-text check passed while every
// real import silently dropped special pricing, discounts, out-of-stock
// threshold, and expiry tracking -- exactly the bug this session's fix
// closes for real. Real transpiled classifyProducts against a small
// in-memory fake D1 that dispatches on the SQL text (unlike
// classifyContacts' single-`all()` fake above, classifyProducts makes three
// distinct SELECTs -- import_job_files, products, branches -- in one call).
{
  const { classifyProducts } = moduleObj.exports
  assert.strictEqual(typeof classifyProducts, 'function', 'classifyProducts should be exported from importEngine.ts')

  const makeFakeProductsDb = (existingProducts = [], branches = [{ id: 1, name: 'Main Branch', is_default: 1 }]) => ({
    prepare: (sql) => ({
      all: async () => {
        if (/FROM import_job_files/.test(sql)) return []
        if (/FROM products/.test(sql)) return existingProducts
        if (/FROM branches/.test(sql)) return branches
        return []
      },
    }),
  })
  const row = (fields, rowNumber) => ({ _rowNumber: rowNumber, ...fields })
  const noImages = new Map() // skips computeImportImageMatch entirely -- not under test here

  // 1) Every field explicitly set on the row -- each must reach `data` with
  // the right type (numbers actually numeric, the flag actually 0/1), not
  // just survive as an uninspected passthrough string.
  {
    const db = makeFakeProductsDb([])
    const results = await classifyProducts(db, [row({
      name: 'Widget', selling_price_usd: '10', cost_price_usd: '5',
      special_price_usd: '8', out_of_stock_threshold: '2',
      discount_enabled: 'true', discount_type: 'percent', discount_percent: '15',
      discount_amount_usd: '0', discount_amount_khr: '0',
      discount_label: 'Sale', discount_badge_color: '#00ff00',
      discount_starts_at: '2026-08-01', discount_ends_at: '2026-09-01',
      expiry_date: '2027-01-01', expiry_alert_days: '45',
    }, 1)], 'job-1', null, noImages)
    const d = results[0].data
    assert.strictEqual(d.special_price_usd, 8)
    assert.strictEqual(d.out_of_stock_threshold, 2)
    assert.strictEqual(d.discount_enabled, 1)
    assert.strictEqual(d.discount_type, 'percent')
    assert.strictEqual(d.discount_percent, 15)
    assert.strictEqual(d.discount_label, 'Sale')
    assert.strictEqual(d.discount_badge_color, '#00ff00')
    assert.strictEqual(d.discount_starts_at, '2026-08-01')
    assert.strictEqual(d.discount_ends_at, '2026-09-01')
    assert.strictEqual(d.expiry_date, '2027-01-01')
    assert.strictEqual(d.expiry_alert_days, 45)
  }

  // VIP price (stored in special_price_*; DB column name unchanged, label
  // is "VIP" now). Two things this guards, both reported bugs:
  //   1. the NEW `vip_price_*` header is read, and
  //   2. the LEGACY `special_price_*` header still is (old export files),
  //   3. a BLANK value defaults to 0, never the selling price.
  {
    const db = makeFakeProductsDb([])
    const [viaVip, viaLegacy, blank] = await classifyProducts(db, [
      row({ name: 'Vip New', selling_price_usd: '12', vip_price_usd: '8' }, 1),
      row({ name: 'Vip Legacy', selling_price_usd: '12', special_price_usd: '7' }, 2),
      row({ name: 'Vip Blank', selling_price_usd: '12' }, 3),
    ], 'job-vip', null, noImages)
    assert.strictEqual(viaVip.data.special_price_usd, 8, 'the new vip_price_usd header must be read into special_price_usd')
    assert.strictEqual(viaLegacy.data.special_price_usd, 7, 'the legacy special_price_usd header must still be honored')
    assert.strictEqual(blank.data.special_price_usd, 0, 'a row with no VIP price stores 0, not the selling price (12)')
  }

  // 2) Nothing set beyond the required fields -- every default must match
  // both the products schema default (0001_init.sql) AND
  // frontend/productImportPlanner.ts's normalizeProductImportRow, so a CSV
  // row that omits a column behaves the same as one created through the
  // manual Add Product form.
  {
    const db = makeFakeProductsDb([])
    const results = await classifyProducts(db, [row({ name: 'Bare Product', selling_price_usd: '20' }, 1)], 'job-2', null, noImages)
    const d = results[0].data
    assert.strictEqual(d.special_price_usd, 0, 'VIP (special) price with no CSV value defaults to 0, NOT the selling price -- defaulting to selling silently set VIP = selling on every row and the edit form then wrote it back, destroying real VIP prices')
    assert.strictEqual(d.out_of_stock_threshold, 0)
    assert.strictEqual(d.discount_enabled, 0)
    assert.strictEqual(d.discount_type, 'percent')
    assert.strictEqual(d.discount_percent, 0)
    // normalizeImportMoney's roundUpToDecimals can return -0 for a
    // fallback/zero input (pre-existing float quirk, unrelated to this
    // session's fix) -- assert.strictEqual uses Object.is and treats -0 as
    // distinct from 0, so use === here, which (correctly, for this purpose)
    // does not.
    assert.ok(d.discount_amount_usd === 0, `discount_amount_usd should default to 0, got ${d.discount_amount_usd}`)
    assert.ok(d.discount_amount_khr === 0, `discount_amount_khr should default to 0, got ${d.discount_amount_khr}`)
    assert.strictEqual(d.discount_label, null)
    assert.strictEqual(d.discount_badge_color, '#e11d48')
    assert.strictEqual(d.discount_starts_at, null)
    assert.strictEqual(d.discount_ends_at, null)
    assert.strictEqual(d.expiry_date, null)
    assert.strictEqual(d.expiry_alert_days, 30)
  }

  // 3) discount_type isn't given, but a discount_amount is -- infers
  // 'fixed' rather than defaulting blindly to 'percent' (mirrors
  // normalizeProductImportRow's own inference rule).
  {
    const db = makeFakeProductsDb([])
    const results = await classifyProducts(db, [row({ name: 'Fixed Discount Item', selling_price_usd: '20', discount_amount_usd: '3' }, 1)], 'job-3', null, noImages)
    assert.strictEqual(results[0].data.discount_type, 'fixed')
  }

  console.log('PASS classifyProducts actually populates special-price/discount/out-of-stock-threshold/expiry fields on `data` (Track F parity, value-level) -- explicit values, schema/manual-form-matching defaults, and discount_type inference all confirmed')
}

// -- classifyProducts: reviewer-chosen per-row mode (`_action` CSV column
// -> ImportRowResult.plannedMode), and the 'skip_row' fix from this
// session. This is genuinely new coverage, not a Track F-style regression
// guard -- the plannedMode branch (added a prior session, per
// importEngine.ts's own file-header note) had zero test coverage before
// this, on the exact "silently wrong write to a live products table" axis
// that file's header explicitly warns about taking shortcuts on.
{
  const { classifyProducts } = moduleObj.exports
  const makeFakeProductsDb = (existingProducts = [], branches = [{ id: 1, name: 'Main Branch', is_default: 1 }]) => ({
    prepare: (sql) => ({
      all: async () => {
        if (/FROM import_job_files/.test(sql)) return []
        if (/FROM products/.test(sql)) return existingProducts
        if (/FROM branches/.test(sql)) return branches
        return []
      },
    }),
  })
  const row = (fields, rowNumber) => ({ _rowNumber: rowNumber, ...fields })
  const noImages = new Map()
  const existingMatch = { id: 42, sku: 'SKU-1', barcode: null, name: 'Existing Widget', cost_price_usd: 5, cost_price_khr: null, selling_price_usd: 10, selling_price_khr: null }

  // 1) A matched row (same sku) requesting each of the three real modes
  // gets that exact plannedMode, and stays classified as an 'update'.
  for (const mode of ['merge_stock', 'override_add', 'override_replace']) {
    const db = makeFakeProductsDb([existingMatch])
    const results = await classifyProducts(db, [row({ name: 'Existing Widget', sku: 'SKU-1', selling_price_usd: '10', _action: mode }, 1)], 'job-mode', null, noImages)
    assert.strictEqual(results[0].action, 'update', `${mode}: matched row should classify as update`)
    assert.strictEqual(results[0].plannedMode, mode, `${mode}: plannedMode should be honored on a matched row`)
  }

  // 2) Same _action values, but nothing in the DB matches this row -- the
  // row creates a new product, and plannedMode must NOT carry over (the
  // three modes are inherently about reconciling with something that
  // already exists; ImportRowResult's own doc comment on plannedMode says
  // this explicitly).
  {
    const db = makeFakeProductsDb([])
    const results = await classifyProducts(db, [row({ name: 'Brand New Item', selling_price_usd: '10', _action: 'merge_stock' }, 1)], 'job-nomatch', null, noImages)
    assert.strictEqual(results[0].action, 'create')
    assert.strictEqual(results[0].plannedMode, undefined, 'plannedMode must not apply to a create row even if `_action` requested one')
  }

  // 3) An `_action` this engine doesn't recognize as one of the three
  // modes (here 'create_variant' -- reviewer picked "Variant" in the UI,
  // which importEngine.ts's file header now documents as a real,
  // still-open gap) leaves plannedMode undefined -- falls through to the
  // legacy default write path, not a crash and not a silent mode switch.
  {
    const db = makeFakeProductsDb([existingMatch])
    const results = await classifyProducts(db, [row({ name: 'Existing Widget', sku: 'SKU-1', selling_price_usd: '10', _action: 'create_variant' }, 1)], 'job-unrec', null, noImages)
    assert.strictEqual(results[0].action, 'update')
    assert.strictEqual(results[0].plannedMode, undefined)
  }

  // 4) 'skip_row' -- the bug fixed this session. Before the fix, this fell
  // through to the same legacy path as case 3 above (an ordinary update
  // applied, reviewer's Skip choice silently dropped). Must now classify
  // as a real 'skip', on both a matched row (existingId populated, so a
  // skipped row's identity is still visible to the reviewer) and an
  // unmatched one (existingId null) -- runImportApply's `actionable`
  // filter only keeps 'create'/'update', so anything reaching 'skip' here
  // is guaranteed to never reach a write statement.
  {
    const db = makeFakeProductsDb([existingMatch])
    const results = await classifyProducts(db, [row({ name: 'Existing Widget', sku: 'SKU-1', selling_price_usd: '10', _action: 'skip_row' }, 1)], 'job-skip-matched', null, noImages)
    assert.strictEqual(results[0].action, 'skip', 'a row marked skip_row on a matched product must classify as skip, not update')
    assert.strictEqual(results[0].existingId, 42)
  }
  {
    const db = makeFakeProductsDb([])
    const results = await classifyProducts(db, [row({ name: 'Never Created', selling_price_usd: '10', _action: 'skip_row' }, 1)], 'job-skip-unmatched', null, noImages)
    assert.strictEqual(results[0].action, 'skip', 'a row marked skip_row with no match must classify as skip, not create')
    assert.strictEqual(results[0].existingId, null)
  }

  console.log('PASS classifyProducts plannedMode: merge_stock/override_add/override_replace honored only on a matched row, unrecognized `_action` values fall through safely, and skip_row (fixed this session) genuinely skips instead of silently applying')
}

// -- classifyProducts: batch/date column consolidation (Aug 24 2026,
// explicit user direction). The template used to ship two separate
// optional columns -- `batch` (a free-typed label that was silently
// ignored -- lot_code was always derived from `date`, never from
// whatever text was in `batch`) and `date` (the actual received date).
// Now there is one column, `batch(mm/dd/yyyy)`, whose value IS the
// received date; `batch`/`date`/`received_date` stay accepted as
// fallbacks so an older CSV isn't broken by the rename. dateToBatchCode
// itself (batchCode.ts, exercised indirectly here since classifyProducts
// calls it for lot_code) also switched from all-numeric MMDDYYYY to a
// month-abbreviation MMMDDYYYY code this same session.
{
  const { classifyProducts } = moduleObj.exports
  const { dateToBatchCode } = batchCodeModuleObj.exports

  const makeFakeProductsDb = (existingProducts = [], branches = [{ id: 1, name: 'Main Branch', is_default: 1 }]) => ({
    prepare: (sql) => ({
      all: async () => {
        if (/FROM import_job_files/.test(sql)) return []
        if (/FROM products/.test(sql)) return existingProducts
        if (/FROM branches/.test(sql)) return branches
        return []
      },
    }),
  })
  const row = (fields, rowNumber) => ({ _rowNumber: rowNumber, ...fields })
  const noImages = new Map()

  // dateToBatchCode itself: new month-abbreviation format.
  assert.strictEqual(dateToBatchCode('08/24/2026'), 'AUG242026', 'dateToBatchCode should render 08/24/2026 as AUG242026, not the old numeric 08242026')
  assert.strictEqual(dateToBatchCode('8/2/2026'), 'AUG022026', 'a single-digit day should still zero-pad, same as the old format')
  assert.strictEqual(dateToBatchCode('2026-01-05'), 'JAN052026', 'an ISO-shaped input (e.g. from received_date) should resolve to the right month name, not just August')

  // The new consolidated column, `batch(mm/dd/yyyy)`, is read as the
  // received date and drives lot_code.
  {
    const db = makeFakeProductsDb([])
    const results = await classifyProducts(db, [row({ name: 'New Column Item', selling_price_usd: '10', 'batch(mm/dd/yyyy)': '08/24/2026' }, 1)], 'job-batch-col', null, noImages)
    const d = results[0].data
    assert.strictEqual(d.received_date, '08/24/2026')
    assert.strictEqual(d.lot_code, 'AUG242026')
  }

  // Old `batch` and `date` columns still work as fallbacks (in that
  // order) for an existing hand-built or previously-downloaded CSV.
  {
    const db = makeFakeProductsDb([])
    const results = await classifyProducts(db, [row({ name: 'Old Batch Column', selling_price_usd: '10', batch: '01/15/2026' }, 1)], 'job-old-batch', null, noImages)
    assert.strictEqual(results[0].data.lot_code, 'JAN152026', 'the old `batch` column should still be read as a date fallback')
  }
  {
    const db = makeFakeProductsDb([])
    const results = await classifyProducts(db, [row({ name: 'Old Date Column', selling_price_usd: '10', date: '03/10/2026' }, 1)], 'job-old-date', null, noImages)
    assert.strictEqual(results[0].data.lot_code, 'MAR102026', 'the old `date` column should still be read as a date fallback')
  }

  // A blank/missing column still means "received now" -- unchanged
  // behavior, just confirming the new column name didn't break the
  // existing default.
  {
    const db = makeFakeProductsDb([])
    const results = await classifyProducts(db, [row({ name: 'No Date At All', selling_price_usd: '10' }, 1)], 'job-no-date', null, noImages)
    assert.ok(results[0].data.received_date, 'a row with no date column at all should still default received_date to today, not blank')
    assert.ok(results[0].data.lot_code, 'lot_code should still be derived from the defaulted received_date')
  }

  console.log('PASS classifyProducts reads the consolidated `batch(mm/dd/yyyy)` column as the received date (with `batch`/`date` as fallbacks), and dateToBatchCode renders month-abbreviation codes like AUG242026')
}

// -- classifyContacts: customer membership-number auto-assignment
// (creation-only), same-name-can't-coexist with a 'force_create' reviewer
// override (both against the existing DB and within one file), and the
// membership_number -> name match priority (phone deliberately dropped as
// a customer match key -- phone/address can be shared by multiple
// different customers, unlike name and membership_number). Real transpiled
// classifyContacts against a small in-memory fake D1 (its only DB touch is
// `db.prepare(sql).all()` to load the existing table once up front -- no
// writes happen at classify time, those are a separate later apply phase).
{
  const { classifyContacts } = moduleObj.exports
  assert.strictEqual(typeof classifyContacts, 'function', 'classifyContacts should be exported from importEngine.ts')

  const makeFakeDb = (existingRows) => ({ prepare: () => ({ all: async () => existingRows }) })
  const row = (fields, rowNumber) => ({ _rowNumber: rowNumber, ...fields })
  const withDecisions = (decisionsByRowNumber) => JSON.stringify({ decisionsByRowNumber })

  // 1) Brand-new customer, no membership_number on the row -- gets one
  // auto-assigned rather than staying null.
  {
    const db = makeFakeDb([])
    const results = await classifyContacts(db, 'customers', [row({ name: 'Dara' }, 1)], null)
    assert.strictEqual(results.length, 1)
    assert.strictEqual(results[0].action, 'create')
    assert.ok(String(results[0].data.membership_number || '').startsWith('LCMN-'), 'new customer with no membership_number in the CSV gets one auto-generated')
  }

  // 2) Matched existing customer whose stored membership_number is
  // already blank (legacy row) -- creation-only backfill means the merge
  // path leaves it blank rather than inventing one for a record this
  // import didn't create.
  {
    const db = makeFakeDb([{ id: 5, name: 'Sokha', membership_number: null }])
    const results = await classifyContacts(db, 'customers', [row({ name: 'Sokha' }, 1)], null)
    assert.strictEqual(results[0].action, 'update')
    assert.strictEqual(results[0].data.membership_number, null, 'a matched customer with no existing membership_number stays blank on merge -- backfill is creation-only')
  }

  // 3) Matched existing customer that ALREADY has a membership_number --
  // never overwritten with a freshly generated one.
  {
    const db = makeFakeDb([{ id: 6, name: 'Vanna', membership_number: 'LCMN-KEEPME1' }])
    const results = await classifyContacts(db, 'customers', [row({ name: 'Vanna' }, 1)], null)
    assert.strictEqual(results[0].data.membership_number, 'LCMN-KEEPME1', 'an existing membership_number is preserved, not replaced')
  }

  // 4) Same name as an existing customer, different phone -- must merge
  // into the existing record (never a second customer sharing the name),
  // and the row is flagged with a 'name_match' warning so the reviewer
  // can see why.
  {
    const db = makeFakeDb([{ id: 7, name: 'Bopha', phone: '099888777', membership_number: 'LCMN-EXIST001' }])
    const results = await classifyContacts(db, 'customers', [row({ name: 'Bopha', phone: '070111222' }, 1)], null)
    assert.strictEqual(results[0].action, 'update', 'a name collision merges into the existing customer instead of creating a duplicate')
    assert.strictEqual(results[0].existingId, 7)
    assert.ok(results[0].warnings?.some((w) => w.kind === 'name_match'), 'a name-only match is flagged with a name_match warning')
  }

  // 4b) Phone is no longer a customer match key -- a matching phone with a
  // DIFFERENT name must NOT merge (phone/address can be legitimately
  // shared by more than one customer; only name and membership_number
  // identify a customer for matching purposes now).
  {
    const db = makeFakeDb([{ id: 9, name: 'Household Account', phone: '099888777', membership_number: 'LCMN-HOUSE001' }])
    const results = await classifyContacts(db, 'customers', [row({ name: 'A Different Person', phone: '099888777' }, 1)], null)
    assert.strictEqual(results[0].action, 'create', 'a shared phone number alone must not merge two different-named customers into one')
    assert.notStrictEqual(results[0].existingId, 9)
    // Not silent, though -- a genuinely new customer whose phone is
    // already on file under someone else gets flagged for review even
    // though it isn't auto-merged/blocked.
    assert.ok(
      results[0].warnings?.some((w) => w.kind === 'membership_phone_conflict'),
      'a new customer whose phone already belongs to a different existing customer must be flagged for review, not imported silently',
    )
  }

  // 4c) membership_number match whose phone belongs to a DIFFERENT
  // existing customer than the one matched (typo'd/copy-pasted number) --
  // must still match/update via membership_number (the stronger
  // identifier), but flag the conflict and never let this row's phone
  // overwrite the matched customer's real phone.
  {
    const db = makeFakeDb([
      { id: 10, name: 'Correct Owner', phone: '011222333', membership_number: 'LCMN-REAL001' },
      { id: 11, name: 'Someone Else', phone: '099888777', membership_number: 'LCMN-OTHER002' },
    ])
    const results = await classifyContacts(
      db,
      'customers',
      [row({ name: 'Correct Owner', phone: '099888777', membership_number: 'LCMN-REAL001' }, 1)],
      null,
    )
    assert.strictEqual(results[0].action, 'update', 'membership_number still wins the match over the phone conflict')
    assert.strictEqual(results[0].existingId, 10)
    assert.ok(
      results[0].warnings?.some((w) => w.kind === 'membership_phone_conflict'),
      'a membership match whose phone belongs to a different existing customer must be flagged',
    )
    assert.strictEqual(results[0].data.phone, '011222333', 'the conflicting imported phone must never overwrite the matched customer\'s real phone')
  }

  // 5) Two brand-new rows in the SAME file share a name -- must fold into
  // ONE customer, not create two with the same name.
  {
    const db = makeFakeDb([])
    const results = await classifyContacts(db, 'customers', [
      row({ name: 'Chan', phone: '011000111', email: 'chan@example.com' }, 1),
      row({ name: 'Chan', phone: '012000222' }, 2),
    ], null)
    assert.strictEqual(results.length, 2, 'both rows still get a result each (one create, one skip) so the review screen accounts for every row')
    assert.strictEqual(results[0].action, 'create')
    assert.strictEqual(results[1].action, 'skip', 'the second same-name row in this file is folded into the first instead of becoming its own customer')
    assert.ok(results[1].warnings?.some((w) => w.kind === 'name_match'), 'the folded duplicate is flagged with a name_match warning')
    assert.strictEqual(results[0].data.email, 'chan@example.com', 'the surviving row keeps whichever value either row supplied')
  }

  // 5b) Same same-name-in-file collision as (5), but this time the second
  // row carries a 'force_create' decision -- reviewer says these are two
  // real, different people sharing a name; must NOT fold.
  {
    const db = makeFakeDb([])
    const results = await classifyContacts(db, 'customers', [
      row({ name: 'Chan', phone: '011000111' }, 1),
      row({ name: 'Chan', phone: '012000222' }, 2),
    ], withDecisions({ '2': { action: 'force_create' } }))
    assert.strictEqual(results[0].action, 'create')
    assert.strictEqual(results[1].action, 'create', 'force_create overrides the same-file name fold -- becomes its own contact instead of merging into row 1')
    assert.notStrictEqual(results[0].data.phone, results[1].data.phone, 'the two rows stay genuinely separate, not merged')
  }

  // 6) Re-importing with a membership_number that matches an existing
  // customer finds that account even though the name on file changed --
  // membership_number is the account's real identifier, and outranks a
  // name match.
  {
    const db = makeFakeDb([{ id: 8, name: 'Old Name', membership_number: 'LCMN-ACCT0008' }])
    const results = await classifyContacts(db, 'customers', [row({ name: 'New Name', membership_number: 'LCMN-ACCT0008' }, 1)], null)
    assert.strictEqual(results[0].action, 'update')
    assert.strictEqual(results[0].existingId, 8, 'matched by membership_number even though the name on the row differs from what is on file')
  }

  // 6b) 'force_create' does NOT apply to a membership_number match --
  // that's a real account identifier, not a soft name guess, so an
  // override decision on a membership-matched row is simply ignored for
  // matching purposes (still merges into that exact account).
  {
    const db = makeFakeDb([{ id: 10, name: 'Old Name', membership_number: 'LCMN-ACCT0010' }])
    const results = await classifyContacts(db, 'customers', [row({ name: 'New Name', membership_number: 'LCMN-ACCT0010' }, 1)], withDecisions({ '1': { action: 'force_create' } }))
    assert.strictEqual(results[0].action, 'update', 'force_create cannot bypass a membership_number match -- that identifies one specific real account')
    assert.strictEqual(results[0].existingId, 10)
  }

  // 7) DB name match with a 'force_create' override -- reviewer says the
  // file's row and the existing record are different people despite
  // sharing a name; must create a new contact, not merge into id 7.
  {
    const db = makeFakeDb([{ id: 7, name: 'Bopha', membership_number: 'LCMN-EXIST001' }])
    const results = await classifyContacts(db, 'customers', [row({ name: 'Bopha', phone: '070111222' }, 1)], withDecisions({ '1': { action: 'force_create' } }))
    assert.strictEqual(results[0].action, 'create', 'force_create overrides a DB name match into a genuinely separate new contact')
    assert.strictEqual(results[0].existingId, null)
  }

  // 8) gender and created_date columns (added to the customer template
  // per explicit user direction, so a CSV exported from another system
  // imports without hand-editing headers first). gender goes through
  // normalizeContactGender's free-text matching; created_date parses to
  // an ISO created_at on a genuinely new row.
  {
    const db = makeFakeDb([])
    const results = await classifyContacts(db, 'customers', [row({ name: 'Sreymom', gender: 'Female', created_date: '2019-03-14' }, 1)], null)
    assert.strictEqual(results[0].data.gender, 'female', 'a created_date/gender CSV row normalizes free-text gender the same as the customer form dropdown')
    assert.strictEqual(results[0].data.created_at, new Date('2019-03-14').toISOString(), 'created_date parses to an ISO created_at for a brand-new customer')
  }

  // 9) created_date is accepted alongside the older created_at/created/
  // join_date/date_joined column names -- created_date takes priority
  // when a row somehow has more than one.
  {
    const db = makeFakeDb([])
    const results = await classifyContacts(db, 'customers', [row({ name: 'Ratanak', created_at: '2020-01-01', created_date: '2018-06-01' }, 1)], null)
    assert.strictEqual(results[0].data.created_at, new Date('2018-06-01').toISOString(), 'created_date wins over the older created_at column name when both are present on the same row')
  }

  // 10) A matched existing customer's created_date is classified onto
  // data.created_at same as a new row, but then merged against the
  // existing record via resolveContactFieldValue's merge_blank_only rule
  // -- since the existing customer already has a non-blank created_at,
  // the merge keeps that original value, never the imported one. This is
  // the actual enforcement point for "a matched customer's existing
  // created_at is never touched by import" (materializeImportChunk's
  // customer UPDATE statement also excludes created_at from its column
  // list as a second, belt-and-suspenders layer -- not re-derived here).
  {
    const db = makeFakeDb([{ id: 20, name: 'Existing Person', created_at: '2015-01-01T00:00:00.000Z' }])
    const results = await classifyContacts(db, 'customers', [row({ name: 'Existing Person', created_date: '2024-05-05' }, 1)], null)
    assert.strictEqual(results[0].action, 'update')
    assert.strictEqual(results[0].data.created_at, '2015-01-01T00:00:00.000Z', 'a matched customer keeps its real original created_at -- the imported created_date never overwrites it')
  }

  console.log('PASS classifyContacts: creation-only membership_number backfill, membership_number/name match priority (phone dropped for customers), force_create reviewer override for name matches, and gender/created_date column parsing')
}

// -- classifySales: order grouping by receipt_number, sale_status
// validation, and the "history import never deducts, only a return status
// restocks" rule (see classifySales' own header comment for the full
// reasoning). Real transpiled classifySales against a small in-memory fake
// D1 that branches on which table a query targets (classifySales issues
// three separate up-front SELECTs: products, branches, product_batches).
{
  const { classifySales, parseSalesImportDateTime } = moduleObj.exports
  assert.strictEqual(typeof classifySales, 'function', 'classifySales should be exported from importEngine.ts')
  assert.strictEqual(typeof parseSalesImportDateTime, 'function', 'sales date parser should be exported for direct boundary tests')

  const defaultProducts = [
    { id: 1, sku: 'SKU-1', barcode: 'BAR-1', name: 'Widget', selling_price_usd: 10, selling_price_khr: 41000, cost_price_usd: 6, cost_price_khr: 24600 },
    { id: 2, sku: 'SKU-2', barcode: 'BAR-2', name: 'Gadget', selling_price_usd: 20, selling_price_khr: 82000, cost_price_usd: 12, cost_price_khr: 49200 },
  ]
  const defaultBranches = [{ id: 5, name: 'Main Branch' }]
  const defaultBatches = [{ id: 9, variant_product_id: 1, lot_code: 'LOT-A', expiry_date: '2027-01-01' }]

  const makeFakeDb = (overrides = {}) => {
    const products = overrides.products ?? defaultProducts
    const branches = overrides.branches ?? defaultBranches
    const batches = overrides.batches ?? defaultBatches
    const customers = overrides.customers ?? []
    const users = overrides.users ?? []
    const deliveryContacts = overrides.deliveryContacts ?? []
    return {
      prepare: (sql) => ({
        all: async () => {
          if (sql.includes('FROM products')) return products
          if (sql.includes('FROM branches')) return branches
          if (sql.includes('FROM product_batches')) return batches
          if (sql.includes('FROM customers')) return customers
          if (sql.includes('FROM users')) return users
          if (sql.includes('FROM delivery_contacts')) return deliveryContacts
          return []
        },
      }),
    }
  }
  const row = (fields, rowNumber) => ({ _rowNumber: rowNumber, ...fields })

  // 1) A plain two-line 'completed' order (no sale_status column at all,
  // matching the common historical-export case) groups by receipt_number
  // into one 'create' result, prices default from the product's selling
  // price, and -- the core of this session's ask -- nothing about the
  // result implies any stock mutation: no returned_quantity anywhere.
  {
    const db = makeFakeDb()
    const results = await classifySales(db, [
      row({ receipt_number: 'R-1', sku: 'SKU-1', quantity: 2, customer_name: 'Dara' }, 1),
      row({ receipt_number: 'R-1', sku: 'SKU-2', quantity: 1 }, 2),
    ], null)
    assert.strictEqual(results.length, 1, 'two rows sharing a receipt_number collapse into one order')
    assert.strictEqual(results[0].action, 'create')
    const data = results[0].data
    assert.strictEqual(data.sale_status, 'completed', 'defaults to completed when the column is blank/absent')
    assert.strictEqual(data.items.length, 2)
    assert.strictEqual(data.items[0].applied_price_usd, 10, 'defaults to the product selling price when unit_price_usd is blank')
    assert.strictEqual(data.subtotal_usd, 20 + 20, '2x$10 + 1x$20')
    assert.ok(data.items.every((item) => (item.returned_quantity || 0) === 0), 'a completed order never carries a nonzero returned_quantity')
  }

  // 2) barcode fallback when sku is blank.
  {
    const db = makeFakeDb()
    const results = await classifySales(db, [row({ receipt_number: 'R-2', barcode: 'BAR-2', quantity: 1 }, 1)], null)
    assert.strictEqual(results[0].action, 'create')
    assert.strictEqual(results[0].data.items[0].product_id, 2, 'matched by barcode when sku is blank')
  }

  // 2b) A human-readable product name is a safe fallback only when it is
  // unique. This makes the template usable without barcodes while never
  // guessing between two catalog records sharing a name.
  {
    const db = makeFakeDb()
    const results = await classifySales(db, [row({ receipt_number: 'R-2b', name: 'Gadget', quantity: 1 }, 1)], null)
    assert.strictEqual(results[0].data.items[0].product_id, 2, 'unique product name matches when sku/barcode are blank')

    const ambiguousDb = makeFakeDb({ products: [...defaultProducts, { ...defaultProducts[0], id: 3, sku: 'SKU-3', barcode: 'BAR-3' }] })
    const ambiguous = await classifySales(ambiguousDb, [row({ receipt_number: 'R-2c', name: 'Widget', quantity: 1 }, 1)], null)
    assert.strictEqual(ambiguous[0].action, 'error', 'an ambiguous product name must not guess')
  }

  // 3) unknown sku/barcode -> the whole order errors (one bad line spoils
  // the order, same as the original single-product-match design).
  {
    const db = makeFakeDb()
    const results = await classifySales(db, [row({ receipt_number: 'R-3', sku: 'NOPE', quantity: 1 }, 1)], null)
    assert.strictEqual(results[0].action, 'error')
    assert.ok(/Product not found/.test(results[0].message))
  }

  // 4) invalid sale_status value -> error, naming the valid list.
  {
    const db = makeFakeDb()
    const results = await classifySales(db, [row({ receipt_number: 'R-4', sku: 'SKU-1', quantity: 1, sale_status: 'shipped' }, 1)], null)
    assert.strictEqual(results[0].action, 'error')
    assert.ok(/Invalid sale_status "shipped"/.test(results[0].message))
  }

  // 5) sale_status='returned' with NO returned_quantity column at all ->
  // defaults the full sold quantity as returned (the common case: the
  // whole order came back), and still imports as a 'create' (a return is a
  // sales-history fact too, not just a stock event) with no blocking error.
  {
    const db = makeFakeDb()
    const results = await classifySales(db, [row({ receipt_number: 'R-5', sku: 'SKU-1', quantity: 3, sale_status: 'returned' }, 1)], null)
    assert.strictEqual(results[0].action, 'create')
    assert.strictEqual(results[0].data.items[0].returned_quantity, 3, "'returned' with no explicit column defaults to the full line quantity")
    assert.strictEqual(results[0].message, null, 'a full default return needs no reviewer warning')
  }

  // 6) sale_status='partial_return' with an explicit per-line
  // returned_quantity smaller than quantity -- exactly the "different
  // details" case this session asked for: only part of one line actually
  // came back.
  {
    const db = makeFakeDb()
    const results = await classifySales(db, [row({ receipt_number: 'R-6', sku: 'SKU-1', quantity: 5, returned_quantity: 2, sale_status: 'partial_return' }, 1)], null)
    assert.strictEqual(results[0].action, 'create')
    assert.strictEqual(results[0].data.items[0].returned_quantity, 2)
    assert.strictEqual(results[0].data.items[0].quantity, 5, 'the original sold quantity is preserved for the sales record even though only 2 came back')
  }

  // 6b) 'partial_return' with NO returned_quantity given on a line -> that
  // line is treated as "not part of what came back" (0), not guessed at,
  // and the order still imports with a reviewer-facing warning rather than
  // being blocked.
  {
    const db = makeFakeDb()
    const results = await classifySales(db, [row({ receipt_number: 'R-6b', sku: 'SKU-1', quantity: 4, sale_status: 'partial_return' }, 1)], null)
    assert.strictEqual(results[0].action, 'create')
    assert.strictEqual(results[0].data.items[0].returned_quantity, 0)
    assert.ok(/no stock restored/.test(results[0].message))
  }

  // 7) returned_quantity greater than the sold quantity on a line -> error,
  // not silently clamped (a data problem worth surfacing, not guessing at).
  {
    const db = makeFakeDb()
    const results = await classifySales(db, [row({ receipt_number: 'R-7', sku: 'SKU-1', quantity: 2, returned_quantity: 5, sale_status: 'returned' }, 1)], null)
    assert.strictEqual(results[0].action, 'error')
    assert.ok(/exceeds sold quantity/.test(results[0].message))
  }

  // 8) batch_label matching an existing active lot for that exact product
  // resolves batch_id + carries its expiry_date; a label that matches no
  // batch (or matches a DIFFERENT product's lot) leaves batch_id null
  // rather than erroring -- an unmatched lot is not a blocking problem, it
  // just means the restock (if any) lands at the branch level only.
  {
    const db = makeFakeDb()
    const matched = await classifySales(db, [row({ receipt_number: 'R-8', sku: 'SKU-1', quantity: 1, batch_label: 'LOT-A', sale_status: 'returned' }, 1)], null)
    assert.strictEqual(matched[0].data.items[0].batch_id, 9)
    assert.strictEqual(matched[0].data.items[0].batch_expiry_date, '2027-01-01')

    const unmatched = await classifySales(db, [row({ receipt_number: 'R-8b', sku: 'SKU-1', quantity: 1, batch_label: 'LOT-ZZZ', sale_status: 'returned' }, 1)], null)
    assert.strictEqual(unmatched[0].data.items[0].batch_id, null, 'unmatched lot code does not error, just imports with no batch link')

    const wrongProduct = await classifySales(db, [row({ receipt_number: 'R-8c', sku: 'SKU-2', quantity: 1, batch_label: 'LOT-A', sale_status: 'returned' }, 1)], null)
    assert.strictEqual(wrongProduct[0].data.items[0].batch_id, null, "LOT-A belongs to product 1's batch, not product 2's -- must not cross-match")
  }

  // 9) a named branch that matches an existing branch resolves branch_id
  // immediately (mirroring classifyProducts/classifyInventory); a branch
  // name with no match yet sets branch_name_pending instead of erroring,
  // to be created at apply time by the shared resolveAndCreateBranches --
  // same three-case rule those two already use.
  {
    const db = makeFakeDb()
    const known = await classifySales(db, [row({ receipt_number: 'R-9', sku: 'SKU-1', quantity: 1, branch: 'Main Branch' }, 1)], null)
    assert.strictEqual(known[0].data.branch_id, 5)
    assert.strictEqual(known[0].data.branch_name_pending, undefined)

    const unknown = await classifySales(db, [row({ receipt_number: 'R-9b', sku: 'SKU-1', quantity: 1, branch: 'New Branch' }, 1)], null)
    assert.strictEqual(unknown[0].data.branch_id, null)
    assert.strictEqual(unknown[0].data.branch_name_pending, 'New Branch')
  }

  // 10) order_reference is still accepted as a fallback grouping key for a
  // hand-built/external CSV that doesn't use receipt_number.
  {
    const db = makeFakeDb()
    const results = await classifySales(db, [
      row({ order_reference: 'ORD-1', sku: 'SKU-1', quantity: 1 }, 1),
      row({ order_reference: 'ORD-1', sku: 'SKU-2', quantity: 1 }, 2),
    ], null)
    assert.strictEqual(results.length, 1, 'order_reference still groups two lines into one order')
    assert.strictEqual(results[0].data.items.length, 2)
  }

  // 11) Track F parity gap (found this session): each item must carry the
  // matched product's cost_price_usd/khr through to the classified result.
  // salesAnalytics.ts's COGS/profit queries sum sale_items.cost_price_usd *
  // quantity directly -- the same column a manual POS sale populates from
  // routes/sales.ts's own product lookup. The initial `products` SELECT at
  // the top of classifySales already fetches cost_price_usd/khr for this
  // exact reason; previously it was fetched and then never read again, so
  // every imported sale line recorded 0 cost regardless of the product's
  // real cost (the column's DEFAULT), silently overstating margin on any
  // historical/imported sales data.
  {
    const db = makeFakeDb()
    const results = await classifySales(db, [row({ receipt_number: 'R-11', sku: 'SKU-1', quantity: 3 }, 1)], null)
    const item = results[0].data.items[0]
    assert.strictEqual(item.cost_price_usd, 6, 'imported sale item must carry the matched product\'s cost_price_usd -- COGS/profit reporting reads this column directly')
    assert.strictEqual(item.cost_price_khr, 24600, 'imported sale item must carry the matched product\'s cost_price_khr')

    const preserved = await classifySales(db, [row({
      receipt_number: 'R-11b', sku: 'SKU-1', quantity: 1,
      cost_price_usd: '4.25', cost_price_khr: '17425',
      base_price_usd: '6', product_discount_type: 'fixed', product_discount_label: 'Promo', product_discount_usd: '0.5',
      manual_discount_type: 'percent', manual_discount_value: '10', manual_discount_usd: '0.5',
    }, 1)], null)
    assert.strictEqual(preserved[0].data.items[0].cost_price_usd, 4.25, 'an exported historical cost snapshot overrides today\'s product cost')
    assert.strictEqual(preserved[0].data.items[0].cost_price_khr, 17425)
    assert.strictEqual(preserved[0].data.items[0].base_price_usd, 6)
    assert.strictEqual(preserved[0].data.items[0].product_discount_label, 'Promo')
    assert.strictEqual(preserved[0].data.items[0].product_discount_usd, 0.5)
    assert.strictEqual(preserved[0].data.items[0].manual_discount_type, 'percent')
    assert.strictEqual(preserved[0].data.items[0].manual_discount_value, 10)

    const invalidCost = await classifySales(db, [row({ receipt_number: 'R-11c', sku: 'SKU-1', quantity: 1, cost_price_usd: '-1' }, 1)], null)
    assert.strictEqual(invalidCost[0].action, 'error', 'a negative historical cost is rejected instead of corrupting COGS')
  }

  // 11b) Strict, deterministic historical timestamps: compact 24-hour
  // wall-clock values are Phnom Penh time; explicit offsets remain exact;
  // impossible dates and 24:00 fail closed instead of silently becoming a
  // different date or falling back to import time.
  {
    assert.strictEqual(parseSalesImportDateTime('2026-08-28 14:30'), '2026-08-28T07:30:00.000Z')
    assert.strictEqual(parseSalesImportDateTime('08/28/2026 23:59:58'), '2026-08-28T16:59:58.000Z')
    assert.strictEqual(parseSalesImportDateTime('2026-08-28T14:30:00+07:00'), '2026-08-28T07:30:00.000Z')
    assert.strictEqual(parseSalesImportDateTime(''), null)
    assert.throws(() => parseSalesImportDateTime('2026-02-31 12:00'), /Invalid sale_date/)
    assert.throws(() => parseSalesImportDateTime('2026-08-28 24:00'), /Invalid sale_date/)

    const db = makeFakeDb()
    const invalid = await classifySales(db, [row({ receipt_number: 'R-11d', sku: 'SKU-1', quantity: 1, sale_date: 'not a date' }, 1)], null)
    assert.strictEqual(invalid[0].action, 'error', 'invalid sale_date blocks the row instead of silently importing at now')
    const valid = await classifySales(db, [row({ receipt_number: 'R-11e', sku: 'SKU-1', quantity: 1, sale_date: '2026-08-28 14:30' }, 1)], null)
    assert.strictEqual(valid[0].data.created_at, '2026-08-28T07:30:00.000Z')
  }

  // 12) Track F parity gap (found this session): an imported sale whose
  // customer_phone/customer_name match a real existing customer must
  // resolve customer_id, same as a manual POS checkout does when the
  // cashier picks that customer -- contacts.ts's per-customer purchase
  // history and notifications.ts's top-customer aggregation both key
  // strictly on sales.customer_id with no name-based fallback. Phone match
  // takes priority over name match (more precise/unique); an ambiguous
  // name (shared by more than one customer) must resolve to no match
  // rather than guessing; an unmatched phone/name must still import fine,
  // just with customer_id null (same as before this fix, not a new error
  // case).
  {
    const customers = [
      { id: 101, name: 'Dara', phone: '012345678' },
      { id: 102, name: 'Dara', phone: '099999999' }, // ambiguous name, different customer
      { id: 103, name: 'Sreymom', phone: null },
    ]
    const db = makeFakeDb({ customers })

    const byPhone = await classifySales(db, [row({ receipt_number: 'R-12a', sku: 'SKU-1', quantity: 1, customer_name: 'Someone Else', customer_phone: '012-345-678' }, 1)], null)
    assert.strictEqual(byPhone[0].data.customer_id, 101, 'phone match (formatting-tolerant) resolves customer_id even when the name on the row differs from what is on file')

    const byName = await classifySales(db, [row({ receipt_number: 'R-12b', sku: 'SKU-1', quantity: 1, customer_name: 'Sreymom' }, 1)], null)
    assert.strictEqual(byName[0].data.customer_id, 103, 'unambiguous name match resolves customer_id when no phone is given')

    const ambiguous = await classifySales(db, [row({ receipt_number: 'R-12c', sku: 'SKU-1', quantity: 1, customer_name: 'Dara' }, 1)], null)
    assert.strictEqual(ambiguous[0].data.customer_id, null, 'a name shared by more than one customer must not guess which one')

    const noMatch = await classifySales(db, [row({ receipt_number: 'R-12d', sku: 'SKU-1', quantity: 1, customer_name: 'Nobody On File', customer_phone: '011000000' }, 1)], null)
    assert.strictEqual(noMatch[0].data.customer_id, null, 'no phone/name match still imports fine, just with no customer_id -- not a new error case')
  }

  // 13) Track F parity gap (part 70): cashier_id/delivery_contact_id
  // resolution plus the discount/tax/total/amount_paid/change/membership
  // money math must match routes/sales.ts POST /'s own sequence exactly
  // (exchangeRate -> discount -> tax -> total -> amountPaid -> change), not
  // just carry the bare item subtotal through as total_usd/khr.
  {
    const users = [
      { id: 201, name: 'Sophea', is_active: 1 },
      { id: 202, name: 'Rithy', is_active: 1 },
    ]
    const deliveryContacts = [
      { id: 301, name: 'Delivery Guy', phone: '070999888' },
    ]
    const db = makeFakeDb({ users, deliveryContacts })

    // Cashier resolves by name (active users only); a name matching no
    // active user leaves cashier_id null without erroring the row.
    const cashierMatch = await classifySales(db, [row({ receipt_number: 'R-13a', sku: 'SKU-1', quantity: 1, cashier_name: 'Sophea' }, 1)], null)
    assert.strictEqual(cashierMatch[0].data.cashier_id, 201, 'cashier_name matching an active user resolves cashier_id')
    const cashierNoMatch = await classifySales(db, [row({ receipt_number: 'R-13b', sku: 'SKU-1', quantity: 1, cashier_name: 'Nobody Employed Here' }, 1)], null)
    assert.strictEqual(cashierNoMatch[0].data.cashier_id, null, 'an unmatched cashier_name imports fine with cashier_id null')

    // Full money-math sequence: subtotal 1x$10, $2 discount, $1 tax,
    // membership $0.50 off, 4100 exchange rate -> total = 10 - 2 - 0.5 + 1
    // = 8.5; amount_paid explicitly $10 -> change = 1.5.
    const priced = await classifySales(db, [row({
      receipt_number: 'R-13c', sku: 'SKU-1', quantity: 1,
      discount_usd: '2', tax_usd: '1', amount_paid_usd: '10',
      membership_discount_usd: '0.5', membership_points_redeemed: '50',
    }, 1)], null)
    const pricedData = priced[0].data
    assert.strictEqual(pricedData.discount_usd, 2)
    assert.strictEqual(pricedData.tax_usd, 1)
    assert.strictEqual(pricedData.membership_discount_usd, 0.5)
    assert.strictEqual(pricedData.membership_points_redeemed, 50)
    assert.strictEqual(pricedData.total_usd, 8.5, 'total_usd = subtotal - discount - membership_discount + tax, matching routes/sales.ts POST / exactly')
    assert.strictEqual(pricedData.total_khr, Math.round(8.5 * 4100), 'total_khr = round(total_usd * exchange_rate)')
    assert.strictEqual(pricedData.change_usd, 1.5, 'change_usd = amount_paid - total')

    // An explicit amount_paid_usd of 0 (fully unpaid/on credit) must be
    // honored, not treated the same as a blank cell defaulting to "paid in
    // full" -- the exact gap a bare `Number(...) || totalUsd` would cause.
    const unpaid = await classifySales(db, [row({ receipt_number: 'R-13d', sku: 'SKU-1', quantity: 1, amount_paid_usd: '0' }, 1)], null)
    // Math.abs (not strictEqual) -- normalizeImportMoney's roundUpToDecimals
    // returns -0 for a "0" input (pre-existing quirk of that shared
    // utility, unrelated to this session's change); -0 and 0 are the same
    // amount, just distinguished by Object.is, which strictEqual uses.
    assert.strictEqual(Math.abs(unpaid[0].data.amount_paid_usd), 0, 'an explicit amount_paid_usd of 0 is honored, not defaulted to total_usd')

    // A row with no discount/tax/amount_paid columns at all still behaves
    // exactly like before this session -- total_usd equals the bare
    // subtotal, amount_paid defaults to full payment, no change due.
    const plain = await classifySales(db, [row({ receipt_number: 'R-13e', sku: 'SKU-1', quantity: 1 }, 1)], null)
    assert.strictEqual(plain[0].data.total_usd, 10, 'no discount/tax columns -> total_usd is still just the bare subtotal')
    assert.strictEqual(plain[0].data.amount_paid_usd, 10, 'amount_paid defaults to total_usd when the column is blank')
    assert.strictEqual(plain[0].data.change_usd, 0)

    // Delivery fields only resolve/populate when is_delivery is truthy on
    // the row -- an is_delivery-less row leaves every delivery_* column at
    // its schema default, same as a normal in-store manual sale.
    const notDelivery = await classifySales(db, [row({ receipt_number: 'R-13f', sku: 'SKU-1', quantity: 1, delivery_contact_phone: '070999888', delivery_fee_usd: '3' }, 1)], null)
    assert.strictEqual(notDelivery[0].data.is_delivery, 0)
    assert.strictEqual(notDelivery[0].data.delivery_contact_id, null, 'delivery fields are ignored when is_delivery is not set, even if a phone/fee column has a value')
    assert.strictEqual(notDelivery[0].data.delivery_fee_usd, 0)

    const delivery = await classifySales(db, [row({
      receipt_number: 'R-13g', sku: 'SKU-1', quantity: 1, is_delivery: '1',
      delivery_contact_phone: '070-999-888', delivery_fee_usd: '3',
    }, 1)], null)
    assert.strictEqual(delivery[0].data.is_delivery, 1)
    assert.strictEqual(delivery[0].data.delivery_contact_id, 301, 'delivery_contact_phone (formatting-tolerant) resolves delivery_contact_id when is_delivery is set')
    assert.strictEqual(delivery[0].data.delivery_fee_usd, 3)
  }

  console.log('PASS classifySales: compact grouping, strict 24-hour dates, safe sku/barcode/name matching, historical cost snapshots, statuses/returns/batches/branches/customers, and full checkout money parity')
}

// -- Track F parity regression guard (companion to the products one above):
// the sales-import apply path's INSERT INTO sale_items must still include
// cost_price_usd/khr. This is a source-text assertion, not a live-DB one (no
// fake-D1 harness for runImportApply's write half yet, see this file's
// header comment) -- but it directly guards the exact bug this session's
// Track F pass found: classifySales computing cost_price_usd/khr per item
// (tested above) is only half the fix if the INSERT that actually writes
// sale_items drops the column again.
{
  const salesCommitSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'salesImportCommit.ts'), 'utf8')
  const insertMatch = salesCommitSource.match(/INSERT INTO sale_items \(([^)]+)\)[\s\S]*?SELECT/)
  assert.ok(insertMatch, 'runImportApply should still build an INSERT INTO sale_items(...) statement for imported sales')
  const insertColumns = insertMatch[1].split(',').map((c) => c.trim())
  for (const column of [
    'cost_price_usd', 'cost_price_khr', 'base_price_usd', 'base_price_khr',
    'product_discount_type', 'product_discount_label', 'product_discount_usd', 'product_discount_khr',
    'manual_discount_type', 'manual_discount_value', 'manual_discount_usd', 'manual_discount_khr',
    'returned_quantity',
  ]) {
    assert.ok(insertColumns.includes(column), `sale_items INSERT (import apply path) is missing column "${column}" -- COGS/profit reporting would silently read 0 for every imported sale`)
  }

  console.log('PASS sale_items import-apply INSERT still writes cost_price_usd/khr')
}

// -- Track F parity regression guard (companion to the customer_id
// value-level test above): the sales-import apply path's INSERT INTO
// sales(...) header statement must still include customer_id, or
// classifySales resolving it on `data` (tested above) is only half the
// fix -- same "computed but never reaches the actual write" bug class as
// the cost_price_usd/khr and products Track F gaps this file already
// guards against.
{
  const salesCommitSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'salesImportCommit.ts'), 'utf8')
  const insertMatch = salesCommitSource.match(/INSERT INTO sales \(([^)]+)\)[\s\S]*?SELECT/)
  assert.ok(insertMatch, 'runImportApply should still build an INSERT INTO sales(...) statement for imported sales')
  const insertColumns = insertMatch[1].split(',').map((c) => c.trim())
  assert.ok(insertColumns.includes('customer_id'), 'sales INSERT (import apply path) is missing column "customer_id" -- contacts.ts\'s per-customer purchase history and notifications.ts\'s top-customer aggregation would silently never see imported sales for a real matched customer')

  console.log('PASS sales import-apply INSERT still writes customer_id')
}

// -- Track F parity regression guard (part 70, companion to the value-level
// cashier/delivery/money-math test above): the sales-import apply path's
// INSERT INTO sales(...) header statement must still include every column
// classifySales now computes, or the computation is only half the fix --
// same "computed but never reaches the actual write" bug class this file
// already guards cost_price_usd/khr and customer_id against.
{
  const salesCommitSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'salesImportCommit.ts'), 'utf8')
  const insertMatch = salesCommitSource.match(/INSERT INTO sales \(([^)]+)\)[\s\S]*?SELECT/)
  assert.ok(insertMatch, 'runImportApply should still build an INSERT INTO sales(...) statement for imported sales')
  const insertColumns = insertMatch[1].split(',').map((c) => c.trim())
  for (const column of [
    'cashier_id', 'exchange_rate', 'discount_usd', 'discount_khr', 'tax_usd', 'tax_khr',
    'amount_paid_usd', 'amount_paid_khr', 'change_usd', 'change_khr',
    'membership_discount_usd', 'membership_discount_khr', 'membership_points_redeemed',
    'is_delivery', 'delivery_contact_id', 'delivery_contact_name', 'delivery_contact_phone',
    'delivery_contact_address', 'delivery_fee_usd', 'delivery_fee_khr', 'delivery_fee_paid_by',
  ]) {
    assert.ok(insertColumns.includes(column), `sales INSERT (import apply path) is missing column "${column}" -- an imported historical sale would silently lose this field even though classifySales computed it`)
  }

  console.log('PASS sales import-apply INSERT still writes cashier_id/exchange_rate/discount/tax/amount_paid/change/membership/delivery columns')
}

// -- classifyProducts: the products-review "Details" field-rule preset
// (BulkImportModal.tsx's Fill blanks only / Keep existing / Use imported,
// sent per-row as a `_field_rules` JSON column) was previously read
// nowhere in classifyProducts -- every matched row always took the CSV's
// value for category/brand/unit/supplier/description/low_stock_threshold
// regardless of what the reviewer picked, and the `existing` products
// SELECT didn't even fetch those columns to compare against. Real
// transpiled classifyProducts against a fake products row that already
// has values set for these fields, confirming all three rules actually
// change `data` (and therefore both the reviewer's changes-diff and the
// real UPDATE write, which both read off this same object).
{
  const { classifyProducts } = moduleObj.exports
  const makeFakeProductsDb = (existingProducts = [], branches = [{ id: 1, name: 'Main Branch', is_default: 1 }]) => ({
    prepare: (sql) => ({
      all: async () => {
        if (/FROM import_job_files/.test(sql)) return []
        if (/FROM products/.test(sql)) return existingProducts
        if (/FROM branches/.test(sql)) return branches
        return []
      },
    }),
  })
  const row = (fields, rowNumber) => ({ _rowNumber: rowNumber, ...fields })
  const noImages = new Map()
  const existingMatch = {
    id: 42, sku: 'SKU-1', barcode: null, name: 'Existing Widget',
    cost_price_usd: 5, cost_price_khr: null, selling_price_usd: 10, selling_price_khr: null,
    category: 'Existing Category', brand: 'Existing Brand', unit: 'box',
    supplier: 'Existing Supplier', description: 'Existing description', low_stock_threshold: 25,
  }

  // 1) 'keep_existing' -- the CSV's value for that field must never reach
  // `data`; the existing product's own value survives untouched.
  {
    const db = makeFakeProductsDb([existingMatch])
    const results = await classifyProducts(db, [row({
      name: 'Existing Widget', sku: 'SKU-1', selling_price_usd: '10', cost_price_usd: '5',
      category: 'New Category From CSV', brand: 'New Brand From CSV',
      _field_rules: JSON.stringify({ category: 'keep_existing', brand: 'keep_existing' }),
    }, 1)], 'job-keep', null, noImages)
    const d = results[0].data
    assert.strictEqual(d.category, 'Existing Category', '"Keep existing" must preserve the existing category, not the CSV\'s')
    assert.strictEqual(d.brand, 'Existing Brand', '"Keep existing" must preserve the existing brand, not the CSV\'s')
  }

  // 2) 'merge_blank_only' ("Fill blanks only") -- an existing field that
  // already has a value is preserved even though the CSV carries a
  // different one; the low_stock_threshold case also confirms this
  // isn't string-only (existing value is a number).
  {
    const db = makeFakeProductsDb([existingMatch])
    const results = await classifyProducts(db, [row({
      name: 'Existing Widget', sku: 'SKU-1', selling_price_usd: '10', cost_price_usd: '5',
      supplier: 'New Supplier From CSV', low_stock_threshold: '5',
      _field_rules: JSON.stringify({ supplier: 'merge_blank_only', low_stock_threshold: 'merge_blank_only' }),
    }, 1)], 'job-fill-blanks-existing-set', null, noImages)
    const d = results[0].data
    assert.strictEqual(d.supplier, 'Existing Supplier', '"Fill blanks only" must not overwrite an already-filled existing supplier')
    assert.strictEqual(d.low_stock_threshold, 25, '"Fill blanks only" must not overwrite an already-set existing low_stock_threshold')
  }

  // 3) 'merge_blank_only' when the EXISTING field actually is blank -- the
  // CSV's value should land, since there's nothing existing to preserve.
  {
    const blankMatch = { ...existingMatch, description: null }
    const db = makeFakeProductsDb([blankMatch])
    const results = await classifyProducts(db, [row({
      name: 'Existing Widget', sku: 'SKU-1', selling_price_usd: '10', cost_price_usd: '5',
      description: 'New description from CSV',
      _field_rules: JSON.stringify({ description: 'merge_blank_only' }),
    }, 1)], 'job-fill-blanks-existing-blank', null, noImages)
    assert.strictEqual(results[0].data.description, 'New description from CSV', '"Fill blanks only" should let the CSV fill in a field the existing product left blank')
  }

  // 4) 'use_imported' (and no rule at all) -- unchanged default behavior,
  // CSV value wins, same as before this fix existed.
  {
    const db = makeFakeProductsDb([existingMatch])
    const results = await classifyProducts(db, [row({
      name: 'Existing Widget', sku: 'SKU-1', selling_price_usd: '10', cost_price_usd: '5',
      category: 'New Category From CSV', unit: 'case',
      _field_rules: JSON.stringify({ category: 'use_imported' }),
    }, 1)], 'job-use-imported', null, noImages)
    const d = results[0].data
    assert.strictEqual(d.category, 'New Category From CSV', '"Use imported" must still let the CSV value win')
    assert.strictEqual(d.unit, 'case', 'A field with no rule set at all must still default to using the imported value')
  }

  // 5) A brand-new product (no match) ignores _field_rules entirely --
  // there's nothing existing to reconcile against, so the CSV's values
  // pass through exactly as a create always has.
  {
    const db = makeFakeProductsDb([])
    const results = await classifyProducts(db, [row({
      name: 'Brand New Widget', selling_price_usd: '10', cost_price_usd: '5',
      category: 'Whatever Category',
      _field_rules: JSON.stringify({ category: 'keep_existing' }),
    }, 1)], 'job-no-match', null, noImages)
    assert.strictEqual(results[0].data.category, 'Whatever Category', 'A new-product row has no existing match to keep, so the CSV value is used regardless of the field rule')
  }

  console.log('PASS classifyProducts now actually applies the Details field-rule preset (keep_existing/merge_blank_only/use_imported) sent via `_field_rules`, previously a no-op read nowhere in this file')
}

// Part 327: 'fill_blank' job-level import mode -- applyFillBlankOnlyMode,
// exercised through the real classifyProducts (same pattern as the
// _field_rules block above: real transpiled source, fake products/
// branches db). Confirms (1) an already-filled existing field survives a
// differing CSV value, (2) a genuinely blank existing field still gets
// filled from the CSV, and (3) an unmatched (brand-new) row is
// unaffected -- the mode only ever reconciles against something that
// already exists. The write-time half of this mode's contract (stock/
// batch statements never emitted for a fill_blank matched row) lives in
// materializeImportChunk, which needs a full D1-batch mock this pure
// test file doesn't have -- not covered here, flagged in progress.md.
{
  const { classifyProducts } = moduleObj.exports
  const makeFakeProductsDb = (existingProducts = [], branches = [{ id: 1, name: 'Main Branch', is_default: 1 }]) => ({
    prepare: (sql) => ({
      all: async () => {
        if (/FROM import_job_files/.test(sql)) return []
        if (/FROM products/.test(sql)) return existingProducts
        if (/FROM branches/.test(sql)) return branches
        return []
      },
    }),
  })
  const row = (fields, rowNumber) => ({ _rowNumber: rowNumber, ...fields })
  const noImages = new Map()
  const fillBlankPolicy = JSON.stringify({ import_mode: 'fill_blank' })
  const existingFilled = {
    id: 77, sku: 'SKU-FB', barcode: null, name: 'Fillable Widget',
    cost_price_usd: 5, cost_price_khr: null, selling_price_usd: 10, selling_price_khr: null,
    category: 'Existing Category', categories: 'Existing Category', brand: 'Existing Brand', brands: 'Existing Brand',
    unit: 'box', supplier: 'Existing Supplier', description: 'Existing description', low_stock_threshold: 25,
    barcode_col_placeholder: undefined,
  }

  // 1) Already-filled existing fields survive a differing CSV value.
  {
    const db = makeFakeProductsDb([existingFilled])
    const results = await classifyProducts(db, [row({
      name: 'Fillable Widget', sku: 'SKU-FB', selling_price_usd: '10', cost_price_usd: '5',
      category: 'New Category From CSV', description: 'New description from CSV', unit: 'case',
    }, 1)], 'job-fill-blank-existing-set', fillBlankPolicy, noImages)
    const d = results[0].data
    assert.strictEqual(d.category, 'Existing Category', 'fill_blank must not overwrite an already-filled existing category')
    assert.strictEqual(d.description, 'Existing description', 'fill_blank must not overwrite an already-filled existing description')
    assert.strictEqual(d.unit, 'box', 'fill_blank must not overwrite an already-filled existing unit')
  }

  // 2) A genuinely blank existing field still gets filled from the CSV.
  {
    const blankMatch = { ...existingFilled, barcode: null, supplier: null }
    const db = makeFakeProductsDb([blankMatch])
    const results = await classifyProducts(db, [row({
      name: 'Fillable Widget', sku: 'SKU-FB', selling_price_usd: '10', cost_price_usd: '5',
      barcode: 'NEWBARCODE123', supplier: 'New Supplier From CSV',
    }, 1)], 'job-fill-blank-existing-blank', fillBlankPolicy, noImages)
    const d = results[0].data
    assert.strictEqual(d.barcode, 'NEWBARCODE123', 'fill_blank should let the CSV fill in a barcode the existing product left blank')
    assert.strictEqual(d.supplier, 'New Supplier From CSV', 'fill_blank should let the CSV fill in a supplier the existing product left blank')
  }

  // 3) An unmatched (brand-new) row is unaffected by fill_blank -- CSV
  // values pass through exactly as an ordinary create always has.
  {
    const db = makeFakeProductsDb([])
    const results = await classifyProducts(db, [row({
      name: 'Brand New Fillable Widget', selling_price_usd: '10', cost_price_usd: '5',
      category: 'Whatever Category', description: 'Whatever description',
    }, 1)], 'job-fill-blank-no-match', fillBlankPolicy, noImages)
    const d = results[0].data
    assert.strictEqual(d.category, 'Whatever Category', 'A new-product row has no existing match to preserve, so the CSV value is used regardless of fill_blank')
    assert.strictEqual(d.description, 'Whatever description', 'A new-product row has no existing match to preserve, so the CSV value is used regardless of fill_blank')
  }

  console.log('PASS classifyProducts fill_blank mode (Part 327): already-filled existing fields survive a differing CSV value, a genuinely blank existing field still gets filled, and an unmatched row is unaffected')
}

// Part 329: Customer Portal description-column import mapping --
// buildDescriptionFromColumns (pure) plus classifyProducts confirming an
// explicit `description` column still wins outright over the named
// section columns.
{
  const { buildDescriptionFromColumns, classifyProducts } = moduleObj.exports

  // 1) Introduction alone stays a plain, unlabeled paragraph -- no
  // section columns present means nothing for parseProductDescription
  // to key off, same shape as a hand-typed one-paragraph description.
  {
    const text = buildDescriptionFromColumns({ introduction: 'A gentle everyday cleanser.' })
    assert.strictEqual(text, 'A gentle everyday cleanser.', 'Introduction alone should come back as plain unlabeled text')
  }

  // 2) All five columns assemble into the labeled text
  // productDetailSections.ts's parser recognizes, in a stable order,
  // official product name/features/who-for/ingredients each on their
  // own labeled block.
  {
    const text = buildDescriptionFromColumns({
      introduction: 'Daily face wash for sensitive skin.',
      official_product_name: 'Gentle Face Wash 200ml',
      'features_&_benefits': 'Soap-free\nFragrance-free',
      'who_is_it_for?': 'Sensitive or reactive skin types',
      ingredients: 'Aqua, Glycerin, Panthenol',
    })
    assert.ok(text.startsWith('Daily face wash for sensitive skin.'), 'Leading text should be the unlabeled intro')
    assert.ok(text.includes('Official Product Name: Gentle Face Wash 200ml'), 'Official product name should be labeled')
    assert.ok(text.includes('Features & Benefits:\nSoap-free\nFragrance-free'), 'Features & Benefits should be labeled with its content')
    assert.ok(text.includes('Who is it for?:\nSensitive or reactive skin types'), 'Who is it for? should be labeled with its content')
    assert.ok(text.includes('Ingredients:\nAqua, Glycerin, Panthenol'), 'Ingredients should be labeled with its content')
  }

  // 3) Punctuation-free header fallbacks (an export tool that strips
  // "&"/"?" from headers) still resolve to the same sections.
  {
    const text = buildDescriptionFromColumns({
      features_and_benefits: 'Long-lasting',
      who_is_it_for: 'Everyone',
    })
    assert.ok(text.includes('Features & Benefits:\nLong-lasting'), 'features_and_benefits fallback header should still map to Features & Benefits')
    assert.ok(text.includes('Who is it for?:\nEveryone'), 'who_is_it_for fallback header should still map to Who is it for?')
  }

  // 4) No description columns at all -> empty string, not a stray
  // separator or whitespace.
  {
    assert.strictEqual(buildDescriptionFromColumns({}), '', 'No description-section columns present should produce an empty string')
  }

  // 5) Through classifyProducts: a row with only the named section
  // columns (no `description` column) gets the assembled text written
  // to data.description for a brand-new product.
  {
    const db = {
      prepare: (sql) => ({
        all: async () => {
          if (/FROM import_job_files/.test(sql)) return []
          if (/FROM products/.test(sql)) return []
          if (/FROM branches/.test(sql)) return [{ id: 1, name: 'Main Branch', is_default: 1 }]
          return []
        },
      }),
    }
    const results = await classifyProducts(db, [{
      _rowNumber: 1,
      product: 'Gentle Face Wash',
      selling_price_usd: '12', cost_price_usd: '6',
      introduction: 'Daily face wash for sensitive skin.',
      ingredients: 'Aqua, Glycerin',
    }], 'job-description-columns', null, new Map())
    assert.strictEqual(results[0].data.name, 'Gentle Face Wash', 'The "Product" column should match by name, same as the name/product_name aliases')
    assert.ok(String(results[0].data.description).includes('Daily face wash for sensitive skin.'), 'Assembled description should include the intro text')
    assert.ok(String(results[0].data.description).includes('Ingredients:\nAqua, Glycerin'), 'Assembled description should include the labeled Ingredients section')
  }

  // 6) An explicit `description` column wins outright over the named
  // section columns, even when both are present on the same row.
  {
    const db = {
      prepare: (sql) => ({
        all: async () => {
          if (/FROM import_job_files/.test(sql)) return []
          if (/FROM products/.test(sql)) return []
          if (/FROM branches/.test(sql)) return [{ id: 1, name: 'Main Branch', is_default: 1 }]
          return []
        },
      }),
    }
    const results = await classifyProducts(db, [{
      _rowNumber: 1,
      name: 'Widget With Explicit Description',
      selling_price_usd: '12', cost_price_usd: '6',
      description: 'The explicit description column.',
      introduction: 'This should be ignored.',
    }], 'job-description-column-wins', null, new Map())
    assert.strictEqual(results[0].data.description, 'The explicit description column.', 'An explicit description column must win outright over the assembled section columns')
  }

  console.log('PASS buildDescriptionFromColumns / classifyProducts Customer Portal description-column import mapping (Part 329)')
}

}

runAsyncTests().catch((error) => {
  console.error('FAIL', error)
  process.exitCode = 1
})

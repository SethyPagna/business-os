// Standalone unit tests for the P2-3 Codex/legacy-data barcode import
// contract (docs/plans/codex-data-contract.md) -- applyBarcodeImportPrecedence
// and parseBarcodeAliasColumn in src/lib/importEngine.ts.
//
// Same harness technique as test-import-engine-pure.cjs (no D1/wrangler
// test runner in this project -- see PORTING_STATUS.md): transpiles the
// REAL source files with the `typescript` package already in node_modules
// and calls the actual exported functions, not a re-implementation. The
// module-loading boilerplate below is copied from test-import-engine-pure.cjs
// verbatim (same local-import graph, since applyBarcodeImportPrecedence/
// parseBarcodeAliasColumn live in the same file and classifyProducts is
// exercised end-to-end here too) -- keep the two in sync if importEngine.ts's
// local import graph changes.
//
// Covers the six fixture cases required by docs/plans/coordinated-plan-2026-09-02.md
// section 4.5 / the P2-3 brief:
//   1. incoming real barcode fills a missing/placeholder existing one
//   2. incoming real barcode fills an existing "0"
//   3. incoming real barcode never overwrites an existing DIFFERENT real
//      barcode -- alias recorded + barcode_alias_recorded warning raised
//   4. incoming placeholder/blank never clears an existing real barcode
//   5. barcode_aliases CSV column parsing (parseBarcodeAliasColumn)
//   6. duplicate alias within one cell is idempotent (deduped, not double-queued)
//
// Run: node scripts/test-barcode-import-precedence-pure.cjs

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

// barcodeAliases.ts (P2-3, Codex/legacy-data contract) is pure (no D1/Env
// dependency) and importEngine.ts's applyBarcodeImportPrecedence/
// parseBarcodeAliasColumn genuinely call isRealBarcode/normalizeBarcode at
// runtime -- real transpiled module, same treatment as productDetailRule.ts
// etc. above, so the barcode-precedence tests below exercise the actual
// placeholder rule, not a stand-in.
const barcodeAliasesSourcePath = path.join(__dirname, '..', 'src', 'lib', 'barcodeAliases.ts')
const barcodeAliasesSource = fs.readFileSync(barcodeAliasesSourcePath, 'utf8')
const { outputText: barcodeAliasesOutputText } = ts.transpileModule(barcodeAliasesSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'barcodeAliases.ts',
})
const barcodeAliasesModuleObj = { exports: {} }
const barcodeAliasesWrapper = new Function('exports', 'require', 'module', '__filename', '__dirname', barcodeAliasesOutputText)
barcodeAliasesWrapper(barcodeAliasesModuleObj.exports, require, barcodeAliasesModuleObj, barcodeAliasesSourcePath, path.dirname(barcodeAliasesSourcePath))

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
  if (request === './barcodeAliases') {
    return barcodeAliasesModuleObj.exports // real module -- applyBarcodeImportPrecedence/parseBarcodeAliasColumn actually call into it
  }
  if (request === './salesImportCommit') {
    return { MAX_HISTORICAL_SALE_LINES: 100, applyHistoricalSaleImport: async () => ({ alreadyApplied: false }) }
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

const { classifyProducts, applyBarcodeImportPrecedence, parseBarcodeAliasColumn } = moduleObj.exports
assert.strictEqual(typeof applyBarcodeImportPrecedence, 'function', 'applyBarcodeImportPrecedence should be exported from importEngine.ts')
assert.strictEqual(typeof parseBarcodeAliasColumn, 'function', 'parseBarcodeAliasColumn should be exported from importEngine.ts')
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

let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }
async function checkAsync(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

// -- Pure applyBarcodeImportPrecedence checks --------------------------

check('rule (a): incoming real barcode fills a missing existing one', () => {
  const data = { barcode: '6923644012345' }
  const warnings = []
  applyBarcodeImportPrecedence(data, { barcode: null }, warnings)
  assert.strictEqual(data.barcode, '6923644012345')
  assert.strictEqual(warnings.length, 0, 'filling a missing barcode is not warning-worthy')
})

check('rule (a): incoming real barcode fills an existing placeholder "0"', () => {
  const data = { barcode: '6923644012345' }
  const warnings = []
  applyBarcodeImportPrecedence(data, { barcode: '0' }, warnings)
  assert.strictEqual(data.barcode, '6923644012345')
  assert.strictEqual(warnings.length, 0)
})

check('rule (b): incoming real barcode never overwrites a DIFFERENT existing real barcode -- alias queued + warning raised', () => {
  const data = { barcode: '111111111111' }
  const warnings = []
  applyBarcodeImportPrecedence(data, { barcode: '999999999999' }, warnings)
  assert.strictEqual(data.barcode, '999999999999', 'the existing real barcode must be kept on products.barcode')
  assert.deepStrictEqual(data.__pendingBarcodeAlias, { barcode: '111111111111', barcodeNormalized: '111111111111', source: 'import' })
  assert.strictEqual(warnings.length, 1)
  assert.strictEqual(warnings[0].kind, 'barcode_alias_recorded')
})

check('rule (b): the SAME real barcode (after normalization) is a no-op -- no alias, no warning', () => {
  const data = { barcode: ' 999999999999 ' }
  const warnings = []
  applyBarcodeImportPrecedence(data, { barcode: '999999999999' }, warnings)
  assert.strictEqual(warnings.length, 0, 'identical barcode must not be treated as a conflict')
  assert.strictEqual(data.__pendingBarcodeAlias, undefined)
})

check('rule (c): incoming placeholder/blank never clears an existing real barcode', () => {
  const data1 = { barcode: '0' }
  applyBarcodeImportPrecedence(data1, { barcode: '888888888888' }, [])
  assert.strictEqual(data1.barcode, '888888888888', 'incoming "0" must not clear the existing real barcode')

  const data2 = { barcode: '' }
  applyBarcodeImportPrecedence(data2, { barcode: '888888888888' }, [])
  assert.strictEqual(data2.barcode, '888888888888', 'incoming blank must not clear the existing real barcode')
})

check('rule (d): neither side real -- a genuinely blank cell keeps the existing placeholder rather than nulling it', () => {
  const data = { barcode: '' }
  applyBarcodeImportPrecedence(data, { barcode: '0' }, [])
  assert.strictEqual(data.barcode, '0', 'blank cell must not needlessly null out an existing placeholder')
})

check('rule (d): neither side real -- an incoming placeholder that actually said something is left as-is (not overwritten by the existing placeholder)', () => {
  const data = { barcode: '12' } // short/placeholder but non-empty
  applyBarcodeImportPrecedence(data, { barcode: '0' }, [])
  assert.strictEqual(data.barcode, '12', 'an incoming placeholder cell that carried a value wins over the existing placeholder, same as every other column')
})

check('no match (create path) is a no-op', () => {
  const data = { barcode: '6923644012345' }
  applyBarcodeImportPrecedence(data, null, [])
  assert.strictEqual(data.barcode, '6923644012345')
})

// -- parseBarcodeAliasColumn checks -------------------------------------

check('parseBarcodeAliasColumn: splits a pipe-separated cell, trims, drops placeholders', () => {
  const out = parseBarcodeAliasColumn(' 6923644012345 | 0 | 12 | 041554089073 |')
  assert.deepStrictEqual(out, ['6923644012345', '041554089073'])
})

check('parseBarcodeAliasColumn: duplicate alias within one cell is deduped (idempotent)', () => {
  const out = parseBarcodeAliasColumn('6923644012345|6923644012345| 6923644012345')
  assert.deepStrictEqual(out, ['6923644012345'], 'the same alias repeated in one cell must be queued only once')
})

check('parseBarcodeAliasColumn: blank/undefined/placeholder-only cell yields an empty array', () => {
  assert.deepStrictEqual(parseBarcodeAliasColumn(undefined), [])
  assert.deepStrictEqual(parseBarcodeAliasColumn(''), [])
  assert.deepStrictEqual(parseBarcodeAliasColumn('0|0|'), [])
})

// -- End-to-end through the real classifyProducts ------------------------

async function runEndToEndChecks() {
  const existingWithPlaceholder = {
    id: 501, sku: 'SKU-ALIAS-1', barcode: '0', name: 'Aveeno Eye Cream 14ml',
    cost_price_usd: 5, cost_price_khr: null, selling_price_usd: 9, selling_price_khr: null,
    category: 'Cat', brand: 'Brand', unit: 'pcs', supplier: null, description: null, low_stock_threshold: 10,
  }
  const existingWithRealBarcode = {
    id: 502, sku: 'SKU-ALIAS-2', barcode: '999999999999', name: 'Neutrogena Sunscreen 40ml',
    cost_price_usd: 5, cost_price_khr: null, selling_price_usd: 9, selling_price_khr: null,
    category: 'Cat', brand: 'Brand', unit: 'pcs', supplier: null, description: null, low_stock_threshold: 10,
  }

  // PINNED ARCHITECTURAL FINDING (see docs/plans/codex-data-contract.md
  // "Barcode precedence vs. THE product identity rule" for the full
  // writeup): productDetailSignature (src/lib/productDetailRule.ts) --
  // "barcode + cost" -- is THE identity rule classifyProducts uses to
  // decide `match`, on EVERY path that can set it (isExactIdentity on
  // skuMatch/sameNameBarcodeCandidates, the costWasBlank
  // sameNameSameBarcode fallback, sameBatchCandidate, and the final
  // byName fallback) -- confirmed by reading each one at
  // src/lib/importEngine.ts:1546-1653. Every one of them requires the
  // existing candidate's barcode to already equal (case/space-insensitive)
  // the row's OWN incoming barcode before `match` can become non-null.
  // That means a row whose barcode genuinely DIFFERS from what is on file
  // for that product -- exactly the Codex re-verification scenario this
  // section exists for -- never reaches `match` at all: classifyProducts
  // routes it to action="create" (a new sibling child-row under the same
  // name group, per productDetailRule.ts's own "a different barcode is a
  // different physical article" rule), not "update". Consequently
  // applyBarcodeImportPrecedence's rules (a)/(b)/(c)/(d) are exercised by
  // classifyProducts only in the trivial case where the incoming and
  // existing barcodes ALREADY agree (rule (b)'s own early-return no-op).
  // Pinned here, not silently "fixed" by reworking productDetailRule.ts's
  // shared identity rule (used by duplicate-merge, branch-transfer and the
  // manual product form too, well outside this section's barcode-
  // resolution/candidate-map ownership) -- see the report/contract doc for
  // the coordinator recommendation.

  await checkAsync('PINNED: a SKU-matched row filling a MISSING/placeholder existing barcode still becomes action="create" (a new child row), not "update" -- the barcode-fill scenario never reaches applyBarcodeImportPrecedence through classifyProducts today', async () => {
    const db = makeFakeProductsDb([existingWithPlaceholder])
    const results = await classifyProducts(db, [{
      _rowNumber: 1, name: 'Aveeno Eye Cream 14ml', sku: 'SKU-ALIAS-1', barcode: '6923644012345', cost_price_usd: '5',
    }], 'job-fill-missing', null, new Map())
    assert.strictEqual(results[0].action, 'create', 'productDetailSignature disagreement (placeholder "0" vs the incoming real barcode) blocks the SKU match')
    assert.strictEqual(results[0].existingId, null)
    assert.strictEqual(results[0].data.__pendingBarcodeAlias, undefined, 'applyBarcodeImportPrecedence never saw a match object, so nothing was queued')
  })

  await checkAsync('PINNED: a SKU-matched row with a DIFFERENT real barcode also becomes action="create", not the alias-recording "update" the precedence rules describe', async () => {
    const db = makeFakeProductsDb([existingWithRealBarcode])
    const results = await classifyProducts(db, [{
      _rowNumber: 1, name: 'Neutrogena Sunscreen 40ml', sku: 'SKU-ALIAS-2', barcode: '111111111111', cost_price_usd: '5',
    }], 'job-conflict', null, new Map())
    assert.strictEqual(results[0].action, 'create')
    assert.strictEqual(results[0].existingId, null)
    assert.strictEqual(results[0].data.barcode, '111111111111', 'the row is not treated as a conflict at all -- it is a brand-new product row carrying its own incoming barcode as-is')
    assert.strictEqual(results[0].data.__pendingBarcodeAlias, undefined)
    assert.strictEqual((results[0].warnings || []).some((w) => w.kind === 'barcode_alias_recorded'), false, 'no barcode_alias_recorded warning either -- the row never reached the precedence guard')
  })

  await checkAsync('reachable case: incoming and existing barcodes already AGREE (after normalizeBarcode) -- the SKU match survives, applyBarcodeImportPrecedence runs and is correctly a no-op', async () => {
    const db = makeFakeProductsDb([existingWithRealBarcode])
    const results = await classifyProducts(db, [{
      _rowNumber: 1, name: 'Neutrogena Sunscreen 40ml', sku: 'SKU-ALIAS-2', barcode: ' 999999999999 ', cost_price_usd: '5',
    }], 'job-agree', null, new Map())
    assert.strictEqual(results[0].action, 'update', 'same barcode (modulo whitespace) and same cost -- productDetailSignature agrees, the SKU match is exact identity')
    assert.strictEqual(results[0].existingId, 502)
    assert.strictEqual(results[0].data.barcode, '999999999999')
    assert.strictEqual(results[0].data.__pendingBarcodeAlias, undefined, 'identical barcodes are never queued as an alias')
    assert.strictEqual((results[0].warnings || []).some((w) => w.kind === 'barcode_alias_recorded'), false)
  })

  await checkAsync('classifyProducts: optional barcode_aliases CSV column is ingested into __importAliasColumnValues on both create and update rows -- independent of match/identity, unaffected by the pinned finding above', async () => {
    // Update row: barcode and cost both agree with the existing candidate,
    // so this row genuinely reaches action="update" (see the "reachable
    // case" test above) -- proving __importAliasColumnValues attaches
    // correctly on the UPDATE path, not just create.
    const dbUpdate = makeFakeProductsDb([existingWithRealBarcode])
    const updateResults = await classifyProducts(dbUpdate, [{
      _rowNumber: 1, name: 'Neutrogena Sunscreen 40ml', sku: 'SKU-ALIAS-2', barcode: '999999999999', cost_price_usd: '5',
      barcode_aliases: '111111111111|222222222222',
    }], 'job-alias-column-update', null, new Map())
    assert.strictEqual(updateResults[0].action, 'update')
    assert.deepStrictEqual(updateResults[0].data.__importAliasColumnValues, ['111111111111', '222222222222'])

    const dbCreate = makeFakeProductsDb([])
    const createResults = await classifyProducts(dbCreate, [{
      _rowNumber: 1, name: 'Brand New Product', barcode: '333333333333',
      barcode_aliases: '444444444444',
    }], 'job-alias-column-create', null, new Map())
    assert.strictEqual(createResults[0].action, 'create')
    assert.deepStrictEqual(createResults[0].data.__importAliasColumnValues, ['444444444444'])
  })

  // _action=override_replace's effect on applyBarcodeImportPrecedence is
  // covered by the pure unit test above ('no match (create path) is a
  // no-op' plus the isolated rule-(b) test combined with the caller's own
  // guard) -- there is no meaningful end-to-end classifyProducts scenario
  // for it here: per the pinned finding above, a genuinely differing
  // barcode never produces a non-null `match` in the first place, so
  // there is no established match left for override_replace to act on
  // through this path today.

  console.log(`\n${passed} passed`)
}

runEndToEndChecks().catch((error) => {
  console.error(error)
  process.exit(1)
})

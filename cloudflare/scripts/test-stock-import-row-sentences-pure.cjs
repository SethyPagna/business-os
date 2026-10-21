// The unified stock import's row sentences (cloudflare/src/lib/stockActionImport.ts) are restated in Khmer by the review
// screen (frontend/src/components/imports/importRowText.ts), which finds each one in the joined row message. The English the
// resolver really produces is the English of a pack key, word for word, so the restatement keeps finding it.
//
// This runs the REAL resolver (not a source-text grep): a reworded Worker sentence, or a pack edit that is not mirrored, fails here.
//
// Run: node scripts/test-stock-import-row-sentences-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')

function loadCompiled(file, stubs) {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', file)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  }).outputText
  const original = Module._load
  Module._load = function(request, parent, isMain) {
    if (request === './moneyPrecision') return original.call(this, path.join(__dirname, '../src/lib/moneyPrecision.ts'), parent, isMain)
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    return original.call(this, request, parent, isMain)
  }
  try {
    const moduleObj = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', output)(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))
    return moduleObj.exports
  } finally {
    Module._load = original
  }
}

const productDetailRule = loadCompiled('productDetailRule.ts', {})
const batchCode = loadCompiled('batchCode.ts', {})
const importNumbers = loadCompiled('importNumbers.ts', {})
const resolver = loadCompiled('stockActionResolver.ts', {})
const branchRoles = loadCompiled('branchRoles.ts', {})
const branchEffect = loadCompiled('branchEffect.ts', { './branchRoles': branchRoles, './sqlBinding': loadCompiled('sqlBinding.ts', {}) })
const importBranchAuthority = loadCompiled('importBranchAuthority.ts', { './branchRoles': branchRoles, './branchEffect': branchEffect })
const subject = loadCompiled('stockActionImport.ts', {
  './importBranchAuthority': importBranchAuthority,
  './searchMatch': loadCompiled('searchMatch.ts', {}), // the barcode fold (lane 6.0.938)
  './batchCode': batchCode,
  './importNumbers': importNumbers,
  './stockActionResolver': resolver,
  './productDetailRule': productDetailRule,
})

const root = path.join(__dirname, '..', '..')
const en = JSON.parse(fs.readFileSync(path.join(root, 'frontend', 'src', 'lang', 'en.json'), 'utf8'))
const km = JSON.parse(fs.readFileSync(path.join(root, 'frontend', 'src', 'lang', 'km.json'), 'utf8'))
const fill = (text, values) => text.replace(/\{(\w+)\}/g, (token, name) => Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : token)

const branches = [{ id: 1, name: 'Shop' }, { id: 2, name: 'Warehouse' }]
const serum = { id: 10, name: 'Serum', barcode: 'ABC', selling_price_usd: 12, wholesale_price_usd: 10, cost_price_usd: 5 }
const resolve = (rows, catalog) => subject.resolveUnifiedStockImportRows(rows, 'direct', catalog, branches, [])

// 1. The three static row errors.
const bad = resolve([{ name: '', barcode: '', shop: '', date: 'bad' }], [serum])[0]
assert.ok(bad.errors.includes(en.stock_import_name_or_barcode_required), 'name/barcode sentence is en.stock_import_name_or_barcode_required: ' + JSON.stringify(bad.errors))
assert.ok(bad.errors.includes(en.stock_import_date_invalid), 'date sentence is en.stock_import_date_invalid: ' + JSON.stringify(bad.errors))
assert.ok(bad.errors.includes(en.stock_import_quantity_required), 'quantity sentence is en.stock_import_quantity_required: ' + JSON.stringify(bad.errors))

// 2. A received date two matching product rows share.
const twin = (id, extra) => ({ ...serum, id, ...extra })
const sharedBatch = resolve([{ name: 'Serum', barcode: 'ABC', shop: '1', date: '08/28/2026', action: 'add', batch: 'SHIP-1' }],
  [twin(20, { batch_keys: ['SHIP-1'] }), twin(21, { batch_keys: ['SHIP-1'] })])[0]
assert.deepStrictEqual(sharedBatch.conflicts, [fill(en.stock_import_batch_ambiguous, { batch: 'SHIP-1', count: 2 })], 'batch sentence is en.stock_import_batch_ambiguous')

// 3. A name + barcode the catalog holds on several rows.
const duplicated = resolve([{ name: 'Serum', barcode: 'ABC', shop: '1', date: '08/28/2026', action: 'add', batch: 'NEW' }],
  [twin(20, { batch_keys: ['A'] }), twin(21, { batch_keys: ['B'] }), twin(22, { batch_keys: ['C'] })])[0]
assert.deepStrictEqual(duplicated.conflicts, [fill(en.stock_import_match_several_rows, { count: 3 })], 'duplicate-rows sentence is en.stock_import_match_several_rows')

// 4. A nameless row whose barcode is shared by different products.
const sharedBarcode = resolve([{ name: '', barcode: 'DUP', shop: '1', date: '08/27/2026', action: 'add' }],
  [serum, { id: 11, name: 'A', barcode: 'DUP' }, { id: 12, name: 'B', barcode: 'DUP' }])[0]
assert.deepStrictEqual(sharedBarcode.conflicts, [fill(en.stock_import_barcode_matches_several, { barcode: 'DUP', count: 2 })], 'shared-barcode sentence is en.stock_import_barcode_matches_several')

// 5. The packs say the same thing in Khmer, with the same placeholders.
const holders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',')
for (const key of ['stock_import_name_or_barcode_required', 'stock_import_date_invalid', 'stock_import_batch_ambiguous', 'stock_import_match_several_rows', 'stock_import_barcode_matches_several']) {
  assert.ok(/[ក-៿]/.test(km[key]) && km[key] !== en[key], `km.${key} is Khmer`)
  assert.strictEqual(holders(km[key]), holders(en[key]), `${key}: Khmer and English name the same placeholders`)
}
console.log('PASS the unified stock import row sentences are the pack English of the keys the review screen restates them from')

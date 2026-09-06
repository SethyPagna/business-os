const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')

function compile(file) {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', file)
  return {
    sourcePath,
    output: ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      fileName: sourcePath,
    }).outputText,
  }
}

function loadCompiled(file, stubs) {
  const compiled = compile(file)
  const original = Module._load
  Module._load = function(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    return original.call(this, request, parent, isMain)
  }
  try {
    const moduleObj = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', compiled.output)(moduleObj.exports, require, moduleObj, compiled.sourcePath, path.dirname(compiled.sourcePath))
    return moduleObj.exports
  } finally {
    Module._load = original
  }
}

// productDetailRule carries THE fold (identityBarcodeKey). It is loaded for
// real, not stubbed: a stub would let matchProduct 'pass' over a comparison
// that never folds the leading zero.
const productDetailRule = loadCompiled('productDetailRule.ts', {})
const batchCode = loadCompiled('batchCode.ts', {})
const importNumbers = loadCompiled('importNumbers.ts', {})
const resolver = loadCompiled('stockActionResolver.ts', {})
const subject = loadCompiled('stockActionImport.ts', {
  './batchCode': batchCode,
  './importNumbers': importNumbers,
  './stockActionResolver': resolver,
  './productDetailRule': productDetailRule,
})

assert.deepStrictEqual(subject.UNIFIED_STOCK_COLUMNS, [
  'name', 'barcode', 'shop', 'warehouse', 'date', 'action',
  'selling_price', 'wholesale_price', 'cost_price', 'batch',
  // supplier is OPTIONAL (migration 0062): blank/absent keeps the original
  // ten-column contract importable, present attributes the batch.
  'supplier',
])
assert.strictEqual(subject.getUnifiedStockMode('{"stock_action_mode":"reconcile"}'), 'reconcile')
assert.strictEqual(subject.getUnifiedStockMode('{"stock_action_mode":"wrong"}'), 'direct')

const products = [{ id: 10, name: 'Serum', barcode: 'ABC', selling_price_usd: 12, wholesale_price_usd: 10, cost_price_usd: 5 }]
const branches = [{ id: 1, name: 'Shop' }, { id: 2, name: 'Warehouse' }]
const current = [{ productId: 10, branchId: 1, quantity: 8 }, { productId: 10, branchId: 2, quantity: 4 }]

const direct = subject.resolveUnifiedStockImportRows([
  { _rowNumber: 2, name: 'Serum', barcode: 'ABC', shop: '2', warehouse: '0', date: '08/27/2026', action: 'add' },
  { _rowNumber: 3, name: 'Serum', barcode: 'ABC', shop: '0', warehouse: '2', date: '08/27/2026', action: 'sale1' },
], 'direct', products, branches, current)
assert.strictEqual(direct[0].plan.kind, 'add')
assert.deepStrictEqual(direct[0].plan.branchActions, [{ branchId: 1, direction: 'add', quantity: 2 }, { branchId: 2, direction: 'none', quantity: 0 }])
assert.strictEqual(direct[1].plan.kind, 'sale')
assert.strictEqual(direct[1].plan.saleGroupKey, '2026-08-27#1')
assert.strictEqual(direct[1].sellingPriceUsd, 12, 'blank optional prices inherit from the exact product match')

const reconcile = subject.resolveUnifiedStockImportRows([
  { name: 'Serum', barcode: 'ABC', shop: '10', warehouse: '1', date: '2026-08-27', action: '' },
], 'reconcile', products, branches, current)
assert.deepStrictEqual(reconcile[0].plan.branchActions, [{ branchId: 1, direction: 'add', quantity: 2 }, { branchId: 2, direction: 'sale', quantity: 3 }])
assert.ok(reconcile[0].conflicts.some((message) => /both adds and sells/.test(message)))

const created = subject.resolveUnifiedStockImportRows([
  { name: 'New Product', barcode: 'NEW', shop: '3', date: '08/27/2026', action: '' },
], 'direct', products, [{ id: 2, name: 'Warehouse' }], current)[0]
assert.strictEqual(created.plan.kind, 'create')
assert.deepStrictEqual(created.branchRefs, [{ slot: 'shop', branchId: -1, branchName: 'Shop', pending: true, value: 3 }])

const variants = [
  { ...products[0], id: 20, cost_price_usd: 5, batch_keys: ['08272026'] },
  { ...products[0], id: 21, cost_price_usd: 6, batch_keys: ['OTHER'] },
]
// id 20 and id 21 differ ONLY by cost, so since the owner's Sep-4 2026 ruling
// they are ONE identity the catalog happens to hold TWICE -- a duplicate pair,
// which is what N15's merge tool exists to clean up. Cost used to pick between
// them (and a third cost minted a third row), so this import path was itself a
// source of the duplicates. It now refuses to guess and says what to do.
const exactCost = subject.resolveUnifiedStockImportRows([
  { name: 'Serum', barcode: 'ABC', cost_price: '6', shop: '1', date: '08/28/2026', action: 'add', batch: 'NEW' },
], 'direct', variants, branches, [])[0]
assert.strictEqual(exactCost.productId, null, 'a duplicate pair is reviewable, never actionable -- cost no longer picks a row')
assert.ok(exactCost.conflicts.some((message) => /merge the exact duplicates/.test(message)))
assert.strictEqual(exactCost.plan, null, 'and it never falls through to an apply')
const differentCost = subject.resolveUnifiedStockImportRows([
  { name: 'Serum', barcode: 'ABC', cost_price: '7', shop: '1', date: '08/28/2026', action: 'add', batch: 'NEW' },
], 'direct', variants, branches, [])[0]
assert.strictEqual(differentCost.productId, null, 'a third cost does not mint a third product either')
assert.strictEqual(differentCost.identityKey, 'new:serum|abc', 'the identity carries no cost component any more')
assert.ok(differentCost.conflicts.some((message) => /merge the exact duplicates/.test(message)))
const sameBatch = subject.resolveUnifiedStockImportRows([
  { name: 'Serum', barcode: 'ABC', cost_price: '7', shop: '1', date: '08/27/2026', action: 'add' },
], 'direct', variants, branches, [])[0]
assert.strictEqual(sameBatch.productId, 20, 'same barcode + existing date-derived batch shares the product option despite receipt cost')
const sameNewBatch = subject.resolveUnifiedStockImportRows([
  { _rowNumber: 30, name: 'Brand New', barcode: 'BN1', cost_price: '5', shop: '1', date: '08/29/2026', action: 'add', batch: 'SHIP-A' },
  { _rowNumber: 31, name: 'Brand New', barcode: 'BN1', cost_price: '6', shop: '1', date: '08/29/2026', action: 'add', batch: 'SHIP-A' },
], 'direct', variants, branches, [])
assert.strictEqual(sameNewBatch[1].identityKey, sameNewBatch[0].identityKey, 'two new receipts for the same barcode+batch create one option')
assert.strictEqual(sameNewBatch[0].costPriceUsd, 5)
assert.strictEqual(sameNewBatch[1].costPriceUsd, 6, 'each shared-option receipt keeps its own cost payload')

const invalid = subject.resolveUnifiedStockImportRows([{ name: '', barcode: '', shop: '-2', date: 'bad' }], 'direct', products, branches, current)[0]
assert.strictEqual(invalid.plan, null)
assert.ok(invalid.errors.length >= 3)

const ambiguous = subject.resolveUnifiedStockImportRows([
  { name: '', barcode: 'DUP', shop: '1', date: '08/27/2026', action: 'add' },
], 'direct', [...products, { id: 11, name: 'A', barcode: 'DUP' }, { id: 12, name: 'B', barcode: 'DUP' }], branches, current)[0]
// No name on the row, so the ONLY question left is the barcode -- and it is
// shared by two different products. Cost used to appear in this message as a
// second thing to supply; it cannot disambiguate anything any more.
assert.ok(ambiguous.conflicts.some((message) => /matches 2 products/.test(message)))
assert.ok(ambiguous.conflicts.every((message) => !/cost/i.test(message)))
assert.strictEqual(ambiguous.plan, null, 'an ambiguous identity must never fall through to create')

console.log('PASS unified stock import parses, matches, resolves branches/current stock, preserves every row, and flags ambiguity')

const sqlBinding = loadCompiled('sqlBinding.ts', {})
const searchMatch = loadCompiled('searchMatch.ts', {})
// productIdentity for real too: it holds identityBarcodeKeySql, the ONE SQL
// spelling of the fold this bridge narrows the catalog with.
const productIdentity = loadCompiled('productIdentity.ts', { './db': {}, './sqlBinding': sqlBinding, './productDetailRule': productDetailRule })
const catalog = loadCompiled('stockActionCatalog.ts', {
  './db': {},
  './sqlBinding': sqlBinding,
  './searchMatch': searchMatch,
  './productIdentity': productIdentity,
  './stockActionImport': subject,
})

const seenSql = []
const fakeDb = {
  prepare(sql) {
    seenSql.push(sql)
    return {
      async all() {
        if (/FROM products/.test(sql)) return products
        if (/FROM product_batches/.test(sql)) return []
        if (/FROM branches/.test(sql)) return branches
        if (/FROM branch_stock/.test(sql)) return current
        throw new Error(`Unexpected query: ${sql}`)
      },
    }
  },
}

;(async () => {
  const classified = await catalog.classifyUnifiedStockActions(fakeDb, [
    { _rowNumber: 2, name: 'Serum', barcode: 'ABC', shop: '10', warehouse: '4', date: '08/27/2026' },
    { _rowNumber: 3, name: 'Missing', barcode: '', shop: '-1', date: 'bad' },
  ], '{"stock_action_mode":"reconcile"}')
  assert.strictEqual(classified[0].action, 'update')
  assert.strictEqual(classified[0].data.plan.kind, 'add')
  assert.strictEqual(classified[1].action, 'error')
  assert.ok(seenSql.some((sql) => /FROM branch_stock/.test(sql)))
  assert.ok(seenSql.every((sql) => !/SELECT \*/.test(sql)), 'catalog reads stay narrow')
  console.log('PASS unified stock catalog classification uses bounded narrow reads and blocks invalid rows')
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

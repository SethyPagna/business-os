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

const batchCode = loadCompiled('batchCode.ts', {})
const importNumbers = loadCompiled('importNumbers.ts', {})
const resolver = loadCompiled('stockActionResolver.ts', {})
const subject = loadCompiled('stockActionImport.ts', {
  './batchCode': batchCode,
  './importNumbers': importNumbers,
  './stockActionResolver': resolver,
})

assert.deepStrictEqual(subject.UNIFIED_STOCK_COLUMNS, [
  'name', 'barcode', 'shop', 'warehouse', 'date', 'action',
  'selling_price', 'vip_price', 'cost_price', 'batch',
])
assert.strictEqual(subject.getUnifiedStockMode('{"stock_action_mode":"reconcile"}'), 'reconcile')
assert.strictEqual(subject.getUnifiedStockMode('{"stock_action_mode":"wrong"}'), 'direct')

const products = [{ id: 10, name: 'Serum', barcode: 'ABC', selling_price_usd: 12, special_price_usd: 10, cost_price_usd: 5 }]
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

const invalid = subject.resolveUnifiedStockImportRows([{ name: '', barcode: '', shop: '-2', date: 'bad' }], 'direct', products, branches, current)[0]
assert.strictEqual(invalid.plan, null)
assert.ok(invalid.errors.length >= 3)

const ambiguous = subject.resolveUnifiedStockImportRows([
  { name: '', barcode: 'DUP', shop: '1', date: '08/27/2026', action: 'add' },
], 'direct', [...products, { id: 11, name: 'A', barcode: 'DUP' }, { id: 12, name: 'B', barcode: 'DUP' }], branches, current)[0]
assert.ok(ambiguous.conflicts.some((message) => /matches 2 products/.test(message)))
assert.strictEqual(ambiguous.plan, null, 'an ambiguous identity must never fall through to create')

console.log('PASS unified stock import parses, matches, resolves branches/current stock, preserves every row, and flags ambiguity')

const sqlBinding = loadCompiled('sqlBinding.ts', {})
const catalog = loadCompiled('stockActionCatalog.ts', {
  './db': {},
  './sqlBinding': sqlBinding,
  './stockActionImport': subject,
})

const seenSql = []
const fakeDb = {
  prepare(sql) {
    seenSql.push(sql)
    return {
      async all() {
        if (/FROM products/.test(sql)) return products
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

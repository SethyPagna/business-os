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
  // free_goods is OPTIONAL (N14-D): the operator's explicit "these goods
  // were free" declaration for a $0.00 cost_price row.
  'free_goods',
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
assert.strictEqual(direct[0].freeGoods, false, 'no free_goods cell reads as not declared free')

// The N14-D declaration column, read with the same truthy-string rule the
// frontend mirror (unifiedStockImport.ts's parseFreeGoodsFlag) uses.
const freeGoodsRows = subject.resolveUnifiedStockImportRows([
  { _rowNumber: 2, name: 'Serum', barcode: 'ABC', shop: '1', date: '08/27/2026', action: 'add', free_goods: 'yes' },
  { _rowNumber: 3, name: 'Serum', barcode: 'ABC', shop: '1', date: '08/27/2026', action: 'add', free_goods: '' },
  { _rowNumber: 4, name: 'Serum', barcode: 'ABC', shop: '1', date: '08/27/2026', action: 'add', free_goods: 'no' },
], 'direct', products, branches, current)
assert.strictEqual(freeGoodsRows[0].freeGoods, true)
assert.strictEqual(freeGoodsRows[1].freeGoods, false)
assert.strictEqual(freeGoodsRows[2].freeGoods, false)

// A sheet headed "Free" (normalizes to the raw key `free`, not `free_goods`)
// must read the same as the canonical header -- the client's own header
// alias map (unifiedStockImport.ts) accepts "Free"/"FreeGoods"/"Is Free"/
// "Free Item" for this column, so the Worker must honor the same spellings
// or a clean client mirror gets refused free_goods_required on upload
// (sibling:F13 verifier wave 9; red before the raw.free fallback existed).
const freeAliasRows = subject.resolveUnifiedStockImportRows([
  { _rowNumber: 2, name: 'Serum', barcode: 'ABC', shop: '1', date: '08/27/2026', action: 'add', free: 'yes' },
], 'direct', products, branches, current)
assert.strictEqual(freeAliasRows[0].freeGoods, true, 'a "Free" header column must be read the same as free_goods')

// The client's own header-alias map (unifiedStockImport.ts's HEADER_ALIASES)
// accepts "Supplier Name" / "Vendor" / "Vendor Name" for this column; before
// this fix the Worker read only the literal `supplier` key, so a sheet the
// client blessed as clean was refused on every row (sibling:F13 verifier
// wave 9, red before the alias fallback existed).
for (const supplierKey of ['supplier_name', 'vendor', 'vendor_name']) {
  const row = subject.resolveUnifiedStockImportRows([
    { _rowNumber: 2, name: 'Serum', barcode: 'ABC', shop: '1', date: '08/27/2026', action: 'add', cost_price: '2', [supplierKey]: 'Acme' },
  ], 'direct', products, branches, current)[0]
  assert.strictEqual(row.supplier, 'Acme', `a "${supplierKey}" header column must be read the same as supplier`)
}

// Same gap on the cost column: the client accepts "Cost Price Usd" / "Cost" /
// "Unit Cost"; the Worker read only `cost_price`. This one also corrupts the
// WRITE, not just the gate, since a missed alias leaves sheetCostPriceUsd
// null and costPriceUsd silently inherits the matched product's catalog
// cost -- a receipt cost the operator never typed.
for (const costKey of ['cost_price_usd', 'cost', 'unit_cost']) {
  const row = subject.resolveUnifiedStockImportRows([
    { _rowNumber: 2, name: 'Serum', barcode: 'ABC', shop: '1', date: '08/27/2026', action: 'add', supplier: 'Acme', [costKey]: '2.5' },
  ], 'direct', products, branches, current)[0]
  assert.strictEqual(row.sheetCostPriceUsd, 2.5, `a "${costKey}" header column must be read the same as cost_price`)
}

// ---- ROOT CAUSE: table-driven parity against the client's own alias table
// (sibling:F13 verifier wave 9, item 3) -- extract HEADER_ALIASES straight
// from unifiedStockImport.ts's source and assert every spelling it lists has
// a reader in subject.COLUMN_ALIASES, so a spelling added to one table
// without the other goes red HERE instead of shipping as a client-blessed,
// server-refused sheet. Before COLUMN_ALIASES existed, only free_goods had
// any fallback reader at all -- this loop would have failed for every other
// column.
{
  const frontendSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'products', 'import', 'unifiedStockImport.ts'),
    'utf8',
  )
  const tableMatch = frontendSrc.match(/const HEADER_ALIASES:[^{]*=\s*\{([\s\S]*?)\n\}/)
  assert.ok(tableMatch, 'unifiedStockImport.ts must still define HEADER_ALIASES in the expected shape')
  const clientAliases = {}
  const entryRe = /(\w+):\s*\[([^\]]*)\]/g
  let entryMatch
  while ((entryMatch = entryRe.exec(tableMatch[1]))) {
    clientAliases[entryMatch[1]] = entryMatch[2]
      .split(',')
      .map((piece) => piece.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
  }
  const fields = Object.keys(clientAliases)
  assert.ok(fields.length >= 12, `expected to extract every unified-stock column's alias list, got: ${fields.join(', ')}`)
  for (const field of fields) {
    assert.ok(subject.COLUMN_ALIASES[field], `stockActionImport.ts's COLUMN_ALIASES has no entry for '${field}' -- the Worker cannot read any of its header spellings`)
    const serverSet = new Set(subject.COLUMN_ALIASES[field].map((word) => word.toLowerCase()))
    for (const alias of clientAliases[field]) {
      assert.ok(serverSet.has(alias.toLowerCase()),
        `client alias '${alias}' for column '${field}' has no Worker-side reader -- a sheet the client accepts is refused server-side`)
    }
  }
  console.log(`PASS every client header alias (${fields.length} columns) has a matching Worker-side reader`)
}

// Behavioral spot-check: one row spelled entirely in non-canonical alias
// headers must resolve every field through the shared table, not just be
// listed in it.
{
  const aliasRow = {
    _rowNumber: 2,
    product_name: 'Aliased Serum', upc: 'ALI1', shop_quantity: '2', warehouse_quantity: '0',
    transaction_date: '08/27/2026', stock_action: 'add',
    price_usd: '9', wholesale_price_usd: '7', unit_cost: '4',
    lot_code: 'LOT-A', vendor_name: 'Acme', free_item: 'yes',
  }
  const resolved = subject.resolveUnifiedStockImportRows(
    [aliasRow], 'direct', [], [{ id: 1, name: 'Shop' }, { id: 2, name: 'Warehouse' }], [],
  )[0]
  assert.strictEqual(resolved.productName, 'Aliased Serum', 'name alias product_name')
  assert.strictEqual(resolved.barcode, 'ALI1', 'barcode alias upc')
  assert.strictEqual(resolved.branchRefs.find((branch) => branch.slot === 'shop')?.value, 2, 'shop alias shop_quantity')
  assert.strictEqual(resolved.date, '2026-08-27', 'date alias transaction_date')
  assert.strictEqual(resolved.plan?.kind, 'create', 'action alias stock_action still resolves a new-product row to create')
  assert.strictEqual(resolved.sellingPriceUsd, 9, 'selling_price alias price_usd')
  assert.strictEqual(resolved.wholesalePriceUsd, 7, 'wholesale_price alias wholesale_price_usd')
  assert.strictEqual(resolved.sheetCostPriceUsd, 4, 'cost_price alias unit_cost')
  assert.strictEqual(resolved.batchLabel, 'LOT-A', 'batch alias lot_code')
  assert.strictEqual(resolved.supplier, 'Acme', 'supplier alias vendor_name')
  assert.strictEqual(resolved.freeGoods, true, 'free_goods alias free_item')
  console.log('PASS one row spelled entirely in alias headers resolves every field through COLUMN_ALIASES')
}

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

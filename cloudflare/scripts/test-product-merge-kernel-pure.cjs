const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function load(rel) {
  const fileName = path.join(__dirname, '..', 'src', rel)
  const { outputText } = ts.transpileModule(fs.readFileSync(fileName, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName,
  })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', outputText)(mod, mod.exports, require)
  return mod.exports
}

const { resolveProductMergeEconomics, parseMergeMoney, productMergeCaseKey, productMergeCasAssertion } = load('lib/productMerge.ts')

assert.equal(productMergeCaseKey(3, 9), '3:9')
assert.throws(() => productMergeCaseKey(3, 3), /two different positive integer ids/)

const cost = (values) => resolveProductMergeEconomics(values.map((value, index) => ({ id: index + 1, cost_price_usd: value })))
assert.equal(cost([4, 5]).merged.cost_price_usd, 4.5)
assert.equal(cost([4, 4, 4, 5]).merged.cost_price_usd, 4.5, 'DISTINCT happens before mean')
assert.equal(cost([4, 5, 6]).merged.cost_price_usd, 5, 'whole-cluster mean is not pairwise 5.25')
assert.equal(cost([0, 0]).merged.cost_price_usd, 0)
assert.equal(cost([0, 4, 4]).merged.cost_price_usd, 4, 'zero is excluded when a recorded non-zero cost exists')
assert.equal(cost([' 4.00001 ', '5.00002']).merged.cost_price_usd, 4.5, 'round once after the mean')
assert.equal(cost([1.23454, 1.23455]).merged.cost_price_usd, 1.2345)
assert.deepEqual(parseMergeMoney(''), { kind: 'missing' })
assert.equal(cost(['12oops']).issues[0].code, 'malformed')
assert.equal(cost([-2]).issues[0].code, 'negative')
assert.equal(cost([Infinity]).issues[0].code, 'malformed')

const prices = resolveProductMergeEconomics([
  { id: 1, selling_price_usd: 12, selling_price_khr: 50000, wholesale_price_usd: 9 },
  { id: 2, selling_price_usd: 15, selling_price_khr: 48000, wholesale_price_usd: 7 },
])
assert.equal(prices.merged.selling_price_usd, 15)
assert.equal(prices.merged.selling_price_khr, 50000)
assert.equal(prices.merged.wholesale_price_usd, 9)

const guard = productMergeCasAssertion([
  { id: 1, name: 'A', barcode: '0123', is_active: 1, updated_at: 'u1' },
  { id: 2, name: 'A', barcode: '123', is_active: 1, updated_at: 'u2' },
])
assert.match(guard.sql, /json_extract\('', '\$'\)/)
assert.equal(guard.params.aUpdated, 'u1')
assert.equal(guard.params.bBarcode, '123')

const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.ts'), 'utf8')
assert.match(route, /code: 'incompatible_product_identity'/)
assert.match(route, /buildAtomicMergeHistoryStatements/)
assert.match(route, /MAX_MERGES_PER_REQUEST = 25/)
assert.match(route, /const economics = resolveProductMergeEconomics\(moneyRows\)/)

const undo = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'undoAppliers.ts'), 'utf8')
assert.match(undo, /fingerprintPending: true/)
assert.match(undo, /INSERT INTO undo_snapshots[\s\S]*INSERT INTO action_history[\s\S]*INSERT INTO audit_logs/)
assert.match(undo, /adjustmentMovementMarker/)

console.log('test-product-merge-kernel-pure: all checks passed')

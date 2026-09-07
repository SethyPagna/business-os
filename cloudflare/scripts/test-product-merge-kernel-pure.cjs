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

const {
  createProductMergeClusterPlan,
  parseMergeMoney,
  parseProductMergeClusterPlan,
  productMergeCaseKey,
  productMergeCasAssertion,
  productMergePlanKeeperMatches,
  productMergePlanSourceMemberMatches,
  resolveProductMergeClusterPlanEconomics,
  resolveProductMergeEconomics,
} = load('lib/productMerge.ts')

assert.equal(productMergeCaseKey(3, 9), '3:9')
assert.throws(() => productMergeCaseKey(3, 3), /two different positive integer ids/)

const cost = (values) => resolveProductMergeEconomics(values.map((value, index) => ({ id: index + 1, cost_price_usd: value })))
assert.equal(cost([4, 5]).merged.cost_price_usd, 4.5)
assert.equal(cost([4, 4, 4, 5]).merged.cost_price_usd, 4.5, 'DISTINCT happens before mean')
assert.equal(cost([4, 5, 6]).merged.cost_price_usd, 5, 'whole-cluster mean is not pairwise 5.25')
assert.equal(cost([0, 0]).merged.cost_price_usd, 0)
assert.equal(cost([0, 4, 4]).merged.cost_price_usd, 4, 'zero is excluded when a recorded non-zero cost exists')
assert.equal(cost([' 4.00001 ', '5.00002']).merged.cost_price_usd, 4.5001, 'round up once after the mean')
assert.equal(cost([1.23454, 1.23455]).merged.cost_price_usd, 1.2346)
assert.equal(cost([130.6595, 130.6596]).merged.cost_price_usd, 130.6596, 'owner rounding rule never rounds a mean down')
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

const plannedRows = [
  { id: 1, updated_at: 'u1', cost_price_usd: 4, cost_price_khr: 4000 },
  { id: 2, updated_at: 'u2', cost_price_usd: 5, cost_price_khr: 5000 },
  { id: 3, updated_at: 'u3', cost_price_usd: 6, cost_price_khr: 6000 },
]
const clusterPlan = createProductMergeClusterPlan('["tea","123"]', 1, plannedRows)
assert.deepEqual(parseProductMergeClusterPlan(JSON.parse(JSON.stringify(clusterPlan))), clusterPlan)
assert.equal(resolveProductMergeClusterPlanEconomics(clusterPlan).merged.cost_price_usd, 5)
const retryKeeper = { id: 1, updated_at: 'after-first-fold', cost_price_usd: 5, cost_price_khr: 5000 }
assert.equal(productMergePlanKeeperMatches(clusterPlan, retryKeeper), true)
assert.equal(productMergePlanSourceMemberMatches(clusterPlan, plannedRows[2]), true)
assert.equal(resolveProductMergeEconomics([retryKeeper, plannedRows[2]]).merged.cost_price_usd, 5.5, 'a fresh pairwise retry would drift')
assert.equal(resolveProductMergeClusterPlanEconomics(clusterPlan).merged.cost_price_usd, 5, 'the durable source plan preserves the original whole-cluster mean')
assert.equal(productMergePlanSourceMemberMatches(clusterPlan, { ...plannedRows[2], cost_price_usd: 7 }), false, 'a changed remaining member quarantines the plan')

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
assert.match(route, /MERGE_DUPLICATES_MAX_PRODUCTS_PER_REQUEST = 25/)
assert.match(route, /MERGE_DUPLICATES_MAX_DUPLICATES_PER_CLUSTER = 2/)
assert.match(route, /MERGE_DUPLICATES_REQUEST_BUDGET_MS = 20_000/)
assert.match(route, /MERGE_DUPLICATES_REQUEST_STATEMENT_BUDGET = 700/)
assert.match(route, /readProductMergeCaseSnapshot\(db, canonicalId, dup\.id, MERGE_REPARENT_TABLES\)/)
assert.match(route, /readProductMergeDependentLotSnapshots\(db, snapshot, stockDisposition\)/)
assert.match(route, /readAppliedBulkClusterPlan/)
assert.match(route, /resolveProductMergeClusterPlanEconomics\(clusterPlan\)/)
assert.match(route, /resumedCluster: Boolean\(persistedPlan\)/)

const undo = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'undoAppliers.ts'), 'utf8')
assert.match(undo, /fingerprintPending: true/)
assert.match(undo, /INSERT INTO undo_snapshots[\s\S]*INSERT INTO action_history[\s\S]*INSERT INTO audit_logs/)
assert.match(undo, /adjustmentMovementMarker/)

console.log('test-product-merge-kernel-pure: all checks passed')

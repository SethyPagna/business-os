const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const cache = new Map()
function load(relative) {
  const file = path.resolve(__dirname, '../src', relative)
  if (cache.has(file)) return cache.get(file)
  const mod = { exports: {} }; cache.set(file, mod.exports)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const localRequire = (name) => name.startsWith('.')
    ? load(path.relative(path.resolve(__dirname, '../src'), path.resolve(path.dirname(file), name + '.ts')))
    : require(name)
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  cache.set(file, mod.exports); return mod.exports
}
const imports = load('lib/importNumbers.ts')
assert.equal(imports.normalizeImportCost4('1.2345'), 1.2345)
assert.equal(imports.normalizeImportCost4('0.00015'), 0.0002)
assert.equal(imports.normalizeImportMoney('1.2345'), 1.24, 'legacy sale-import callers remain unchanged in StageA')
assert.equal(imports.normalizeImportSellingPrice('1.2345'), 1.24)
const { resolveMovementCostSnapshot: snapshot } = load('lib/movementCostSnapshot.ts')
assert.deepEqual(snapshot({ quantity: 1e-10, fallbackUnitCostUsd: 12345678 }), {
  unitCostUsd: 12345678, totalCostUsd: .0012, unitCostKhr: null, totalCostKhr: null,
}, 'a tiny positive movement is still valued, and unknown currency remains NULL')
assert.deepEqual(snapshot({ quantity: 1, components: [{ quantity: .9999999995, unitCostUsd: 0 }], fallbackUnitCostUsd: 1e11 }), {
  unitCostUsd: 50, totalCostUsd: 50, unitCostKhr: null, totalCostKhr: null,
}, 'every positive decimal remainder is valued exactly even below the old tolerance')
assert.equal(snapshot({ quantity: 1, components: [{ quantity: .9999999995, unitCostUsd: 0 }] }).totalCostUsd, null, 'unpriced tiny remainder keeps currency unknown')
assert.throws(() => snapshot({ quantity: 1, components: [{ quantity: 1.0000000001, unitCostUsd: 0 }] }), /cannot exceed/)
assert.equal(snapshot({ quantity: .3, components: [{ quantity: .1, unitCostUsd: 1 }, { quantity: .2, unitCostUsd: 1 }] }).totalCostUsd, .3, 'exact decimal coverage does not falsely reject binary 0.1+0.2')
assert.equal(snapshot({ quantity: .5, fallbackUnitCostUsd: .0003 }).totalCostUsd, .0002)
assert.equal(snapshot({ quantity: .5, fallbackUnitCostUsd: .0001 }).unitCostUsd, .0001, 'authoritative unit is not back-calculated from rounded total')
assert.equal(snapshot({ quantity: .5, fallbackUnitCostUsd: .0001 }).totalCostUsd, .0001)
assert.equal(snapshot({ quantity: .5, fallbackUnitCostUsd: 1.234567 }).unitCostUsd, 1.234567, 'captured historical unit is not silently rewritten')
const weighted = snapshot({ quantity: .5, components: [{ quantity: .25, unitCostUsd: .0001 }, { quantity: .25, unitCostUsd: .0003 }] })
assert.equal(weighted.unitCostUsd, .0002, 'weighted mean derives from raw numerator')
assert.equal(weighted.totalCostUsd, .0001)
assert.equal(snapshot({ quantity: 1, components: [
  { quantity: .5, unitCostUsd: .0001 }, { quantity: .5, unitCostUsd: .0001 },
] }).totalCostUsd, .0001, 'one movement allocation rounds once, not each lot')
assert.deepEqual(snapshot({ quantity: 3, fallbackUnitCostUsd: 0 }), {
  unitCostUsd: 0, totalCostUsd: 0, unitCostKhr: null, totalCostKhr: null,
})
assert.equal(snapshot({ quantity: 3, fallbackUnitCostUsd: .3333 }).totalCostUsd, .9999)
assert.throws(() => snapshot({ quantity: 2, fallbackUnitCostUsd: 1e11 }), RangeError)
assert.throws(() => snapshot({ quantity: 1, components: [{ quantity: 2, unitCostUsd: 1 }] }), RangeError)
const merge = load('lib/productMerge.ts')
const rows = [1, 1.0001, 1.0003].map((cost, i) => ({ id: i + 1, updated_at: null, cost_price_usd: cost }))
const v2 = merge.createProductMergeClusterPlan('same', 1, rows)
assert.equal(v2.version, 2)
assert.equal(merge.resolveProductMergeClusterPlanEconomics(v2).merged.cost_price_usd, 1.0001)
// Golden historical wire shape: construct it independently of the new plan writer.
const v1 = JSON.parse(JSON.stringify(v2)); v1.version = 1
const parsed = merge.parseProductMergeClusterPlan(v1)
assert.deepEqual(parsed, v1)
assert.equal(merge.resolveProductMergeClusterPlanEconomics(parsed).merged.cost_price_usd, 1.0002)
assert.equal(merge.productMergePlanKeeperMatches(parsed, { id: 1, cost_price_usd: 1.0002 }), true)
assert.equal(merge.productMergePlanKeeperMatches(parsed, { id: 1, cost_price_usd: 1.0001 }), false)
assert.equal(merge.parseProductMergeClusterPlan({ ...v1, version: 3 }), null)
assert.equal(merge.parseProductMergeClusterPlan({ ...v1, memberIds: [1, 2, 4] }), null)
assert.equal(merge.productMergePlanSourceMemberMatches(v1, { ...rows[2], cost_price_usd: 1.0004 }), false)
console.log('test-money-precision-cost-writers: PASS actual import, weighted movement, NULL/zero, overflow, v1 golden and v2 plan/replay guards')

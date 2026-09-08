const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

function loadTs(file, stubs = {}) {
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
  })
  const original = Module._load
  Module._load = (request, parent, main) => Object.prototype.hasOwnProperty.call(stubs, request)
    ? stubs[request] : original.call(Module, request, parent, main)
  const mod = { exports: {} }
  try { new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod) }
  finally { Module._load = original }
  return mod.exports
}

const lib = path.join(__dirname, '..', 'src', 'lib')
const detail = loadTs(path.join(lib, 'productDetailRule.ts'))
const merge = loadTs(path.join(lib, 'productMerge.ts'))
const identity = loadTs(path.join(lib, 'productIdentity.ts'), { './db': {}, './sqlBinding': {}, './productDetailRule': detail })
const selected = loadTs(path.join(lib, 'productConflictMergeBatch.ts'), {
  './productIdentity': identity, './productDetailRule': detail, './productMerge': merge,
})
const groups = loadTs(path.join(lib, 'productConflictActionGroups.ts'), {
  './productIdentity': identity, './productDetailRule': detail, './productMerge': merge,
  './productConflictMergeBatch': selected,
})

const request = (overrides = {}) => ({
  manifest_version: 1, resolution_version: 2, client_request_id: 'review_group_001',
  merge_groups: [{ group_key: 'barcode:601', member_ids: [3, 1, 2] }], remove_rows: [], ...overrides,
})
assert.deepEqual(groups.parseProductConflictActionPreviewRequest(request()).merge_groups[0].member_ids, [1, 2, 3])
for (const bad of [
  { ...request(), extra: true }, request({ merge_groups: [] }), request({ client_request_id: 'short' }),
  request({ remove_rows: [{ product_id: 1 }] }),
  request({ merge_groups: [{ group_key: 'x', member_ids: [1] }] }),
  request({ merge_groups: [{ group_key: 'x', member_ids: [1, 1] }] }),
]) assert.throws(() => groups.parseProductConflictActionPreviewRequest(bad), /./)
assert.throws(() => groups.parseProductConflictActionPreviewRequest(request({
  merge_groups: [{ group_key: `${'😀'.repeat(61)}`, member_ids: [1, 2] }],
})), /bounded string/, 'group_key length is enforced in UTF-8 bytes')
assert.throws(() => groups.parseProductConflictActionPreviewRequest(request({
  merge_groups: Array.from({ length: 1600 }, (_, index) => ({
    group_key: `${String(index).padStart(4, '0')}-${'k'.repeat(165)}`, member_ids: [1, 2],
  })),
})), /combined group_key payload/, 'collapsed source keys have a bounded total UTF-8 size')
assert.deepEqual(groups.parseProductConflictActionPreviewRequest(request({ merge_groups: [],
  remove_rows: [{ product_id: 9, reason: '  Independent duplicate  ' }] })).remove_rows,
[{ product_id: 9, reason: 'Independent duplicate' }])
for (const bad of [
  request({ remove_rows: [{ product_id: 1, reason: 'overlap' }] }),
  request({ merge_groups: [], remove_rows: [{ product_id: 9, reason: 'one' }, { product_id: 9, reason: 'two' }] }),
  request({ merge_groups: [], remove_rows: [{ product_id: 9, reason: ' ' }] }),
]) assert.throws(() => groups.parseProductConflictActionPreviewRequest(bad), /./)
try { groups.parseProductConflictActionPreviewRequest(request({ remove_rows: [{ product_id: 1, reason: 'overlap' }] })) }
catch (error) { assert.equal(error.code, 'overlapping_actions'); assert.equal(error.status, 400) }

const row = (id, name, barcode, cost, rest = {}) => ({
  id, name, barcode, category: null, brand: null, unit: 'pcs', image_path: null,
  is_active: 1, is_group: 0, updated_at: `u${id}`,
  cost_price_usd: cost, cost_price_khr: 0, selling_price_usd: id + 10, selling_price_khr: id + 100,
  wholesale_price_usd: id + 5, wholesale_price_khr: id + 50, ...rest,
})
const productRows = [
  row(1, 'Milk', '0601', 0, { category: 'Dairy', brand: 'A', unit: 'box' }),
  row(2, 'Other', '601', 4, { category: 'Drinks', brand: 'B', unit: 'pcs' }),
  row(3, 'Third', '000601', 4, { category: null, brand: 'B', unit: 'pcs' }),
  row(4, 'Fourth', '601', 6),
]
let plan = groups.buildProductConflictActionGroupPlans(
  [{ group_key: 'barcode:601', member_ids: [1, 2, 3, 4] }], productRows,
  [{ product_id: 1, branch_id: 1, branch_name: 'Shop', quantity: 2 }, { product_id: 2, branch_id: 1, branch_name: 'Shop', quantity: 3 }],
  [{ product_id: 1, batch_id: 10, batch_key: 'lot-a', supplier_name: 'Supplier A', received_at: '2026-09-01', branch_id: 1, quantity: 2 },
    { product_id: 2, batch_id: 11, batch_key: 'lot-b', supplier_name: 'Supplier B', received_at: '2026-09-02', branch_id: 1, quantity: 3 }],
)[0]
assert.equal(plan.blocked, null)
assert.equal(plan.eligibility_basis, 'barcode')
assert.equal(plan.eligibility_value, '601')
assert.equal(plan.economics.merged.cost_price_usd, 5, 'distinct positive original-group costs [4,4,6] average once')
assert.deepEqual(plan.economics.distinctCosts.cost_price_usd, [4, 6])
assert.equal(plan.economics.merged.selling_price_usd, 14)
assert.deepEqual(plan.stock.projected_by_branch, [{ branch_id: 1, branch_name: 'Shop', quantity: 5 }])
assert.equal(plan.lots.projected_quantity, 5)
assert.deepEqual(plan.lots.rows.map((item) => item.supplier_name), ['Supplier A', 'Supplier B'])
assert.deepEqual(plan.options.category_source_ids, [1, 2, 3])

plan = groups.buildProductConflictActionGroupPlans(
  [{ group_key: 'name:tea', member_ids: [10, 11, 12] }],
  [row(10, ' Tea ', 'a', 0), row(11, 'tea', 'b', 0), row(12, 'TEA', '', 0)], [], [],
)[0]
assert.equal(plan.eligibility_basis, 'name')
assert.equal(plan.economics.merged.cost_price_usd, 0)

const canonical = groups.canonicalizeProductConflictActionGroups([
  { group_key: 'b', member_ids: [2, 1] }, { group_key: 'a', member_ids: [1, 2] },
])
assert.deepEqual(canonical, [{ group_key: 'a', source_group_keys: ['a', 'b'], member_ids: [1, 2], overlapping: false }])

plan = groups.buildProductConflictActionGroupPlans(
  [{ group_key: 'g1', member_ids: [20, 21] }, { group_key: 'g2', member_ids: [21, 22] }],
  [row(20, 'Same', 'a', 1), row(21, 'Same', 'z', 2), row(22, 'Different', 'z', 3)], [], [],
)[0]
assert.equal(plan.blocked.code, 'overlap_requires_selection', 'pairwise/transitive identity cannot invent a group')

plan = groups.buildProductConflictActionGroupPlans(
  [{ group_key: 'g1', member_ids: [30, 31] }, { group_key: 'g2', member_ids: [31, 32] }],
  [row(30, 'Same', 'a', 1), row(31, 'Same', 'b', 2), row(32, 'Same', 'c', 3)], [], [],
)[0]
assert.equal(plan.blocked, null)
assert.deepEqual(plan.member_ids, [30, 31, 32])
assert.equal(plan.eligibility_basis, 'name')

plan = groups.buildProductConflictActionGroupPlans(
  [{ group_key: 'bad', member_ids: [40, 41] }], [row(40, 'Bad', 'x', -1), row(41, 'Bad', 'y', 2)], [], [],
)[0]
assert.equal(plan.blocked.code, 'invalid_merge_numeric')

plan = groups.buildProductConflictActionGroupPlans(
  [{ group_key: 'blank-name', member_ids: [50, 51, 52] }],
  [row(50, 'Tea', 'a', 1), row(51, 'tea', 'b', 2), row(52, '', 'c', 3)], [], [],
)[0]
assert.equal(plan.blocked.code, 'incompatible_group_identity', 'every member needs the common nonempty name')

plan = groups.buildProductConflictActionGroupPlans(
  [{ group_key: 'blank-barcode', member_ids: [60, 61, 62] }],
  [row(60, 'One', '601', 1), row(61, 'Two', '0601', 2), row(62, 'Three', '', 3)], [], [],
)[0]
assert.equal(plan.blocked.code, 'incompatible_group_identity', 'every member needs the common nonempty barcode')

console.log('product conflict action groups pure: 28 checks passed')

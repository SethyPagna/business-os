const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

function loadTs(file, stubs = {}) {
  const source = fs.readFileSync(file, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  })
  const original = Module._load
  Module._load = (request, parent, main) => Object.prototype.hasOwnProperty.call(stubs, request)
    ? stubs[request]
    : original.call(Module, request, parent, main)
  const mod = { exports: {} }
  try { new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod) }
  finally { Module._load = original }
  return mod.exports
}

const lib = path.join(__dirname, '..', 'src', 'lib')
const detail = loadTs(path.join(lib, 'productDetailRule.ts'))
const merge = loadTs(path.join(lib, 'productMerge.ts'))
const identity = loadTs(path.join(lib, 'productIdentity.ts'), {
  './db': {}, './sqlBinding': {}, './productDetailRule': detail,
})
const selected = loadTs(path.join(lib, 'productConflictMergeBatch.ts'), {
  './productIdentity': identity, './productDetailRule': detail, './productMerge': merge,
})

const preview = (overrides = {}) => ({
  cases: [{ case_key: 'barcode:1234', cluster_type: 'barcode', cluster_value: '1234', product_ids: [1, 2] }],
  ...overrides,
})
const apply = (overrides = {}) => ({
  client_request_id: 'selected_merge_001', manifest_version: 1, manifest_digest: `sha256-${'a'.repeat(64)}`,
  cases: [{ ordinal: 0, case_key: 'barcode:1234', keep_id: 1, merge_id: 2, state_digest: `sha256-${'b'.repeat(64)}`, stock: null }],
  ...overrides,
})

assert.deepEqual(selected.parseProductConflictPreviewRequest(preview()).cases[0].product_ids, [1, 2])
for (const bad of [
  { ...preview(), extra: true },
  preview({ cases: [] }),
  preview({ cases: [{ ...preview().cases[0], cluster_value: true }] }),
  preview({ cases: [{ ...preview().cases[0], product_ids: [1, Number.MAX_SAFE_INTEGER + 1] }] }),
  preview({ cases: [{ ...preview().cases[0], product_ids: [1, true] }] }),
  preview({ cases: [{ ...preview().cases[0], product_ids: [1, 1] }] }),
  preview({ cases: [{ ...preview().cases[0], case_key: 'barcode:wrong' }] }),
  preview({ cases: [preview().cases[0], { ...preview().cases[0], case_key: 'name:tea', cluster_type: 'name', cluster_value: 'Tea', product_ids: [2, 3] }] }),
]) assert.throws(() => selected.parseProductConflictPreviewRequest(bad), /./)

assert.equal(selected.parseProductConflictApplyRequest(apply()).cases[0].stock, null)
for (const bad of [
  apply({ client_request_id: 'short' }),
  apply({ manifest_version: 2 }),
  apply({ manifest_digest: 'bad' }),
  apply({ cases: [{ ...apply().cases[0], ordinal: 1 }] }),
  apply({ cases: [{ ...apply().cases[0], stock: true }] }),
  apply({ cases: [{ ...apply().cases[0], extra: 1 }] }),
]) assert.throws(() => selected.parseProductConflictApplyRequest(bad), /./)

const row = (id, barcode, stock = 0, rest = {}) => ({
  id, name: ' Tea  Cream ', barcode, is_active: 1, is_group: 0, stock_quantity: stock,
  cost_price_usd: 4, cost_price_khr: 16000, ...rest,
})
let result = selected.chooseProductConflictMergePair([row(9, '001234', 99), row(10, '01234', 1)])
assert.equal(result.eligible, true)
assert.equal(result.keeper.id, 10, 'the cleaner leading-zero barcode wins before stock')
result = selected.chooseProductConflictMergePair([row(9, '1234', 2), row(10, '1234', 9)])
assert.equal(result.keeper.id, 10, 'stock wins for identical raw barcodes')
result = selected.chooseProductConflictMergePair([row(9, '1234', 2), row(10, '1234', 2)])
assert.equal(result.keeper.id, 9, 'id is the final deterministic tie-break')

for (const [rows, code] of [
  [[row(1, '1234')], 'not_exact_pair'],
  [[row(1, '1234'), row(2, '1234'), row(3, '1234')], 'not_exact_pair'],
  [[row(1, '1234'), row(2, '1234', 0, { is_active: 0 })], 'not_exact_pair'],
  [[row(1, '1234'), row(2, '1234', 0, { is_group: 1 })], 'not_exact_pair'],
  [[row(1, '1234', 0, { name: '  ' }), row(2, '1234', 0, { name: '' })], 'incompatible_product_identity'],
  [[row(1, '1234'), row(2, '1234', 0, { name: 'Other' })], 'incompatible_product_identity'],
  [[row(1, '1234'), row(2, '5678')], 'incompatible_product_identity'],
  [[row(1, '1234'), row(2, '1234', 0, { cost_price_usd: 400 })], 'cost_outlier_review'],
  [[row(1, '1234'), row(2, '1234', 0, { selling_price_usd: -1 })], 'invalid_merge_numeric'],
]) {
  const refusal = selected.chooseProductConflictMergePair(rows)
  assert.equal(refusal.eligible, false)
  assert.equal(refusal.code, code)
}

async function main() {
  const a = await selected.productConflictSha256({ z: 1, a: [{ b: 2, a: 1 }] })
  const b = await selected.productConflictSha256({ a: [{ a: 1, b: 2 }], z: 1 })
  const c = await selected.productConflictSha256({ a: [{ a: 1, b: 3 }], z: 1 })
  assert.equal(a, b, 'object key order is canonical')
  assert.notEqual(a, c, 'request data changes the digest')
  assert.match(a, /^sha256-[a-f0-9]{64}$/)
  const requestA = await selected.productConflictSha256(apply())
  const requestRetry = await selected.productConflictSha256(JSON.parse(JSON.stringify(apply())))
  const requestReordered = await selected.productConflictSha256({
    ...apply(),
    cases: [
      { ...apply().cases[0], ordinal: 0, case_key: 'barcode:5678', keep_id: 3, merge_id: 4 },
      { ...apply().cases[0], ordinal: 1 },
    ],
  })
  const requestChoice = await selected.productConflictSha256({
    ...apply(), cases: [{ ...apply().cases[0], stock: 'merge' }],
  })
  assert.equal(requestA, requestRetry, 'exact retries keep the request digest')
  assert.notEqual(requestA, requestReordered, 'ordered membership changes the request digest')
  assert.notEqual(requestA, requestChoice, 'stock choice changes the request digest')
  assert.equal(selected.productConflictOperationId('run-1', 3), 'product-conflict:run-1:3')
  console.log('test-product-conflict-merge-batch-pure: all checks passed')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })

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

const base = {
  manifest_version: 1,
  resolution_version: 2,
  review_id: '123e4567-e89b-42d3-a456-426614174000',
  draft_digest: `sha256-${'a'.repeat(64)}`,
  resolutions: [{
    group_key: 'barcode:601', keeper_id: 2,
    barcode: { mode: 'member', source_product_id: 3 },
    category_source_id: 1, brand_source_id: 2, unit_source_id: 3,
  }],
}
assert.deepEqual(groups.parseProductConflictActionFinalizeRequest(base), base)
assert.deepEqual(groups.parseProductConflictActionFinalizeRequest({ ...base, resolutions: [] }).resolutions, [])
assert.deepEqual(groups.parseProductConflictActionFinalizeRequest({
  ...base, resolutions: [{ ...base.resolutions[0], barcode: { mode: 'canonical' } }],
}).resolutions[0].barcode, { mode: 'canonical' })
assert.deepEqual(groups.parseProductConflictActionFinalizeRequest({
  ...base, resolutions: [{ ...base.resolutions[0], barcode: { mode: 'clear' } }],
}).resolutions[0].barcode, { mode: 'clear' })

for (const invalid of [
  { ...base, extra: true },
  { ...base, review_id: 'not-a-review' },
  { ...base, draft_digest: 'sha256-short' },
  { ...base, resolutions: [base.resolutions[0], base.resolutions[0]] },
  { ...base, resolutions: [{ ...base.resolutions[0], keeper_id: 0 }] },
  { ...base, resolutions: [{ ...base.resolutions[0], barcode: { mode: 'member' } }] },
  { ...base, resolutions: [{ ...base.resolutions[0], barcode: { mode: 'clear', source_product_id: 3 } }] },
  { ...base, resolutions: [{ ...base.resolutions[0], barcode: { mode: 'invented' } }] },
]) assert.throws(() => groups.parseProductConflictActionFinalizeRequest(invalid), /./)

const apply = {
  review_id: base.review_id,
  manifest_digest: `sha256-${'b'.repeat(64)}`,
  client_request_id: base.review_id,
}
assert.equal(groups.isProductConflictActionApplyRequest(apply), true)
assert.deepEqual(groups.parseProductConflictActionApplyRequest(apply), apply)
for (const invalid of [
  { ...apply, client_request_id: 'different' },
  { ...apply, manifest_digest: 'sha256-short' },
  { ...apply, extra: true },
]) assert.throws(() => groups.parseProductConflictActionApplyRequest(invalid), /./)

console.log('product conflict action finalize/apply pure: strict contracts passed')

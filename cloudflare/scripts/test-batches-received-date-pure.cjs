const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require(path.join(__dirname, '..', '..', 'frontend', 'node_modules', 'typescript'))

function loadBatchCode() {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'batchCode.ts')
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  }).outputText
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', output)(moduleObj.exports, require, moduleObj)
  return moduleObj.exports
}

const { dateToBatchCode, normalizeTypedDate } = loadBatchCode()
const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'batches.ts'), 'utf8')
const productBatches = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'productBatches.ts'), 'utf8')

assert.equal(normalizeTypedDate('03/09/2026'), '2026-09-03')
assert.equal(dateToBatchCode(normalizeTypedDate('03/09/2026')), '09032026')
assert.equal(normalizeTypedDate('2026-09-03'), '2026-09-03', 'ISO input remains unambiguous')
assert.match(
  route,
  /normalizeTypedDate\(body\.received_at\)/,
  'the operator-facing batch received-date editor must use the shared typed-date parser',
)
assert.doesNotMatch(
  route,
  /if \(body\.received_at !== undefined\) \{[\s\S]{0,300}normalizeToIsoDate\(body\.received_at/,
  'the lineage edit gate must not call the import-oriented parser for typed dates',
)
assert.match(route, /received_at is not a valid date \(use dd\/mm\/yyyy\)/,
  'invalid typed dates must name the accepted day-first order')

console.log('PASS batch received-date edits preserve shared typed day-first lineage')
// The list remains active-lot-only, while its scalar includes every positive
// lot at the exact product/branch. It is intentionally unrelated to money
// visibility and has no received-date payload to fabricate.
assert.match(route, /known_positive_quantity: knownPositiveQuantity/, 'scoped list response must carry the authoritative known-lot scalar')
assert.match(route, /SELECT COALESCE\(SUM\(bbs\.quantity\), 0\) AS quantity/, 'scalar must be calculated in the authoritative database')
const listRoute = route.slice(route.indexOf("app.get('/', async (c) =>"), route.indexOf("app.post('/', async (c) =>"))
assert.match(listRoute, /pb\.variant_product_id = \?/, 'scalar must be scoped to the requested product')
assert.match(listRoute, /bbs\.branch_id = \?/, 'scalar must be scoped to the requested branch')
assert.match(listRoute, /bbs\.quantity > 0/, 'zero known lots must not reduce the remainder')
assert.doesNotMatch(listRoute.slice(listRoute.indexOf('const knownPositive'), listRoute.indexOf('// A reader admitted')), /pb\.is_active/, 'inactive positive lots must still count as known provenance')
console.log('PASS batch list exposes all positive known lot quantity without changing active choices')
const trackedReader = productBatches.slice(productBatches.indexOf('export async function getTrackedProductIds'), productBatches.indexOf('// GET /api/batches?productId='))
assert.match(trackedReader, /bbs\.branch_id = @branchId/, 'tracked ids must stay branch-scoped')
// S1 (owner 14 Nov): tracked means a lot HOLDING stock. An active empty lot no longer counts; an inactive lot with positive stock still does (its provenance must show), so there is no is_active test at all.
assert.match(trackedReader, /bbs\.quantity > 0/, 'only lots holding stock make a product tracked')
assert.doesNotMatch(trackedReader, /pb\.is_active/, 'inactive positive lots count, and active empty lots do not: no is_active test')
assert.doesNotMatch(trackedReader, />= 0/, 'a zero-quantity lot is not stock')
console.log('PASS positive lots (active or not) make a product tracked; empty ones do not')

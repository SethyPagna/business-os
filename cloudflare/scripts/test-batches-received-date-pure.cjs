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

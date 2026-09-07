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

const { dateToBatchCode, normalizeToIsoDate } = loadBatchCode()
const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'batches.ts'), 'utf8')

assert.equal(normalizeToIsoDate('03/09/2026', 'day-first'), '2026-09-03')
assert.equal(dateToBatchCode(normalizeToIsoDate('03/09/2026', 'day-first')), '09032026')
assert.equal(normalizeToIsoDate('2026-09-03', 'day-first'), '2026-09-03', 'ISO input remains unambiguous')
assert.match(
  route,
  /normalizeToIsoDate\(body\.received_at, 'day-first'\)/,
  'the operator-facing batch received-date editor must use explicit day-first parsing',
)
assert.doesNotMatch(
  route,
  /if \(body\.received_at !== undefined\) \{[\s\S]{0,300}normalizeToIsoDate\(body\.received_at\)(?!,)/,
  'the lineage edit gate must not fall back to the parser default for ambiguous dates',
)

console.log('PASS batch received-date edits preserve explicit day-first lineage')

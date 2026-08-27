const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

const file = path.join(__dirname, '..', 'src', 'lib', 'importLifecycleGate.ts')
const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const mod = { exports: {} }
new Function('exports', 'require', 'module', output)(mod.exports, require, mod)
const { canReplaceImportCsv, canEditImportDecisions, retryModeForImportStatus } = mod.exports

assert.strictEqual(canReplaceImportCsv('pending'), true)
assert.strictEqual(canReplaceImportCsv('failed'), true)
for (const status of ['queued', 'analyzing', 'awaiting_review', 'approved', 'applying', 'completed', 'cancelled']) {
  assert.strictEqual(canReplaceImportCsv(status), false, `${status} source must be immutable`)
}

assert.strictEqual(canEditImportDecisions('contacts', 'awaiting_review'), true)
assert.strictEqual(canEditImportDecisions('products', 'awaiting_review'), true)
assert.strictEqual(canEditImportDecisions('stock_actions', 'awaiting_review'), false)
assert.strictEqual(canEditImportDecisions('contacts', 'applying'), false)
assert.strictEqual(canEditImportDecisions('contacts', 'analyzing'), false)

assert.strictEqual(retryModeForImportStatus('awaiting_review'), 'review_required')
assert.strictEqual(retryModeForImportStatus('approved'), 'apply')
for (const status of ['pending', 'failed', 'cancelled', 'completed', 'completed_with_errors']) {
  assert.strictEqual(retryModeForImportStatus(status), 'analyze')
}

console.log('PASS import lifecycle seals reviewed CSV/stock decisions and prevents retry from bypassing approval')


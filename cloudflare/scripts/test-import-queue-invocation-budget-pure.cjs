const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const file = path.join(__dirname, '../src/queue.ts')
const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const runs = []
let failure = null
const run = async (_env, id) => { runs.push(id); if (failure) throw failure }
const stubs = {
  './lib/importMaintenanceFence': {},
  './lib/importEngine': { runImportAnalyze: run, runImportApply: run, isImportApplyAuthorizationError: () => false },
  './lib/bulkDeleteEngine': { runBulkDeleteJob: run },
  './lib/backup': {}, './lib/driveSyncQueue': {}, './lib/imageAudit': {}, './lib/importIncomingFiles': {},
  './lib/queueDispatch': { registerInlineImportRunner() {} },
}
const mod = { exports: {} }
new Function('require', 'exports', 'module', output)(name => {
  assert.ok(Object.hasOwn(stubs, name), `unknown dependency ${name}`)
  return stubs[name]
}, mod.exports, mod)
const message = (id, kind) => ({
  body: { jobId: id, kind }, timestamp: new Date(), attempts: 1, acknowledged: 0, retries: 0,
  ack() { this.acknowledged++ }, retry() { this.retries++ },
})

async function main() {
  for (const kind of ['analyze', 'apply', 'bulk-delete']) {
    runs.length = 0
    const batch = Array.from({ length: 5 }, (_, index) => message(`${kind}-${index}`, kind))
    await mod.exports.handleImportQueue({ messages: batch }, {})
    assert.deepEqual(runs, [`${kind}-0`], 'each runner may use its entire invocation query allowance')
    assert.equal(batch[0].acknowledged, 1)
    assert.equal(batch[0].retries, 0)
    for (const pending of batch.slice(1)) {
      assert.equal(pending.acknowledged, 0, 'never drop an unprocessed message')
      assert.equal(pending.retries, 1)
      await mod.exports.handleImportQueue({ messages: [pending] }, {})
      assert.equal(pending.acknowledged, 1)
    }
    assert.equal(runs.length, 5)
  }
  failure = new Error('synthetic transient failure')
  runs.length = 0
  const failed = [message('failed', 'apply'), message('later', 'apply')]
  const originalError = console.error
  try {
    console.error = () => {}
    await mod.exports.handleImportQueue({ messages: failed }, {})
  } finally { console.error = originalError }
  assert.deepEqual(runs, ['failed'])
  assert.ok(failed.every(item => item.retries === 1 && item.acknowledged === 0))
  console.log('PASS queue delivery isolates each import budget and retries every unprocessed message')
}
main().catch(error => { console.error(error); process.exitCode = 1 })

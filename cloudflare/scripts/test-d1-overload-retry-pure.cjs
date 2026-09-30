// Focused regression coverage for the shared D1 retry adapter. Queue overload
// must fail once so a saturated D1 is not given another identical operation;
// ordinary transient infrastructure errors still receive the established one
// retry, except through batchOnce, which never retries. The real TypeScript
// module is transpiled and executed.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'db.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
}).outputText
const loaded = { exports: {} }
// lib/db.ts re-exports the import maintenance fence; the retry kernel under
// test never reaches it, so the re-export is satisfied with a throwing stand-in.
const requireForDb = (id) => id === './importMaintenanceFence' ? {
  getImportFencedDb: async () => { throw new Error('getImportFencedDb should not be called by this pure test') },
  withImportMaintenanceWriteFence: async () => { throw new Error('withImportMaintenanceWriteFence should not be called by this pure test') },
  isImportMaintenanceFenceError: () => false,
  ImportMaintenanceFenceError: class ImportMaintenanceFenceError extends Error {},
} : require(id)
new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
  loaded.exports, requireForDb, loaded, sourcePath, path.dirname(sourcePath),
)
const { D1Compat } = loaded.exports

// A single-row read. D1Compat.get() has read row 0 of all() since A0 (first()
// returns no meta for the per-request metrics); first() is kept so the fake
// still answers either call the same way, one attempt per call.
function firstDb(failures) {
  let attempts = 0
  const attempt = () => {
    attempts += 1
    const failure = failures.shift()
    if (failure) throw failure
  }
  return {
    get attempts() { return attempts },
    prepare() {
      return {
        bind() {
          return {
            async first() { attempt(); return { ok: true } },
            async all() { attempt(); return { results: [{ ok: true }], meta: {} } },
            async run() { attempt(); return { meta: { changes: 1 } } },
          }
        },
      }
    },
  }
}

function batchDb(failures) {
  let attempts = 0
  return {
    get attempts() { return attempts },
    prepare(sql) { return { sql, bind() { return this } } },
    async batch() {
      attempts += 1
      const failure = failures.shift()
      if (failure) throw failure
      return [{ success: true }]
    },
  }
}

async function main() {
  const quotaMessages = [
    "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.",
    "D1_ERROR: Your account has exceeded D1's free tier daily row write limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.",
    "D1_ERROR: Your account has exceeded D1's maximum account storage limit, please contact Cloudflare to raise your limit",
    'D1_ERROR: Exceeded maximum DB size.',
  ]
  for (const message of quotaMessages) {
    for (const method of ['get', 'all', 'run', 'batch', 'batchOnce']) {
      const failure = new Error(message)
      const raw = method.startsWith('batch') ? batchDb([failure]) : firstDb([failure])
      const db = new D1Compat(raw)
      const invoke = method.startsWith('batch')
        ? () => db[method]([{ sql: 'UPDATE t SET value = 1' }])
        : () => db.prepare(method === 'run' ? 'UPDATE t SET value = 1' : 'SELECT 1')[method]()
      const originalSetTimeout = globalThis.setTimeout
      const delays = []
      globalThis.setTimeout = (callback, delay, ...args) => {
        delays.push(delay)
        return originalSetTimeout(callback, delay, ...args)
      }
      try {
        await assert.rejects(invoke, (error) => error === failure, `${method} must preserve the quota error`)
      } finally {
        globalThis.setTimeout = originalSetTimeout
      }
      assert.deepEqual(delays, [], `${method} quota refusal must not schedule backoff`)
      assert.equal(raw.attempts, 1, `${method} quota refusal must not retry: ${message}`)
    }
  }
  console.log('PASS documented daily and storage quotas fail after one attempt across reads and writes')

  for (const message of [
    'D1_ERROR: D1 DB is overloaded. Requests queued for too long.',
    'D1 DB is overloaded',
  ]) {
    const raw = firstDb([new Error(message)])
    const db = new D1Compat(raw)
    await assert.rejects(() => db.prepare('SELECT 1').get(), /overloaded/i)
    assert.equal(raw.attempts, 1, `queue overload must not retry: ${message}`)
  }
  console.log('PASS queue-overload reads fail after one D1 attempt')

  const transient = firstDb([new Error('D1_ERROR: internal error')])
  const transientResult = await new D1Compat(transient).prepare('SELECT 1').get()
  assert.deepEqual(transientResult, { ok: true })
  assert.equal(transient.attempts, 2, 'an ordinary transient D1 error keeps the one retry')
  console.log('PASS ordinary transient reads still retry once')

  const storageReset = firstDb([new Error('D1_ERROR: Internal error in D1 DB storage caused object to be reset.')])
  assert.deepEqual(await new D1Compat(storageReset).prepare('SELECT 1').get(), { ok: true })
  assert.equal(storageReset.attempts, 2, 'a transient storage reset is not a storage quota')
  console.log('PASS transient storage resets still retry once')

  const overloadedBatch = batchDb([new Error('D1_ERROR: Requests queued for too long')])
  await assert.rejects(
    () => new D1Compat(overloadedBatch).batch([{ sql: 'UPDATE t SET value = 1' }]),
    /queued for too long/i,
  )
  assert.equal(overloadedBatch.attempts, 1, 'the shared batch path must also skip an overload retry')
  console.log('PASS queue-overload batches fail after one D1 attempt')

  // batchOnce is the explicit single-attempt write: a rejected batch may have
  // committed with its acknowledgement lost, so even the transient error that
  // batch() retries must reach the caller after one attempt.
  const retriedBatch = batchDb([new Error('D1_ERROR: internal error')])
  await new D1Compat(retriedBatch).batch([{ sql: 'UPDATE t SET value = 1' }])
  assert.equal(retriedBatch.attempts, 2, 'batch() keeps the one retry on a transient error')
  const onceBatch = batchDb([new Error('D1_ERROR: internal error')])
  await assert.rejects(
    () => new D1Compat(onceBatch).batchOnce([{ sql: 'UPDATE t SET value = 1' }]),
    /internal error/,
  )
  assert.equal(onceBatch.attempts, 1, 'batchOnce must not retry, not even a transient error')
  console.log('PASS batchOnce makes one attempt on an error batch() retries')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

// Focused regression coverage for the shared D1 retry adapter. Queue overload
// must fail once so a saturated D1 is not given another identical operation;
// ordinary transient infrastructure errors still receive the established one
// retry. The real TypeScript module is transpiled and executed.

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
new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
  loaded.exports, require, loaded, sourcePath, path.dirname(sourcePath),
)
const { D1Compat } = loaded.exports

function firstDb(failures) {
  let attempts = 0
  return {
    get attempts() { return attempts },
    prepare() {
      return {
        bind() {
          return {
            async first() {
              attempts += 1
              const failure = failures.shift()
              if (failure) throw failure
              return { ok: true }
            },
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

  const overloadedBatch = batchDb([new Error('D1_ERROR: Requests queued for too long')])
  await assert.rejects(
    () => new D1Compat(overloadedBatch).batch([{ sql: 'UPDATE t SET value = 1' }]),
    /queued for too long/i,
  )
  assert.equal(overloadedBatch.attempts, 1, 'the shared batch path must also skip an overload retry')
  console.log('PASS queue-overload batches fail after one D1 attempt')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

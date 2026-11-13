// The scheduled Drive step of the rotation, driven branch by branch (lib/driveSyncCron.ts with injected collaborators), plus
// a MUTANT without its "nothing new: skip" return, which must be caught by behaviour, not by reading the source.
// Run (from cloudflare/): node scripts/test-drive-sync-cron-step-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

const file = path.join(__dirname, '..', 'src', 'lib', 'driveSyncCron.ts')
const original = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
function load(source) {
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const mod = { exports: {} }
  new Function('exports', 'module', outputText)(mod.exports, mod)
  return mod.exports
}

function harness({ due = true, fresh = { new: true, backupKey: 'k' }, authority = { allowed: true } } = {}) {
  const calls = []
  return {
    calls,
    deps: {
      scheduleDue: async () => { calls.push('due'); return due === true ? { due: true } : { due: false, reason: 'not-due' } },
      hasNewBackup: async () => { calls.push('fresh'); return fresh },
      authorize: async () => { calls.push('authorize'); return authority },
      recordError: async (message) => { calls.push(`error:${message}`) },
      enqueue: async () => { calls.push('enqueue'); return { queued: true } },
    },
  }
}

// Every branch, against a given implementation. Returns nothing; throws AssertionError on a wrong behaviour.
async function exercise(impl) {
  let h = harness({ due: false })
  assert.deepStrictEqual(await impl.runScheduledDriveSyncStep(h.deps), { due: false, reason: 'not-due' })
  assert.deepStrictEqual(h.calls, ['due'], 'not due: nothing else is consulted')

  h = harness({ fresh: { new: false, reason: 'already-synced' } })
  assert.deepStrictEqual(await impl.runScheduledDriveSyncStep(h.deps), { skipped: true, reason: 'already-synced' })
  assert.deepStrictEqual(h.calls, ['due', 'fresh'], 'Drive already holds the newest backup: no authority check, no queued job')

  h = harness({ authority: { allowed: false, message: 'reconnect please' } })
  assert.deepStrictEqual(await impl.runScheduledDriveSyncStep(h.deps), { allowed: false, message: 'reconnect please' })
  assert.deepStrictEqual(h.calls, ['due', 'fresh', 'authorize', 'error:reconnect please'], 'a refused authoriser is recorded and nothing is queued')

  h = harness()
  assert.deepStrictEqual(await impl.runScheduledDriveSyncStep(h.deps), { queued: true })
  assert.deepStrictEqual(h.calls, ['due', 'fresh', 'authorize', 'enqueue'], 'something new and authorised: one job queued')
}

;(async () => {
  await exercise(load(original))

  // MUTANT: the skip removed. The job would be queued every visit.
  const skipLine = "  if (!fresh.new) return { skipped: true, reason: fresh.reason }\n"
  assert.ok(original.includes(skipLine), 'the mutation target exists')
  let caught = false
  try { await exercise(load(original.replace(skipLine, ''))) } catch (error) { caught = error instanceof assert.AssertionError }
  assert.ok(caught, 'a Drive step without its nothing-new skip must fail this test')

  // The real wiring uses the module, so the behaviour above is the behaviour of the cron.
  const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8').replace(/\r\n/g, '\n')
  const step = indexSrc.slice(indexSrc.indexOf("step('drive-sync'"), indexSrc.indexOf("step('audit-log-retention'"))
  for (const needle of ['runScheduledDriveSyncStep({', 'driveSyncScheduleDue(env)', 'driveSyncHasNewBackup(env)', 'checkDriveSyncAuthorizer(env)', "enqueueDriveSyncJob(env, 'scheduled')"]) {
    assert.ok(step.includes(needle), `the rotation's drive-sync step wires ${needle}`)
  }
  console.log('test-drive-sync-cron-step-pure: passed')
})().catch((error) => { console.error(error); process.exit(1) })

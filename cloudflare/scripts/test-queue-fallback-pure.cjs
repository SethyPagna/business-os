// lib/queueDispatch.ts -- the auto-fallback for a deployment with no
// IMPORT_QUEUE binding.
//
// What is actually at risk here, and therefore what this pins:
//
//  1. The HAPPY PATH STAYS THE HAPPY PATH. With the binding present the
//     message must still go to Cloudflare Queues, byte for byte, and the
//     inline runner must not run. A fallback that quietly starts running
//     imports inside the request on a correctly-configured production Worker
//     would be far worse than the bug it replaces.
//  2. NO BARE .send() SURVIVES. The old failure was nine separate call sites
//     doing env.IMPORT_QUEUE.send(...) with no guard; fixing eight of them
//     leaves the ninth throwing "Cannot read properties of undefined". This
//     file greps the whole of src/ so a tenth site added later fails here.
//  3. THE TRAMPOLINE IS FLAT. Every import chunk self-continues by
//     dispatching the next one. Inline, that is re-entrant: a naive
//     implementation recurses once per chunk and blows the stack on a large
//     job. The nesting depth must stay at 1 no matter how many chunks run.
//  4. FAILURE DOES NOT LEAK. A chunk that throws must propagate to the
//     original caller AND must not leave its abandoned continuations sitting
//     in the queue to be run by the next, unrelated dispatch.
//  5. THE POSITIVE CONTROL. Checks that only ever observe "it ran" cannot
//     tell the queued path from the inline path. So the queued case asserts
//     the runner was NOT invoked and the inline case asserts nothing was sent
//     -- and a control re-runs the queued case against an env whose binding
//     was removed, proving the two branches are genuinely distinguishable.
//
// Run: node scripts/test-queue-fallback-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const srcRoot = path.join(cloudflareRoot, 'src')
const ts = require(path.join(cloudflareRoot, 'node_modules', 'typescript'))

let passed = 0
const tests = []
function check(name, fn) { tests.push({ name, fn }) }

function loadQueueDispatch() {
  const sourcePath = path.join(srcRoot, 'lib', 'queueDispatch.ts')
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: 'queueDispatch.ts',
  })
  const moduleObj = { exports: {} }
  // queueDispatch.ts must stay runtime-dependency-free: it is imported by
  // importEngine.ts, bulkDeleteEngine.ts and routes/importJobs.ts, so a
  // runtime import here would need a new stub in every harness that loads any
  // of the three.
  const requireShim = (request) => {
    throw new Error(`queueDispatch.ts must have no runtime dependencies, but required ${request}`)
  }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    moduleObj.exports, requireShim, moduleObj, sourcePath, path.dirname(sourcePath),
  )
  return moduleObj.exports
}

const dispatchModule = loadQueueDispatch()
const { dispatchImportWork, registerInlineImportRunner, __resetQueueDispatchForTests } = dispatchModule

function fakeQueueEnv() {
  const sent = []
  return { sent, env: { IMPORT_QUEUE: { send: async (message) => { sent.push(message) } } } }
}

check('a bound IMPORT_QUEUE still goes to Cloudflare Queues, unchanged', async () => {
  __resetQueueDispatchForTests()
  let inlineRuns = 0
  registerInlineImportRunner(async () => { inlineRuns++ })
  const { sent, env } = fakeQueueEnv()
  const mode = await dispatchImportWork(env, { jobId: 'job-1', kind: 'analyze' })
  assert.equal(mode, 'queued')
  assert.deepEqual(sent, [{ jobId: 'job-1', kind: 'analyze' }], 'the message must reach the queue exactly as built')
  assert.equal(inlineRuns, 0, 'a bound queue must never run import work inside the caller')
})

check('POSITIVE CONTROL: removing the binding flips the same call to inline', async () => {
  // Same env object, same message, one property removed. If this did not
  // change the answer, the check above would be proving nothing.
  __resetQueueDispatchForTests()
  const runs = []
  registerInlineImportRunner(async (_env, message) => { runs.push(message) })
  const { sent, env } = fakeQueueEnv()
  delete env.IMPORT_QUEUE
  const mode = await dispatchImportWork(env, { jobId: 'job-1', kind: 'analyze' })
  assert.equal(mode, 'inline')
  assert.deepEqual(runs, [{ jobId: 'job-1', kind: 'analyze' }])
  assert.deepEqual(sent, [], 'nothing may be sent when there is no queue to send to')
})

check('a missing binding with no runner fails loudly, not with a TypeError', async () => {
  __resetQueueDispatchForTests()
  await assert.rejects(
    dispatchImportWork({}, { jobId: 'job-1', kind: 'apply' }),
    (error) => {
      assert.match(error.message, /IMPORT_QUEUE/)
      assert.doesNotMatch(String(error.message), /reading 'send'/,
        'the pre-fix failure was exactly this TypeError -- it must not come back')
      return true
    },
  )
})

check('an undefined env does not throw before the guard', async () => {
  // dispatchImportWork(env?.IMPORT_QUEUE) is optional-chained on purpose:
  // markJobFailed paths can reach here with a half-built env.
  __resetQueueDispatchForTests()
  const runs = []
  registerInlineImportRunner(async (_env, message) => { runs.push(message) })
  await dispatchImportWork(undefined, { jobId: 'job-2', kind: 'apply' })
  assert.deepEqual(runs, [{ jobId: 'job-2', kind: 'apply' }])
})

check('self-continuation runs every chunk without nesting the stack', async () => {
  __resetQueueDispatchForTests()
  const order = []
  let depth = 0
  let maxDepth = 0
  const CHUNKS = 200
  registerInlineImportRunner(async (env, message) => {
    depth++
    maxDepth = Math.max(maxDepth, depth)
    order.push(message.jobId)
    const n = Number(message.jobId.split('-')[1])
    // This is exactly what importEngine's chunk tail does: checkpoint, then
    // dispatch the next unit and return.
    if (n < CHUNKS) await dispatchImportWork(env, { jobId: `chunk-${n + 1}`, kind: 'apply' })
    depth--
  })
  const mode = await dispatchImportWork({}, { jobId: 'chunk-1', kind: 'apply' })
  assert.equal(mode, 'inline')
  assert.equal(order.length, CHUNKS, 'every self-continued chunk must actually run')
  assert.deepEqual(order.slice(0, 3), ['chunk-1', 'chunk-2', 'chunk-3'], 'chunks must run in order')
  assert.equal(order[CHUNKS - 1], `chunk-${CHUNKS}`)
  assert.equal(maxDepth, 1, 'a re-entrant dispatch must be trampolined, not recursed')
})

check('a failing chunk propagates and abandons its own continuations', async () => {
  __resetQueueDispatchForTests()
  const runs = []
  registerInlineImportRunner(async (env, message) => {
    runs.push(message.jobId)
    if (message.jobId === 'boom-1') {
      // Queue a continuation first, exactly as a chunk would, then fail.
      await dispatchImportWork(env, { jobId: 'boom-2', kind: 'apply' })
      throw new Error('D1 unavailable')
    }
  })
  await assert.rejects(dispatchImportWork({}, { jobId: 'boom-1', kind: 'apply' }), /D1 unavailable/)
  assert.deepEqual(runs, ['boom-1'], 'the continuation of a failed job must not run')
  // ...and must not run later either, on an unrelated dispatch.
  await dispatchImportWork({}, { jobId: 'unrelated', kind: 'analyze' })
  assert.deepEqual(runs, ['boom-1', 'unrelated'], 'abandoned work must not resurface on the next dispatch')
})

check('a redelivery halves the chunk down to the floor and no further', async () => {
  const { chunkRowsForAttempt, MIN_IMPORT_CHUNK_ROWS } = dispatchModule
  assert.equal(MIN_IMPORT_CHUNK_ROWS, 25)
  // Paid ladder, then free's.
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((a) => chunkRowsForAttempt(600, a)), [600, 300, 150, 75, 37, 25, 25])
  assert.deepEqual([1, 2, 3, 4, 5].map((a) => chunkRowsForAttempt(150, a)), [150, 75, 37, 25, 25])
  // First delivery must be untouched: attempts is 1, not 0, on Cloudflare
  // Queues -- an off-by-one here would silently halve every healthy import.
  assert.equal(chunkRowsForAttempt(600, 1), 600)
  assert.equal(chunkRowsForAttempt(600, undefined), 600, 'the inline path passes no attempt at all')
  // A wild attempts value must not produce 0 or a negative window (`limit >>
  // (attempt - 1)` wraps past 31 and would).
  assert.equal(chunkRowsForAttempt(600, 40), 25)
  assert.equal(chunkRowsForAttempt(600, 1e9), 25)
  assert.equal(chunkRowsForAttempt(600, 0), 600)
  assert.equal(chunkRowsForAttempt(600, -5), 600)
  // The floor is a floor, never a raise: a hypothetical tier below it keeps
  // its own smaller limit.
  assert.equal(chunkRowsForAttempt(10, 1), 10)
  assert.equal(chunkRowsForAttempt(10, 9), 10)
})

function barrier() {
  let release
  const promise = new Promise(resolve => { release = resolve })
  return { promise, release }
}

for (const sameEnv of [true,false]) for (const failingRoot of [null,'A','B']) {
  check(`concurrent ${sameEnv ? 'same' : 'different'} env roots wait independently; failure=${failingRoot}`, async () => {
    __resetQueueDispatchForTests()
    const gates = { A:barrier(), B:barrier() }
    const runs = [], wrappers = {}, states = { A:'pending', B:'pending' }
    const binding = Object.freeze({name:'binding'})
    const envA = Object.freeze({DB:binding})
    const envB = sameEnv ? envA : Object.freeze({DB:binding})
    const failure = new Error(`${failingRoot} failed`)
    registerInlineImportRunner(async (env,message) => {
      runs.push(message.jobId)
      const root = message.jobId[0]
      assert.equal(env.DB,binding,'binding identity must not change')
      if (message.jobId.length !== 1) return
      wrappers[root] = env
      await dispatchImportWork(env,{jobId:`${root}-continuation`,kind:'apply'})
      await gates[root].promise
      if (root === failingRoot) throw failure
    })
    const start = (root,env) => dispatchImportWork(env,{jobId:root,kind:'apply'}).then(
      mode=> { states[root]='fulfilled'; return {mode} },
      error=> { states[root]='rejected'; return {error} },
    )
    const a = start('A',envA), b = start('B',envB)
    try {
      await Promise.resolve()
      assert.deepEqual(runs,['A','B'],'both independent roots begin, neither is misclassified as a continuation')
      assert.deepEqual(states,{A:'pending',B:'pending'},'neither caller resolves before its own work')
      assert.notEqual(wrappers.A,wrappers.B)
      assert.notEqual(wrappers.A,envA)
      gates.A.release()
      const outcomeA = await a
      assert.equal(states.B,'pending','A completion/failure cannot settle B')
      assert.equal(outcomeA.error,failingRoot==='A' ? failure : undefined)
      gates.B.release()
      const outcomeB = await b
      assert.equal(outcomeB.error,failingRoot==='B' ? failure : undefined)
      assert.equal(runs.includes('A-continuation'),failingRoot!=='A')
      assert.equal(runs.includes('B-continuation'),failingRoot!=='B')
      await assert.rejects(dispatchImportWork(wrappers.A,{jobId:'A-late',kind:'apply'}),/already completed/)
      await dispatchImportWork(envA,{jobId:'C-independent',kind:'apply'})
      assert.equal(runs.includes('A-late'),false)
      assert.equal(runs.filter(id=>id==='A-continuation').length,failingRoot==='A'?0:1)
      assert.deepEqual(Object.keys(envA),['DB'],'original env is never annotated')
    } finally {
      gates.A.release(); gates.B.release()
      await Promise.all([a,b])
    }
  })
}

check('a failed nested continuation abandons only its root and is never replayed', async () => {
  __resetQueueDispatchForTests()
  const runs = []
  registerInlineImportRunner(async (env,message) => {
    runs.push(message.jobId)
    if (message.jobId==='root') await dispatchImportWork(env,{jobId:'nested',kind:'apply'})
    if (message.jobId==='nested') {
      await dispatchImportWork(env,{jobId:'abandoned',kind:'apply'})
      throw new Error('nested failure')
    }
  })
  const env = {}
  await assert.rejects(dispatchImportWork(env,{jobId:'root',kind:'apply'}),/nested failure/)
  await dispatchImportWork(env,{jobId:'unrelated',kind:'apply'})
  assert.deepEqual(runs,['root','nested','unrelated'])
})

check('private wrapper preserves accessor binding receiver, own keys and nested binding identity', async () => {
  __resetQueueDispatchForTests()
  const binding = {}
  const env = {}
  Object.defineProperty(env,'DB',{enumerable:true,get(){assert.equal(this,env);return binding}})
  registerInlineImportRunner(async scoped => {
    assert.equal(scoped.DB,binding)
    assert.deepEqual(Object.keys(scoped),['DB'])
    assert.equal({...scoped}.DB,binding)
  })
  await dispatchImportWork(env,{jobId:'accessor',kind:'apply'})
})

check('queue rejection is propagated unchanged and never falls back inline', async () => {
  __resetQueueDispatchForTests()
  let runs = 0
  registerInlineImportRunner(async()=>{runs++})
  const failure = new Error('queue send failed')
  const env = {IMPORT_QUEUE:{async send(){throw failure}}}
  await assert.rejects(dispatchImportWork(env,{jobId:'queued',kind:'apply'}),error=>error===failure)
  assert.equal(runs,0)
})

check('both import runners take the attempt from the queue message', async () => {
  const engine = fs.readFileSync(path.join(srcRoot, 'lib', 'importEngine.ts'), 'utf8')
  const wired = engine.match(/const chunkRows = chunkRowsForAttempt\(limits\.rowsPerImportChunk, attempt\)/g) || []
  assert.equal(wired.length, 2, 'analyze and apply must both narrow their window on a redelivery')
  const queueSource = fs.readFileSync(path.join(srcRoot, 'queue.ts'), 'utf8')
  assert.match(queueSource, /const attempt = message\.attempts/,
    'attempts is the only evidence a Worker gets that the previous delivery died')
  assert.match(queueSource, /runImportAnalyze\(env, jobId, queueLatencyMs, attempt\)/)
  assert.match(queueSource, /runImportApply\(env, jobId, queueLatencyMs, attempt\)/)
})

check('no bare IMPORT_QUEUE.send survives anywhere in src/', async () => {
  const offenders = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!entry.name.endsWith('.ts')) continue
      const source = fs.readFileSync(full, 'utf8')
      source.split(/\r?\n/).forEach((line, i) => {
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) return
        if (/\bIMPORT_QUEUE\s*\.\s*send\s*\(/.test(line)) offenders.push(`${path.relative(srcRoot, full)}:${i + 1}`)
      })
    }
  }
  walk(srcRoot)
  assert.deepEqual(offenders, [],
    'every import producer must go through dispatchImportWork -- a bare .send() is the unguarded failure this module exists to remove')
})

check('the Env type admits a deployment with no queue bindings', async () => {
  const source = fs.readFileSync(path.join(srcRoot, 'index.ts'), 'utf8')
  assert.match(source, /^\s*IMPORT_QUEUE\?: Queue$/m,
    'a required IMPORT_QUEUE makes the compiler agree with the assumption that just broke production')
  assert.match(source, /^\s*MEDIA_QUEUE\?: Queue$/m)
})

check('queue.ts registers the inline runner for all three job kinds', async () => {
  const source = fs.readFileSync(path.join(srcRoot, 'queue.ts'), 'utf8')
  assert.match(source, /registerInlineImportRunner\(/,
    'without this registration the fallback has nothing to run and throws instead')
  const registration = source.slice(source.indexOf('registerInlineImportRunner('))
  const body = registration.slice(0, registration.indexOf('\n})'))
  for (const runner of ['runImportAnalyze', 'runImportApply', 'runBulkDeleteJob']) {
    assert.ok(body.includes(runner), `the inline runner must cover ${runner} -- the consumer dispatches to it`)
  }
})

async function main() {
  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log('PASS', name)
      passed++
    } catch (e) {
      console.log('FAIL', name, '-', e.message)
      process.exitCode = 1
    }
  }
  console.log(`\n${passed} check(s) passed.`)
  if (process.exitCode) console.log('SOME CHECKS FAILED')
}

void main()

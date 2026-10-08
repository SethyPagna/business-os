const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const baseline = process.argv.includes('--baseline')
const baselineSource = baseline ? require('node:child_process').execFileSync('git', ['show', '12798de289ea6e224ee41aca6b3e000577cca743:cloudflare/src/routes/stockInCommit.ts'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }) : null
const fixtureRequire = name => name === 'node:fs' && baseline ? { ...fs, readFileSync(file, ...args) {
  return String(file).replaceAll('\\', '/').endsWith('/src/routes/stockInCommit.ts') ? baselineSource : fs.readFileSync(file, ...args)
} } : require(name)

let fixture = fs.readFileSync(path.join(__dirname, 'test-intake-full-request-budget.cjs'), 'utf8').replace(/\r/g, '').split(';(async () => {')[0]
fixture = fixture.replace('let failures = new Set()', 'let failures = new Set(); let pairs = new Map()')
fixture = fixture.replace('physical = 0; failures = new Set()', 'physical = 0; failures = new Set(); pairs = new Map()')
fixture = fixture.replace('physical += statements.length', "physical += statements.length; if (options.enforceCap) assert.ok(physical <= 1000, 'physical Paid cap including background')")
fixture = fixture.replace('if (kind && options.tailRetries && !failures.has(kind)) {', `const pair = sql + JSON.stringify(params); const nth = (pairs.get(pair) || 0) + 1
      if (kind) pairs.set(pair, nth)
      if (kind && options.tailRetries && nth % 2 === 1) {`)
fixture = fixture.replace('const payload = options.multiLine ?', 'const payload = options.payload || (options.multiLine ?')
fixture = fixture.replace('} : body\n    const response', '} : body)\n    const response')
const { world } = new Function('require', '__dirname', fixture + ';return {world};')(fixtureRequire, __dirname)

async function lifecycleChecks() {
  const { Hono } = require('hono')
  const ts = require('typescript')
  let visited = [], settled = false, refuse = false
  const kernel = async (c, body) => {
    visited.push(body.id)
    if (body.id === 2) assert.equal(settled, true)
    c.executionCtx.waitUntil(Promise.resolve().then(() => { settled = true; throw Error('synthetic rejected tail') }))
    return c.json(refuse ? { code: 'stock_request_query_budget_exceeded' } : { saved: body.id }, refuse ? 503 : 200)
  }
  const mocks = {
    '../lib/acquisitionCostAccess': { acquisitionCostResponses: async (c, next) => next() },
    '../lib/auth': { requireAuth: async (c, next) => next() },
    '../lib/permissions': { hasPermission: () => true, isActionBlocked: () => false },
    '../lib/planTier': { getPlanLimits: () => ({ stockInLinesPerRequest: 24 }) },
    './inventory': { runAdjustAction: kernel }, './batches': { runReceiveBatchAction: kernel },
    '../lib/stockSessionMath': {},
  }
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/routes/stockInCommit.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => mocks[name] || require(name), mod, mod.exports)
  class Execution {
    #pending = []
    waitUntil(p) { this.#pending.push(p); p.catch(() => {}) }
    async finish() { await Promise.allSettled(this.#pending) }
  }
  const execution = new Execution()
  const app = new Hono()
  app.post('/', async c => c.json(await mod.exports.runStockInCommit(c, await c.req.json())))
  const line = id => ({ key: String(id), wire: 'adjust', body: { id } })
  const call = async lines => (await app.fetch(new Request('https://fixture/', { method: 'POST', body: JSON.stringify(lines) }), {}, execution)).json()
  assert.deepEqual(await call([]), [])
  assert.equal((await call([line(1)])).length, 1)
  await execution.finish()
  visited = []; settled = false
  assert.ok((await call([line(1), line(2)])).every(r => r.ok))
  assert.deepEqual(visited, [1, 2])
  visited = []; refuse = true
  assert.ok((await call([line(1), line(2), line(3)])).every(r => r.code === 'deferred'))
  assert.deepEqual(visited, [1], 'budget refusal stops untouched suffix reads')
  await execution.finish()
}

;(async () => {
  if (!baseline) await lifecycleChecks()
  const options = { multiLine: true, tailRetries: true, delayedKv: true, releaseKvAfterResponse: baseline, enforceCap: !baseline }
  const f = await world('paid', 'optional-tagged', false, options)
  const before = f.effects()
  const first = await f.call(true)
  if (baseline) {
    assert.equal(first.physical, 1023)
    assert.equal(first.body.results.filter(r => r.ok).length, 24)
    console.log('PASS baseline counter parity with pending-tail overrun: 1023')
    f.sql.close()
    return
  }
  assert.equal(first.status, 200)
  assert.ok(first.physical <= 1000, `pending tails exceeded admission limit: ${first.physical}`)
  assert.equal(first.body.results.length, 24)
  const saved = first.body.results.filter(r => r.ok).length
  const deferred = first.body.results.filter(r => r.code === 'deferred').length
  assert.ok(saved > 0)
  assert.equal(saved + deferred, 24)
  assert.equal(first.effects.written, saved)
  assert.equal(first.effects.held, before.held + saved * 5)
  assert.equal(first.effects.movement, before.movement + saved * 2)
  options.payload = { lines: first.body.results.flatMap((result, i) => result.code === 'deferred'
    ? [{ key: 'line-' + i, wire: 'adjust', body: { ...f.body, client_request_id: f.body.client_request_id + '-' + i } }] : []) }
  const retry = await f.call()
  assert.ok(retry.physical <= 1000)
  assert.equal(retry.body.results.filter(r => r.ok).length, deferred)
  assert.equal(retry.effects.written, 24)
  assert.equal(retry.effects.held, before.held + 120)
  assert.equal(retry.effects.movement, before.movement + 48)
  f.sql.close()
  for (const tier of ['free', 'paid']) {
    const singleOptions = { tailRetries: true, multiLine: true }
    const single = await world(tier, 'add', true, singleOptions)
    singleOptions.payload = { lines: [{ key: 'single', wire: 'adjust', body: single.body }] }
    const result = await single.call(true)
    assert.equal(result.status, 200)
    assert.equal(result.body.results[0].ok, true)
    assert.equal(result.effects.written, 1)
    singleOptions.payload = { lines: [] }
    const empty = await single.call()
    assert.equal(empty.status, 400)
    assert.deepEqual(empty.effects, result.effects)
    single.sql.close()
  }
  const ackOptions = { multiLine: true, claimLostAck: true }
  const ack = await world('paid', 'add', true, ackOptions)
  ackOptions.payload = { lines: [{ key: 'ack', wire: 'adjust', body: ack.body }] }
  const ackBefore = ack.effects()
  const lost = await ack.call()
  assert.equal(lost.body.results[0].code, 'stock_request_in_flight')
  assert.deepEqual(lost.effects, ackBefore)
  ack.sql.close()
  const fault = await world('paid', 'optional-tagged', true, { multiLine: true, completionFault: true })
  const unknown = await fault.call()
  assert.ok(unknown.body.results.every(r => r.code === 'stock_request_outcome_unknown'))
  assert.equal(unknown.effects.written, 24)
  const replay = await fault.call()
  assert.ok(replay.body.results.every(r => r.code === 'stock_request_partially_applied'))
  assert.deepEqual(replay.effects, unknown.effects)
  fault.sql.close()
  console.log(JSON.stringify({ pass: true, paidAttempts: first.physical, saved, deferred, retryAttempts: retry.physical }))
})().catch(error => { console.error(error); process.exitCode = 1 })


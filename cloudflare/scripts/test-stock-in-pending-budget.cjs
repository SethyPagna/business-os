const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const baseline = process.argv.includes('--baseline')
const pressureControl = process.argv.includes('--pressure-control')
const pressureReads = Number(process.argv.find(arg => arg.startsWith('--pressure-reads='))?.split('=')[1] || (baseline ? 3 : 2))
assert.ok([1, 2, 3].includes(pressureReads))
const historicalGraph = {
  '/src/routes/stockInCommit.ts': '12798de289ea6e224ee41aca6b3e000577cca743',
  '/src/routes/inventory.ts': 'ad5d4cabb88d3196325dbff437d5a785a4df278f',
  '/src/lib/productBatches.ts': 'ad5d4cabb88d3196325dbff437d5a785a4df278f',
}
const historicalSources = baseline ? Object.fromEntries(Object.entries(historicalGraph).map(([file, sha]) => [file,
  require('node:child_process').execFileSync('git', ['show', sha + ':cloudflare' + file], { cwd: path.join(__dirname, '..'), encoding: 'utf8' })])) : {}
const fixtureRequire = name => name === 'node:fs' && baseline ? { ...fs, readFileSync(file, ...args) {
  const key = Object.keys(historicalSources).find(key => String(file).replaceAll('\\', '/').endsWith(key))
  return key ? historicalSources[key] : fs.readFileSync(file, ...args)
} } : require(name)

let fixture = fs.readFileSync(path.join(__dirname, 'test-intake-full-request-budget.cjs'), 'utf8').replace(/\r/g, '').split(';(async () => {')[0]
fixture = fixture.replace('let failures = new Set()', 'let failures = new Set(); let pairs = new Map()')
fixture = fixture.replace('physical = 0; failures = new Set()', 'physical = 0; failures = new Set(); pairs = new Map()')
fixture = fixture.replace('async function world(tier, mode, verified, options = {}) {', `async function world(tier, mode, verified, options = {}) { options.enforceCap ??= ${!baseline};`)
fixture = fixture.replace('physical += statements.length', "physical += statements.length; if (options.enforceCap) assert.ok(physical <= (tier === 'free' ? 50 : 1000), 'physical plan cap including background')")
fixture = fixture.replace('if (kind && options.tailRetries && !failures.has(kind)) {', `const pair = sql + JSON.stringify(params); const nth = (pairs.get(pair) || 0) + 1
      if (kind) pairs.set(pair, nth)
      if (kind && options.tailRetries && nth % 2 === 1) {`)
// Failure injection stays at the actual binding dispatch. D1Compat must retry the real product
// snapshot once per line; each failed and successful attempt is metered by the unchanged Worker.
const preflightSql = 'SELECT id, name, selling_price_usd, selling_price_khr, cost_price_usd, cost_price_khr FROM products WHERE id = '
assert.ok(fixture.includes('const kind = /SELECT namespace'), 'actual dispatch classifier remains present')
const branchPreflightSql = 'SELECT id, name, role, is_active, successor_branch_id FROM branches'
const lotPreflightSql = baseline ? 'SELECT id,batch_key,received_at,unit_cost_usd FROM product_batches WHERE variant_product_id=' : 'SELECT pb.id,pb.batch_key,pb.received_at,pb.unit_cost_usd,pb.received_cost_usd,'
fixture = fixture.replace('const kind = /SELECT namespace', `const kind = options.branchPreflightRetries && sql.trim().replace(/\\s+/g, ' ') === ${JSON.stringify(branchPreflightSql)} ? 'preflight-branch'
        : options.lotPreflightRetries && sql.trim().replace(/\\s+/g, ' ').startsWith(${JSON.stringify(lotPreflightSql)}) ? 'preflight-lot'
          : options.preflightRetries && sql.trim().replace(/\\s+/g, ' ').startsWith(${JSON.stringify(preflightSql)}) ? 'preflight' : /SELECT namespace`)
fixture = fixture.replace("throw Error('D1_ERROR: network synthetic tail retry')", "throw Error('D1_ERROR: network synthetic ' + kind + ' retry')")
fixture = fixture.replace('let physical = 0', 'let physical = 0; let requests = 0')
fixture = fixture.replace('let physical = 0', 'let physical = 0; let trace = []')
fixture = fixture.replace('physical += statements.length', 'trace.push(...statements); physical += statements.length')
fixture = fixture.replace('physical = 0; failures = new Set()', 'physical = 0; trace = []; failures = new Set()')
fixture = fixture.replace('const call = async (cold = false) => {', 'const call = async (cold = false) => { requests++')
fixture = fixture.replace('physical, failures:', `physical, requests, attemptedStatements: observed.invocation.attemptedStatements,
      preflightAttempts: trace.filter(sql => sql.startsWith(${JSON.stringify(preflightSql)})).length,
      branchPreflightAttempts: trace.filter(sql => sql === ${JSON.stringify(branchPreflightSql)}).length,
      lotPreflightAttempts: trace.filter(sql => sql.startsWith(${JSON.stringify(lotPreflightSql)})).length, failures:`)
fixture = fixture.replace('const payload = options.multiLine ?', 'const payload = options.payload || (options.multiLine ?')
fixture = fixture.replace('} : body\n    const response', '} : body)\n    const response')
const { world, load } = new Function('require', '__dirname', fixture + ';return {world, load};')(fixtureRequire, __dirname)

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
  assert.equal(load('lib/planTier.ts').getPlanLimits({ PLAN_TIER: 'paid' }).stockInLinesPerRequest, 24)
  assert.match(fs.readFileSync(path.join(__dirname, '../src/routes/inventory.ts'), 'utf8'), /reserve: body\.sellingPriceUsd != null \|\| body\.sellingPriceKhr != null \? 18 : 16/, 'optional price receipt retains its 18-statement reserve')
  const options = { multiLine: true, tailRetries: true, delayedKv: true, releaseKvAfterResponse: baseline, enforceCap: !baseline, preflightRetries: baseline || pressureControl, branchPreflightRetries: (baseline || pressureControl) && pressureReads >= 2, lotPreflightRetries: (baseline || pressureControl) && pressureReads >= 3 }
  const f = await world('paid', 'optional-tagged', false, options)
  const before = f.effects()
  const first = await f.call(true)
  if (baseline) {
    assert.equal(first.status, 200)
    const historicalSaved = first.body.results.filter(r => r.ok).length
    console.log(JSON.stringify({ historicalObserved: true, attempts: first.physical, saved: historicalSaved, codes: first.body.results.filter(r => !r.ok).map(r => r.code) }))
    assert.ok(historicalSaved > 0)
    assert.equal(first.attemptedStatements, first.physical)
    assert.ok(first.physical > 1000, `historical pending-tail kernel must discriminate current admission: ${first.physical}`)
    assert.equal(first.preflightAttempts, 48)
    assert.equal(first.branchPreflightAttempts, 48)
    assert.equal(first.lotPreflightAttempts, 48)
    console.log(JSON.stringify({ pass: true, negativeControl: 'historical stockInCommit plus ad5 inventory/productBatches; actual D1 retries', historicalGraph, attemptedStatements: first.physical, saved: historicalSaved, preflightAttempts: [first.preflightAttempts, first.branchPreflightAttempts, first.lotPreflightAttempts] }))
    f.sql.close()
    return
  }
  if (pressureControl) {
    assert.equal(first.status, 200)
    assert.equal(first.attemptedStatements, first.physical)
    assert.ok(first.physical <= 1000)
    const saved = first.body.results.filter(r => r.ok).length
    const deferred = first.body.results.filter(r => r.code === 'deferred').length
    assert.ok(saved > 0)
    if (pressureReads >= 2) assert.ok(deferred > 0)
    assert.equal(saved + deferred, 24)
    assert.deepEqual([first.preflightAttempts, first.branchPreflightAttempts, first.lotPreflightAttempts], [2 * (saved + (deferred ? 1 : 0)), (pressureReads >= 2 ? 2 : 1) * (saved + (deferred ? 1 : 0)), (pressureReads >= 3 ? 2 : 1) * (saved + (deferred ? 1 : 0))])
    assert.deepEqual(first.effects, { ...before, received: before.received + saved * 5, held: before.held + saved * 5,
      movement: before.movement + saved * 2, written: before.written + saved })
    console.log(JSON.stringify({ pass: true, control: 'current kernel; actual D1 retries', pressureReads, attemptedStatements: first.physical, saved, deferred, preflightAttempts: [first.preflightAttempts, first.branchPreflightAttempts, first.lotPreflightAttempts] }))
    f.sql.close()
    return
  }
  assert.equal(first.status, 200)
  assert.ok(first.physical <= 1000, 'optimized all-saved workload including delayed/retried tails')
  assert.equal(first.attemptedStatements, first.physical)
  assert.equal(first.requests, 1, 'all-saved completion requires one request')
  assert.equal(first.body.results.length, 24)
  assert.ok(first.body.results.every((r, i) => r.ok && r.key === 'line-' + i))
  assert.equal(first.body.results.filter(r => r.code === 'deferred').length, 0)
  assert.deepEqual(first.effects, { ...before, received: before.received + 120, held: before.held + 120,
    movement: before.movement + 48, written: before.written + 24 })
  // Every line settled; the continuation set is empty, so the client issues no retry request.
  f.sql.close()

  const pressureOptions = { multiLine: true, tailRetries: true, preflightRetries: true, branchPreflightRetries: true, lotPreflightRetries: false, delayedKv: true, enforceCap: true }
  const pressure = await world('paid', 'optional-tagged', false, pressureOptions)
  const pressureBefore = pressure.effects()
  const pressured = await pressure.call(true)
  assert.equal(pressured.status, 200)
  assert.equal(pressured.attemptedStatements, pressured.physical)
  assert.ok(pressured.physical <= 1000)
  assert.equal(pressured.body.results.length, 24)
  const saved = pressured.body.results.filter(r => r.ok).length
  const deferred = pressured.body.results.filter(r => r.code === 'deferred').length
  assert.ok(saved > 0 && deferred > 0, 'real product preflight retries must produce a genuine deferred suffix')
  assert.equal(saved + deferred, 24)
  assert.ok(['preflight', 'preflight-branch'].every(kind => pressured.failures.includes(kind)), 'actual dispatch threw retryable product/branch read failures')
  assert.deepEqual([pressured.branchPreflightAttempts, pressured.lotPreflightAttempts], [2 * (saved + 1), saved + 1])
  assert.equal(pressured.preflightAttempts, 2 * (saved + 1), 'one failed and one successful actual product read for each attempted line, including first deferred line')
  assert.ok(pressured.body.results.slice(0, saved).every(r => r.ok))
  assert.ok(pressured.body.results.slice(saved).every(r => r.code === 'deferred'), 'untouched suffix keeps original order')
  assert.deepEqual(pressured.effects, { ...pressureBefore, received: pressureBefore.received + saved * 5,
    held: pressureBefore.held + saved * 5, movement: pressureBefore.movement + saved * 2, written: pressureBefore.written + saved })
  const originalLines = Array.from({ length: 24 }, (_, i) => ({ key: 'line-' + i, wire: 'adjust',
    body: { ...pressure.body, client_request_id: pressure.body.client_request_id + '-' + i } }))
  const receiptIds = () => pressure.sql.prepare('SELECT request_id FROM stock_mutation_receipts WHERE written=1 ORDER BY id').all().map(row => row.request_id)
  assert.deepEqual(receiptIds(), originalLines.slice(0, saved).map(line => line.body.client_request_id))
  pressureOptions.payload = { lines: originalLines.slice(saved) }
  assert.deepEqual(pressureOptions.payload.lines.map(line => line.key), pressured.body.results.slice(saved).map(r => r.key))
  const retry = await pressure.call()
  assert.equal(retry.status, 200)
  assert.equal(retry.attemptedStatements, retry.physical)
  assert.ok(retry.physical <= 1000)
  assert.equal(retry.requests, 2)
  assert.equal(retry.preflightAttempts, deferred * 2, 'same actual one-retry pressure applies during continuation')
  assert.ok(retry.body.results.every((r, i) => r.ok && r.key === originalLines[saved + i].key))
  assert.equal(retry.body.results.length, deferred)
  assert.deepEqual(receiptIds(), originalLines.map(line => line.body.client_request_id), 'continuation retains every original ID and never re-applies saved prefix')
  assert.deepEqual(retry.effects, { ...pressureBefore, received: pressureBefore.received + 120, held: pressureBefore.held + 120,
    movement: pressureBefore.movement + 48, written: pressureBefore.written + 24 })
  const replay = await pressure.call()
  assert.equal(replay.status, 200)
  assert.ok(replay.body.results.every(r => r.ok && r.replayed))
  assert.deepEqual(replay.effects, retry.effects)
  assert.equal(replay.attemptedStatements, replay.physical)
  assert.ok(replay.physical <= 1000)
  pressure.sql.close()
  const singleAttempts = {}
  for (const tier of ['free', 'paid']) {
    const singleOptions = { tailRetries: true, multiLine: true }
    const single = await world(tier, 'add', true, singleOptions)
    singleOptions.payload = { lines: [{ key: 'single', wire: 'adjust', body: single.body }] }
    const result = await single.call(true)
    assert.equal(result.status, 200)
    assert.equal(result.body.results[0].ok, true)
    assert.equal(result.effects.written, 1)
    assert.equal(result.attemptedStatements, result.physical)
    assert.ok(result.physical <= (tier === 'free' ? 50 : 1000))
    singleAttempts[tier] = result.physical
    singleOptions.payload = { lines: [] }
    const empty = await single.call()
    assert.equal(empty.status, 400)
    assert.equal(empty.attemptedStatements, empty.physical)
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
  const faultReplay = await fault.call()
  assert.ok(faultReplay.body.results.every(r => r.code === 'stock_request_partially_applied'))
  assert.deepEqual(faultReplay.effects, unknown.effects)
  fault.sql.close()
  console.log(JSON.stringify({ pass: true, allSavedAttempts: first.physical, allSavedRequests: first.requests, singleAttempts, pressureAttempts: pressured.physical, preflightAttempts: pressured.preflightAttempts, saved, deferred, retryAttempts: retry.physical, replayAttempts: replay.physical }))
})().catch(error => { console.error(error); process.exitCode = 1 })


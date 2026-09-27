// Per-request metrics layer (C3v2 A0): lib/requestMetrics.ts, the D1Compat
// meta accounting in lib/db.ts, the cache marking in lib/cache.ts.
//
// What this pins, and the plausible wrong implementation each check rejects:
//  1. Hook key parity -- db.ts / cache.ts / requestMetrics.ts use one
//     Symbol.for key. A typo in one file silently disables its half.
//  2. Accumulator math through the REAL D1Compat: get/all/run count one
//     statement each, a batch counts one per statement (not one per batch),
//     rows_read/rows_written/duration are summed, a failed statement is
//     counted as failed, and missing/garbage meta adds zero, not NaN.
//  3. get() parity: row 0 of all() returns exactly what first() did, for no
//     row, one row, many rows, a row of nulls and an aggregate over nothing.
//     The fake statement mirrors workerd 1.20260730.1's d1-api first()/all()
//     (same '/query' result, results.at(0) or null).
//  4. Server-Timing format, and only on authenticated responses.
//  5. Sampling: every miss/bypass, hits at 10 %, weight 1/rate.
//  6. Privacy: ids/names/phone in the path and query never reach the
//     datapoint -- only the route template and numbers do. Clocks are
//     injected so every double is exact and none is exempt from the scan.
//  7. No binding / a throwing binding: no-op, response unchanged.
//  8. Background separation: runBackground work is recorded under its own
//     label and never added to the route; unwrapped waitUntil work that
//     resolves after the response is counted as `late`, not as the route's.
//  9. cachedJsonResponse marks miss then hit on the real cache module.
//
// Real Hono (the package this Worker runs) so routePath-after-next() is the
// real resolution, not an assumption.
//
// Mutation hooks for proving the checks can fail: DB_SOURCE,
// REQUEST_METRICS_SOURCE and CACHE_SOURCE point the loader at another copy.
//
// Run: node scripts/test-request-metrics-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')
const { Hono } = require('hono')

const SRC = path.join(__dirname, '../src')
function load(rel, overrides = {}, sourcePath) {
  const filename = sourcePath || path.join(SRC, rel)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const mod = { exports: {} }
  const localRequire = (name) => Object.hasOwn(overrides, name) ? overrides[name] : require(name)
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

const metrics = load('lib/requestMetrics.ts', {}, process.env.REQUEST_METRICS_SOURCE)
const dbModule = load('lib/db.ts', { './importMaintenanceFence': {} }, process.env.DB_SOURCE)
const cacheModule = load('lib/cache.ts', {
  './db': { getDb: () => { throw new Error('no D1 expected') } },
  './quotaGuard': { consumeQuota: async () => ({ zone: 'ok' }) },
}, process.env.CACHE_SOURCE)

const tests = []
function check(name, fn) { tests.push({ name, fn }) }
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// A D1Database fake whose statements return scripted metas.
function scriptedD1(script) {
  const calls = []
  const next = (sql) => {
    const step = script(sql)
    calls.push(sql)
    if (step instanceof Error) throw step
    return step
  }
  const stmt = (sql) => ({
    sql,
    bind() { return this },
    async all() { const s = next(sql); return { results: s.results || [], meta: s.meta } },
    async run() { const s = next(sql); return { results: [], meta: s.meta } },
    async first() { throw new Error('D1Compat must not call first(): it returns no meta') },
  })
  return {
    calls,
    prepare: (sql) => stmt(sql),
    async batch(prepared) { return prepared.map((p) => { const s = next(p.sql); return { results: s.results || [], meta: s.meta } }) },
  }
}

function sink() {
  const points = []
  return { points, writeDataPoint(point) { points.push(JSON.parse(JSON.stringify(point))) } }
}

function appWith(register, options) {
  const app = new Hono()
  app.use('/api/*', options ? metrics.createRequestMetricsMiddleware(options) : metrics.requestMetricsMiddleware)
  register(app)
  return app
}

function executionCtx() {
  const pending = []
  return { pending, waitUntil(p) { pending.push(p) }, passThroughOnException() {} }
}

check('hook key is identical in requestMetrics.ts, db.ts and cache.ts', () => {
  const key = metrics.REQUEST_METRICS_HOOK_KEY
  assert.equal(typeof key, 'string')
  for (const rel of ['lib/db.ts', 'lib/cache.ts']) {
    const text = fs.readFileSync(path.join(SRC, rel), 'utf8')
    assert.ok(text.includes(`Symbol.for('${key}')`), `${rel} must look the hook up with Symbol.for('${key}')`)
  }
  const hook = globalThis[Symbol.for(key)]
  assert.equal(typeof hook?.d1Call, 'function')
  assert.equal(typeof hook?.cache, 'function')
})

check('accumulator sums get/all/run and counts a batch per statement', async () => {
  const metas = {
    'SELECT get': { rows_read: 1, rows_written: 0, duration: 0.25 },
    'SELECT all': { rows_read: 40, rows_written: 0, duration: 1.5 },
    'UPDATE run': { rows_read: 2, rows_written: 3, duration: 0.5 },
    'B1': { rows_read: 1, rows_written: 1, duration: 0.1 },
    'B2': { rows_read: 5, rows_written: 2, duration: 0.2 },
    'B3': { rows_read: 0, rows_written: 4, duration: 0.3 },
    'GARBAGE': { rows_read: 'x', rows_written: -3, duration: NaN },
    'NO META': undefined,
  }
  const d1 = scriptedD1((sql) => sql === 'BAD' ? new Error('D1_ERROR: no such table: nope') : { meta: metas[sql], results: [{ ok: 1 }] })
  const db = new dbModule.D1Compat(d1)
  let acc
  const app = appWith((a) => a.get('/api/x', async (c) => {
    acc = metrics.requestMetricsOf(c)
    await db.prepare('SELECT get').get()
    await db.prepare('SELECT all').all()
    await db.prepare('UPDATE run').run()
    await db.batch([{ sql: 'B1' }, { sql: 'B2' }, { sql: 'B3' }])
    await db.batchOnce([{ sql: 'GARBAGE' }, { sql: 'NO META' }])
    await assert.rejects(db.prepare('BAD').all(), /no such table/)
    return c.json({ ok: true })
  }))
  const res = await app.request('/api/x', {}, {}, executionCtx())
  assert.equal(res.status, 200)
  assert.equal(acc.statements, 8, 'get+all+run = 3, batch of 3 = 3, batchOnce of 2 = 2')
  assert.equal(acc.rowsRead, 1 + 40 + 2 + 1 + 5 + 0)
  assert.equal(acc.rowsWritten, 3 + 1 + 2 + 4)
  assert.ok(Math.abs(acc.d1Ms - (0.25 + 1.5 + 0.5 + 0.1 + 0.2 + 0.3)) < 1e-9, `d1Ms ${acc.d1Ms}`)
  assert.equal(acc.failed, 1)
  assert.equal(acc.d1Calls, 6, 'get, all, run, batch, batchOnce and the failed call: one round trip each')
  assert.ok(Number.isFinite(acc.rowsRead) && Number.isFinite(acc.d1Ms) && Number.isFinite(acc.d1WallMs))
})

check('D1Compat outside any request scope is a silent no-op', async () => {
  const d1 = scriptedD1(() => ({ meta: { rows_read: 9 }, results: [{ a: 1 }] }))
  const db = new dbModule.D1Compat(d1)
  assert.deepEqual(await db.prepare('SELECT x').get(), { a: 1 })
  assert.deepEqual(await db.batch([{ sql: 'Y' }]).then((r) => r.length), 1)
})

// --- get() parity ----------------------------------------------------------
// Mirrors workerd 1.20260730.1 cloudflare-internal d1-api: first() and all()
// both issue _sendOrThrow('/query', ..., 'ROWS_AND_COLUMNS') and map it with
// toArrayOfObjects(); first() returns null when results is empty, else
// results.at(0).
function workerdLikeD1(sqlite) {
  class Stmt {
    constructor(sql, params = []) { this.sql = sql; this.params = params }
    bind(...values) { return new Stmt(this.sql, values) }
    _query() { return { results: sqlite.prepare(this.sql).all(...this.params), meta: { rows_read: 1, rows_written: 0, duration: 0 } } }
    async first(colName) {
      const results = this._query().results
      if (!(results.length > 0)) return null
      const firstResult = results.at(0)
      if (colName !== undefined) return firstResult[colName]
      return firstResult
    }
    async all() { return this._query() }
    async run() { return { results: [], meta: { changes: 0, last_row_id: 0 } } }
  }
  return { prepare: (sql) => new Stmt(sql), async batch() { throw new Error('unused') } }
}

check('get() via all()[0] returns exactly what first() returned, every shape', async () => {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, note TEXT, qty REAL);
    INSERT INTO t VALUES (1, 'a', NULL, 1.5), (2, 'b', 'x', NULL), (3, NULL, NULL, NULL);
    CREATE TABLE empty (id INTEGER);`)
  const d1 = workerdLikeD1(sqlite)
  const db = new dbModule.D1Compat(d1)
  // The pre-A0 D1Compat.get, verbatim in behaviour: first() then `?? undefined`.
  const oldGet = async (sql, params) => {
    const values = []
    const translated = sql.replace(/@(\w+)/g, (_m, name) => { values.push((params || {})[name] ?? null); return '?' })
    const row = await d1.prepare(translated).bind(...values).first()
    return row ?? undefined
  }
  const shapes = [
    ['no row', 'SELECT * FROM t WHERE id = @id', { id: 99 }],
    ['one row', 'SELECT * FROM t WHERE id = @id', { id: 1 }],
    ['many rows, first wins', 'SELECT * FROM t ORDER BY id DESC', {}],
    ['row with null columns', 'SELECT * FROM t WHERE id = @id', { id: 3 }],
    ['aggregate over nothing', 'SELECT MAX(id) AS m, COUNT(*) AS n FROM empty', {}],
    ['single null column', 'SELECT NULL AS x', {}],
    ['empty table', 'SELECT * FROM empty', {}],
  ]
  for (const [label, sql, params] of shapes) {
    const before = await oldGet(sql, params)
    const after = await db.prepare(sql).get(params)
    assert.deepStrictEqual(after, before, label)
    if (label === 'no row' || label === 'empty table') assert.equal(after, undefined, `${label}: undefined, not null`)
  }
  assert.equal((await db.prepare('SELECT * FROM t ORDER BY id DESC').get()).id, 3)
  assert.deepStrictEqual({ ...(await db.prepare('SELECT MAX(id) AS m FROM empty').get()) }, { m: null })
})

check('Server-Timing header format, authenticated responses only', async () => {
  const d1 = scriptedD1(() => ({ meta: { rows_read: 12, rows_written: 1, duration: 3.14159 }, results: [] }))
  const db = new dbModule.D1Compat(d1)
  const app = appWith((a) => {
    a.get('/api/private', async (c) => { c.set('user', { id: 1 }); await db.prepare('Q').all(); await db.prepare('Q').all(); return c.json({}) })
    a.get('/api/public', async (c) => { await db.prepare('Q').all(); return c.json({}) })
  })
  const priv = await app.request('/api/private', {}, {}, executionCtx())
  // d1w is real elapsed time (non-deterministic); everything else is exact.
  assert.match(priv.headers.get('Server-Timing'),
    /^d1;dur=6\.3;desc="rr=24 rw=2 q=2", d1n;desc="2", d1w;dur=\d+(\.\d)?, d1q;dur=6\.3, cache;desc="bypass"$/)
  const pub = await app.request('/api/public', {}, {}, executionCtx())
  assert.equal(pub.headers.get('Server-Timing'), null, 'no header without an authenticated user')
  const acc = metrics.createRequestMetrics('api', '')
  assert.equal(metrics.serverTimingHeader(acc), 'd1;dur=0;desc="rr=0 rw=0 q=0", d1n;desc="0", d1w;dur=0, d1q;dur=0, cache;desc="bypass"')
  acc.d1Region = 'APAC'
  assert.equal(metrics.serverTimingHeader(acc), 'd1;dur=0;desc="rr=0 rw=0 q=0", d1n;desc="0", d1w;dur=0, d1q;dur=0, d1r;desc="APAC", cache;desc="bypass"')
})

check('sampling: misses and bypass always, hits at 10 % with weight 10', () => {
  assert.equal(metrics.shouldSample('miss', 0.9999), true)
  assert.equal(metrics.shouldSample('bypass', 0.9999), true)
  assert.equal(metrics.shouldSample('hit', 0.0999), true)
  assert.equal(metrics.shouldSample('hit', 0.1), false)
  assert.equal(metrics.shouldSample('hit', 0.5), false)
  assert.equal(1 / metrics.sampleRate('hit'), 10)
  assert.equal(1 / metrics.sampleRate('miss'), 1)
  const acc = metrics.createRequestMetrics('api', '')
  assert.equal(metrics.cacheStateOf(acc), 'bypass')
  metrics.addCacheOutcome(acc, 'hit')
  assert.equal(metrics.cacheStateOf(acc), 'hit')
  metrics.addCacheOutcome(acc, 'miss')
  assert.equal(metrics.cacheStateOf(acc), 'miss', 'any miss makes the request a miss')
})

check('privacy: only the route template and numbers reach Analytics Engine', async () => {
  // Both clocks are driven by hand, so every double is exact and the scan
  // below covers all of them. On real clocks a wall time such as
  // 0.0425000001 contains "42" and the check went red at random (R-A0 F3).
  let requestClock = 1_000_000
  let d1Clock = 5_000
  const dataset = sink()
  const d1 = scriptedD1(() => { d1Clock += 3; return { meta: { rows_read: 7, rows_written: 0, duration: 1 }, results: [{ name: 'Sok Dara', phone: '012345678' }] } })
  const db = new dbModule.D1Compat(d1)
  const customers = new Hono()
  customers.get('/:id', async (c) => {
    c.set('user', { id: 42, username: 'cashier-nita' })
    const row = await db.prepare('SELECT').get()
    requestClock += 17
    return c.json(row)
  })
  const app = appWith((a) => a.route('/api/customers', customers), { random: () => 0, now: () => requestClock })
  performance.now = () => d1Clock
  let res
  try {
    res = await app.request('/api/customers/778899?phone=012345678&name=Sok%20Dara&amount=125.50', {}, { Business_OS_Analytics: dataset }, executionCtx())
  } finally {
    delete performance.now
  }
  assert.equal(res.status, 200)
  assert.equal(dataset.points.length, 1)
  const [point] = dataset.points
  assert.deepEqual(point.indexes, ['req_metrics'])
  assert.deepEqual(point.blobs, ['api', '/api/customers/:id', 'GET', '200', 'bypass', '', ''])
  // wall 17, D1 ms 1, rows_read 7, rows_written 0, statements 1, weight 1,
  // failed 0, late 0, D1 calls 1, D1 wall 3, primary 0.
  assert.deepEqual(point.doubles, [17, 1, 7, 0, 1, 1, 0, 0, 1, 3, 0])
  const serialized = JSON.stringify(point)
  for (const secret of ['778899', '012345678', 'Sok', 'Dara', '125.5', 'phone', 'name=', 'amount', 'cashier', '42']) {
    assert.ok(!serialized.includes(secret), `datapoint must not contain ${secret}: ${serialized}`)
  }
  assert.equal(metrics.sanitizeTemplate('/api/customers/778899?phone=1'), '(unmatched)')
  assert.equal(metrics.sanitizeTemplate(undefined), '(unmatched)')
  assert.equal(metrics.sanitizeTemplate('x'.repeat(10)), '(unmatched)')
})

check('sampled-out hit writes nothing; sampled hit carries weight 10', async () => {
  let rand = 0.5
  const dataset = sink()
  const app = appWith((a) => a.get('/api/h', (c) => { globalThis[Symbol.for(metrics.REQUEST_METRICS_HOOK_KEY)].cache('hit'); return c.json({}) }), { random: () => rand })
  await app.request('/api/h', {}, { Business_OS_Analytics: dataset }, executionCtx())
  assert.equal(dataset.points.length, 0)
  rand = 0.05
  await app.request('/api/h', {}, { Business_OS_Analytics: dataset }, executionCtx())
  assert.equal(dataset.points.length, 1)
  assert.equal(dataset.points[0].blobs[4], 'hit')
  assert.equal(dataset.points[0].doubles[5], 10)
})

check('no binding and a throwing binding are both no-ops', async () => {
  const app = appWith((a) => a.get('/api/n', (c) => { c.set('user', { id: 1 }); return c.json({ ok: 1 }, 201) }), { random: () => 0 })
  const none = await app.request('/api/n', {}, {}, executionCtx())
  assert.equal(none.status, 201)
  assert.deepEqual(await none.json(), { ok: 1 })
  const throwing = { writeDataPoint() { throw new Error('AE down') } }
  const res = await app.request('/api/n', {}, { Business_OS_Analytics: throwing }, executionCtx())
  assert.equal(res.status, 201)
  assert.deepEqual(await res.json(), { ok: 1 })
  assert.ok(res.headers.get('Server-Timing'))
  await metrics.runBackground(undefined, 'x', async () => 1)
})

check('background work gets its own label and never mixes into the route', async () => {
  const dataset = sink()
  const d1 = scriptedD1(() => ({ meta: { rows_read: 100, rows_written: 10, duration: 5 }, results: [] }))
  const db = new dbModule.D1Compat(d1)
  let acc
  const ctx = executionCtx()
  const app = appWith((a) => {
    a.use('/api/*', async (c, next) => {
      await next()
      // Same shape as index.ts's Telegram drain: after the response, off path.
      const drain = metrics.runBackground(c.env, 'telegram-drain', async () => { await db.prepare('D1').all(); await db.prepare('D2').all() })
      c.executionCtx.waitUntil(drain)
    })
    a.get('/api/r', async (c) => {
      acc = metrics.requestMetricsOf(c)
      await db.prepare('R').all()
      // Unwrapped waitUntil that resolves after the response: must be `late`.
      c.executionCtx.waitUntil((async () => { await delay(15); await db.prepare('LATE').all() })())
      return c.json({})
    })
  }, { random: () => 0 })
  await app.request('/api/r', {}, { Business_OS_Analytics: dataset }, ctx)
  await Promise.all(ctx.pending)
  assert.equal(acc.statements, 1, 'route counts only its own statement')
  assert.equal(acc.rowsRead, 100)
  assert.equal(acc.late, 1, 'post-response unwrapped work is late, not the route')
  const api = dataset.points.filter((p) => p.blobs[0] === 'api')
  const bg = dataset.points.filter((p) => p.blobs[0] === 'bg')
  assert.equal(api.length, 1)
  assert.equal(api[0].doubles[4], 1)
  assert.equal(bg.length, 1)
  assert.deepEqual(bg[0].blobs, ['bg', 'bg:telegram-drain', 'BG', 'ok', 'bypass', '', ''])
  assert.equal(bg[0].doubles[4], 2)
  assert.equal(bg[0].doubles[2], 200)
  // A failing cron step is recorded as an error and rethrown unchanged.
  const failing = new Error('step failed')
  await assert.rejects(metrics.runBackground({ Business_OS_Analytics: dataset }, 'cron:backup', async () => { await db.prepare('C').all(); throw failing }), (e) => e === failing)
  const cron = dataset.points.at(-1)
  assert.deepEqual(cron.blobs.slice(0, 4), ['bg', 'bg:cron:backup', 'BG', 'error'])
  assert.equal(cron.doubles[4], 1)
})

// Performance council addition: wall-clock around each D1 call next to
// meta.duration, so d1w - d1q is the Worker<->D1 round trip; region/primary
// when D1 reports them; no SQL text or bound value leaves the request.
check('a wrapped db records call count, wall-clock and meta.duration per call', async () => {
  const dataset = sink()
  const SECRET_SQL = 'SELECT loyalty_secret FROM customers WHERE phone = @phone'
  const regions = ['APAC', 'APAC', 'APAC', 'APAC']
  let call = 0
  const d1 = {
    prepare(sql) {
      return {
        sql,
        bind() { return this },
        async all() {
          await delay(25) // the "network": wall must cover it, meta.duration must not
          const region = regions[call++]
          return { results: [{ ok: 1 }], meta: { rows_read: 1, rows_written: 0, duration: 2, served_by_region: region, served_by_primary: true } }
        },
        async run() { throw new Error('unused') },
      }
    },
    async batch(prepared) {
      await delay(25)
      const region = regions[call++]
      return prepared.map(() => ({ results: [], meta: { rows_read: 0, rows_written: 1, duration: 1.5, served_by_region: region, served_by_primary: false } }))
    },
  }
  const db = new dbModule.D1Compat(d1)
  let acc
  const app = appWith((a) => a.get('/api/t', async (c) => {
    c.set('user', { id: 1 })
    acc = metrics.requestMetricsOf(c)
    await db.prepare(SECRET_SQL).all({ phone: '0999888777' })
    await db.prepare(SECRET_SQL).get({ phone: '0999888777' })
    await db.batch([{ sql: 'UPDATE a SET x = @x', params: { x: 'Sok Dara' } }, { sql: 'UPDATE b', params: {} }, { sql: 'UPDATE c' }])
    return c.json({})
  }), { random: () => 0 })
  const res = await app.request('/api/t', {}, { Business_OS_Analytics: dataset }, executionCtx())
  assert.equal(acc.d1Calls, 3, 'all + get + one batch = 3 calls (a batch is one round trip)')
  assert.equal(acc.statements, 5, 'the batch still counts 3 statements')
  assert.ok(Math.abs(acc.d1Ms - (2 + 2 + 1.5 * 3)) < 1e-9, `meta.duration sum ${acc.d1Ms}`)
  assert.ok(acc.d1WallMs >= 3 * 20, `wall-clock covers the three 25 ms round trips: ${acc.d1WallMs}`)
  assert.ok(acc.d1WallMs > acc.d1Ms, 'wall includes the round trip meta.duration does not')
  assert.equal(acc.d1Region, 'APAC')
  assert.equal(acc.d1Primary, 2, 'two calls reported served_by_primary')
  const header = res.headers.get('Server-Timing')
  assert.match(header, /d1n;desc="3"/)
  assert.match(header, /d1q;dur=8\.5/)
  assert.match(header, /d1r;desc="APAC"/)
  const wallFromHeader = Number(header.match(/d1w;dur=([\d.]+)/)[1])
  assert.ok(wallFromHeader >= 60, `d1w in header: ${wallFromHeader}`)
  const [point] = dataset.points
  assert.equal(point.blobs[6], 'APAC')
  assert.equal(point.doubles[8], 3, 'double9 = D1 calls')
  assert.ok(point.doubles[9] >= 60, 'double10 = D1 wall ms')
  assert.ok(Math.abs(point.doubles[1] - 8.5) < 1e-9, 'double2 = meta.duration sum')
  assert.equal(point.doubles[10], 2, 'double11 = primary-served calls')
  for (const leaked of ['loyalty_secret', 'customers', 'phone', '0999888777', 'Sok', 'UPDATE']) {
    assert.ok(!JSON.stringify(point).includes(leaked), `datapoint leaks ${leaked}`)
    assert.ok(!header.includes(leaked), `header leaks ${leaked}`)
  }
  // Calls served from different regions report 'mixed'; odd region text is 'other'.
  const mixed = metrics.createRequestMetrics('api', '')
  metrics.addD1Call(mixed, 1, [{ served_by_region: 'APAC' }])
  metrics.addD1Call(mixed, 1, [{ served_by_region: 'WEUR' }])
  assert.equal(mixed.d1Region, 'mixed')
  assert.equal(metrics.sanitizeRegion('select * from x'), 'other')
  assert.equal(metrics.sanitizeRegion(undefined), '')
})

check('a retried call counts both round trips but not the back-off sleep', async () => {
  let attempts = 0
  const d1 = {
    prepare() {
      return {
        bind() { return this },
        async all() {
          attempts++
          await delay(10)
          if (attempts === 1) throw new Error('D1_ERROR: internal error') // transient: withD1Retry sleeps 200 ms
          return { results: [{ ok: 1 }], meta: { rows_read: 1, duration: 1 } }
        },
      }
    },
    async batch() { throw new Error('unused') },
  }
  const db = new dbModule.D1Compat(d1)
  let acc
  const app = appWith((a) => a.get('/api/retry', async (c) => { acc = metrics.requestMetricsOf(c); await db.prepare('Q').all(); return c.json({}) }))
  await app.request('/api/retry', {}, {}, executionCtx())
  assert.equal(acc.d1Calls, 2)
  assert.equal(acc.failed, 1)
  assert.equal(acc.statements, 1)
  assert.ok(acc.d1WallMs >= 15 && acc.d1WallMs < 150, `two ~10 ms attempts, not the 200 ms sleep: ${acc.d1WallMs}`)
})

check('cachedJsonResponse marks miss, then hit, on the request', async () => {
  const entries = new Map()
  global.caches = { default: {
    match: async (req) => entries.get(req.url)?.clone(),
    put: async (req, res) => { entries.set(req.url, res.clone()) },
  } }
  let produced = 0
  const app = appWith((a) => a.get('/api/c', async (c) => {
    c.set('user', { id: 1 })
    const value = await cacheModule.cachedJsonResponse(c.req.raw, c.executionCtx, 'k2:1', 20, async () => { produced++; return { n: 1 } })
    return c.json(value)
  }))
  const ctx1 = executionCtx()
  const first = await app.request('http://x/api/c?q=1', {}, {}, ctx1)
  await Promise.all(ctx1.pending)
  assert.match(first.headers.get('Server-Timing'), /cache;desc="miss"$/)
  const second = await app.request('http://x/api/c?q=1', {}, {}, executionCtx())
  assert.match(second.headers.get('Server-Timing'), /cache;desc="hit"$/)
  assert.equal(produced, 1)
  delete global.caches
})

check('a read-only response header does not break the response', async () => {
  const app = appWith((a) => a.get('/api/ro', (c) => {
    c.set('user', { id: 1 })
    return Response.redirect('https://example.com/', 302) // immutable headers
  }))
  const res = await app.request('/api/ro', {}, {}, executionCtx())
  assert.equal(res.status, 302)
})

;(async () => {
  let failed = 0
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`ok - ${name}`) } catch (error) { failed++; console.error(`not ok - ${name}\n  ${error && error.stack || error}`) }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`)
  if (failed) process.exit(1)
})()

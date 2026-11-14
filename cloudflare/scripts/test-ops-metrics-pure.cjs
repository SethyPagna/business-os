#!/usr/bin/env node
// Offline checks for the Analytics Engine metrics reader (ops/scripts/ops-metrics.mjs, its query templates in
// ops/scripts/metrics/ and .github/workflows/metrics.yml). A fake fetch stands in for Cloudflare.
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const ts = require('typescript')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

const ACCOUNT = '0123456789abcdef0123456789abcdef'
const TOKEN = 'test-token-not-a-real-one'

let passed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (err) {
    console.error(`FAIL ${name}\n  ${err && err.stack}`)
    process.exitCode = 1
  }
}

function requestMetricsModule() {
  const js = ts.transpileModule(read('cloudflare', 'src', 'lib', 'requestMetrics.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const m = { exports: {} }
  const hookKey = Symbol.for('business-os.request-metrics.v1')
  const liveHook = globalThis[hookKey]
  try {
    new Function('require', 'module', 'exports', `var __WORKER_BUILD_REVISION__ = "c0ffee12ab34";\n${js}`)(require, m, m.exports)
  } finally {
    globalThis[hookKey] = liveHook
  }
  return m.exports
}

function fakeAnalytics(answers) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    const name = /blob8 AS revision/.test(init.body) ? 'build-revisions' : /AS shape\b/.test(init.body) ? 'request-shapes' : /index1 = 'report_atomic_shadow'/.test(init.body) ? 'report-atomic-shadow' : /blob1 = 'bg'/.test(init.body) ? 'background-runs' : /blob4 AS status/.test(init.body) ? 'route-errors' : 'route-latency'
    const answer = answers[name] || { status: 200, data: [] }
    const body = answer.raw !== undefined ? answer.raw : JSON.stringify({ meta: [], data: answer.data, rows: answer.data.length })
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, text: async () => body }
  }
  return { calls, fetchImpl }
}

;(async () => {
  const metrics = await load('ops/scripts/ops-metrics.mjs')
  const common = await load('ops/scripts/ops-common.mjs')

  await check('trading windows: 01:00-13:00 UTC of each business date, 1 to 7 days, real dates only', () => {
    assert.deepStrictEqual(metrics.tradingWindows('2026-09-29', '1'), [{ businessDate: '2026-09-29', start: '2026-09-29 01:00:00', end: '2026-09-29 13:00:00' }])
    assert.deepStrictEqual(metrics.tradingWindows('2026-09-30', 3).map((w) => [w.start, w.end]), [
      ['2026-09-30 01:00:00', '2026-09-30 13:00:00'],
      ['2026-10-01 01:00:00', '2026-10-01 13:00:00'],
      ['2026-10-02 01:00:00', '2026-10-02 13:00:00'],
    ])
    for (const [from, days, code] of [['2026-02-30', 1, 'metrics-bad-from'], ['2026-9-29', 1, 'metrics-bad-from'], ["2026-09-29'", 1, 'metrics-bad-from'],
      ['2026-09-29', 0, 'metrics-bad-days'], ['2026-09-29', 8, 'metrics-bad-days'], ['2026-09-29', '1.5', 'metrics-bad-days'], ['2026-09-29', 'x', 'metrics-bad-days']]) {
      assert.throws(() => metrics.tradingWindows(from, days), (e) => e instanceof common.OpsError && e.code === code, `${from} ${days}`)
    }
  })

  const windows = metrics.tradingWindows('2026-09-29', 2)
  const templates = Object.fromEntries(metrics.QUERY_NAMES.map((name) => [name, metrics.loadTemplate(name)]))

  await check('queries: comments dropped, the window once, a revision filter only when asked, nothing injectable', () => {
    for (const [name, template] of Object.entries(templates)) {
      const sql = metrics.buildQuery(template, { windows })
      assert.ok(!/\{\{|--|;/.test(sql), `${name}: placeholder, comment or semicolon left`)
      assert.strictEqual(sql.split("timestamp >= toDateTime('2026-09-29 01:00:00') AND timestamp < toDateTime('2026-09-29 13:00:00')").length, 2, `${name}: day 1 window`)
      assert.strictEqual(sql.split("timestamp >= toDateTime('2026-09-30 01:00:00') AND timestamp < toDateTime('2026-09-30 13:00:00')").length, 2, `${name}: day 2 window`)
      assert.ok(/AND \(\(timestamp >= [^\n]* OR \(timestamp >= [^\n]*\)\)/.test(sql), `${name}: the day windows are OR-ed inside one AND group`)
      assert.ok(!/blob8 =/.test(sql), `${name}: no build filter unless asked`)
      assert.ok(/\bFROM Business_OS_Analytics\b/.test(sql) && (name === 'report-atomic-shadow' ? /\bindex1 = 'report_atomic_shadow'/ : /\bindex1 = 'req_metrics'/).test(sql), `${name}: dataset and index`)
    }
    const filtered = metrics.buildQuery(templates['route-latency'], { windows, revision: 'c0ffee12ab34-dirty' })
    assert.ok(filtered.includes(") AND blob8 = 'c0ffee12ab34-dirty'"), filtered)
    for (const bad of ["x' OR '1'='1", 'a b', 'x'.repeat(65), 'rev;']) {
      assert.throws(() => metrics.buildQuery(templates['route-latency'], { windows, revision: bad }), (e) => e.code === 'metrics-bad-revision', bad)
    }
    assert.throws(() => metrics.buildQuery('SELECT 1 WHERE ({{WINDOW}}) AND ({{WINDOW}})', { windows }), (e) => e.code === 'metrics-bad-template')
    assert.throws(() => metrics.buildQuery('SELECT 1', { windows }), (e) => e.code === 'metrics-bad-template')
    assert.throws(() => metrics.loadTemplate('../queries/product-names'), (e) => e.code === 'metrics-unknown-query')
  })

  await check('templates read the datapoint layout lib/requestMetrics.ts writes, from the dataset wrangler binds', () => {
    const dataset = /\[\[analytics_engine_datasets\]\]\s*binding = "Business_OS_Analytics"\s*dataset = "([^"]+)"/.exec(read('cloudflare', 'wrangler.toml'))
    assert.ok(dataset, 'wrangler.toml binds Business_OS_Analytics')
    const rm = requestMetricsModule()
    assert.strictEqual(rm.METRICS_ANALYTICS_KIND, 'req_metrics')
    const acc = { ...rm.createRequestMetrics('api', '', 0), d1Ms: 2, rowsRead: 3, rowsWritten: 4, statements: 5, failed: 7, late: 8, d1Calls: 9, d1WallMs: 10, d1Primary: 11, d1Region: 'APAC' }
    const point = { kind: 'api', template: '/api/t', method: 'GET', status: '200', cache: 'miss', flags: 'f=on', wallMs: 1, weight: 6, acc }
    const blob = Object.fromEntries(rm.datapointLabels(point).map((value, i) => [`blob${i + 1}`, value]))
    const double = Object.fromEntries(rm.datapointValues(point).map((value, i) => [`double${i + 1}`, value]))
    assert.deepStrictEqual([blob.blob1, blob.blob2, blob.blob3, blob.blob4, blob.blob5, blob.blob8], ['api', '/api/t', 'GET', '200', 'miss', 'c0ffee12ab34'])
    assert.deepStrictEqual([double.double1, double.double3, double.double5, double.double6, double.double9, double.double10], [1, 3, 5, 6, 9, 10])
    const latency = metrics.buildQuery(templates['route-latency'], { windows })
    for (const [column, as] of [['blob2', 'route'], ['blob3', 'method'], ['blob5', 'cache']]) assert.ok(latency.includes(`${column} AS ${as}`), `${column} AS ${as}`)
    assert.ok(latency.includes('quantileExactWeighted(0.50)(double1, _sample_interval) AS wall_p50_ms'), 'p50 of the wall time (double1), weighted like the p95')
    assert.ok(latency.includes('quantileExactWeighted(0.95)(double1, _sample_interval) AS wall_p95_ms'), 'p95 of the wall time (double1)')
    assert.ok(latency.includes('quantileExactWeighted(0.95)(double10, _sample_interval) AS d1_wall_p95_ms'), 'p95 of the D1 wall time (double10)')
    assert.ok(latency.includes('SUM(_sample_interval * double6) AS requests'), 'both samplings weigh the request count')
    assert.ok(latency.includes('SUM(_sample_interval * double6 * double9) / SUM(_sample_interval * double6) AS d1_calls_avg'))
    assert.ok(latency.includes("blob1 = 'api'") && latency.includes("blob4 >= '200' AND blob4 < '400'"), 'successful API requests only')
    assert.ok(/GROUP BY route, method, cache\b/.test(latency), 'one cache state per group')
    const errors = metrics.buildQuery(templates['route-errors'], { windows })
    assert.ok(errors.includes("NOT (blob4 >= '200' AND blob4 < '400')") && errors.includes('blob4 AS status'), 'errors are the complement, by status')
    assert.ok(metrics.buildQuery(templates['build-revisions'], { windows }).includes('blob8 AS revision'), 'builds read blob8')
    for (const sql of Object.values(templates)) assert.ok(sql.includes(`FROM ${dataset[1]}`), 'the dataset wrangler.toml binds')
  })

  await check('the cron runs inside the trading window are bg rows that latency and errors leave out, and the window\'s comment names them', () => {
    const cron = /^crons = \[(.*)\]$/m.exec(read('cloudflare', 'wrangler.toml').replace(/\r\n/g, '\n'))
    assert.ok(cron, 'wrangler.toml has crons')
    const minutes = [...cron[1].matchAll(/"\*\/(\d+) \* \* \* \*"/g)].map((m) => Number(m[1]))
    assert.ok(minutes.length >= 1 && minutes.every((n) => n > 0 && n <= 60), 'wrangler.toml runs its crons every N minutes (the rotating cron)')
    const source = read('ops', 'scripts', 'ops-metrics.mjs').replace(/\r\n/g, '\n').split('\n')
    const at = source.findIndex((line) => line.startsWith('export const TRADING_HOURS_UTC'))
    let first = at
    while (first > 0 && source[first - 1].startsWith('//')) first -= 1
    const comment = source.slice(first, at).join(' ')
    for (const n of minutes) assert.ok(new RegExp(`every ${n}\\b`).test(comment), `the comment must name the every-${n}-minutes cron run: ${comment}`)
    assert.ok(!/cron[^.;]*fall outside/.test(comment), `the comment still says the cron falls outside: ${comment}`)
    const rm = requestMetricsModule()
    const cronPoint = { kind: 'bg', template: 'cron', method: '', status: '', cache: '', flags: '', wallMs: 1, weight: 1, acc: rm.createRequestMetrics('bg', 'cron', 0) }
    assert.strictEqual(rm.datapointLabels(cronPoint)[0], 'bg')
    for (const name of ['route-latency', 'route-errors']) assert.ok(metrics.buildQuery(templates[name], { windows }).includes("blob1 = 'api'"), `${name} reads API rows only`)
    assert.ok(!metrics.buildQuery(templates['build-revisions'], { windows }).includes('blob1'), 'the builds list counts every kind')
  })

  await check('request shapes and background runs: registered, read the layout lib/requestMetrics.ts writes, same template rules, and the datapoint they read exists', () => {
    assert.deepStrictEqual([...metrics.QUERY_NAMES], ['route-latency', 'route-errors', 'build-revisions', 'request-shapes', 'background-runs', 'report-atomic-shadow'])
    const rm = requestMetricsModule()
    const shapes = metrics.buildQuery(templates['request-shapes'], { windows })
    const labels = [...shapes.matchAll(/blob6 LIKE 'shape=([a-z0-9_]+)%', '([a-z0-9_]+)'/g)]
    assert.ok(labels.length >= 15 && labels.every((m) => m[1] === m[2]), 'every shape constant maps to itself')
    const emitted = [...new Set(['default', 'filter', 'text', 'barcode', 'ids', 'rank_le20', 'rank_lt300', 'rank_le1500', 'rank_gt1500',
      rm.salesStatsShape({}), rm.salesStatsShape({ startDate: 'a', endDate: 'a' }), rm.salesStatsShape({ startDate: 'a', endDate: 'b' }), rm.salesStatsShape({ q: 'x' }),
      rm.customersShape({ fields: 'sales_picker' }), rm.customersShape({ fields: 'sales_picker', q: 'x' }), rm.customersShape({}), rm.customersShape({ q: 'x' })])]
    for (const label of emitted) assert.ok(labels.some((m) => m[1] === label), `request-shapes.sql names the shape ${label}`)
    for (const query of [{}, { category: 'x' }, { query: 'x' }, { query: '123456' }, { ids: '1' }, { rankIds: '1' }, { rankIds: Array(21).fill(1).join(',') }, { rankIds: Array(300).fill(1).join(',') }, { rankIds: Array(1501).fill(1).join(',') }]) {
      assert.ok(labels.some((m) => m[1] === rm.productsSearchShape(query)), `products/search shape ${rm.productsSearchShape(query)} is named in the SQL`)
    }
    assert.ok(shapes.includes("blob1 = 'api'") && shapes.includes("blob6 LIKE 'shape=%'") && shapes.includes('GROUP BY route, method, shape, cache'), 'api rows with a shape, one cache state per group')
    assert.ok(shapes.includes('SUM(_sample_interval * double6 * double3) AS rows_read_total'), 'rows read, both samplings')
    const point = { kind: 'api', template: '/api/products/search', method: 'GET', status: '200', cache: 'miss', flags: rm.flagsWithShape('default', 'ic_simple=on'), wallMs: 1, weight: 1, acc: rm.createRequestMetrics('api', '', 0) }
    assert.ok(rm.datapointLabels(point)[5].startsWith('shape=default;'), 'blob6 leads with the shape')
    const background = metrics.buildQuery(templates['background-runs'], { windows })
    for (const part of ["blob1 = 'bg'", 'blob2 AS label', 'blob4 AS status', 'SUM(_sample_interval * double6) AS runs', 'SUM(_sample_interval * double6 * double9) AS d1_calls',
      'SUM(_sample_interval * double6 * double3) AS rows_read', 'SUM(_sample_interval * double6 * double4) AS rows_written', 'SUM(_sample_interval * double6 * double5) AS statements',
      'GROUP BY day, label, status', "toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day"]) assert.ok(background.includes(part), part)
    assert.ok(!/blob4 >= /.test(background), 'every status counts: a failed background run still spent its rows')
    const bg = rm.createRequestMetrics('bg', 'cron:backup', 0)
    assert.strictEqual(rm.datapointLabels({ kind: 'bg', template: 'bg:cron:backup', method: 'BG', status: 'ok', cache: 'bypass', flags: '', wallMs: 1, weight: 1, acc: bg })[0], 'bg')
  })

  await check('report atomic shadow: registered, reads the datapoint lib/reportAtomicSwitch.ts writes, no revision filter', async () => {
    const sql = metrics.buildQuery(templates['report-atomic-shadow'], { windows, revision: 'c0ffee12ab34' })
    for (const part of ["index1 = 'report_atomic_shadow'", 'blob1 AS route', 'blob2 AS outcome', 'blob3 AS first_diff_path', 'SUM(_sample_interval) AS comparisons', 'SUM(_sample_interval * double1) AS served_bytes', 'GROUP BY day, route, outcome, first_diff_path']) assert.ok(sql.includes(part), part)
    assert.ok(!sql.includes('blob8'), 'shadow rows keep differing paths in blob8, not a build revision')
    const src = read('cloudflare', 'src', 'lib', 'reportAtomicSwitch.ts')
    assert.ok(src.includes("kind: 'report_atomic_shadow', labels: [route, outcome, ...detail.slice(0, 6)], values: [servedJson.length]"), 'the writer layout the query reads')
    const fake = fakeAnalytics({
      'report-atomic-shadow': { status: 200, data: [{ day: '2026-09-29 00:00:00', route: 'periods', outcome: 'match', first_diff_path: '', comparisons: '9', served_bytes: '1000' }] },
      'build-revisions': { status: 200, data: [{ revision: 'dev' }] },
    })
    const result = await metrics.readMetrics({ fetchImpl: fake.fetchImpl, accountId: ACCOUNT, token: TOKEN, from: '2026-09-29', days: 1 })
    assert.strictEqual(result.ok, true)
    assert.deepStrictEqual(result.shadow.map((r) => [r.route, r.outcome, r.comparisons]), [['periods', 'match', 9]])
  })

  await check('report atomic shadow: one query per whole Cambodia business day, and the flip needs comparisons on every day', async () => {
    const day = metrics.businessDayWindow({ businessDate: '2026-11-14' })
    assert.deepStrictEqual([day.start, day.end], ['2026-11-13 17:00:00', '2026-11-14 17:00:00'], 'the whole business day, night hours included')
    const fake = fakeAnalytics({
      'report-atomic-shadow': { status: 200, data: [{ day: '2026-11-14 00:00:00', route: 'periods', outcome: 'match', first_diff_path: '', comparisons: '40', served_bytes: '1' }] },
      'build-revisions': { status: 200, data: [{ revision: 'dev' }] },
    })
    const result = await metrics.readMetrics({ fetchImpl: fake.fetchImpl, accountId: ACCOUNT, token: TOKEN, from: '2026-11-14', days: 3 })
    const shadowCalls = fake.calls.filter((c) => /index1 = 'report_atomic_shadow'/.test(c.init.body))
    assert.strictEqual(shadowCalls.length, 3, 'one shadow query per day')
    assert.ok(shadowCalls[0].init.body.includes("timestamp >= toDateTime('2026-11-13 17:00:00') AND timestamp < toDateTime('2026-11-14 17:00:00')"), shadowCalls[0].init.body)
    assert.deepStrictEqual(result.shadow.map((r) => r.business_date), ['2026-11-14', '2026-11-15', '2026-11-16'])
    assert.strictEqual(result.shadowSummary.flipReady, true)
    const w = metrics.tradingWindows('2026-11-14', 3)
    const row = (date, outcome, n) => ({ business_date: date, outcome, comparisons: String(n) })
    const clean = [row('2026-11-14', 'match', 50), row('2026-11-15', 'match', 50), row('2026-11-16', 'match', 50)]
    assert.strictEqual(metrics.summarizeShadow(clean, w).flipReady, true)
    assert.strictEqual(metrics.summarizeShadow(clean.slice(0, 2), w).flipReady, false, 'a day with no comparisons blocks the flip')
    assert.strictEqual(metrics.summarizeShadow([], w).flipReady, false, 'no rows is not a pass')
    assert.strictEqual(metrics.summarizeShadow(clean, w.slice(0, 2)).flipReady, false, 'fewer than 3 days')
    assert.strictEqual(metrics.summarizeShadow([...clean, row('2026-11-15', 'mismatch', 1)], w).flipReady, false)
    assert.strictEqual(metrics.summarizeShadow([...clean, row('2026-11-15', 'timeout', 1)], w).error, 1, 'an unknown outcome counts as an error')
    assert.strictEqual(metrics.summarizeShadow([...clean, row('2026-11-15', 'write_between', 15)], w).flipReady, true, '15 of 165 unjudged is under 10%')
    assert.strictEqual(metrics.summarizeShadow([...clean, row('2026-11-15', 'refused:too_big', 20)], w).flipReady, false, '20 of 170 unjudged is over 10%')
    const text = metrics.publicLines({ result }).map(([t, v]) => common.formatPublic(t, v)).join('\n')
    assert.ok(text.includes('report atomic shadow: 3 of 3 business days compared; comparisons 120, match 120, mismatch 0'), text)
    assert.ok(text.includes('report atomic flip ready: yes'), text)
    assert.ok(!text.includes('periods'), 'the public log names no route')
  })

  await check('request-shape and background rows reach the result as numbers and strings; the public log counts them and names nothing', async () => {
    const fake = fakeAnalytics({
      'request-shapes': { status: 200, data: [{ route: '/api/products/search', method: 'GET', shape: 'default', cache: 'miss', requests: '12', rows_read_total: '540000', rows_read_avg: '45000', d1_calls_avg: '11', wall_p95_ms: 'x' }] },
      'background-runs': { status: 200, data: [{ day: '2026-09-29 00:00:00', label: 'bg:cron:backup', status: 'ok', runs: '2', d1_calls: '40', rows_read: '800000', rows_written: '10' }, { day: '2026-09-29 00:00:00', label: 'bg:telegram-drain', status: 'ok', runs: '5', rows_read: '50' }] },
      'build-revisions': { status: 200, data: [{ revision: 'dev' }] },
    })
    const result = await metrics.readMetrics({ fetchImpl: fake.fetchImpl, accountId: ACCOUNT, token: TOKEN, from: '2026-09-29', days: 1 })
    assert.strictEqual(result.ok, true)
    assert.deepStrictEqual(result.shapes, [{ route: '/api/products/search', method: 'GET', shape: 'default', cache: 'miss', requests: 12, rows_read_total: 540000, rows_read_avg: 45000, d1_calls_avg: 11, wall_p95_ms: null }])
    assert.deepStrictEqual(result.background.map((r) => [r.label, r.runs, r.rows_read]), [['bg:cron:backup', 2, 800000], ['bg:telegram-drain', 5, 50]])
    const text = metrics.publicLines({ result }).map(([t, v]) => common.formatPublic(t, v)).join('\n')
    assert.ok(text.includes('request shape groups: 1; background labels: 2'), text)
    for (const secret of ['backup', 'telegram', '540000', '800000', '/api/']) assert.ok(!text.includes(secret), `public log carries ${secret}`)
    const failed = await metrics.readMetrics({ fetchImpl: fakeAnalytics({ 'background-runs': { status: 500, raw: 'boom' }, 'build-revisions': { status: 200, data: [{ revision: 'dev' }] } }).fetchImpl, accountId: ACCOUNT, token: TOKEN, from: '2026-09-29', days: 1 })
    assert.deepStrictEqual(failed.problems, ['metrics-background-runs-failed'])
  })

  await check('latency rows: flows attached, numbers normalised, p95 withheld below 100 stored rows', () => {
    const [search, sale, other] = metrics.summarizeLatency([
      { route: '/api/products/search', method: 'GET', cache: 'hit', requests: '4000', stored_rows: '400', wall_p50_ms: 20, wall_p95_ms: 80.5, d1_wall_p95_ms: 30, d1_calls_avg: 2, statements_avg: 3, rows_read_avg: 50 },
      { route: '/api/sales/', method: 'post', cache: 'bypass', requests: 99, stored_rows: '99', wall_p50_ms: 120, wall_p95_ms: 400, d1_wall_p95_ms: 200, d1_calls_avg: 18, statements_avg: 40, rows_read_avg: 90 },
      { route: '/api/unknown/:id', method: 'GET', cache: 'miss', requests: 100, stored_rows: 100, wall_p50_ms: 'x', wall_p95_ms: 9, d1_wall_p95_ms: 1, d1_calls_avg: 1, statements_avg: 1, rows_read_avg: 1 },
    ])
    assert.deepStrictEqual([search.flow, search.primary, search.storedRows, search.enough, search.wallP95Ms, search.requests], ['pos-search', true, 400, true, 80.5, 4000])
    assert.deepStrictEqual([sale.flow, sale.enough, sale.wallP95Ms, sale.d1WallP95Ms, sale.wallP50Ms, sale.d1CallsAvg], ['checkout', false, null, null, 120, 18])
    assert.deepStrictEqual([other.flow, other.enough, other.wallP95Ms, other.wallP50Ms], [null, true, 9, null])
    assert.deepStrictEqual(metrics.flowOf('/api/products', 'POST'), { flow: 'product-edit', primary: true })
    assert.deepStrictEqual(metrics.flowOf('/api/products', 'GET'), { flow: 'pos-search', primary: false })
    assert.strictEqual(metrics.flowOf('/api/auth/me', 'GET').flow, 'control')
  })

  await check('the SQL API call: one POST per query to the account analytics_engine/sql path, raw SQL body, bearer token', async () => {
    const fake = fakeAnalytics({ 'build-revisions': { status: 200, data: [{ revision: 'c0ffee12ab34', requests: 10, stored_rows: 10 }] } })
    const result = await metrics.readMetrics({ fetchImpl: fake.fetchImpl, accountId: ACCOUNT, token: TOKEN, from: '2026-09-29', days: '1', revision: 'c0ffee12ab34' })
    assert.strictEqual(result.ok, true, JSON.stringify(result.problems))
    assert.strictEqual(fake.calls.length, metrics.QUERY_NAMES.length)
    for (const { url, init } of fake.calls) {
      assert.strictEqual(url, `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/analytics_engine/sql`)
      assert.strictEqual(init.method, 'POST')
      assert.strictEqual(init.headers.authorization, `Bearer ${TOKEN}`)
      assert.strictEqual(init.headers['content-type'], 'text/plain')
      assert.ok(/^SELECT /.test(init.body), 'the body is the SQL itself, not JSON')
    }
    const bodies = fake.calls.map((c) => c.init.body)
    assert.deepStrictEqual(metrics.QUERY_NAMES.map((name, i) => [name, bodies[i].includes("blob8 = 'c0ffee12ab34'")]), [['route-latency', true], ['route-errors', true], ['build-revisions', false], ['request-shapes', true], ['background-runs', true], ['report-atomic-shadow', false]], 'the build filter narrows every query but the builds list')
    await assert.rejects(metrics.readMetrics({ fetchImpl: fake.fetchImpl, accountId: 'not-an-account', token: TOKEN, from: '2026-09-29', days: 1 }), (e) => e.code === 'bad-account-id')
  })

  await check('a read that saw nothing fails, and so does any failed query; statuses reach the public log, bodies do not', async () => {
    const empty = await metrics.readMetrics({ fetchImpl: fakeAnalytics({}).fetchImpl, accountId: ACCOUNT, token: TOKEN, from: '2026-09-29', days: 1 })
    assert.deepStrictEqual([empty.ok, empty.problems], [false, ['metrics-no-datapoints']], 'no datapoint at all is a failed read, not a quiet day')
    const served = fakeAnalytics({ 'build-revisions': { status: 200, data: [{ revision: 'c0ffee12ab34-dirty' }, { revision: 'dev' }] } }).fetchImpl
    for (const revision of ['c0ffee12ab35', 'c0ffee12ab34', 'c0ffee12']) {
      const unserved = await metrics.readMetrics({ fetchImpl: served, accountId: ACCOUNT, token: TOKEN, from: '2026-09-29', days: 1, revision })
      assert.deepStrictEqual([unserved.ok, unserved.problems], [false, ['metrics-revision-not-served']], `a build filter that matches no build in the window (${revision}) is a failed read, not a quiet build`)
      const unservedLog = metrics.publicLines({ result: unserved }).map(([t, v]) => common.formatPublic(t, v)).join('\n')
      assert.ok(unservedLog.includes('problem: metrics-revision-not-served') && unservedLog.includes('metrics verdict: FAIL') && !unservedLog.includes('c0ffee'), unservedLog)
    }
    const matched = await metrics.readMetrics({ fetchImpl: served, accountId: ACCOUNT, token: TOKEN, from: '2026-09-29', days: 1, revision: 'c0ffee12ab34-dirty' })
    assert.deepStrictEqual([matched.ok, matched.problems], [true, []], 'the exact stamp of a served build passes with no route rows')
    const denied = await metrics.readMetrics({
      fetchImpl: fakeAnalytics({ 'route-latency': { status: 403, raw: '{"errors":[{"code":10000,"message":"Authentication error for /api/secret-route"}]}' }, 'build-revisions': { status: 200, data: [{ revision: 'dev' }] } }).fetchImpl,
      accountId: ACCOUNT, token: TOKEN, from: '2026-09-29', days: 1,
    })
    assert.deepStrictEqual([denied.ok, denied.problems], [false, ['metrics-route-latency-failed']])
    const text = metrics.publicLines({ result: denied, bytes: 123 }).map(([t, v]) => common.formatPublic(t, v)).join('\n')
    assert.ok(text.includes('query route-latency: HTTP 403') && text.includes('problem: metrics-route-latency-failed') && text.includes('metrics verdict: FAIL'), text)
    assert.ok(!/secret-route|Authentication|10000/.test(text), 'the error body stays in the encrypted file')
    const garbage = await metrics.readMetrics({
      fetchImpl: fakeAnalytics({ 'route-errors': { status: 200, raw: 'not json' }, 'build-revisions': { status: 200, data: [{ revision: 'dev' }] } }).fetchImpl,
      accountId: ACCOUNT, token: TOKEN, from: '2026-09-29', days: 1,
    })
    assert.deepStrictEqual(garbage.problems, ['metrics-route-errors-failed'], 'a 200 without a data array is a failed query')
  })

  await check('public log: counts and verdict only; the report on disk is encrypted and alone', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-metrics-'))
    try {
      const fake = fakeAnalytics({
        'route-latency': { status: 200, data: [{ route: '/api/products/search', method: 'GET', cache: 'hit', requests: 5000, stored_rows: 500, wall_p50_ms: 21, wall_p95_ms: 87.25, d1_wall_p95_ms: 33, d1_calls_avg: 2, statements_avg: 2, rows_read_avg: 40 }] },
        'build-revisions': { status: 200, data: [{ revision: 'c0ffee12ab34', requests: 5000, stored_rows: 500 }] },
      })
      const env = { OPS_OUT_DIR: tmp, CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT, OPS_METRICS_FROM: '2026-09-29', OPS_METRICS_DAYS: '1' }
      const { result, lines } = await metrics.runMetrics({ env, fetchImpl: fake.fetchImpl })
      assert.strictEqual(result.ok, true)
      const text = lines.map(([t, v]) => common.formatPublic(t, v)).join('\n')
      assert.ok(text.includes('route groups: 1') && text.includes('metrics verdict: PASS') && text.includes('window: 1 trading days, one build only: no'), text)
      for (const secret of ['/api/', '87.25', '5000', '500', 'c0ffee', TOKEN, ACCOUNT]) assert.ok(!text.includes(secret), `public log carries ${secret}`)
      const written = fs.readdirSync(tmp)
      assert.strictEqual(written.length, 1, `exactly one file on disk: ${written.join(', ')}`)
      assert.match(written[0], /^metrics-[A-Za-z0-9-]+\.enc\.json$/, 'named metrics-<run id or local>.enc.json')
      const file = fs.readFileSync(path.join(tmp, written[0]), 'utf8')
      for (const secret of ['/api/products/search', '87.25', TOKEN]) assert.ok(!file.includes(secret), `the report is not encrypted: ${secret}`)
      await assert.rejects(metrics.runMetrics({ env: { ...env, OPS_METRICS_FROM: '' }, fetchImpl: fake.fetchImpl }), (e) => e.code === 'missing-environment')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  await check('ops-metrics.mjs prints only through the public-log formatter, fetches once, imports only ops-common and node built-ins', () => {
    const source = read('ops', 'scripts', 'ops-metrics.mjs')
    const count = (re) => (source.match(re) || []).length
    assert.strictEqual(count(/process\.stdout\.write\(|console\.\w+\(/g), 0, 'no direct printing')
    assert.strictEqual(count(/\bspawn|child_process|execSync|execFile/g), 0, 'no child process')
    assert.strictEqual(count(/\bfetchImpl\(/g), 1, 'one outbound call site')
    assert.ok(source.includes('`${API_BASE}/accounts/${accountId}/analytics_engine/sql`'), 'the only URL is the SQL API of the account')
    assert.deepStrictEqual([...source.matchAll(/\bfrom '([^']+)'/g)].map((m) => m[1]).sort(), ['./ops-common.mjs', 'node:fs', 'node:path', 'node:url'])
    assert.deepStrictEqual([...source.matchAll(/\b(say|summary)\(\s*([^,]+),/g)].map((m) => `${m[1]}(${m[2]})`), ['say(template)', 'summary(template)'], 'every public line comes from publicLines()')
    for (const m of source.matchAll(/new OpsError\(\s*([^,)]+)/g)) assert.ok(/^'[a-z][a-z0-9-]*'$/.test(m[1]) || m[1] === 'problem', `new OpsError(${m[1]})`)
  })

  await check('metrics.yml: manual, read-only token scope, ordinal confirm before and after approval, secrets only in the script step', () => {
    const wf = read('.github', 'workflows', 'metrics.yml').replace(/\r\n/g, '\n')
    assert.ok(/^on:\n {2}workflow_dispatch:\n/m.test(wf) && !/^ {2}(push|pull_request|schedule|workflow_run):/m.test(wf), 'manual trigger only')
    assert.ok(/^permissions:\n {2}contents: read\n/m.test(wf), 'contents: read only')
    const confirm = /if \(-not \[string\]::Equals\(\$env:CONFIRM, 'metrics', \[System\.StringComparison\]::Ordinal\)\) \{/g
    assert.strictEqual((wf.match(confirm) || []).length, 2, 'the gate job and the metrics job both compare ordinally')
    assert.ok(!/\s-[ci]?(ne|eq|like|match)\b/i.test(wf), 'no culture-aware PowerShell comparison')
    assert.ok(/ {2}metrics:\n {4}name: metrics\n {4}needs: gate\n/.test(wf) && /environment: production/.test(wf), 'the read waits for the gate and the production reviewer')
    for (const line of wf.split('\n').filter((l) => l.includes('${{'))) {
      assert.ok(/^\s+[A-Z_]+: \$\{\{ (inputs\.[a-z]+|secrets\.CLOUDFLARE_(API_TOKEN|ACCOUNT_ID)|runner\.temp) \}\}(\/ops-out)?$/.test(line) ||
        /^\s+(if: always\(\) && steps\.checkout\.outcome == 'success'|path: \$\{\{ runner\.temp \}\}\/ops-out\/\*\.enc\.json)$/.test(line), `an expression outside env: ${line.trim()}`)
    }
    const secretLines = wf.split('\n').filter((l) => l.includes('secrets.'))
    assert.strictEqual(secretLines.length, 2)
    const stepOf = (needle) => wf.slice(wf.lastIndexOf('- name:', wf.indexOf(needle)), wf.indexOf(needle))
    assert.ok(stepOf('secrets.CLOUDFLARE_API_TOKEN').includes('- name: Read the metrics'), 'only the reader step gets the token')
    assert.ok(/run: node ops\/scripts\/ops-metrics\.mjs\n/.test(wf))
    assert.ok(/persist-credentials: false/.test(wf) && /retention-days: 3/.test(wf) && /path: \$\{\{ runner\.temp \}\}\/ops-out\/\*\.enc\.json/.test(wf), 'no stored credentials; only the encrypted file, kept 3 days')
    for (const name of ['OPS_OUT_DIR', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'OPS_METRICS_FROM', 'OPS_METRICS_DAYS', 'OPS_METRICS_REVISION']) {
      assert.ok(new RegExp(`\\n {10}${name}: `).test(wf), `the reader step sets ${name}`)
    }
    assert.ok(!/^concurrency:\n {2}group: production-deploy/m.test(wf), 'a read-only reader does not hold up a release')
  })

  console.log(`test-ops-metrics-pure: ${passed} checks passed`)
})().catch((error) => { console.error(error); process.exit(1) })

'use strict'
// The Worker CPU of the JavaScript of the count marks (amendment 1.1 D.1 to D.4; slice A4). Pure: no database and no Worker.
//   node scripts/ic-marks-js-cpu-pure.cjs [--out=<file.json>]
// What is timed is the code the routes run, not the SQL: the marks library (src/lib/inventoryCheckMarks.ts, compiled here as test-inventory-check-marks-pure.cjs compiles it) over a database stub that returns the rows D1 returned in
// scripts/fixtures/ic-marks-recorded-c.json (written by test-inventory-check-marks-cost-native.cjs on world C with RECORD_FIXTURE=<path>), then the JSON the route stores and sends. The SQL engine's time is NOT here: on Cloudflare it runs inside D1.
// Wall time equals CPU time here (pure JavaScript, no I/O between the two clock reads); process.cpuUsage is unusable on Windows at its 15.6 ms tick.
// Each measure runs in its own child process, so its FIRST run is a cold JIT, as an unwarmed isolate is: the first run alone (median of five fresh processes: a loaded laptop puts a scheduler pause inside a single one, all five are printed), 20 warm-up runs, then 31 samples of 50 runs (per run: the median and the worst sample).
// Pass line (D.2.5, safety factor 3 is a chosen factor, not a measurement): 3 x (worst warm sample) + 3 x baseline <= 8 ms, and 3 x first run <= 10 ms.
//   baseline = what every request pays besides the body: a Request, the SHA-256 of the cache-key text, an empty Response read back. Hono and the auth middleware are not run here (they need a Worker); the real fixed part is larger, which is why the line stops at 8 of 10 ms.
// Measure (a) picks the page size (D.3): the largest of 2,000, 1,000, 500 that passes. The probe also proves it can fail: a page of 20,000 rows must miss the line.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const cp = require('node:child_process')
const ts = require('typescript')
const ROOT = path.resolve(__dirname, '..')
const FIXTURE = path.join(__dirname, 'fixtures', 'ic-marks-recorded-c.json')
const LINE = { warmMs: 8, firstMs: 10, factor: 3 }
const PAGE_SIZES = [2000, 1000, 500]

const loadLib = () => {
  const text = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'inventoryCheckMarks.ts'), 'utf8')
  const js = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const stubs = { './inventoryCheckSessions': { waitingLineSql: () => '', waitingKeySql: () => '' }, './productIdBuckets': { PRODUCT_ID_BUCKETS_SQL: '' } }
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', js)(mod.exports, (id) => { assert.ok(stubs[id], 'unexpected import ' + id); return stubs[id] }, mod)
  return mod.exports
}
// A database that answers each batch call with the next recorded batch (a fresh stub per run).
const stubOf = (batches) => { let k = 0; return { async batch(statements) { const recorded = batches[k++]; assert.ok(recorded, 'more batches than recorded'); assert.equal(statements.length, recorded.length, 'statements in batch ' + k); return recorded.map((results) => ({ results })) } } }
// A snapshot page of `n` rows from the recorded 2,000 (ids shifted for rows beyond them, only for the page that proves the probe can fail).
const rowsOf = (recorded, n) => { const out = []; for (let k = 0; out.length < n; k++) for (const r of recorded) { if (out.length === n) break; out.push({ ...r, id: Number(r.id) + k * 1000000 }) } return out }

const childMain = async (spec, light, firstOnly) => {
  const [name, sizeWord] = spec.split(':'), size = Number(sizeWord || 0)
  const lib = loadLib(), fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
  const scope = fx.scope, snapshot = fx.snapshot.batches[0]
  const page = (n) => [snapshot[0], snapshot[1], n <= snapshot[2].length ? snapshot[2].slice(0, n) : rowsOf(snapshot[2], n)]
  const limits = { pageEvents: fx.limits.pageEvents, touchedMax: fx.limits.touchedMax }
  const topOnly = [snapshot[0], snapshot[0]]
  const sink = []
  let run
  if (name === 'baseline') {
    run = async () => { const req = new Request('https://ic.invalid/__bos/ic-marks?org=1&branch=1&page=1&f=1', { headers: { cookie: 'session=x' } }); const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(req.url)); const res = new Response('{}'); sink.push(digest.byteLength + (await res.text()).length); sink.length = 0 }
  } else if (name === 'a') {
    const rows = page(size)
    run = async () => { const built = await lib.readSnapshotPage(stubOf([rows]), scope, 1, size); const { stored, body } = lib.buildPageAnswer(1, built, ''); return JSON.stringify(stored).length + JSON.stringify(body).length }
  } else if (name === 'b') {
    const built = await lib.readSnapshotPage(stubOf([page(size)]), scope, 1, size)
    const text = JSON.stringify(lib.buildPageAnswer(1, built, '').stored)
    run = async () => { const cached = JSON.parse(text); const check = await lib.readTopAndAt(stubOf([topOnly]), cached.cursor); return JSON.stringify(lib.pageBody(cached, check.top, '')).length }
  } else if (name === 'c') {
    run = async () => JSON.stringify(await lib.readChanges(stubOf(fx.changes.batches), scope, fx.changes.since, fx.changes.tag, limits)).length
  } else if (name === 'd') {
    // The route's withoutWaiting (routes/inventoryChecks.ts) is replicated here: the shared cached answer (serveCachedChanges) arrives with slice A3, which moves the strip into the library.
    const text = JSON.stringify(await lib.readChanges(stubOf(fx.changes.batches), scope, fx.changes.since, fx.changes.tag, limits))
    run = async () => { const answer = JSON.parse(text); return JSON.stringify('waiting' in answer ? Object.fromEntries(Object.entries(answer).filter(([k]) => k !== 'waiting')) : answer).length }
  } else if (name === 'e') {
    run = async () => JSON.stringify(await lib.readPendingPage(stubOf(fx.pending.batches), scope, null, fx.limits.pageApprovals)).length
  } else throw new Error('unknown measure ' + name)
  const now = () => process.hrtime.bigint()
  const perRun = async (n) => { const t0 = now(); for (let i = 0; i < n; i++) sink.push(await run()); const dt = Number(now() - t0) / 1e6 / n; sink.length = 0; return dt }
  const first = await perRun(1)
  if (firstOnly) { process.stdout.write(JSON.stringify({ firstMs: first })); return }
  for (let i = 0; i < (light ? 3 : 20); i++) await run()
  const samples = []
  for (let i = 0; i < (light ? 5 : 31); i++) samples.push(await perRun(light ? 5 : 50))
  samples.sort((x, y) => x - y)
  process.stdout.write(JSON.stringify({ measure: spec, firstMs: first, medianMs: samples[Math.floor(samples.length / 2)], worstMs: samples[samples.length - 1], samples: samples.length }))
}

const child = (spec, flags) => {
  const r = cp.spawnSync(process.execPath, [__filename, '--child=' + spec, ...flags], { encoding: 'utf8', maxBuffer: 1 << 24 })
  if (r.status !== 0) throw new Error('measure ' + spec + ' failed: ' + (r.stderr || r.stdout).slice(0, 400))
  return JSON.parse(r.stdout)
}
// The first run is the one number a loaded laptop makes noisy (a scheduler pause lands inside it), so it is the MEDIAN of five fresh processes (the first of the full run and four first-only runs); all five are reported.
const FIRST_PROCESSES = 5
const measure = (spec, light) => {
  const full = child(spec, light ? ['--light'] : [])
  const firsts = [full.firstMs, ...Array.from({ length: FIRST_PROCESSES - 1 }, () => child(spec, ['--first-only']).firstMs)].sort((x, y) => x - y)
  return { ...full, firstMs: firsts[Math.floor(firsts.length / 2)], firstsMs: firsts }
}
const passes = (m, baseline) => ({ warm: LINE.factor * m.worstMs + LINE.factor * baseline.medianMs, first: LINE.factor * m.firstMs, ok: LINE.factor * m.worstMs + LINE.factor * baseline.medianMs <= LINE.warmMs && LINE.factor * m.firstMs <= LINE.firstMs })

// The pinned page size, read from planTier.ts: both profiles hold the same value.
const pinnedPageIds = () => {
  const text = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'planTier.ts'), 'utf8')
  const values = [...text.matchAll(/inventoryMarksPageIds: ([0-9_]+),/g)].map((m) => Number(m[1].split('_').join('')))
  assert.equal(values.length, 2, 'inventoryMarksPageIds is set in both profiles')
  assert.equal(values[0], values[1], 'both profiles hold the same page size')
  return values[0]
}

const main = () => {
  const outArg = process.argv.find((a) => a.startsWith('--out='))
  assert.ok(fs.existsSync(FIXTURE), 'the recorded rows are missing: ' + FIXTURE)
  const baseline = measure('baseline')
  const pageRuns = PAGE_SIZES.map((n) => ({ rows: n, a: measure('a:' + n) }))
  const chosen = PAGE_SIZES.find((n) => passes(pageRuns.find((p) => p.rows === n).a, baseline).ok) || 0
  const pinned = pinnedPageIds()
  const atPinned = pageRuns.find((p) => p.rows === pinned)
  assert.ok(atPinned, 'the pinned page size ' + pinned + ' is one of ' + PAGE_SIZES.join(', '))
  const others = ['b:' + pinned, 'c', 'd', 'e'].map((spec) => ({ spec, m: measure(spec) }))
  const verdicts = [{ spec: 'a:' + pinned, m: atPinned.a }, ...others].map((x) => ({ ...x, ...passes(x.m, baseline) }))
  // The probe can fail: a page of 20,000 rows misses the line (light repeats; its own time is long).
  const huge = measure('a:20000', true), hugeVerdict = passes(huge, baseline)
  const report = { baselineMedianMs: baseline.medianMs, line: LINE, chosenPageIds: chosen, pinnedPageIds: pinned, pageSizes: pageRuns.map((p) => ({ rows: p.rows, ...p.a, ...passes(p.a, baseline) })), measures: verdicts.map((v) => ({ spec: v.spec, firstMs: v.m.firstMs, firstsMs: v.m.firstsMs, medianMs: v.m.medianMs, worstMs: v.m.worstMs, scoreWarm: v.warm, scoreFirst: v.first, ok: v.ok })), proofCanFail: { rows: 20000, firstMs: huge.firstMs, worstMs: huge.worstMs, scoreWarm: hugeVerdict.warm, ok: hugeVerdict.ok } }
  console.log(JSON.stringify(report, null, 1))
  if (outArg) fs.writeFileSync(outArg.slice('--out='.length), JSON.stringify(report, null, 1))
  let failed = 0
  const check = (label, ok) => { console.log((ok ? 'PASS ' : 'FAIL ') + label); if (!ok) failed++ }
  check('the probe fails on a page of 20,000 rows (it can fail)', hugeVerdict.ok === false)
  for (const v of verdicts) check('measure ' + v.spec + ': 3 x worst + 3 x baseline = ' + v.warm.toFixed(2) + ' ms <= ' + LINE.warmMs + ' and 3 x first = ' + v.first.toFixed(2) + ' ms <= ' + LINE.firstMs, v.ok)
  check('the pinned inventoryMarksPageIds ' + pinned + ' passes the line', passes(atPinned.a, baseline).ok)
  console.log((chosen > pinned ? 'NOTE a larger page passes in this run (D.3 takes the largest): ' : 'NOTE largest page that passes in this run: ') + chosen)
  process.exit(failed ? 1 : 0)
}

const childArg = process.argv.find((a) => a.startsWith('--child='))
if (childArg) childMain(childArg.slice('--child='.length), process.argv.includes('--light'), process.argv.includes('--first-only')).catch((e) => { console.error(e.stack || e); process.exit(1) })
else main()

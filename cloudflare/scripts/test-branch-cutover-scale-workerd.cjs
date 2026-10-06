// Branch cutover at production scale on local workerd D1 (Miniflare: in-memory database, random port).
// Production showed that one heavy statement is enough to stop a run: the first fold preview hit
// "D1 DB exceeded its CPU time limit and was reset. [code: 7429]" (ops run 37385964086). This test seeds the
// production-shaped fixture (branch-cutover-scale-fixture.cjs; CUTOVER_SCALE, default 0.25, 1 = the 6 Oct
// inventory) and runs the real parent and certified child end to end through workerd's D1, recording every
// statement's D1 meta.duration and rows_read. It requires:
//   - inspect works on D1 (the schema read used to hit SQLITE_AUTH on D1's internal _cf_* tables);
//   - no single statement over STATEMENT_MS, and no statement whose rows_read grows faster than the data
//     (ROWS_PER_SCALE x scale): the per-product lot sub-queries used to read the whole branch per product;
//   - the ops fold preview (as guarded and run by the Ops task) is under the same bounds and equals the run;
//   - 7429 resets injected on real D1 reads and batches at several stages leave the run resumable;
//   - the received-date census (ops) is under the same bounds, and D1's own date()/GLOB/trim() compute the
//     business day exactly as the run's JS does (owner 6 Oct: slash dates are dates, month-first).
// It prints the slowest statement per stage (CUTOVER_SCALE=1 is the report's timings table).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const ts = require('typescript')
const harness = require('./branch-cutover-workerd-harness.cjs')
function parentModule() {
  const cache = new Map()
  const load = (name) => {
    name = path.posix.normalize(name.endsWith('.ts') ? name : name + '.ts')
    if (cache.has(name)) return cache.get(name).exports
    const module = { exports: {} }; cache.set(name, module)
    const js = ts.transpileModule(fs.readFileSync(path.join(root, 'cloudflare/src', name), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function('require', 'module', 'exports', js)(request => request.startsWith('.') ? load(path.posix.join(path.posix.dirname(name), request)) : {}, module, module.exports)
    return module.exports
  }
  return load('lib/branchCutoverParent')
}
const root = path.resolve(__dirname, '../..')
const SCALE = Number(process.env.CUTOVER_SCALE || 0.25)
const STATEMENT_MS = 250
const ROWS_PER_SCALE = 1_000_000

async function main() {
  const guard = await import(pathToFileURL(path.join(root, 'ops/scripts/ops-sql-guard.mjs')).href)
  const preview = guard.guardSql(fs.readFileSync(path.join(root, 'ops/queries/cutover-fold-preview.sql'), 'utf8')).sql
  const census = guard.guardSql(fs.readFileSync(path.join(root, 'ops/queries/received-date-format-census.sql'), 'utf8')).sql
  const { mf, call } = await harness.start()
  let checks = 0
  const check = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name) }
  try {
    const loaded = await harness.seed(call, { scale: SCALE })
    console.log('SCALE ' + JSON.stringify({ scale: SCALE, ...loaded }))
    let expected
    await check('the ops fold preview is bounded on workerd D1 (one materialized pass)', async () => {
      const result = await call({ op: 'query', sql: preview })
      assert.ok(result.rows && result.rows.length === 1, JSON.stringify(result).slice(0, 300))
      console.log('PREVIEW ' + JSON.stringify({ ms: result.meta.duration, rowsRead: result.meta.rows_read }))
      assert.ok(result.meta.duration <= STATEMENT_MS, 'preview ms ' + result.meta.duration)
      assert.ok(result.meta.rows_read <= ROWS_PER_SCALE * SCALE, 'preview rows ' + result.meta.rows_read)
      expected = result.rows[0]
      assert.equal(expected.branches_ok, 1); assert.equal(expected.inexact_pairs, 0); assert.ok(expected.same_date_merges > 0)
      assert.ok(expected.received_slash > 0 && expected.received_slash_ambiguous > 0 && expected.received_other > 0, 'the fixture carries slash dates')
    })
    await check('the received-date census is bounded on workerd D1 and reads the slash order', async () => {
      const result = await call({ op: 'query', sql: census })
      assert.ok(result.rows && result.rows.length >= 1, JSON.stringify(result).slice(0, 300))
      console.log('CENSUS ' + JSON.stringify({ ms: result.meta.duration, rowsRead: result.meta.rows_read, rows: result.rows.length }))
      assert.ok(result.meta.duration <= STATEMENT_MS, 'census ms ' + result.meta.duration)
      assert.ok(result.meta.rows_read <= ROWS_PER_SCALE * SCALE, 'census rows ' + result.meta.rows_read)
      const slash = result.rows.find(row => row.shape === 'N/N/YYYY')
      // the fixture writes month-first slash dates plus a deliberate 24/08/2026: the census must show both
      assert.ok(slash && slash.second_gt_12 > 0 && slash.first_gt_12 > 0 && slash.sibling_month_first > 0, JSON.stringify(slash))
    })
    await check('D1 computes the business day exactly as the run (the SQL twin the preview carries), slash dates included', async () => {
      const parent = parentModule()
      const values = ['\t2026-09-12', '2026-09-12\n', '\u00a008/24/2026', ' 08/24/2026 ', '2026-09-12 10:00:00\n', '2026-09-1210:00:00', '2026-09-12T23:30:00+0700',
        '2026-09-12T23:30:00 Z', '2026-09-12T18:00:00Z', '2026-09-12 17:00:00', '2026-09-12T23:30:00+07:00', 'not a date', '', null]
      for (const year of ['2024', '2026', '2100', '2000']) for (let m = 0; m <= 13; m++) for (let d = 0; d <= 32; d++) {
        const [mm, dd] = [String(m).padStart(2, '0'), String(d).padStart(2, '0')]
        values.push(`${m}/${d}/${year}`, `${mm}/${dd}/${year}`, `${year}-${mm}-${dd}`)
      }
      const result = await call({ op: 'query', sql: `SELECT key AS k, ${parent.cutoverLotDaySql('value')} AS d FROM json_each(?1) ORDER BY key`, params: [JSON.stringify(values)] })
      assert.equal(result.rows.length, values.length, JSON.stringify(result).slice(0, 300))
      for (const row of result.rows) assert.equal(row.d, parent.cutoverLotBusinessDay(values[row.k]), JSON.stringify(values[row.k]))
    })
    let run
    await check('the whole cutover runs on workerd D1 at scale, every statement bounded, with 7429 resets injected on real reads and batches', async () => {
      const faults = { 'capture#5': { on: 'read', at: 1 }, 'capture#9': { on: 'batch', at: 0 }, 'child#3': { on: 'batch', at: 0 }, 'child#7': { on: 'read', at: 2 },
        'fold#2': { on: 'batch', at: 0 }, 'reconcile#3': { on: 'read', at: 1 }, 'finalize#1': { on: 'batch', at: 0 } }
      run = await harness.drive(call, { faults })
      assert.deepEqual(run.fired.sort(), Object.keys(faults).sort())
      // each injected reset surfaced once, as the 7429 itself or as an unconfirmed outcome caused by it, and the next call resumed
      assert.equal(run.faultErrors.length, Object.keys(faults).length)
      for (const { label, error } of run.faultErrors) assert.ok(/code: 7429/.test(error.message + ' ' + error.cause), label + ' ' + JSON.stringify(error))
      assert.equal(run.row.phase, 'completed')
      const table = []
      for (const [label, s] of Object.entries(run.stats)) {
        table.push({ stage: label, invocations: s.invocations, statements: s.statements, slowestMs: s.worst?.d ?? 0, slowestRows: s.worst?.r ?? 0, maxRowsRead: s.maxRowsRead,
          rowsRead: s.rowsRead, slowest: (s.worst?.sql || '').replace(/\s+/g, ' ').slice(0, 90) })
      }
      for (const row of table) console.log('STAGE ' + JSON.stringify(row))
      for (const [, p] of Object.entries(run.perText)) {
        // wall time on a shared host: one stall of a statement that otherwise runs fast (and reads few rows) is the host, not
        // the query; a statement run once, or slow twice, must stay under the bound. rows_read below is the deterministic bound.
        const ms = p.count > 1 ? p.secondMs : p.maxMs
        if (p.maxMs > STATEMENT_MS) console.log('STALL ' + JSON.stringify({ stage: p.label, maxMs: p.maxMs, nextMs: p.secondMs, count: p.count, maxRows: p.maxRows }))
        assert.ok(ms <= STATEMENT_MS, `${p.label} statement ${p.maxMs} ms (next ${p.secondMs} ms over ${p.count} runs)`)
        assert.ok(p.maxRows <= ROWS_PER_SCALE * SCALE, `${p.label} statement reads ${p.maxRows} rows (budget ${ROWS_PER_SCALE * SCALE})`)
      }
    })
    await check('the preview read before begin equals what the fold stage did at scale', async () => {
      const terminal = JSON.parse(run.row.terminal_json)
      assert.deepEqual({ groups: expected.same_date_merges, foldedLots: expected.folded_lots, costChanged: expected.cost_blend_folds, expirySplit: expected.expiry_splits,
        supplierSplit: expected.supplier_splits, roundingSplit: 0, uncostedMerges: expected.uncosted_merges, freeUnknownMerges: expected.free_unknown_merges,
        emptySupplierMerges: expected.empty_supplier_merges }, terminal.folds)
      assert.equal(expected.moving_products, terminal.committedChildren)
      const left = (await call({ op: 'query', sql: 'SELECT (SELECT count(*) FROM branch_stock WHERE branch_id=2 AND quantity<>0) + (SELECT count(*) FROM branch_batch_stock WHERE branch_id=2 AND quantity<>0) AS n' })).rows[0].n
      assert.equal(left, 0)
    })
  } finally { await mf.dispose() }
  console.log(`${checks} branch cutover scale (workerd D1) checks passed`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })

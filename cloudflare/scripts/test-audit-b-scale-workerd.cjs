// DATA-AUDIT lane B at production scale on local workerd D1 (Miniflare: in-memory database, random port).
// A read-only audit that trips D1's CPU limit (error 7429) is worse than none, so every ops/queries/audit-b-*.sql is run as the
// ops task runs it (guarded text, no binds) on the production-shaped fixture (audit-b-scale-fixture.cjs; AUDIT_B_SCALE, default 0.25,
// 1 = the 6 Oct 2026 inventory, the report's timings table) and must stay under HARD_MS x scale (floor 400 ms) and ROWS_PER_SCALE x scale rows (the design budget is STATEMENT_MS = 250 ms at scale 1 on an idle host; the headers carry each query's idle figure) 
// Wall time on a shared host is noisy: the fastest of five runs is judged; rows_read is the deterministic bound. Prints one line per query.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const harness = require('./branch-cutover-workerd-harness.cjs')
const fixture = require('./audit-b-scale-fixture.cjs')
const root = path.resolve(__dirname, '../..')
const SCALE = Number(process.env.AUDIT_B_SCALE || 0.25)
const STATEMENT_MS = 250 // the design budget at scale 1 (reported, see ops/queries headers)
const HARD_MS = 1000 // the failing line: shared hosts run identical statements 2-3x apart (idle 109 s vs loaded 225 s to seed), so wall time only catches order-of-magnitude regressions; rows_read is the deterministic bound
const RUNS = 5
const ROWS_PER_SCALE = 500_000

async function main() {
  const guard = await import(pathToFileURL(path.join(root, 'ops/scripts/ops-sql-guard.mjs')).href)
  const names = fs.readdirSync(path.join(root, 'ops/queries')).filter((f) => /^audit-b-.*\.sql$/.test(f)).map((f) => f.slice(0, -4)).sort()
  assert.ok(names.length >= 15, 'lane B has 15 queries, found ' + names.length)
  const { mf, call } = await harness.start()
  let checks = 0
  const failures = []
  try {
    const loaded = await harness.seed(call, { tables: fixture.rows({ scale: SCALE }) })
    console.log('SCALE ' + JSON.stringify({ scale: SCALE, ...loaded }))
    for (const name of names) {
      const { sql, rules } = guard.guardSql(fs.readFileSync(path.join(root, 'ops/queries', name + '.sql'), 'utf8'))
      const runs = []
      for (let i = 0; i < RUNS; i++) {
        const r = await call({ op: 'query', sql })
        assert.ok(!r.error, name + ' failed on workerd D1: ' + r.error)
        runs.push(r)
      }
      const last = runs[runs.length - 1]
      assert.ok(last.rows.length >= (rules.minRows || 0) && last.rows.length <= rules.maxRows, name + ' returned ' + last.rows.length + ' rows')
      const ms = Math.min(...runs.map((r) => r.meta.duration))
      console.log('QUERY ' + JSON.stringify({ name, bestMs: ms, runsMs: runs.map((r) => r.meta.duration), rowsRead: last.meta.rows_read, rows: last.rows.length }))
      const budgetMs = Math.max(HARD_MS * SCALE, 400)
      // every query is measured before the verdict, so one slow statement does not hide the others' numbers
      if (ms > budgetMs) failures.push(`${name}: ${ms} ms best of ${RUNS} (budget ${budgetMs} ms)`)
      if (last.meta.rows_read > ROWS_PER_SCALE * SCALE) failures.push(`${name}: reads ${last.meta.rows_read} rows (budget ${ROWS_PER_SCALE * SCALE})`)
      checks++
      console.log((ms <= budgetMs && last.meta.rows_read <= ROWS_PER_SCALE * SCALE ? 'PASS ' : 'OVER ') + name)
    }
  } finally { await mf.dispose() }
  assert.deepEqual(failures, [], 'over budget: ' + failures.join('; '))
  console.log(`${checks} audit-b scale (workerd D1) checks passed`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })

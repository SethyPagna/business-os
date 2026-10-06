// Bench: seeds the production-shaped lane-B fixture on workerd D1 ONCE and times every named audit-b query (ms + rows_read).
// Usage: node scripts/audit-b-bench.cjs [scale] [--watch <trigger-file>] [query-name ...]   (not a test; the scale test asserts the bounds)
// With --watch the bench stays up after the first round and re-runs (re-reading the .sql files from disk) every time the trigger file
// appears, deleting it first (an adhoc.sql beside it is run once and its first 60 rows printed: EXPLAIN QUERY PLAN, probes); a file named "stop" next to it ends the process. Seeding at scale 1 takes minutes, tuning should not.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const harness = require('./branch-cutover-workerd-harness.cjs')
const fixture = require('./audit-b-scale-fixture.cjs')
const root = path.resolve(__dirname, '../..')
const REPS = Number(process.env.BENCH_REPS || 5)
async function round(call, guard, only) {
  const names = fs.readdirSync(path.join(root, 'ops/queries')).filter((f) => /^audit-b-.*\.sql$/.test(f)).map((f) => f.slice(0, -4)).sort().filter((n) => !only.length || only.includes(n))
  for (const name of names) {
    let sql
    try { sql = guard.guardSql(fs.readFileSync(path.join(root, 'ops/queries', name + '.sql'), 'utf8')).sql } catch (e) { console.log(name, 'GUARD', e.message); continue }
    const out = []
    let best = Infinity, rows = 0, failed = null
    for (let i = 0; i < REPS; i++) {
      const r = await call({ op: 'query', sql })
      if (r.error) { failed = r.error; break }
      best = Math.min(best, r.meta.duration); rows = r.meta.rows_read; out.push(r.meta.duration)
    }
    console.log(name.padEnd(36), failed ? 'ERROR ' + failed : 'min ' + best + ' ms  rows_read ' + rows + '  (' + out.join(',') + ')')
  }
}
async function main() {
  const args = process.argv.slice(2)
  const scale = Number(args.shift() || 1)
  let watch = null
  const only = []
  while (args.length) { const a = args.shift(); if (a === '--watch') watch = args.shift(); else only.push(a) }
  const guard = await import(pathToFileURL(path.join(root, 'ops/scripts/ops-sql-guard.mjs')).href)
  const { mf, call } = await harness.start()
  try {
    const loaded = await harness.seed(call, { tables: fixture.rows({ scale }) })
    console.log('SEED ' + JSON.stringify({ scale, ...loaded }))
    await round(call, guard, only)
    while (watch) {
      const stop = path.join(path.dirname(watch), 'stop')
      if (fs.existsSync(stop)) break
      const adhoc = path.join(path.dirname(watch), 'adhoc.sql')
      if (fs.existsSync(adhoc)) {
        const sql = fs.readFileSync(adhoc, 'utf8'); fs.unlinkSync(adhoc)
        const r = await call({ op: 'query', sql })
        console.log('--- adhoc', r.error ? 'ERROR ' + r.error : JSON.stringify({ ms: r.meta.duration, rowsRead: r.meta.rows_read }), r.error ? '' : JSON.stringify(r.rows.slice(0, 60)).slice(0, 6000))
      } else if (fs.existsSync(watch)) { fs.unlinkSync(watch); console.log('--- round'); await round(call, guard, only) }
      else await new Promise((r) => setTimeout(r, 1000))
    }
  } finally { await mf.dispose() }
}
main().catch((e) => { console.error(e); process.exitCode = 1 })

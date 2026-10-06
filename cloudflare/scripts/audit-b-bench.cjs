// Bench: seeds the production-shaped fixture on workerd D1 once and times every named audit-b query (md + rows_read).
// Usage: node scripts/audit-b-bench.cjs [scale] [query-name ...]   (not a test; the scale test asserts the bounds)
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const harness = require('./branch-cutover-workerd-harness.cjs')
const root = path.resolve(__dirname, '../..')
async function main() {
  const scale = Number(process.argv[2] || 1)
  const only = process.argv.slice(3)
  const guard = await import(pathToFileURL(path.join(root, 'ops/scripts/ops-sql-guard.mjs')).href)
  const names = fs.readdirSync(path.join(root, 'ops/queries')).filter((f) => /^audit-b-.*\.sql$/.test(f)).map((f) => f.slice(0, -4)).sort().filter((n) => !only.length || only.includes(n))
  const { mf, call } = await harness.start()
  try {
    const loaded = await harness.seed(call, { scale })
    console.log('SEED ' + JSON.stringify({ scale, ...loaded }))
    for (const name of names) {
      const { sql } = guard.guardSql(fs.readFileSync(path.join(root, 'ops/queries', name + '.sql'), 'utf8'))
      for (let i = 0; i < 2; i++) {
        const r = await call({ op: 'query', sql })
        if (r.error) { console.log(name, 'ERROR', r.error); break }
        console.log(name, JSON.stringify({ ms: r.meta.duration, rowsRead: r.meta.rows_read, rows: r.rows.length }), i ? JSON.stringify(r.rows[0]).slice(0, 400) : '')
      }
    }
  } finally { await mf.dispose() }
}
main().catch((e) => { console.error(e); process.exitCode = 1 })

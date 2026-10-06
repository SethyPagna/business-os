// Fast native bench (node:sqlite, in-memory, the production-shaped fixture): wall ms per audit-b query. Not a test; D1's own
// meta.duration / rows_read come from audit-b-bench.cjs on workerd. Usage: node scripts/audit-b-native-bench.cjs [scale] [name...]
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { openDb } = require('./audit-b-world.cjs')
const fixture = require('./branch-cutover-scale-fixture.cjs')
const root = path.resolve(__dirname, '../..')
async function main() {
  const scale = Number(process.argv[2] || 1)
  const only = process.argv.slice(3)
  const guard = await import(pathToFileURL(path.join(root, 'ops/scripts/ops-sql-guard.mjs')).href)
  const raw = openDb()
  raw.exec('DELETE FROM branches')
  for (const { name } of raw.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all()) raw.exec('DROP TRIGGER "' + name + '"')
  const extra = fs.existsSync(path.join(__dirname, 'audit-b-scale-fixture.cjs')) ? require('./audit-b-scale-fixture.cjs') : null
  const tables = extra ? extra.rows({ scale }) : fixture.rows({ scale })
  const t0 = Date.now()
  for (const { sql, params } of fixture.statements(tables, 900000, 400)) raw.prepare(sql).run(...params)
  console.log('SEED ms', Date.now() - t0)
  const names = fs.readdirSync(path.join(root, 'ops/queries')).filter((f) => /^audit-b-.*\.sql$/.test(f)).map((f) => f.slice(0, -4)).sort().filter((n) => !only.length || only.includes(n))
  for (const name of names) {
    const { sql } = guard.guardSql(fs.readFileSync(path.join(root, 'ops/queries', name + '.sql'), 'utf8'))
    const times = []
    let rows
    for (let i = 0; i < 3; i++) { const t = process.hrtime.bigint(); rows = raw.prepare(sql).all(); times.push(Number(process.hrtime.bigint() - t) / 1e6) }
    console.log(name, 'native ms', times.map((x) => x.toFixed(0)).join('/'), 'rows', rows.length, JSON.stringify(rows[0] || {}).slice(0, 300))
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1 })

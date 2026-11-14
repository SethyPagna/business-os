'use strict'
// Read-cost driver for GET /api/sales/stats and /stats-strip (lane/sales-stats-reads). Not a test (no test- prefix: the sweep does not run it).
// The same request shapes against a Worker source tree, report_atomic OFF and ON, Free tier, Cache API missing; one line per shape: rows read / D1 calls.
//   node scripts/measure-sales-stats-shapes.cjs <sourceRoot> <label> <outDir> [--analyze] [--cap N]
// <sourceRoot> is a checkout that has cloudflare/scripts/read-budget/world.cjs (base or head); the fixture is this lane's. --cap N patches REPORT_SCOPE_IDS_MAX
// (head only). Writes <outDir>/shapes-<label>.json (bodies, rows, calls) for diffing two runs.
const path = require('node:path')
const fs = require('node:fs')
const [root, label, outDir] = process.argv.slice(2, 5)
const analyze = process.argv.includes('--analyze')
const capAt = process.argv.indexOf('--cap')
const patches = capAt > 0 ? [{ name: 'cap', file: 'src/lib/salesAnalytics.ts', from: 'export const REPORT_SCOPE_IDS_MAX = ', to: `export const REPORT_SCOPE_IDS_MAX = ${Number(process.argv[capAt + 1])} // was ` }] : []
if (!root || !label || !outDir) { console.error('usage: node measure-sales-stats-shapes.cjs <sourceRoot> <label> <outDir> [--analyze] [--cap N]'); process.exit(2) }
process.env.READ_BUDGET_DEADLINE_MS ||= '600000'
const { bootWorld } = require(path.join(root, 'cloudflare/scripts/read-budget/world.cjs'))
const { applyFixture, day } = require('./sales-stats-reads-harness.cjs')
const enc = encodeURIComponent

async function run(switches) {
  const world = await bootWorld({ tier: 'free', patches, ...(switches ? { switches } : {}) })
  const out = {}
  try {
    await applyFixture(world)
    if (analyze) { await world.analyze(); await world.restart(); await world.login() }
    const ctx = world.ctx
    const w = (a, b) => `startDate=${day(ctx, a)}&endDate=${day(ctx, b)}`
    const anyId = (await world.all("SELECT id, receipt_number r FROM sales WHERE created_at >= datetime(?, '-30 hours') ORDER BY id DESC LIMIT 1", ctx.anchor))[0]
    const from = (back) => `${day(ctx, back)} 00:00:00`
    const shapes = {
      'stats today': `/api/sales/stats?${w(0, 0)}`,
      'stats 30d': `/api/sales/stats?${w(29, 0)}`,
      'stats all-time': '/api/sales/stats',
      'stats start-only': `/api/sales/stats?startDate=${day(ctx, 10)}`,
      'stats end-only': `/api/sales/stats?endDate=${day(ctx, 10)}`,
      'stats search Customer 12': '/api/sales/stats?search=Customer%2012',
      'stats search Customer 12 30d': `/api/sales/stats?${w(29, 0)}&search=Customer%2012`,
      'stats search Customer 12 today': `/api/sales/stats?${w(0, 0)}&search=Customer%2012`,
      'stats search Customer (broad)': '/api/sales/stats?search=Customer',
      'stats search Customer 30d (broad)': `/api/sales/stats?${w(29, 0)}&search=Customer`,
      'stats search R0 (all receipts)': '/api/sales/stats?search=R0',
      'stats search R0 30d': `/api/sales/stats?${w(29, 0)}&search=R0`,
      'stats search receipt exact': `/api/sales/stats?search=${enc(anyId.r)}`,
      'stats search receipt prefix5': `/api/sales/stats?search=${enc(anyId.r.slice(0, 5))}`,
      'stats search no match': '/api/sales/stats?search=zzzzqq',
      'stats search khmer': `/api/sales/stats?search=${enc('សុខា')}`,
      'stats status=cancelled': '/api/sales/stats?status=cancelled',
      'stats status=completed 30d': `/api/sales/stats?${w(29, 0)}&status=completed`,
      'stats cancelled+search': '/api/sales/stats?status=cancelled&search=Customer%2012',
      'stats cancelled+broad': '/api/sales/stats?status=cancelled&search=Customer',
      'stats id': `/api/sales/stats?id=${anyId.id}`,
      'list receipt search': `/api/sales?search=${enc(anyId.r)}&limit=20`,
      'list id': `/api/sales?id=${anyId.id}&limit=20`,
      'strip today': `/api/sales/stats-strip?${w(0, 0)}`,
      'strip 30d': `/api/sales/stats-strip?${w(29, 0)}`,
      'strip 30d hours': `/api/sales/stats-strip?${w(29, 0)}&startTime=08:00&endTime=18:00`,
      'strip continuous 30d': `/api/sales/stats-strip?${w(29, 0)}&createdFrom=${enc(from(29))}&createdTo=${enc(from(-1))}`,
      'strip continuous 120d': `/api/sales/stats-strip?${w(119, 0)}&createdFrom=${enc(from(119))}&createdTo=${enc(from(-1))}`,
      'strip continuous 1d': `/api/sales/stats-strip?${w(0, 0)}&createdFrom=${enc(from(0))}&createdTo=${enc(from(-1))}`,
      'daily-report': `/api/sales/daily-report?date=${day(ctx, 0)}`,
      'dashboard today': `/api/dashboard/startup?${w(0, 0)}&granularity=day`,
      'reports overview 30d': `/api/reports/overview?${w(29, 0)}`,
    }
    for (const [name, url] of Object.entries(shapes)) {
      const r = await world.send('GET', url, undefined, { miss: true })
      out[name] = { status: r.status, text: r.text, calls: r.calls, rr: r.rr }
    }
  } finally { await world.dispose() }
  return out
}

;(async () => {
  const off = await run()
  const on = await run({ report_atomic: 'on', report_atomic_long: 'on' })
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, `shapes-${label}.json`), JSON.stringify({ off, on }, null, 1))
  for (const [name, v] of Object.entries(off)) console.log(`${name.padEnd(36)} OFF ${v.status} ${v.rr}/${v.calls} | ON ${on[name].status} ${on[name].rr}/${on[name].calls}`)
})().catch((e) => { console.error(e); process.exit(1) })

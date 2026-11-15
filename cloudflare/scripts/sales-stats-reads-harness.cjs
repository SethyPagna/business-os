'use strict'
// Shared by the test-sales-stats-reads-*-native.cjs files: oracle worlds (the same Worker with a change patched back out in memory), the fixture rows
// the read-budget seed lacks, and the compare helpers. Not a test itself (no test- prefix: the sweep does not run it).
const assert = require('node:assert/strict')
const { bootWorld } = require('./read-budget/world.cjs')
const { seedContext } = require('./read-budget/seed.cjs')

const ATOMIC = { report_atomic: 'on', report_atomic_long: 'on' }

// Sales whose status the seed never produces (it only writes completed / awaiting_payment / cancelled): a NULL and an empty status, the casing and spacing
// variants of 'cancelled' (NOT cancelled for the report), the return statuses, and a sale with a Khmer customer name and a phone number. Applied to the
// most recent sales so every "today" window holds them.
async function applyFixture(world) {
  const ids = (await world.all("SELECT id FROM sales WHERE created_at >= datetime(?, '-30 hours') ORDER BY id DESC LIMIT 20", world.ctx.anchor)).map((r) => r.id)
  assert.ok(ids.length >= 20, 'fixture: need 20 recent sales, have ' + ids.length)
  const statuses = [null, '', 'Cancelled', ' cancelled', 'cancelled ', 'partial_return', 'returned', 'awaiting_delivery', 'cancelled', 'cancelled', null, 'completed', 'returned', 'partial_return']
  for (let i = 0; i < statuses.length; i++) await world.db.prepare('UPDATE sales SET sale_status=? WHERE id=?').bind(statuses[i], ids[i]).run()
  // customer text in Khmer and Latin, on sales that are not among the status fixtures
  await world.db.prepare("UPDATE sales SET customer_name=?, search_normalized=? , customer_phone='012345678' WHERE id=?").bind('សុខា ចាន់', 'សុខា ចាន់', ids[15]).run()
  await world.db.prepare("UPDATE sales SET customer_name=?, search_normalized=?, customer_phone='098765432' WHERE id=?").bind('Zed Quux', 'zed quux', ids[16]).run()
  return ids
}

const day = (ctx, back) => new Date(Date.parse(ctx.anchorDate + 'T00:00:00Z') - back * 86400e3).toISOString().slice(0, 10)

// One world per (patches, switches); every url answered with the Cache API missing.
// Two statements are issued by the clock, not by the request, and land on whichever request is in flight at that moment (a different one in each world):
//   1. the read-switch memo (lib/readSwitches.ts, 15 s on Free) re-reads the flags: 1 call, 3 rows;
//   2. the T10 fallback drain (index.ts, SHIFT_OVERVIEW_DRAIN_INTERVAL_MS = 20 s, a module-level timestamp that every world in the process shares) runs after a GET /api/* response, in
//      waitUntil, and reads the due Telegram sends: 1 call. This is the +-1 that only the longest strips (the most wall clock per request) used to show.
// excludeSwitchReads leaves exactly those two statements out of the counts, so calls and rows are exact (no allowance) and a real extra call still shows.
// Everything else, the first request's cold probes included, is counted.
const SWITCH_READ = /^(SELECT key, value FROM system_flags WHERE key IN \(\?1, \?2\)|SELECT send_key FROM telegram_scheduled_sends\s+WHERE status = 'pending' AND due_at <= \?1 AND \(dispatch = 'fallback' OR due_at <= \?2\)\s+ORDER BY due_at LIMIT \?3)\s*$/
async function runUrls({ urls, patches = [], switches, tier = 'free', fixture = true, analyze = false, regimes = false, prepare, excludeSwitchReads = false }) {
  const world = await bootWorld({ tier, patches, ...(switches ? { switches } : {}) })
  const out = {}
  try {
    if (fixture) await applyFixture(world)
    if (prepare) await prepare(world)
    if (analyze) { await world.analyze(); await world.restart(); await world.login() }
    const list = typeof urls === 'function' ? await urls(world.ctx, world) : urls
    for (const [name, url] of Object.entries(list)) {
      const r = await world.send('GET', url, undefined, { miss: true })
      out[name] = { status: r.status, text: r.text, calls: r.calls, rr: r.rr }
      if (excludeSwitchReads) {
        const reads = ((await world.last()).stmts || []).filter((s) => SWITCH_READ.test(String(s.raw)))
        out[name].calls -= reads.length
        out[name].rr -= reads.reduce((n, s) => n + s.rr, 0)
        out[name].switchReads = reads.length
      }
      if (regimes) {
        // which scope the report statements carried: the id list (json_each) or the subquery that re-runs the filter (matched_sale)
        const stmts = ((await world.last()).stmts || []).map((s) => String(s.raw))
        out[name].ids = stmts.some((s) => /\.id IN \(SELECT value FROM json_each\(\?\d+\)(?: WHERE value > \?\d+)?\)/.test(s))
        out[name].subquery = stmts.some((s) => /IN \(SELECT matched_sale\.id FROM sales matched_sale/.test(s))
      }
    }
  } finally { await world.dispose() }
  return out
}
const bodies = (res) => Object.fromEntries(Object.entries(res).map(([k, v]) => [k, v.status + ' ' + v.text]))

const problems = []
const log = (...a) => console.log(...a)
async function step(name, fn) {
  try { await fn(); log('ok    ' + name) } catch (e) {
    problems.push(name + ': ' + String(e.message).split('\n')[0])
    log('RED   ' + name + '\n      ' + String(e.message).split('\n').slice(0, 4).join('\n      '))
  }
}
function finish() {
  if (problems.length) { console.error('\n' + problems.length + ' RED:\n  ' + problems.join('\n  ')); process.exit(1) }
  log('\nall green')
}
module.exports = { ATOMIC, applyFixture, day, runUrls, bodies, step, log, finish, seedContext }

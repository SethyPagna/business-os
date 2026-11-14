'use strict'
// Stored daily totals: both cron steps work ONE DAY AT A TIME, are resumable from a cursor, and stop BEFORE a CPU, wall-time or query budget taken from
// getPlanLimits(env) is passed. On Free (10 ms CPU, 50 queries per invocation) a step that read several days in one go could be killed for CPU after it had
// found a problem and before it acted on it; a visit that stops cleanly, or is killed, loses at most the day in hand.
//   B1 the budget numbers are the plan's, Free below Paid.   B2 the pure budget: CPU, wall, queries, first day always runs.
//   B3 recompute is one day per kernel read.   B4 a CPU / wall / query budget ends the recompute visit and the next visit continues.
//   B5 reconcile resumes: the cursor is written after every judged day, a killed visit continues at the next day, every day is judged exactly once per cycle.
//   B6 a MISMATCH is quarantined, and alerted, in the visit that detects it, before any further day is read.
// Run (from cloudflare/): node scripts/test-sales-daily-budget-pure.cjs
const assert = require('node:assert/strict')
const { createWorld } = require('./harness/sales-daily-world.cjs')

const w = createWorld()
const { T, cron, tiers } = w
let passed = 0
const check = async (name, run) => { await run(); passed += 1; console.log(`PASS ${name}`) }
const FREE = tiers.PLAN_LIMITS_BY_TIER.free, PAID = tiers.PLAN_LIMITS_BY_TIER.paid
const alerts = []
const alertDep = (over = {}) => w.dep({ alert: async (_env, days) => { alerts.push([...days]); return true }, ...over })

async function main() {
  await check('B1 every budget number comes from the plan limits, and Free is below Paid', () => {
    for (const key of ['salesDailyStepCpuBudgetMs', 'salesDailyStepWallBudgetMs']) {
      assert.ok(FREE[key] > 0 && FREE[key] < PAID[key], key)
    }
    assert.ok(FREE.salesDailyStepCpuBudgetMs < 10, 'a Free budget must sit below the 10 ms CPU limit')
    assert.ok(FREE.salesDailyKernelQueriesPerDay + FREE.salesDailyQueryReserve < FREE.d1QueriesPerInvocation, 'one day must fit the 50-query invocation')
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'lib', 'salesDailyCron.ts'), 'utf8')
    assert.ok(!/\b\d+\s*\*\s*1000\b/.test(src) && !/limit\s*=\s*\d/.test(src), 'no literal limit in the cron')
  })

  await check('B2 the pure budget: CPU estimate, wall clock and query count each stop a visit; the first day always runs', () => {
    let now = 0
    const limits = { ...FREE }
    const budget = new T.SalesDailyStepBudget(limits, () => now)
    assert.equal(budget.allowsAnotherDay(0, 2).ok, true)
    budget.spendDay(10)
    assert.equal(budget.allowsAnotherDay(10, 2).ok, true, 'a small second day fits')
    assert.deepEqual(budget.allowsAnotherDay(100000, 2), { ok: false, reason: 'cpu' })
    now = limits.salesDailyStepWallBudgetMs
    assert.deepEqual(budget.allowsAnotherDay(0, 2), { ok: false, reason: 'wall' })
    now = 0
    budget.spendQueries(limits.d1QueriesPerInvocation - limits.salesDailyQueryReserve - limits.salesDailyKernelQueriesPerDay - 2)
    assert.equal(budget.allowsAnotherDay(0, 2).ok, true)
    budget.spendQueries(1)
    assert.deepEqual(budget.allowsAnotherDay(0, 2), { ok: false, reason: 'queries' })
  })

  await check('B3 recompute reads ONE day per kernel call, newest first', async () => {
    const env = w.fresh(w.DAYS)
    const calls = []
    const run = await cron.runSalesDailyRecompute(env, w.dep({ kernel: w.kernelOf({ beforeRead: (days) => calls.push([...days]) }) }))
    assert.deepEqual(calls, ['2026-11-13', '2026-11-12', '2026-11-11', '2026-11-10', '2026-11-09', '2026-11-08'].map((d) => [d]))
    assert.deepEqual([run.claimed, run.committed, run.more], [6, 6, false])
  })

  await check('B4 a CPU budget ends a Free recompute visit after the day that used it; the next visits finish the rest, one budget each', async () => {
    const env = w.fresh(w.manyDays(10))
    w.setTier(env, 'free')
    const heavy = w.kernelOf({ sourceRows: 300 }) // 300 rows x 0.025 + 0.3 = 7.8 ms of estimate per day: over the 7 ms Free budget on its own
    const first = await cron.runSalesDailyRecompute(env, w.dep({ kernel: heavy }))
    assert.deepEqual([first.claimed, first.committed, first.stopped, first.more], [1, 1, 'cpu', true], 'one heavy day, then the visit stops before a second')
    let visits = 1
    while ((await cron.runSalesDailyRecompute(env, w.dep({ kernel: heavy }))).claimed > 0 && visits < 30) visits += 1
    assert.equal(w.rows().filter((r) => r.state === 0).length, 10, 'every past day is eventually committed')
    assert.ok(visits >= 10, `heavy days take a visit each (${visits})`)
    // light days: the plan's day cap, not the CPU, ends the visit
    const env2 = w.fresh(w.manyDays(10))
    w.setTier(env2, 'free')
    const light = await cron.runSalesDailyRecompute(env2, w.dep())
    assert.deepEqual([light.claimed, light.stopped, light.more], [FREE.salesDailyRecomputeDaysPerRun, undefined, true])
    w.setTier(env2, null)
  })

  await check('B4b a wall-clock budget and a query budget each end a recompute visit too', async () => {
    const env = w.fresh(w.manyDays(8))
    let now = 0
    const slow = w.kernelOf({ beforeRead: () => { now += PAID.salesDailyStepWallBudgetMs } })
    const wall = await cron.runSalesDailyRecompute(env, w.dep({ kernel: slow, clock: () => now }))
    assert.deepEqual([wall.claimed, wall.stopped], [1, 'wall'])
    const env2 = w.fresh(w.manyDays(8))
    w.setTier(env2, 'free')
    const chatty = w.kernelOf({ queries: 30 }) // a day that costs 30 statements: no second day fits the 50-query invocation
    const q = await cron.runSalesDailyRecompute(env2, w.dep({ kernel: chatty }))
    assert.deepEqual([q.claimed, q.stopped], [1, 'queries'])
    w.setTier(env2, null)
  })

  await check('B5 reconcile is resumable: a Free visit judges what its budget allows, the cursor says where it is, the next visit continues, no day is judged twice', async () => {
    const days = w.manyDays(9, '2026-10-01')
    const env = w.fresh(days)
    for (let i = 0; i < 4; i += 1) await cron.runSalesDailyRecompute(env, w.dep())
    w.setTier(env, 'free')
    const judged = []
    const heavy = w.kernelOf({ sourceRows: 300, beforeRead: (d) => judged.push(d[0]) })
    const slice = FREE.salesDailyReconcileOlderDaysPerRun, recent = FREE.salesDailyReconcileRecentDays
    const first = await cron.runSalesDailyReconcile(env, alertDep({ kernel: heavy }))
    assert.deepEqual([first.incomplete, first.stopped, judged.length], [true, 'cpu', 1], 'one day, then it stops and says it is unfinished')
    const cursor = JSON.parse(w.flag('sales_daily_reconcile_cursor'))
    assert.equal(cursor.cycle.olderLast, judged[0], 'the cursor names the last judged day')
    let guard = 0
    let last = first
    while (last.incomplete && guard++ < 40) last = await cron.runSalesDailyReconcile(env, alertDep({ kernel: heavy }))
    assert.equal(last.incomplete, undefined, 'the cycle finishes')
    assert.equal(new Set(judged).size, judged.length, 'no day judged twice in one cycle')
    assert.ok(judged.length >= slice, 'the older slice and the recent window were all judged')
    assert.equal(judged.length <= slice + recent, true)
    assert.deepEqual(JSON.parse(w.flag('sales_daily_reconcile_cursor')).cycle, null, 'a finished cycle leaves no cycle behind')
    w.setTier(env, null)
  })

  await check('B5b a visit KILLED mid-cycle (the kernel throws on the second day) loses only that day: the next visit starts at it, not at the beginning', async () => {
    const env = w.fresh(w.manyDays(6, '2026-10-01'))
    for (let i = 0; i < 3; i += 1) await cron.runSalesDailyRecompute(env, w.dep())
    const seen = []
    const dying = w.kernelOf({ beforeRead: (d) => { seen.push(d[0]); if (seen.length === 3) throw new Error('killed') } })
    await assert.rejects(cron.runSalesDailyReconcile(env, alertDep({ kernel: dying })), /killed/)
    assert.equal(seen.length, 3)
    const cursor = JSON.parse(w.flag('sales_daily_reconcile_cursor'))
    assert.equal(cursor.cycle.olderLast, seen[1], 'two days were judged and written down before the third was started')
    const resumed = []
    const result = await cron.runSalesDailyReconcile(env, alertDep({ kernel: w.kernelOf({ beforeRead: (d) => resumed.push(d[0]) }) }))
    assert.equal(resumed[0], seen[2], 'the next visit starts at the day that was in hand')
    assert.ok(!resumed.includes(seen[0]) && !resumed.includes(seen[1]))
    assert.equal(result.incomplete, undefined)
  })

  await check('B6 a MISMATCH is quarantined and alerted in the visit that finds it, BEFORE any further day is read (a later day that would be killed is never reached)', async () => {
    const env = w.fresh(w.manyDays(6, '2026-10-01'))
    for (let i = 0; i < 3; i += 1) await cron.runSalesDailyRecompute(env, w.dep())
    w.corruptStored('2026-10-02')
    alerts.length = 0
    const reads = []
    const kernel = w.kernelOf({ beforeRead: (d) => { reads.push(d[0]); if (d[0] > '2026-10-02') throw new Error('killed for CPU after the mismatch') } })
    const result = await cron.runSalesDailyReconcile(env, alertDep({ kernel }))
    assert.deepEqual(result.mismatched, ['2026-10-02'])
    assert.deepEqual(reads, ['2026-10-01', '2026-10-02'], 'nothing is read after the mismatch')
    assert.equal(w.flagsNow().quarantined, true)
    assert.deepEqual(alerts, [['2026-10-02']])
    assert.equal(w.stateOf('2026-10-02').state, 1)
  })

  console.log(`\n${passed} checks passed`)
}
main().catch((error) => { console.error(error); process.exit(1) })

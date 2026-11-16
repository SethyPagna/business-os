'use strict'
// Stored daily totals: the lifecycle of a problem, from the Opus review of phase A (Q1, P1, Q2, R1, R2).
//   L1 the owner alert is stored apart from the quarantine and retried on every reconcile visit until it is confirmed sent (fail, send, nothing).
//   L2 one poison day (a payload that fails a storage rule) in the RECOMPUTE: isolated, counted, backed off, read raw; the other days commit; past the plan threshold the owner is alerted.
//   L3 one poison day in the RECONCILE: isolated the same way; the other days are still judged; no quarantine.
//   L4 a cleared quarantine puts its days into VERIFY: stored reads stay stopped until a reconcile finds each of them in agreement; a mismatch quarantines again.
//   L5 a restore during the check is not a mismatch: the epoch is re-read before quarantining.
//   L6 a commit by an isolate of an older kernel version is refused once the coverage names a newer one.
// Run (from cloudflare/): node scripts/test-sales-daily-lifecycle-pure.cjs
const assert = require('node:assert/strict')
const { createWorld } = require('./harness/sales-daily-world.cjs')

const w = createWorld()
const { T, cron } = w
let passed = 0
const check = async (name, run) => { await run(); passed += 1; console.log(`PASS ${name}`) }
const DAYS = w.manyDays(6, '2026-10-01')
const settle = async (env, over = {}) => { for (let i = 0; i < 3; i += 1) await cron.runSalesDailyRecompute(env, w.dep(over)) }
const bad = { v: 1, branches: { 1: { bucket: { money: { revenue: '2/4' }, counts: { tx: 1 } } } } } // not canonical: encode refuses it
const poisonOn = (day) => w.kernelOf({ result: (d, sums) => (d === day ? { payload: bad, sourceRows: 1, refusal: null } : { payload: { v: 1, branches: { 1: { bucket: { money: { revenue: `${sums.t}` }, counts: { tx: sums.n } } } } }, sourceRows: sums.n, refusal: null }) })

async function main() {
  await check('L1 a failed alert is retried on every reconcile visit until sent, then never again; the alert row is not the quarantine row', async () => {
    const env = w.fresh(DAYS)
    await settle(env)
    w.corruptStored('2026-10-02')
    const calls = []
    let ok = false
    const alert = async (_e, days, kind) => { calls.push([kind, [...days]]); return ok }
    const first = await cron.runSalesDailyReconcile(env, w.dep({ alert }))
    assert.deepEqual([first.mismatched, first.alerted], [['2026-10-02'], false])
    assert.equal(calls.length, 1)
    assert.equal(w.flagsNow().quarantined, true)
    assert.deepEqual(JSON.parse(w.flag('sales_daily_alert_mismatch')).sent, false, 'stored apart, still unsent')
    assert.ok(w.flag('sales_daily_quarantine'), 'the quarantine row stays')
    const second = await cron.runSalesDailyReconcile(env, w.dep({ alert }))
    assert.equal(second.skipped, 'quarantined')
    assert.equal(calls.length, 2, 'the next visit tries again')
    ok = true
    const third = await cron.runSalesDailyReconcile(env, w.dep({ alert }))
    assert.deepEqual([calls.length, third.alerted], [3, true], 'this visit sends')
    assert.equal(JSON.parse(w.flag('sales_daily_alert_mismatch')).sent, true)
    await cron.runSalesDailyReconcile(env, w.dep({ alert }))
    assert.equal(calls.length, 3, 'a visit after the success sends nothing')
  })

  await check('L2 one poison day in the recompute: the other days commit, the poison day is dirty (read raw) with a counter and a backoff, then retried, then the owner is alerted', async () => {
    const env = w.fresh(DAYS)
    const alerts = []
    const alert = async (_e, days, kind) => { alerts.push([kind, [...days]]); return true }
    let now = w.NOW
    const run = () => cron.runSalesDailyRecompute(env, w.dep({ kernel: poisonOn('2026-10-04'), alert, nowMs: now }))
    const first = await run()
    assert.deepEqual(first.failed, ['2026-10-04'])
    assert.equal(w.rows().filter((r) => r.state === 0).length, 5, 'every other day committed')
    const poison = w.stateOf('2026-10-04')
    assert.deepEqual([poison.state, poison.fail_count, poison.payload], [1, 1, '{}'])
    assert.ok(poison.retry_after > new Date(now).toISOString().slice(0, 19), 'in backoff')
    const again = await run()
    assert.equal(again.claimed, 0, 'inside the backoff nothing is claimed: the poison day does not jam the visit')
    for (let i = 2; i <= 3; i += 1) {
      now += 2 * 24 * 3600 * 1000
      const r = await run()
      assert.deepEqual(r.failed, ['2026-10-04'])
      assert.equal(w.stateOf('2026-10-04').fail_count, i)
    }
    assert.deepEqual(alerts, [['poison', ['2026-10-04']]], 'raised once, at the plan threshold, through the same alert path')
    assert.equal(JSON.parse(w.flag('sales_daily_alert_poison')).sent, true)
    const stored = T.classifyStoredDay(w.stateOf('2026-10-04'), w.flagsNow())
    assert.equal(stored, 'dirty', 'a reader reads it raw')
  })

  await check('L3 one poison day in the reconcile: isolated (dirty, counted), the other days are still judged, no quarantine', async () => {
    const env = w.fresh(DAYS)
    await settle(env)
    const result = await cron.runSalesDailyReconcile(env, w.dep({ kernel: poisonOn('2026-10-03'), alert: async () => true }))
    assert.deepEqual(result.failed, ['2026-10-03'])
    assert.deepEqual([result.mismatched, result.matched, result.unjudged], [[], 5, 1])
    assert.equal(w.flagsNow().quarantined, false)
    const row = w.stateOf('2026-10-03')
    assert.deepEqual([row.state, row.fail_count], [1, 1])
  })

  await check('L4 a cleared quarantine puts its days into verify: stored reads stay stopped until a reconcile agrees; a mismatch quarantines again', async () => {
    const env = w.fresh(DAYS)
    await settle(env)
    w.corruptStored('2026-10-02')
    await cron.runSalesDailyReconcile(env, w.dep({ alert: async () => true }))
    assert.deepEqual(w.flagsNow().quarantineDays, ['2026-10-02'], 'the quarantine names every day that caused it')
    // what the route does in one batch, for a covering range: verify record, then the quarantine row goes; the rebuild marks the range dirty
    const raw = w.db()
    const verify = T.verifyStartStatement(['2026-10-02'], 'x')
    raw.batch([{ sql: verify.sql, params: verify.params }, { sql: "DELETE FROM system_flags WHERE key = 'sales_daily_quarantine'", params: {} }, { sql: "UPDATE sales_daily_totals SET state = 1 WHERE business_date = '2026-10-02'", params: {} }])
    assert.equal(w.flagsNow().quarantined, false)
    assert.deepEqual(w.flagsNow().verify, ['2026-10-02'])
    assert.equal(T.salesDailyStoredReadAllowed(w.flagsNow()), false, 'no stored read after the clear alone')
    await cron.runSalesDailyRecompute(env, w.dep())
    assert.equal(T.salesDailyStoredReadAllowed(w.flagsNow()), false, 'not after the recompute either: the days must agree in a reconcile first')
    const done = await cron.runSalesDailyReconcile(env, w.dep())
    assert.equal(done.matched, 1)
    assert.equal(w.flag('sales_daily_verify'), null, 'verified: the record is gone')
    assert.equal(T.salesDailyStoredReadAllowed(w.flagsNow()), true, 'stored reads resume only now')
    // and a day that still disagrees quarantines again
    raw.batch([{ sql: T.verifyStartStatement(['2026-10-03'], 'x').sql, params: T.verifyStartStatement(['2026-10-03'], 'x').params }])
    w.corruptStored('2026-10-03')
    const alerts = []
    const again = await cron.runSalesDailyReconcile(env, w.dep({ alert: async (_e, d) => { alerts.push(d); return true } }))
    assert.deepEqual(again.mismatched, ['2026-10-03'])
    assert.equal(w.flagsNow().quarantined, true)
  })

  await check('L5 a restore (epoch change) during the check is not a mismatch: no quarantine, no alert', async () => {
    const env = w.fresh(DAYS)
    await settle(env)
    w.corruptStored('2026-10-02')
    const alerts = []
    const kernel = w.kernelOf({ afterRead: () => w.db().exec("UPDATE system_flags SET value = lower(hex(randomblob(16))) WHERE key = 'data_epoch'") })
    const result = await cron.runSalesDailyReconcile(env, w.dep({ kernel, alert: async (_e, d) => { alerts.push(d); return true } }))
    assert.deepEqual(result.mismatched, [])
    assert.equal(w.flagsNow().quarantined, false)
    assert.equal(alerts.length, 0)
    assert.equal(result.incomplete, true)
  })

  await check('L6 a commit by an isolate of an older kernel version is refused once the coverage names a newer one (no orphan clean row)', async () => {
    const env = w.fresh(['2026-10-01'])
    w.db().exec(`UPDATE system_flags SET value = json_set(value, '$.kernel', ${T.SALES_DAILY_KERNEL_VERSION + 1}) WHERE key = 'sales_daily_coverage'`)
    const run = await cron.runSalesDailyRecompute(env, w.dep())
    assert.equal(run.skipped ?? run.recovered ? 'recover' : 'x', 'recover', 'coverage names a newer kernel than the code: the cron re-covers instead of committing')
    w.db().exec(`UPDATE system_flags SET value = json_set(value, '$.kernel', ${T.SALES_DAILY_KERNEL_VERSION + 1}) WHERE key = 'sales_daily_coverage'`) // a newer isolate re-covered for kernel 2 after the old one read its day
    const claim = T.claimStatement(['2026-10-01'])
    const claimed = w.db().prepare(claim.sql).all(claim.params)
    const commit = T.commitStatement({ day: '2026-10-01', claimGen: claimed[0].claim_gen, computed: { payload: { v: 1, branches: {} }, sourceRows: 0, refusal: null }, epoch: w.epochNow(), kernel: T.SALES_DAILY_KERNEL_VERSION, nowIso: 'x' }, 1000000)
    const changes = w.db().prepare(commit.sql).run(commit.params).meta.changes
    assert.equal(changes, 0, 'refused: the coverage kernel is newer')
  })

  console.log(`\n${passed} checks passed`)
}
main().catch((error) => { console.error(error); process.exit(1) })

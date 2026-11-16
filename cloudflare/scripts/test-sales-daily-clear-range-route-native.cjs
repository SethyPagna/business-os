'use strict'
// POST /api/system/sales-daily/rebuild with clearQuarantine, over a date range, against the REAL Worker under Miniflare (every middleware, the real migrations).
// The route only MARKS and only ever moves the owner's stop: this file pins exactly which rows and flags it may touch.
//   R1 a clear whose range misses a day that caused the quarantine is refused (400 sales_daily_clear_range) BEFORE the password step, changes nothing, writes no audit row
//   R2 an accepted clear: the exact rows (and only those) go dirty, the missing day is re-seeded, the quarantine row is gone, the verify record names the causing days,
//      stored reads stay off, payloads / epoch stamps / kernel stamps of every row are kept, nothing outside the range moves, the epoch and coverage are not touched
//   R3 the audit row: who, the range, the counts, never the password
//   R4 idempotence: the same call again marks nothing, seeds nothing, does not clear again, and leaves the verify record exactly as it was
//   R5 a quarantine row that names no readable day makes the WHOLE range the days to verify
//   R6 a second clear while days are still being verified KEEPS the days not yet verified (the verify record is a union, never a replacement)
//   R7 authentication and permission: anonymous 401; a manager with every neighbouring permission, and a cashier, 403 for a clear; nothing moves
//
// Run (from cloudflare/): node scripts/test-sales-daily-clear-range-route-native.cjs
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')
const { createLoader } = require('./harness/sales-daily-load.cjs')

const URL = '/api/system/sales-daily/rebuild'
const DAY = { out: '2026-10-15', d1: '2026-11-01', d2: '2026-11-02', d3: '2026-11-03', d4: '2026-11-04', d5: '2026-11-05', d6: '2026-11-06' }
const IN_RANGE = [DAY.d1, DAY.d2, DAY.d3, DAY.d4, DAY.d5, DAY.d6]

async function main() {
  const T = createLoader().src('lib/salesDailyTotals.ts')
  const adminPassword = randomBytes(12).toString('base64url')
  const world = await bootWorld({ adminPassword })
  const { check, finish } = createReporter()
  const post = (body, as = 'admin') => world.api('POST', URL, body, { as })
  const sale = (receipt, day) => world.run(`INSERT INTO sales(receipt_number,client_request_id,loyalty_accrual,total_usd,subtotal_usd,created_at) VALUES('${receipt}','req-${receipt}',0,10,10,'${day} 03:00:00')`)
  const rows = async () => (await world.query('SELECT * FROM sales_daily_totals ORDER BY business_date')).map((r) => ({ ...r }))
  const flagRows = async () => (await world.query('SELECT key, value FROM system_flags ORDER BY key')).map((r) => ({ key: r.key, value: r.value }))
  const flagValue = async (key) => (await world.first('SELECT value FROM system_flags WHERE key = ?', key))?.value ?? null
  const audits = async () => world.query("SELECT user_id, action, entity, details FROM audit_logs WHERE action = 'sales_daily_rebuild' ORDER BY id")
  const readFlags = async () => T.salesDailyFlagsFromRows(await world.query(T.SALES_DAILY_FLAGS_SQL))
  const quarantine = (days) => world.run('INSERT INTO system_flags(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value', 'sales_daily_quarantine', days === null ? 'not json' : JSON.stringify({ at: '2026-11-10T01:00:00.000Z', days, paths: ['branches.1.bucket'] }))
  // every table the route could touch, as one comparable string (sales themselves included: the route never writes them)
  const snapshot = async () => JSON.stringify({ totals: await rows(), flags: await flagRows(), sales: await world.query('SELECT id, receipt_number, created_at, total_usd FROM sales ORDER BY id') })
  const without = (list, ...drop) => list.filter((entry) => !drop.includes(entry.key))

  try {
    await world.account('manager', { roleCode: 'sv_manager', permissions: { settings: true, backup: true, backup_restore: true, users: true }, passwordHash: world.adminPasswordHash })
    await world.account('cashier', { roleCode: 'employee' })
    for (const [i, d] of [DAY.out, ...IN_RANGE].entries()) await sale(`C${i}`, d)
    // a finished world: every day clean, stamped with the current epoch and kernel, a payload each; d4 has no row (lost); the coverage names the current epoch
    let epoch = await flagValue('data_epoch')
    if (!epoch) { epoch = 'a'.repeat(32); await world.run("INSERT INTO system_flags(key,value,updated_at) VALUES('data_epoch',?,CURRENT_TIMESTAMP)", epoch) }
    await world.run("UPDATE sales_daily_totals SET state = 0, kernel_version = " + T.SALES_DAILY_KERNEL_VERSION + ", data_epoch = ?, payload = '{\"v\":1,\"branches\":{}}', source_rows = 1, computed_at = '2026-11-10T00:00:00.000Z'", epoch)
    await world.run('DELETE FROM sales_daily_totals WHERE business_date = ?', DAY.d4)
    await world.run("INSERT INTO system_flags(key,value,updated_at) VALUES('sales_daily_coverage',?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify({ epoch, kernel: T.SALES_DAILY_KERNEL_VERSION }))
    await world.run("INSERT INTO system_flags(key,value,updated_at) VALUES('sales_daily_alert_mismatch','{\"sent\":false,\"days\":[]}',CURRENT_TIMESTAMP)")
    await quarantine([DAY.d2, DAY.d5])
    const start = await snapshot()

    await check('R1 a clear whose range misses a causing day is refused before the password step: 400 with the days, nothing moves, no audit row', async (t) => {
      for (const [label, from, to] of [['misses d5', DAY.d2, DAY.d4], ['misses d2', DAY.d3, DAY.d6], ['misses both', DAY.d3, DAY.d4]]) {
        for (const [pw, how] of [[undefined, 'no password'], ['wrong-password', 'wrong password'], [adminPassword, 'right password']]) {
          const r = await post({ from, to, clearQuarantine: true, ...(pw === undefined ? {} : { currentPassword: pw }) })
          t.eq(`${label} / ${how} status`, r.status, 400)
          t.eq(`${label} / ${how} code`, r.json && [r.json.code, r.json.days], ['sales_daily_clear_range', [DAY.d2, DAY.d5]])
        }
      }
      t.eq('nothing moved', await snapshot(), start)
      t.eq('no audit row', (await audits()).length, 0)
    })

    await check('R7 anonymous 401; a manager with settings/backup/restore/users and a cashier get 403 for the clear; nothing moves', async (t) => {
      for (const as of ['manager', 'cashier']) {
        const r = await post({ from: DAY.d1, to: DAY.d6, clearQuarantine: true, currentPassword: adminPassword }, as)
        t.eq(`${as} status`, r.status, 403)
      }
      const anon = await world.mf.dispatchFetch(`http://localhost${URL}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: DAY.d1, to: DAY.d6, clearQuarantine: true }) })
      t.eq('anonymous status', anon.status, 401)
      t.eq('nothing moved', await snapshot(), start)
      t.eq('no audit row', (await audits()).length, 0)
    })

    await check('R1b the quarantine is kept by a rebuild that does not ask to clear it (any range), and by clearQuarantine:false', async (t) => {
      const a = await post({ from: DAY.d3, to: DAY.d3, currentPassword: adminPassword })
      t.eq('omitted', [a.status, a.json && a.json.quarantineCleared, (await readFlags()).quarantined], [200, false, true])
      const b = await post({ from: DAY.d3, to: DAY.d3, currentPassword: adminPassword, clearQuarantine: false })
      t.eq('false', [b.status, b.json && b.json.quarantineCleared, (await readFlags()).quarantined], [200, false, true])
      // put the world back to the start (d3 was marked dirty by these two) and drop their audit rows from the count below
      await world.run("UPDATE sales_daily_totals SET state = 0 WHERE business_date = ?", DAY.d3)
      await world.run("DELETE FROM audit_logs WHERE action = 'sales_daily_rebuild'")
      t.eq('back at the start', await snapshot(), start)
    })

    let afterClear
    await check('R2 the accepted clear marks exactly the range, re-seeds the lost day, keeps every stamp, swaps the quarantine for a verify record, leaves everything else alone', async (t) => {
      const r = await post({ from: DAY.d1, to: DAY.d6, clearQuarantine: true, currentPassword: adminPassword })
      t.eq('status', r.status, 200)
      t.eq('body', r.json && { success: r.json.success, from: r.json.from, to: r.json.to, days: r.json.days, seeded: r.json.seeded, marked: r.json.marked, quarantineCleared: r.json.quarantineCleared, verifying: r.json.verifying, backlog: r.json.backlog },
        { success: true, from: DAY.d1, to: DAY.d6, days: 6, seeded: 1, marked: 5, quarantineCleared: true, verifying: 2, backlog: 6 })
      const before = JSON.parse(start).totals
      const now = await rows()
      t.eq('days and states', now.map((row) => [row.business_date, row.state]), [[DAY.out, 0], ...IN_RANGE.map((d) => [d, 1])])
      t.eq('the row outside the range is byte for byte what it was', now.find((row) => row.business_date === DAY.out), before.find((row) => row.business_date === DAY.out))
      for (const row of now.filter((x) => IN_RANGE.includes(x.business_date) && x.business_date !== DAY.d4)) {
        const was = before.find((x) => x.business_date === row.business_date)
        t.eq(`${row.business_date}: only the state moved`, { ...row, state: 0 }, was)
      }
      t.eq('the re-seeded day is a bare dirty row', (({ state, kernel_version, data_epoch, payload, computed_at, source_rows }) => ({ state, kernel_version, data_epoch, payload, computed_at, source_rows }))(now.find((x) => x.business_date === DAY.d4)), { state: 1, kernel_version: 0, data_epoch: '', payload: '{}', computed_at: null, source_rows: 0 })
      const flags = await readFlags()
      t.eq('quarantine row gone, verify names the causing days', [flags.quarantined, flags.verify], [false, [DAY.d2, DAY.d5]])
      t.eq('stored reads are still off (verify pending), with the epoch and coverage both current', [flags.epoch === epoch, flags.coverage && flags.coverage.epoch === epoch, T.salesDailyStoredReadAllowed(flags)], [true, true, false])
      t.eq('every other flag is untouched (epoch, coverage, the unsent alert)', without(await flagRows(), 'sales_daily_verify'), without(JSON.parse(start).flags, 'sales_daily_quarantine'))
      t.eq('sales untouched', JSON.parse(await snapshot()).sales, JSON.parse(start).sales)
      afterClear = await snapshot()
    })

    await check('R3 one audit row: the admin, system / sales_daily_rebuild, the range and counts, never the password', async (t) => {
      const list = await audits()
      t.eq('one row', list.length, 1)
      t.eq('who and what', [list[0].user_id, list[0].entity], [world.adminId, 'system'])
      const details = JSON.parse(list[0].details)
      t.eq('details', { from: details.from, to: details.to, days: details.days, seeded: details.seeded, marked: details.marked, quarantineCleared: details.quarantineCleared, verifying: details.verifying }, { from: DAY.d1, to: DAY.d6, days: 6, seeded: 1, marked: 5, quarantineCleared: true, verifying: 2 })
      t.ok('no password in the record', !list[0].details.includes(adminPassword))
    })

    await check('R4 the same call again is a no-op: nothing seeded, marked or cleared, the verify record untouched, one more audit row of zeros', async (t) => {
      const verifyBefore = await flagValue('sales_daily_verify')
      const r = await post({ from: DAY.d1, to: DAY.d6, clearQuarantine: true, currentPassword: adminPassword })
      t.eq('status and counts', r.json && [r.status, r.json.seeded, r.json.marked, r.json.quarantineCleared, r.json.verifying], [200, 0, 0, false, 0])
      t.eq('everything is as it was after the first call', await snapshot(), afterClear)
      t.eq('the verify record is byte for byte the same (not rewritten)', await flagValue('sales_daily_verify'), verifyBefore)
      const list = await audits()
      t.eq('two audit rows, the second all zeros', [list.length, JSON.parse(list[1].details).marked, JSON.parse(list[1].details).quarantineCleared], [2, 0, false])
    })

    await check('R5 a quarantine row that names no readable day makes the whole range the days to verify', async (t) => {
      await world.run("DELETE FROM system_flags WHERE key = 'sales_daily_verify'")
      await quarantine(null)
      t.eq('the row is unreadable as days', (await readFlags()).quarantineDays, null)
      const r = await post({ from: DAY.d3, to: DAY.d4, clearQuarantine: true, currentPassword: adminPassword })
      t.eq('accepted for the range', r.json && [r.status, r.json.quarantineCleared, r.json.verifying], [200, true, 2])
      t.eq('verify names every day of the range', (await readFlags()).verify, [DAY.d3, DAY.d4])
    })

    await check('R6 a second clear while days are still being verified KEEPS the days not yet verified', async (t) => {
      // d2 and d5 are being verified (as after R2); the reconcile then finds d5 differing again and quarantines it
      await world.run("INSERT INTO system_flags(key,value,updated_at) VALUES('sales_daily_verify',?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify({ days: [DAY.d2, DAY.d5], at: '2026-11-10T02:00:00.000Z' }))
      await quarantine([DAY.d5])
      const r = await post({ from: DAY.d5, to: DAY.d5, clearQuarantine: true, currentPassword: adminPassword })
      t.eq('accepted', r.json && [r.status, r.json.quarantineCleared], [200, true])
      t.eq('d2 is still to be verified beside d5', (await readFlags()).verify, [DAY.d2, DAY.d5])
      t.eq('the response counts the whole list', r.json && r.json.verifying, 2)
    })
  } finally {
    await world.dispose()
  }
  finish('sales-daily clear range')
}

main().catch((error) => { console.error(error); process.exit(1) })

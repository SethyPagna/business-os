'use strict'
// POST /api/system/sales-daily/rebuild against the REAL Worker under Miniflare (every middleware, the real migrations, including 0308).
// Administrator only, then the caller's current password; a range only (real dates, from <= to, at most the plan's days); it only MARKS: the days of the
// range that have sales get a row and every day of the range goes dirty, nothing outside the range moves, and nothing is computed here. clearQuarantine
// removes the reconcile's quarantine row in the same batch. The audit row holds the range and counts, never the password.
//
// Run (from cloudflare/): node scripts/test-sales-daily-rebuild-route-native.cjs
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')

const URL = '/api/system/sales-daily/rebuild'

async function main() {
  const adminPassword = randomBytes(12).toString('base64url')
  const world = await bootWorld({ adminPassword })
  const { check, finish } = createReporter()
  const sale = (receipt, createdAt) => world.run(`INSERT INTO sales(receipt_number,client_request_id,loyalty_accrual,total_usd,subtotal_usd,created_at) VALUES('${receipt}','req-${receipt}',0,10,10,'${createdAt}')`)
  const days = async () => Object.fromEntries((await world.query('SELECT business_date, state FROM sales_daily_totals ORDER BY business_date')).map((r) => [r.business_date, r.state]))
  const audits = async () => world.query("SELECT user_id, action, entity, details FROM audit_logs WHERE action = 'sales_daily_rebuild' ORDER BY id")
  const post = (body, as = 'admin') => world.api('POST', URL, body, { as })
  try {
    await world.account('manager', { roleCode: 'sv_manager', permissions: { settings: true, backup: true, backup_restore: true, users: true }, passwordHash: world.adminPasswordHash })
    await world.account('cashier', { roleCode: 'employee' })
    // four days of sales; the trigger gives each a dirty row. Two are made clean, one is then deleted (a missing row), one stays outside the range.
    for (const [i, d] of ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].entries()) await sale(`R${i}`, `${d} 03:00:00`)
    await world.run('UPDATE sales_daily_totals SET state = 0')
    await world.run("DELETE FROM sales_daily_totals WHERE business_date = '2026-11-05'")
    const before = JSON.stringify(await days())

    await check('refused for a manager, a cashier and an anonymous caller, and nothing moves', async (t) => {
      for (const as of ['manager', 'cashier']) {
        const r = await post({ from: '2026-11-03', to: '2026-11-04', currentPassword: adminPassword }, as)
        t.eq(`${as} status`, r.status, 403)
      }
      const anon = await world.mf.dispatchFetch(`http://localhost${URL}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      t.eq('anonymous status', anon.status, 401)
      t.eq('days untouched', JSON.stringify(await days()), before)
      t.eq('no audit row', (await audits()).length, 0)
    })

    await check('a bad body is refused with 400 before the password is asked: dates, order, length, fields, flag type', async (t) => {
      const cases = [
        ['no body fields', {}, 'sales_daily_range'],
        ['bad date', { from: '2026-02-30', to: '2026-03-01' }, 'sales_daily_range'],
        ['short date', { from: '2026-3-1', to: '2026-03-01' }, 'sales_daily_range'],
        ['reversed', { from: '2026-11-05', to: '2026-11-04' }, 'sales_daily_range'],
        ['too long', { from: '2000-01-01', to: '2026-11-04' }, 'sales_daily_range_too_long'],
        ['extra field', { from: '2026-11-03', to: '2026-11-04', all: true }, 'sales_daily_body'],
        ['flag type', { from: '2026-11-03', to: '2026-11-04', clearQuarantine: 'yes' }, 'sales_daily_body'],
      ]
      for (const [label, body, code] of cases) {
        const r = await post(body)
        t.eq(`${label} status`, r.status, 400)
        t.eq(`${label} code`, r.json && r.json.code, code)
      }
      t.eq('days untouched', JSON.stringify(await days()), before)
    })

    await check('a missing or wrong password is refused (step-up audited) and nothing moves', async (t) => {
      const none = await post({ from: '2026-11-03', to: '2026-11-06' })
      t.eq('missing status', none.status, 403)
      t.eq('missing code', none.json && none.json.code, 'current_password_required')
      const wrong = await post({ from: '2026-11-03', to: '2026-11-06', currentPassword: 'not-the-password' })
      t.eq('wrong status', wrong.status, 403)
      t.eq('wrong code', wrong.json && wrong.json.code, 'incorrect_password')
      t.eq('days untouched', JSON.stringify(await days()), before)
      t.eq('no rebuild audit row', (await audits()).length, 0)
    })

    await check('the right password marks the range dirty, re-seeds the missing day, leaves other days alone and computes nothing', async (t) => {
      const r = await post({ from: '2026-11-04', to: '2026-11-05', currentPassword: adminPassword })
      t.eq('status', r.status, 200)
      t.eq('body', r.json && { success: r.json.success, days: r.json.days, seeded: r.json.seeded, marked: r.json.marked, quarantineCleared: r.json.quarantineCleared, backlog: r.json.backlog }, { success: true, days: 2, seeded: 1, marked: 1, quarantineCleared: false, backlog: 2 })
      t.eq('days', await days(), { '2026-11-03': 0, '2026-11-04': 1, '2026-11-05': 1, '2026-11-06': 0 })
      t.eq('nothing computed', (await world.query("SELECT COUNT(*) n FROM sales_daily_totals WHERE payload <> '{}' OR computed_at IS NOT NULL"))[0].n, 0)
      const rows = await audits()
      t.eq('one audit row', rows.length, 1)
      t.eq('entity', rows[0].entity, 'system')
      t.ok('range in the record, no password', /2026-11-04/.test(rows[0].details) && !rows[0].details.includes(adminPassword), rows[0].details)
    })

    await check('a rebuild of a range with no sales and no rows marks and seeds nothing; a second identical rebuild marks nothing new', async (t) => {
      const empty = await post({ from: '2026-01-01', to: '2026-01-31', currentPassword: adminPassword })
      t.eq('empty seeded', empty.json && [empty.json.seeded, empty.json.marked], [0, 0])
      const again = await post({ from: '2026-11-04', to: '2026-11-05', currentPassword: adminPassword })
      t.eq('again', again.json && [again.json.seeded, again.json.marked], [0, 0])
    })

    await check('clearQuarantine removes the quarantine row in the same call, and only then', async (t) => {
      await world.run("INSERT INTO system_flags(key,value,updated_at) VALUES('sales_daily_quarantine','{\"days\":[\"2026-11-04\"]}',CURRENT_TIMESTAMP)")
      const kept = await post({ from: '2026-11-04', to: '2026-11-04', currentPassword: adminPassword })
      t.eq('not asked: kept', [kept.json.quarantineCleared, (await world.query("SELECT COUNT(*) n FROM system_flags WHERE key='sales_daily_quarantine'"))[0].n], [false, 1])
      const cleared = await post({ from: '2026-11-04', to: '2026-11-04', currentPassword: adminPassword, clearQuarantine: true })
      t.eq('asked: cleared', [cleared.json.quarantineCleared, (await world.query("SELECT COUNT(*) n FROM system_flags WHERE key='sales_daily_quarantine'"))[0].n], [true, 0])
    })
  } finally {
    await world.dispose()
  }
  finish()
}

main().catch((error) => { console.error(error); process.exit(1) })

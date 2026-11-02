'use strict'
// P1.4 (6.0.1050): the report_atomic switch at the HTTP edge, on the P0.1 world (the real Worker, production-scale synthetic seed incl.
// the S11 boundary rows: sales at 16:59:59 / 17:00:00 UTC, a return today on a 40-day-old sale, an old sale cancelled today, a payment on a
// month-old Not Paid sale), plus the rows the seed lacks: a riel refund today, a Not Paid return that only lowers the debt, an unknown-cost line and a
// store-paid delivery with its fee. For every date range the UI sends, both roles (administrator, and an employee without the cost grant) and
// branch all / 1, the response with the switch OFF and with it ON must be byte-identical; ON must take fewer D1 calls; and OFF must run
// the statements the base committed to read-budget/fingerprints. Revenue with and without Not Paid are fields of one response, so they
// are compared too. Fields that differ between two OFF runs of the same request are listed and masked, never hidden silently.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const bcrypt = require('bcryptjs')
// This is a parity test, not a timing gate: a request on a loaded machine may take longer than the harness's 20 s default, and a status 0 would hide the comparison.
process.env.READ_BUDGET_DEADLINE_MS ||= '180000'
const rb = path.join(__dirname, 'read-budget')
const { bootWorld, runShape, fingerprintOf } = require(path.join(rb, 'world.cjs'))
const { seedContext, ADMIN } = require(path.join(rb, 'seed.cjs'))
const { seedReportExtras } = require('./harness/report_atomic_extras.cjs')

const EMPLOYEE = { username: 'budget_nocost', password: 'budget-password-2' }
const stable = value => JSON.stringify(value, (key, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v))
const switchRow = state => JSON.stringify({ epoch: 1, switches: { report_atomic: state } })

function urls(ctx) {
  const T = ctx.today, W = ctx.week, M = ctx.month, Y = ctx.year
  const R = (s, e) => `startDate=${s}&endDate=${e}`
  const startup = [['today', `${R(T, T)}&granularity=day`], ['7d', `${R(W, T)}&granularity=day`], ['30d', `${R(M, T)}&granularity=day`], ['365d', `${R(Y, T)}&granularity=month`], ['all-time', 'granularity=month']]
  const list = []
  for (const [name, query] of startup) for (const branch of [null, 1]) list.push({ id: `startup ${name}${branch ? ' b' + branch : ''}`, url: `/api/dashboard/startup?${query}${branch ? '&branchId=' + branch : ''}`, roles: ['admin', 'employee'], owned: !branch })
  for (const [name, query] of [['today', R(T, T)], ['7d', R(W, T)], ['30d', R(M, T)], ['365d', R(Y, T)]]) for (const branch of name === '30d' ? [null, 1] : [null]) list.push({ id: `analytics ${name}${branch ? ' b' + branch : ''}`, url: `/api/analytics?${query}${branch ? '&branchId=' + branch : ''}`, roles: ['admin', 'employee'], owned: !branch && name === '30d' })
  const stats = [['all-time', ''], ['today', R(T, T)], ['7d', R(W, T)], ['30d', R(M, T)], ['365d', R(Y, T)], ['search', 'search=Customer%2012']]
  for (const [name, query] of stats) for (const branch of name === 'search' ? [null] : [null, 1]) list.push({ id: `stats ${name}${branch ? ' b' + branch : ''}`, url: `/api/sales/stats?${[query, branch ? 'branchId=' + branch : ''].filter(Boolean).join('&')}`, roles: ['admin', 'employee'], owned: !branch && name === 'all-time' })
  // Crafted parameters: the same status and body on both paths, never a 5xx, never a wider scope than the honest request.
  const crafted = [
    ['startup branch injection', `/api/dashboard/startup?${R(M, T)}&granularity=day&branchId=${encodeURIComponent('1 OR 1=1')}`], ['startup branch text', `/api/dashboard/startup?${R(M, T)}&granularity=day&branchId=abc`],
    ['startup branch unknown', `/api/dashboard/startup?${R(M, T)}&granularity=day&branchId=999`], ['startup branch repeated', `/api/dashboard/startup?${R(M, T)}&granularity=day&branchId=1&branchId=2`],
    ['startup reversed dates', `/api/dashboard/startup?${R(T, M)}&granularity=day`], ['startup impossible date', `/api/dashboard/startup?startDate=2026-13-45&endDate=${T}&granularity=day`],
    ['startup word dates', '/api/dashboard/startup?startDate=yesterday&endDate=today&granularity=day'], ['startup bad granularity', `/api/dashboard/startup?${R(M, T)}&granularity=century`],
    ['analytics reversed dates', `/api/analytics?${R(T, M)}`], ['analytics branch injection', `/api/analytics?${R(M, T)}&branchId=${encodeURIComponent("1' OR '1'='1")}`], ['analytics impossible date', `/api/analytics?startDate=${M}&endDate=2026-02-30`],
    ['stats reversed dates', `/api/sales/stats?${R(T, M)}`], ['stats branch injection', `/api/sales/stats?${R(M, T)}&branchId=${encodeURIComponent('1 OR 1=1')}`], ['stats non-iso dates', '/api/sales/stats?startDate=09/13/2026&endDate=09/14/2026'],
    ['stats branch repeated', `/api/sales/stats?${R(M, T)}&branchId=1&branchId=2`],
  ]
  for (const [id, url] of crafted) list.push({ id: 'crafted ' + id, url, roles: ['admin'], crafted: true })
  list.push({ id: 'stats-strip today', url: `/api/sales/stats-strip?${R(T, T)}`, roles: ['admin'] }, { id: 'stats-strip 30d', url: `/api/sales/stats-strip?${R(M, T)}`, roles: ['admin'] })
  // The full report family (readSalesReportSnapshot): the daily report (an undated series), the grouped reports (a plain dated window), overview and periods
  // take the one atomic batch; the day report (courier fees), the customer report (a scope) and a dated daily report keep the two passes. Both must answer alike.
  list.push({ id: 'reports/overview 30d', url: `/api/reports/overview?${R(M, T)}`, roles: ['admin'] }, { id: 'reports/periods 30d', url: `/api/reports/periods?${R(M, T)}&granularity=day`, roles: ['admin'] },
    { id: 'daily-report all-time', url: `/api/sales/daily-report?date=${T}`, roles: ['admin'], owned: true }, { id: 'daily-report 30d', url: `/api/sales/daily-report?${R(M, T)}`, roles: ['admin'] },
    { id: 'grouped product 365d', url: `/api/reports/grouped?${R(Y, T)}&by=product`, roles: ['admin', 'employee'], owned: true }, { id: 'grouped product 30d', url: `/api/reports/grouped?${R(M, T)}&by=product`, roles: ['admin', 'employee'] },
    { id: 'grouped product b1', url: `/api/reports/grouped?${R(M, T)}&by=product&branchId=1`, roles: ['admin'] }, { id: 'grouped customer 30d', url: `/api/reports/grouped?${R(M, T)}&by=customer`, roles: ['admin'] },
    { id: 'grouped payment_method 7d', url: `/api/reports/grouped?${R(W, T)}&by=payment_method`, roles: ['admin'] }, { id: 'grouped cashier 30d', url: `/api/reports/grouped?${R(M, T)}&by=cashier`, roles: ['admin'] },
    { id: 'grouped hour 30d', url: `/api/reports/grouped?${R(M, T)}&by=hour`, roles: ['admin'] }, { id: 'grouped branch 30d', url: `/api/reports/grouped?${R(M, T)}&by=branch`, roles: ['admin'] },
    { id: 'grouped courier 30d', url: `/api/reports/grouped?${R(M, T)}&by=courier`, roles: ['admin'] }, { id: 'day-report today', url: `/api/sales/day-report?date=${T}`, roles: ['admin', 'employee'] },
    { id: 'customer-report 365d', url: `/api/sales/customer-report?customerId=1&${R(Y, T)}`, roles: ['admin'] }, { id: 'delivery-contact-report 30d', url: `/api/sales/delivery-contact-report?${R(M, T)}`, roles: ['admin'] },
    { id: 'business-summary sales 30d', url: `/api/reports/business-summary/sales?${R(M, T)}`, roles: ['admin'] })
  return list
}

function diffPaths(a, b, p = '', out = []) {
  if (stable(a) === stable(b)) return out
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') { out.push(p || '(root)'); return out }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffPaths(a[k], b[k], p + '.' + k, out)
  return out
}
const without = (value, paths) => {
  const clone = JSON.parse(JSON.stringify(value))
  for (const p of paths) { const keys = p.split('.').filter(Boolean); let node = clone; for (const k of keys.slice(0, -1)) { if (!node || typeof node !== 'object') break; node = node[k] } if (node && typeof node === 'object') delete node[keys[keys.length - 1]] }
  return clone
}

async function main() {
  const started = Date.now()
  const ctx = seedContext()
  const world = await bootWorld({ tier: 'free' })
  const notes = []
  try {
    const extras = await seedReportExtras(world, ctx)
    notes.push('seed extras: ' + JSON.stringify(extras))
    // an employee who may see the dashboard and sales but holds no cost grant
    await world.db.prepare("INSERT INTO roles(id,name,code,permissions,is_system) VALUES(902,'Budget employee','budget_nocost','{\"dashboard\":true,\"sales\":true,\"reports\":true}',0)").run()
    await world.db.prepare("INSERT INTO users(id,username,name,password,role_id,permissions,is_active,organization_id,must_change_password) VALUES(902,?,'Budget Employee',?,902,'{}',1,?,0)").bind(EMPLOYEE.username, bcrypt.hashSync(EMPLOYEE.password, 4), world.orgId).run()
    // A non-administrator signs in only from an approved device.
    await world.db.prepare("INSERT INTO trusted_devices(user_id,device_id,device_name,status) VALUES(902,'budget-device','Budget device','approved')").run()
    const adminCookie = world.cookie
    const login = await world.send('POST', '/api/auth/login', { username: EMPLOYEE.username, password: EMPLOYEE.password, organizationId: world.orgId, deviceId: 'budget-device', deviceName: 'Budget device' }, { cookie: null })
    assert.ok(login.status === 200 && login.setCookie, 'employee login: ' + login.status + ' ' + login.text.slice(0, 400))
    const cookies = { admin: adminCookie, employee: login.setCookie.split(';')[0] }

    const setSwitch = async state => {
      await world.db.prepare("INSERT OR REPLACE INTO system_flags(key,value) VALUES('read_switches',?)").bind(switchRow(state)).run()
      await world.restart()
    }
    const get = (role, url) => world.send('GET', url, undefined, { cookie: cookies[role], miss: true, deadlineMs: 120000 })
    const list = urls(ctx)
    const sweep = async (state, only) => {
      await setSwitch(state)
      const out = new Map()
      for (const entry of list) for (const role of entry.roles.filter(r => !only || only.includes(r))) {
        const r = await get(role, entry.url)
        assert.ok(entry.crafted ? r.status < 500 : r.status === 200, `${state} ${role} ${entry.id}: status ${r.status} ${r.text.slice(0, 160)}`)
        out.set(role + ' ' + entry.id, { status: r.status, json: r.json, text: r.text, calls: r.calls })
      }
      return out
    }

    // 1. determinism control: two OFF sweeps, to learn which fields move on their own
    const off1 = await sweep('off'), off2 = await sweep('off', ['admin'])
    const volatile = new Map()
    for (const [key, a] of off1) { if (!off2.has(key)) continue; const paths = diffPaths(a.json, off2.get(key).json); if (paths.length) { volatile.set(key, paths); volatile.set(key.replace(/^admin /, 'employee '), paths) } }
    const volatileNames = [...new Set([...volatile.values()].flat().map(p => p.split('.').pop()))]
    assert.ok(volatileNames.every(name => /^(generated_at|server_time|now|timestamp|as_of|computed_at|updated_at|fetched_at|duration_ms|elapsed_ms|request_id|ts)$/i.test(name)),
      'only clock-like fields may move between two identical OFF requests: ' + volatileNames.join(','))
    notes.push(`two OFF sweeps (second: administrator only, ${off2.size} requests): ${volatile.size} request keys with moving fields ${JSON.stringify(volatileNames)}`)

    // 2. ON against OFF, byte for byte
    const on = await sweep('on')
    let compared = 0, bytes = 0, fewer = 0, ownedCompared = 0, craftedCompared = 0
    const positives = { tx: 0, pending: 0, cancelled: 0, refund: 0 }
    for (const [key, a] of off1) {
      const b = on.get(key)
      const mask = volatile.get(key) || []
      assert.equal(b.status, a.status, `${key}: ON answers ${b.status}, OFF ${a.status}`)
      if (a.json === null) assert.equal(b.text, a.text, `${key}: ON body differs from OFF`)
      else assert.equal(stable(without(b.json, mask)), stable(without(a.json, mask)), `${key}: ON differs from OFF at ${diffPaths(without(a.json, mask), without(b.json, mask)).slice(0, 6).join(', ')}`)
      compared += 1; bytes += a.text.length
      if (b.calls < a.calls) fewer += 1
      if (/^admin crafted /.test(key)) craftedCompared += 1
      const totals = a.json && (a.json.analytics ? a.json.analytics.totals : a.json.totals)
      if (totals) { positives.tx += totals.tx_count > 0 ? 1 : 0; positives.pending += totals.pending_revenue_usd > 0 ? 1 : 0; positives.cancelled += totals.cancelled_tx_count > 0 ? 1 : 0; positives.refund += totals.refund_usd > 0 ? 1 : 0 }
      if (/startup|analytics|stats all-time|daily-report all-time|grouped product 365d/.test(key) && !/ b1| crafted /.test(key)) { assert.ok(b.calls < a.calls, `${key}: ON must take fewer D1 calls than OFF (${b.calls} vs ${a.calls})`); ownedCompared += 1 }
    }
    assert.ok(positives.tx > 20 && positives.pending > 5 && positives.cancelled > 5 && positives.refund > 3, 'the seeded windows must exercise sales, Not Paid, cancelled and refunded rows: ' + JSON.stringify(positives))
    const craftedStatuses = [...off1].filter(([key]) => /^admin crafted /.test(key)).map(([, v]) => v.status)
    assert.ok(craftedCompared === list.filter(e => e.crafted).length && craftedStatuses.some(s => s === 200) && craftedStatuses.some(s => s >= 400), 'the crafted set must include answered and refused requests: ' + craftedStatuses.join(','))
    notes.push(`OFF == ON on ${compared} responses (${bytes} bytes of OFF JSON, ${craftedCompared} of them crafted parameters answering ${[...new Set(craftedStatuses)].join('/')}); ON took fewer D1 calls on ${fewer}; positive controls ${JSON.stringify(positives)}`)

    // 3. the two roles really see different bodies (cost fields), so the role dimension is not vacuous
    const adminStartup = off1.get('admin startup 30d').json, employeeStartup = off1.get('employee startup 30d').json
    assert.notEqual(stable(adminStartup.analytics.totals), stable(employeeStartup.analytics.totals), 'the employee without a cost grant must not receive the administrator totals')
    // The courier's actual cost is its own grant (sales:view_courier_cost, on by default for a Sales role), so delivery keys are not the acquisition cost under test here.
    const leaked = Object.keys(employeeStartup.analytics.totals).filter(k => /cost|profit|margin/i.test(k) && !/delivery/i.test(k) && employeeStartup.analytics.totals[k] !== null && employeeStartup.analytics.totals[k] !== 0)
    assert.deepEqual(leaked, [], 'no cost-bearing total reaches the employee on either path')
    notes.push('role control: administrator and employee totals differ; the employee body carries no cost, profit or margin figure')

    // 4. cold D1 calls per owned route, OFF against ON (a fresh isolate each; the ON figure includes the one switch read)
    const cold = {}
    for (const state of ['off', 'on']) {
      await setSwitch(state)
      for (const entry of list.filter(e => e.owned)) {
        const m = await runShape(world, { method: 'GET', url: entry.url }, { cold: true, cacheMiss: true })
        assert.equal(m.status, 200); ;(cold[entry.id] ||= {})[state] = m.calls
      }
    }
    for (const [id, c] of Object.entries(cold)) assert.ok(c.on <= 45 && c.on < c.off, `${id}: cold calls OFF ${c.off}, ON ${c.on} (target <= 45 and fewer than OFF)`)
    notes.push('cold D1 calls OFF -> ON: ' + Object.entries(cold).map(([id, c]) => `${id} ${c.off}->${c.on}`).join(', '))

    // 5. OFF is the base: the warm statements of each owned shape equal the fingerprints P0.1 committed for the base
    await setSwitch('off')
    const prints = {}, checked = []
    for (const entry of list.filter(e => e.owned && e.roles.includes('admin'))) {
      const shapeId = ({ 'startup today': 'dashboard-startup-today', 'startup 7d': 'dashboard-startup-7d', 'startup 30d': 'dashboard-startup-30d', 'startup 365d': 'dashboard-startup-365d', 'analytics 30d': 'analytics', 'stats all-time': 'sales-stats-all-time',
        'daily-report all-time': 'sales-daily-report', 'grouped product 365d': 'reports-grouped-by-product-365d' })[entry.id]
      if (!shapeId) continue
      const file = path.join(rb, 'fingerprints', ({ startup: 'api_dashboard_startup', analytics: 'api_analytics', stats: 'api_sales_stats', 'daily-report': 'api_sales_daily_report', grouped: 'api_reports_grouped' })[entry.id.split(' ')[0]] + '.json')
      const committed = (prints[file] ||= JSON.parse(fs.readFileSync(file, 'utf8')))[shapeId]
      assert.ok(committed, 'no committed fingerprint for ' + shapeId)
      await runShape(world, { method: 'GET', url: entry.url }, { cold: true, cacheMiss: true })
      const warm = await runShape(world, { method: 'GET', url: entry.url }, { cold: false, cacheMiss: true, fingerprints: true })
      // Every statement the base ran is still run, the same number of times (the order of statements issued by concurrent branches of one request is not fixed).
      // The only statements allowed beyond it are the ambient ones that depend on the wall clock and not on the report: the session heartbeat (five-minute
      // throttle, lib/auth.ts), the Telegram scheduled-send drain of the request path, and this slice's own switch-row read (memoised for 15 s, so at most one).
      // A loaded machine stretches a test past those intervals, which would otherwise make this comparison depend on how busy the laptop is.
      const ambient = [/^UPDATE user_sessions SET last_seen_at/, /^SELECT send_key FROM telegram_scheduled_sends/, /^SELECT key, value FROM system_flags WHERE key IN \(\?1, \?2\)$/]
      const count = hashes => hashes.reduce((m, h) => m.set(h, (m.get(h) || 0) + 1), new Map())
      const nowCount = count(warm.fingerprints.map(f => f.h)), baseCount = count(committed.map(f => f[0]))
      const heads = new Map([...warm.fingerprints.map(f => [f.h, f.head]), ...committed.map(f => [f[0], f[1]])])
      const isAmbient = h => ambient.some(re => re.test(String(heads.get(h))))
      const drift = [...new Set([...nowCount.keys(), ...baseCount.keys()])].filter(h => (nowCount.get(h) || 0) !== (baseCount.get(h) || 0) && !(isAmbient(h) && (nowCount.get(h) || 0) > (baseCount.get(h) || 0))).map(h => `${heads.get(h)} (now ${nowCount.get(h) || 0}, base ${baseCount.get(h) || 0})`)
      assert.deepEqual(drift, [], `${shapeId}: OFF runs different statements from the base fingerprints`)
      assert.ok(warm.fingerprints.filter(f => ambient[2].test(String(f.head))).length <= 1, `${shapeId}: the switch row is read at most once per request`)
      const now = warm.fingerprints
      checked.push(`${shapeId} (${now.length} statements)`)
    }
    notes.push('OFF statements equal the committed base fingerprints: ' + checked.join(', '))

    for (const line of notes) console.log('PASS ' + line)
    console.log(JSON.stringify({ status: 'PASS', requests: off1.size * 3, seconds: Math.round((Date.now() - started) / 1000), scope: 'Real Worker (Miniflare), P0.1 synthetic production-scale seed; no CPU, quota or production claim.' }))
  } finally { await world.dispose() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

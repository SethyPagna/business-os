'use strict'
// P1.4 (6.0.1050): the report_atomic switch at the HTTP edge, on the P0.1 world (the real Worker, production-scale synthetic seed incl.
// the S11 boundary rows: sales at 16:59:59 / 17:00:00 UTC, a return today on a 40-day-old sale, an old sale cancelled today, a payment on a
// month-old Not Paid sale). For every date range the UI sends, both roles (administrator, and an employee without the cost grant) and
// branch all / 1, the response with the switch OFF and with it ON must be byte-identical; ON must take fewer D1 calls; and OFF must run
// the statements the base committed to read-budget/fingerprints. Revenue with and without Not Paid are fields of one response, so they
// are compared too. Fields that differ between two OFF runs of the same request are listed and masked, never hidden silently.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const bcrypt = require('bcryptjs')
const rb = path.join(__dirname, 'read-budget')
const { bootWorld, runShape, fingerprintOf } = require(path.join(rb, 'world.cjs'))
const { seedContext, ADMIN } = require(path.join(rb, 'seed.cjs'))

const EMPLOYEE = { username: 'budget_nocost', password: 'budget-password-2' }
const stable = value => JSON.stringify(value, (key, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v))
const switchRow = state => JSON.stringify({ epoch: 1, switches: { report_atomic: state } })

function urls(ctx) {
  const T = ctx.today, W = ctx.week, M = ctx.month, Y = ctx.year
  const R = (s, e) => `startDate=${s}&endDate=${e}`
  const startup = [['today', `${R(T, T)}&granularity=day`], ['7d', `${R(W, T)}&granularity=day`], ['30d', `${R(M, T)}&granularity=day`], ['365d', `${R(Y, T)}&granularity=month`]]
  const list = []
  for (const [name, query] of startup) for (const branch of [null, 1]) list.push({ id: `startup ${name}${branch ? ' b' + branch : ''}`, url: `/api/dashboard/startup?${query}${branch ? '&branchId=' + branch : ''}`, roles: ['admin', 'employee'], owned: !branch })
  for (const branch of [null, 1]) list.push({ id: `analytics 30d${branch ? ' b' + branch : ''}`, url: `/api/analytics?${R(M, T)}${branch ? '&branchId=' + branch : ''}`, roles: ['admin', 'employee'], owned: !branch })
  const stats = [['all-time', ''], ['today', R(T, T)], ['30d', R(M, T)], ['search', 'search=Customer%2012']]
  for (const [name, query] of stats) for (const branch of name === 'search' ? [null] : [null, 1]) list.push({ id: `stats ${name}${branch ? ' b' + branch : ''}`, url: `/api/sales/stats?${[query, branch ? 'branchId=' + branch : ''].filter(Boolean).join('&')}`, roles: ['admin', 'employee'], owned: !branch && name === 'all-time' })
  list.push({ id: 'stats-strip today', url: `/api/sales/stats-strip?${R(T, T)}`, roles: ['admin'] }, { id: 'stats-strip 30d', url: `/api/sales/stats-strip?${R(M, T)}`, roles: ['admin'] })
  // Full-family readers: the switch routes them to the same two-pass compare, so they must not move.
  list.push({ id: 'reports/overview 30d', url: `/api/reports/overview?${R(M, T)}`, roles: ['admin'] }, { id: 'reports/periods 30d', url: `/api/reports/periods?${R(M, T)}&granularity=day`, roles: ['admin'] },
    { id: 'sales/daily-report today', url: `/api/sales/daily-report?date=${T}`, roles: ['admin'] })
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
        assert.ok(r.status === 200, `${state} ${role} ${entry.id}: status ${r.status} ${r.text.slice(0, 160)}`)
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
    let compared = 0, bytes = 0, fewer = 0, ownedCompared = 0
    const positives = { tx: 0, pending: 0, cancelled: 0, refund: 0 }
    for (const [key, a] of off1) {
      const b = on.get(key)
      const mask = volatile.get(key) || []
      assert.equal(stable(without(b.json, mask)), stable(without(a.json, mask)), `${key}: ON differs from OFF at ${diffPaths(without(a.json, mask), without(b.json, mask)).slice(0, 6).join(', ')}`)
      compared += 1; bytes += a.text.length
      if (b.calls < a.calls) fewer += 1
      const totals = a.json && (a.json.analytics ? a.json.analytics.totals : a.json.totals)
      if (totals) { positives.tx += totals.tx_count > 0 ? 1 : 0; positives.pending += totals.pending_revenue_usd > 0 ? 1 : 0; positives.cancelled += totals.cancelled_tx_count > 0 ? 1 : 0; positives.refund += totals.refund_usd > 0 ? 1 : 0 }
      if (/startup|analytics|stats all-time/.test(key) && !/ b1/.test(key)) { assert.ok(b.calls < a.calls, `${key}: ON must take fewer D1 calls than OFF (${b.calls} vs ${a.calls})`); ownedCompared += 1 }
    }
    assert.ok(positives.tx > 20 && positives.pending > 5 && positives.cancelled > 5 && positives.refund > 3, 'the seeded windows must exercise sales, Not Paid, cancelled and refunded rows: ' + JSON.stringify(positives))
    notes.push(`OFF == ON on ${compared} responses (${bytes} bytes of OFF JSON); ON took fewer D1 calls on ${fewer}; positive controls ${JSON.stringify(positives)}`)

    // 3. the two roles really see different bodies (cost fields), so the role dimension is not vacuous
    const adminStartup = off1.get('admin startup 30d').json, employeeStartup = off1.get('employee startup 30d').json
    assert.notEqual(stable(adminStartup.analytics.totals), stable(employeeStartup.analytics.totals), 'the employee without a cost grant must not receive the administrator totals')
    const leaked = Object.keys(employeeStartup.analytics.totals).filter(k => /cost|profit|margin/i.test(k) && employeeStartup.analytics.totals[k] !== null && employeeStartup.analytics.totals[k] !== 0)
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
      const shapeId = ({ 'startup today': 'dashboard-startup-today', 'startup 7d': 'dashboard-startup-7d', 'startup 30d': 'dashboard-startup-30d', 'startup 365d': 'dashboard-startup-365d', 'analytics 30d': 'analytics', 'stats all-time': 'sales-stats-all-time' })[entry.id]
      if (!shapeId) continue
      const file = path.join(rb, 'fingerprints', ({ startup: 'api_dashboard_startup', analytics: 'api_analytics', stats: 'api_sales_stats' })[entry.id.split(' ')[0]] + '.json')
      const committed = (prints[file] ||= JSON.parse(fs.readFileSync(file, 'utf8')))[shapeId]
      assert.ok(committed, 'no committed fingerprint for ' + shapeId)
      await runShape(world, { method: 'GET', url: entry.url }, { cold: true, cacheMiss: true })
      const warm = await runShape(world, { method: 'GET', url: entry.url }, { cold: false, cacheMiss: true, fingerprints: true })
      // The same statements, the same number of times; the order of statements issued by concurrent branches of one request is not fixed.
      const count = hashes => hashes.reduce((m, h) => m.set(h, (m.get(h) || 0) + 1), new Map())
      const nowCount = count(warm.fingerprints.map(f => f.h)), baseCount = count(committed.map(f => f[0]))
      const heads = new Map([...warm.fingerprints.map(f => [f.h, f.head]), ...committed.map(f => [f[0], f[1]])])
      const drift = [...new Set([...nowCount.keys(), ...baseCount.keys()])].filter(h => (nowCount.get(h) || 0) !== (baseCount.get(h) || 0)).map(h => `${heads.get(h)} (now ${nowCount.get(h) || 0}, base ${baseCount.get(h) || 0})`)
      assert.deepEqual(drift, [], `${shapeId}: OFF runs different statements from the base fingerprints`)
      const now = warm.fingerprints
      checked.push(`${shapeId} (${now.length} statements)`)
    }
    notes.push('OFF statements equal the committed base fingerprints: ' + checked.join(', '))

    for (const line of notes) console.log('PASS ' + line)
    console.log(JSON.stringify({ status: 'PASS', requests: off1.size * 3, seconds: Math.round((Date.now() - started) / 1000), scope: 'Real Worker (Miniflare), P0.1 synthetic production-scale seed; no CPU, quota or production claim.' }))
  } finally { await world.dispose() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

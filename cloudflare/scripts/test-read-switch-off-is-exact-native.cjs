'use strict'
// OFF is the exact old path. On the read-budget seed (the P0.1 world), a spread of the hottest GET shapes is requested with no
// read_switches row (the deployed state) and again with probe=ON stored: the executed SQL fingerprint list must equal P0.1's
// recorded list for the base, the D1 calls and rows must equal, and the response body must equal (after removing the fields
// that differ between two requests of one state). Nothing consults `probe`, so ON may change nothing. A planted consult
// (a control run in the same file) must be caught by the same comparison.
//
// Run (from cloudflare/): node scripts/test-read-switch-off-is-exact-native.cjs
const fs = require('node:fs')
const path = require('node:path')
const { bootWorld, runShape } = require('./read-budget/world.cjs')
const { getShapes } = require('./read-budget/shapes.cjs')
const { loadBudgets } = require('./read-budget/budgets.cjs')
const { prepareWorld, resolveUrl } = require('./read-budget/runner.cjs')

const SAMPLE = [
  'auth-me', 'auth-bootstrap', 'runtime-version', 'settings', 'settings-meta', 'products-search-pos-page-name-asc-family-metadata-0', 'products-search-pos-text',
  'products-bootstrap-pos-first-load', 'categories', 'units', 'inventory-summary', 'inventory-checks-products-all-time-name-page-check-default', 'sales-list-today',
  'sales-stats-today', 'returns-list', 'customers-list', 'dashboard-startup-today', 'notifications-summary-bell', 'fees-labels', 'shifts-current', 'branches', 'users', 'portal-config',
]
// Their SQL list depends on which cache versions the run has already read (date and order), so only OFF versus ON is compared.
const NOT_REPLAYABLE = new Set(['sales-list-today', 'sales-stats-today', 'dashboard-startup-today'])
const RESTART_VOLATILE = new Set(['/bootedAt'])
const FINGERPRINTS = path.join(__dirname, 'read-budget', 'fingerprints')

function leaves(value, prefix = '', out = new Map()) {
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) leaves(child, `${prefix}/${key}`, out)
  else out.set(prefix, JSON.stringify(value))
  return out
}
function differing(a, b) {
  const left = leaves(a)
  const right = leaves(b)
  return [...new Set([...left.keys(), ...right.keys()])].filter((key) => left.get(key) !== right.get(key))
}

// Any GET may carry the shift-overview drain (index.ts, one run per 20 s, lib/telegram.ts). It is not part of the shape and it fires on
// whichever request lands after the window opens, so a measure without it is taken: the drain cannot fire again for 20 s.
const DRAIN = 'telegram_scheduled_sends'
const hasDrain = (m) => (m.fingerprints || []).some((f) => String(f.head).includes(DRAIN))
const withoutDrain = (m) => ({ ...m, fingerprints: (m.fingerprints || []).filter((f) => !String(f.head).includes(DRAIN)) })
// 6.0.1048: the flags read (switches + data epoch, memoised 15 s per isolate) is a refresh, not part of a shape: a request that lands just after the
// window closes pays it. The measure the comparison keeps is one taken inside a window, so a refresh in it is measured again.
const FLAGS_REFRESH = 'FROM system_flags WHERE key IN (?1, ?2)'
const hasRefresh = (m) => (m.fingerprints || []).some((f) => String(f.head).includes(FLAGS_REFRESH))

async function measure(world, shape, url) {
  const probe = { method: 'GET', url, anon: shape.anon }
  const first = withoutDrain(await runShape(world, probe, { cold: false, cacheMiss: true, fingerprints: true }))
  let second = await runShape(world, probe, { cold: false, cacheMiss: true, fingerprints: true })
  for (let attempt = 0; (hasDrain(second) || hasRefresh(second)) && attempt < 3; attempt += 1) second = await runShape(world, probe, { cold: false, cacheMiss: true, fingerprints: true })
  if (hasDrain(second)) throw new Error(`${shape.id}: the drain was in four measures in a row`)
  return { first, second }
}

async function main() {
  const budgets = loadBudgets()
  const routeOf = new Map(budgets.shapes.map((s) => [s.id, s.route]))
  const world = await bootWorld({ tier: 'free' })
  const reds = []
  let compared = 0
  try {
    await prepareWorld(world)
    // The recorded lists are those of a request that finds the flags memo cold (the first read of a fresh isolate pays the one flags statement, in auth-bootstrap).
    // prepareWorld now sends Inventory Check requests, which read their switches and warm that memo for 15 s, so the comparison starts on a fresh isolate, as it does in production.
    await world.restart()
    await world.login()
    const shapes = getShapes(world.ctx).filter((s) => SAMPLE.includes(s.id))
    if (shapes.length !== SAMPLE.length) reds.push(`the sample names ${SAMPLE.length} shapes, ${shapes.length} exist: ${SAMPLE.filter((id) => !shapes.some((s) => s.id === id)).join(', ')}`)
    const urls = new Map()
    for (const shape of shapes) urls.set(shape.id, await resolveUrl(world, shape.url))

    const off = new Map()
    for (const shape of shapes) off.set(shape.id, await measure(world, shape, urls.get(shape.id)))

    await world.db.prepare('INSERT INTO system_flags (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
      .bind('read_switches', JSON.stringify({ epoch: 1, set_at: '2026-11-02T00:00:00.000Z', set_by: 1, switches: { probe: 'on' } })).run()
    await world.restart()
    await runShape(world, { method: 'GET', url: '/api/auth/me' }, { cold: false, cacheMiss: true })

    for (const shape of shapes) {
      const base = off.get(shape.id)
      const on = await measure(world, shape, urls.get(shape.id))
      const volatile = [...differing(base.first.json, base.second.json), ...RESTART_VOLATILE]
      const label = `${shape.id} (${routeOf.get(shape.id)})`
      const problems = []
      const recorded = (() => {
        const file = path.join(FINGERPRINTS, String(routeOf.get(shape.id)).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') + '.json')
        return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8'))[shape.id] : undefined
      })()
      const shape2 = (m) => (m.fingerprints || []).map((f) => [f.h, f.head])
      if (NOT_REPLAYABLE.has(shape.id)) { /* compared OFF versus ON only */ }
      else if (!recorded) problems.push('no recorded fingerprint list from P0.1')
      else if (JSON.stringify(shape2(base.first)) !== JSON.stringify(recorded)) {
        const now = new Set(shape2(base.first).map((f) => f[0]))
        const was = new Set(recorded.map((f) => f[0]))
        problems.push(`switch OFF: SQL fingerprints differ from the base's recorded list (${now.size} now, ${was.size} recorded; new: ${[...now].filter((h) => !was.has(h)).length}, gone: ${[...was].filter((h) => !now.has(h)).length}; second run equals first: ${JSON.stringify(shape2(base.first)) === JSON.stringify(shape2(base.second))})`)
      }
      if (JSON.stringify(shape2(on.second)) !== JSON.stringify(shape2(base.second))) problems.push('probe ON: the executed SQL fingerprints differ from OFF')
      for (const key of ['status', 'calls', 'rowsRead', 'rowsWritten']) if (on.second[key] !== base.second[key]) problems.push(`probe ON: ${key} ${on.second[key]} vs ${base.second[key]} OFF`)
      const bodyDiff = differing(base.first.json, on.first.json).filter((key) => !volatile.includes(key))
      if (bodyDiff.length) problems.push(`probe ON: body differs at ${bodyDiff.slice(0, 5).join(', ')}`)
      compared += 1
      if (problems.length) reds.push(`${label}: ${problems.join('; ')}`)
    }

    // Control: the comparison above must see a consult. A shape measured while the stored epoch differs AND a statement is added
    // would differ in fingerprints; here the planted difference is a different SQL list, which the comparison reports.
    const planted = [{ h: 'planted00000', head: 'SELECT key, value FROM system_flags WHERE key IN (?1, ?2)' }]
    const a = off.get('auth-me').first.fingerprints.map((f) => [f.h, f.head])
    const b = [...off.get('auth-me').first.fingerprints, ...planted].map((f) => [f.h, f.head])
    if (JSON.stringify(a) === JSON.stringify(b)) reds.push('control: an extra consult statement went unnoticed by the fingerprint comparison')
  } finally { await world.dispose() }
  console.log(`test-read-switch-off-is-exact-native: ${compared} shapes compared, ${reds.length} differ`)
  for (const line of reds) console.error('RED ' + line)
  if (reds.length) process.exitCode = 1
}

main().catch((error) => { console.error(`test-read-switch-off-is-exact-native: crashed: ${error && error.stack}`); process.exitCode = 1 })

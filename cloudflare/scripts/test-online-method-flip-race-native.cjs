'use strict'
// KHQR round 6, condition 2: the route-level flip race. PUT /api/runtime/read-switches turning online_orders ON reads the stored online method up front, then writes the flip in
// one batch. If the method is deleted between that read and the batch, the flip must still be refused (409 online_method_required) and the switch must stay OFF: the
// requirement rides inside the flip's own INSERT and UPDATE (switchFlipUpsertSql). Without that requirement the flip writes ON with no method stored.
//
// The race is made deterministic by a source hook on the in-memory bundle only (src/ is untouched): a DELETE of the setting is placed between the route's read and its batch.
// Two worlds: the shipped route (must refuse) and a control with the requirement taken out of the route (must flip: the hook really lands between the read and the write).
//
// Run (from cloudflare/): node scripts/test-online-method-flip-race-native.cjs
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')

const RACE_AT = /(\r?\n)(  const epoch = current\.epoch \+ 1)/
const RACE_SQL = "  if (needsMethod) await db.prepare(\"DELETE FROM settings WHERE key = 'online_order_payment_method'\").run()"
const REQUIREMENT = 'requirement: needsMethod ? ONLINE_METHOD_STORED_SQL : undefined'

function hook(withoutRequirement) {
  return (file, source) => {
    if (file !== 'routes/runtime.ts') return undefined
    if (!RACE_AT.test(source)) throw new Error('runtime.ts no longer has the line this test hooks the race before: update the test')
    if (withoutRequirement && !source.includes(REQUIREMENT)) throw new Error('runtime.ts no longer passes the requirement in the shape the control removes: update the test')
    const raced = source.replace(RACE_AT, (_m, eol, line) => `${eol}${RACE_SQL}${eol}${line}`)
    return withoutRequirement ? raced.replace(REQUIREMENT, 'requirement: undefined') : raced
  }
}

async function attempt(transformSources) {
  const world = await bootWorld({ adminPassword: randomBytes(12).toString('base64url'), transformSources })
  try {
    await world.run("INSERT INTO settings (key, value) VALUES ('online_order_payment_method', 'ABA KHQR') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    const listed = await world.api('GET', `/api/runtime/read-switches?fresh=${Date.now()}`)
    const flip = await world.api('PUT', '/api/runtime/read-switches', { name: 'online_orders', state: 'on', expectedEpoch: listed.json.epoch })
    const flag = (await world.first("SELECT value FROM system_flags WHERE key = 'read_switches'"))?.value ?? null
    const method = (await world.first("SELECT value FROM settings WHERE key = 'online_order_payment_method'"))?.value ?? null
    const audits = (await world.first("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'read_switch_set'")).n
    return { listed: listed.status, status: flip.status, code: flip.json && flip.json.code, on: Boolean(flag && JSON.parse(flag).switches && JSON.parse(flag).switches.online_orders === 'on'), method, audits }
  } finally { await world.dispose() }
}

async function main() {
  const { check, finish } = createReporter()
  await check('the method is deleted between the route read and its write: 409 online_method_required, the switch stays OFF, nothing audited', async (t) => {
    const r = await attempt(hook(false))
    t.eq('listing', r.listed, 200)
    t.eq('refused', [r.status, r.code], [409, 'online_method_required'])
    t.eq('switch not ON', r.on, false)
    t.eq('method gone (the race happened)', r.method, null)
    t.eq('no read_switch_set audit row', r.audits, 0)
  })
  await check('control: the same race with the requirement taken out of the route flips ON with no method stored (the hook lands between the read and the write)', async (t) => {
    const r = await attempt(hook(true))
    t.eq('flipped', [r.status, r.on, r.method], [200, true, null])
  })
  finish('online method flip race')
}
main().catch((error) => { console.error(error); process.exit(1) })

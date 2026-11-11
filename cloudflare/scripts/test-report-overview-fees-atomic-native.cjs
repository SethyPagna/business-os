#!/usr/bin/env node
// D1 audit wave 2, d1-money item 2 (peer note FOR-D1-AUDIT): GET /api/reports/overview reads the window with delivery fees (readSalesReportSnapshot(env, f, true)), and
// readSalesReportSnapshotAtomic used to refuse the atomic batch whenever fees were asked for, so the undated overview ran the two-pass reader even with report_atomic and
// report_atomic_long ON. The plan builder already builds the delivery-fee group, so the UNDATED window now takes the batch with it.
//   - PARITY: with delivery fees in the seed, every shape's body is byte-identical between the old routing and the new, with report_atomic OFF and ON;
//   - CALLS: the undated overview on ON issues strictly fewer calls than the old routing (the red on the old code), dated windows are unchanged, OFF is unchanged;
//   - the fee rows are really in the body (a control that the fee group is read, not dropped).
// Run (from cloudflare/): node scripts/test-report-overview-fees-atomic-native.cjs
'use strict'
const assert = require('node:assert/strict')
const { bootWorld } = require('./read-budget/world.cjs')

const KERNEL = 'src/lib/salesAnalytics.ts'
const NEW = "if (unscoped && reportPlainFilters(f) && reportAtomicFiltersEligible(f)) return readSalesReportAtomicTotalsSnapshot(env, f, includeDeliveryFees, null, {}, 'full')"
const OLD = "if (bare && reportPlainFilters(f) && reportAtomicFiltersEligible(f)) return readSalesReportAtomicTotalsSnapshot(env, f, false, null, {}, 'full')"
const oldRouting = [{ name: 'old-fee-routing', file: KERNEL, from: NEW, to: OLD }]
const SHAPES = {
  'overview all-time': '/api/reports/overview',
  'overview branch': '/api/reports/overview?branchId=1',
  'overview 30d': '/api/reports/overview?startDate=2026-10-13&endDate=2026-11-11',
  'overview today': '/api/reports/overview?startDate=2026-11-11&endDate=2026-11-11',
}
const UNDATED = ['overview all-time', 'overview branch']
const ATOMIC = { report_atomic: 'on', report_atomic_long: 'on' }

async function run({ patches = [], switches }) {
  const world = await bootWorld({ tier: 'free', patches, ...(switches ? { switches } : {}) })
  const out = {}
  try {
    const contact = (await world.all('SELECT id FROM delivery_contacts ORDER BY id LIMIT 1'))[0]
    const anchor = world.ctx.anchor
    await world.db.prepare(`INSERT INTO fees(fee_type,label,amount_usd,amount_khr,fee_date,branch_id,delivery_contact_id,created_at) VALUES
      ('delivery','Courier',2.5,0,date('${anchor}','-3 day'),1,?,datetime('${anchor}','-3 day')),('delivery','Courier',4,0,date('${anchor}'),1,?,datetime('${anchor}','-1 hour')),
      ('delivery','Courier',1,0,date('${anchor}','-200 day'),1,?,datetime('${anchor}','-200 day'))`).bind(contact.id, contact.id, contact.id).run()
    for (const [name, url] of Object.entries(SHAPES)) {
      const r = await world.send('GET', url, undefined, { miss: true })
      out[name] = { status: r.status, text: r.text, calls: r.calls, rr: r.rr }
    }
  } finally { await world.dispose() }
  return out
}
const bodies = (res) => Object.fromEntries(Object.entries(res).map(([k, v]) => [k, v.status + ' ' + v.text]))
globalThis.__show = (a, b) => { for (const k of Object.keys(a)) if (a[k] !== b[k]) { let i = 0; while (a[k][i] === b[k][i]) i++; console.log('DIFF', k, a[k].slice(Math.max(0, i - 80), i + 120), '|||', b[k].slice(Math.max(0, i - 80), i + 120)) } }
const problems = []
const step = async (name, fn) => { try { await fn(); console.log('ok    ' + name) } catch (e) { problems.push(name); console.log('RED   ' + name + '\n      ' + String(e.message).split('\n').slice(0, 3).join('\n      ')) } }

;(async () => {
  const oldOff = await run({ patches: oldRouting })
  const newOff = await run({})
  const oldOn = await run({ patches: oldRouting, switches: ATOMIC })
  const newOn = await run({ switches: ATOMIC })
  await step('every shape answers 200', () => { for (const r of [oldOff, newOff, oldOn, newOn]) for (const [k, v] of Object.entries(r)) assert.equal(v.status, 200, `${k}: ${v.status} ${v.text.slice(0, 120)}`) })
  await step('parity: old routing and new routing answer byte-identically, report_atomic OFF and ON, and ON equals OFF', () => {
    for (const [x, y] of [[newOff, oldOff], [newOn, oldOn], [newOn, newOff]]) { globalThis.__show(bodies(x), bodies(y)); assert.deepEqual(bodies(x), bodies(y)) }
  })
  await step('control: the delivery fees are in the undated body (a dropped fee group would change it)', () => {
    assert.match(newOn['overview all-time'].text, /delivery/i)
    assert.notEqual(newOn['overview all-time'].text, newOn['overview today'].text)
  })
  await step('required red: the undated overview on report_atomic ON issues fewer calls than the old routing; OFF and the dated windows are unchanged', () => {
    for (const name of UNDATED) assert.ok(newOn[name].calls < oldOn[name].calls, `${name}: ${newOn[name].calls} calls vs old ${oldOn[name].calls}`)
    for (const name of Object.keys(SHAPES)) assert.equal(newOff[name].calls, oldOff[name].calls, `OFF ${name}`)
    for (const name of Object.keys(SHAPES).filter((n) => !UNDATED.includes(n))) assert.equal(newOn[name].calls, oldOn[name].calls, `ON ${name}`)
  })
  console.log('calls/rows old -> new:')
  for (const name of Object.keys(SHAPES)) console.log(`   ${name.padEnd(20)} OFF ${oldOff[name].calls}/${oldOff[name].rr} -> ${newOff[name].calls}/${newOff[name].rr}   ON ${oldOn[name].calls}/${oldOn[name].rr} -> ${newOn[name].calls}/${newOn[name].rr}`)
  if (problems.length) { console.error('\n' + problems.length + ' RED'); process.exit(1) }
  console.log('\nall green')
})().catch((e) => { console.error(e); process.exit(1) })

'use strict'
// Review round 2 (finding 3): an approved fee delete from the review queue (lib/reviewApply.ts, the 'fees' / 'delete' / 'fee' applier) removes a
// fee row and, before this fix, only broadcast. The cached sales report snapshot (stats strip) reads delivery fee rows, so the delivery
// totals stayed stale for up to 20 s after the approval. The direct DELETE (routes/fees.ts) already awaits bumpVersions(env, ['sales']) before
// its broadcast; the queue's applier must do the same, and only when the removed row is one the snapshot reads (lib/feeSalesImpact.ts).
//
// Runs the REAL applier (through applyApprovedPendingAction) over the full migration chain (harness/fees_world.cjs) with the cache bump and the
// push hub replaced by one ordered event log. Mutation controls patch a plausible wrong implementation into the source in memory.
//
// Run (from cloudflare/): node scripts/test-review-fee-delete-bumps-sales-native.cjs
const assert = require('node:assert/strict')
const { createFeesWorld } = require('./harness/fees_world.cjs')

let passed = 0
let quiet = false
async function check(name, run) { await run(); if (!quiet) { passed += 1; console.log(`PASS ${name}`) } }

function makeWorld(patches = []) {
  const events = []
  const cache = { bumpVersion: async () => {}, bumpVersions: async (_env, namespaces) => { await new Promise((resolve) => setTimeout(resolve, 5)); events.push(['bump', [...namespaces]]) } }
  const w = createFeesWorld({
    patches,
    overrides: {
      '../lib/cache': cache,
      './cache': cache,
      '../durable-objects/broadcastHub': { broadcast: async (_env, channel, payload) => { events.push(['broadcast', channel, payload]) } },
    },
  })
  w.sql.exec("INSERT INTO branches (id, name, role, is_active) VALUES (1, 'Store', 'shop', 1)")
  w.sql.exec("INSERT INTO delivery_contacts (id, name) VALUES (7, 'Rider')")
  return { w, events }
}

const insertFee = (w, row) => Number(w.sql.prepare(`INSERT INTO fees (fee_type, label, amount_usd, amount_khr, fee_date, branch_id, delivery_contact_id, created_at, updated_at, created_by)
  VALUES (@fee_type, NULL, 1, 0, '2026-10-10', 1, @delivery_contact_id, '2026-10-10 03:00:00', '2026-10-10 03:00:00', 2)`).run({ fee_type: 'other', delivery_contact_id: null, ...row }).lastInsertRowid)

let pendingId = 100
function queueDelete(w, feeId) {
  const id = pendingId += 1
  const fee = w.get('SELECT updated_at FROM fees WHERE id = ?', feeId)
  w.sql.prepare(`INSERT INTO pending_actions (id, section, action_type, entity_type, entity_id, payload_json, status, requested_by, requested_by_name, expected_entity_state_json)
    VALUES (?, 'fees', 'delete', 'fee', ?, ?, 'open', 2, 'Clerk', ?)`).run(id, feeId, JSON.stringify({ id: feeId }), JSON.stringify({ updated_at: fee ? fee.updated_at : null }))
  return w.get('SELECT * FROM pending_actions WHERE id = ?', id)
}

async function approve(w, events, feeId, { beforeApply } = {}) {
  const row = queueDelete(w, feeId)
  if (beforeApply) beforeApply()
  events.length = 0
  const { applyApprovedPendingAction } = w.load('lib/reviewApply.ts')
  let error = null
  try { await applyApprovedPendingAction({}, row, { id: 1, name: 'Admin' }) } catch (e) { error = e }
  const bumps = events.filter((e) => e[0] === 'bump')
  const pushes = events.filter((e) => e[0] === 'broadcast')
  const firstPush = events.findIndex((e) => e[0] === 'broadcast')
  const lastBump = events.map((e) => e[0]).lastIndexOf('bump')
  return { error, bumps, pushes, ordered: firstPush === -1 || (lastBump !== -1 && lastBump < firstPush), gone: !w.get('SELECT id FROM fees WHERE id = ?', feeId) }
}

async function scenarios(build) {
  const { w, events } = build()

  await check('approving the delete of a delivery fee bumps sales once, awaited before the push', async () => {
    const r = await approve(w, events, insertFee(w, { fee_type: 'delivery' }))
    assert.equal(r.error, null)
    assert.ok(r.gone, 'the fee row was deleted')
    assert.deepEqual(r.bumps, [['bump', ['sales']]], 'exactly one bump, of the sales namespace')
    assert.equal(r.pushes.length, 1, 'and the push still goes out')
    assert.ok(r.ordered, 'the bump resolved before the broadcast')
  })
  await check('approving the delete of an expense that carries a delivery contact bumps sales (the courier expense totals read it)', async () => {
    const r = await approve(w, events, insertFee(w, { fee_type: 'other', delivery_contact_id: 7 }))
    assert.equal(r.error, null)
    assert.deepEqual(r.bumps, [['bump', ['sales']]])
    assert.ok(r.ordered)
  })
  await check('approving the delete of an ordinary expense (rent, stationery) bumps nothing: the snapshot never reads it', async () => {
    const r = await approve(w, events, insertFee(w, { fee_type: 'expense' }))
    assert.equal(r.error, null)
    assert.ok(r.gone)
    assert.equal(r.bumps.length, 0)
    assert.equal(r.pushes.length, 1, 'the list still refreshes through the push')
  })
  await check('a fee already deleted by another path is a safe no-op: no bump, no push', async () => {
    const feeId = insertFee(w, { fee_type: 'delivery' })
    const r = await approve(w, events, feeId, { beforeApply: () => w.sql.prepare('DELETE FROM fees WHERE id = ?').run(feeId) })
    assert.equal(r.error, null)
    assert.equal(r.bumps.length, 0)
    assert.equal(r.pushes.length, 0)
  })
  await check('a stale approval (the fee was edited after it was queued) deletes nothing and bumps nothing', async () => {
    const feeId = insertFee(w, { fee_type: 'delivery' })
    const r = await approve(w, events, feeId, { beforeApply: () => w.sql.prepare("UPDATE fees SET amount_usd = 9, updated_at = '2026-10-11 00:00:00' WHERE id = ?").run(feeId) })
    assert.ok(r.error && /changed|stale/i.test(String(r.error.message || r.error.code || r.error.name)), `refused as stale, got ${r.error && r.error.message}`)
    assert.ok(!r.gone, 'the fee is still there')
    assert.equal(r.bumps.length, 0)
  })
}

async function main() {
  await scenarios(() => makeWorld())

  const APPLY = 'src/lib/reviewApply.ts'
  const BUMP = "  if (feeAffectsSalesSnapshot(existing)) await bumpVersions(env, ['sales'])\n  await notify(env, waitUntil, 'fees', { type: 'deleted', id })"
  const mutants = [
    ['approval never bumps (the round-1 shape)', BUMP, "  await notify(env, waitUntil, 'fees', { type: 'deleted', id })"],
    ['approval bumps after the broadcast', BUMP, "  await notify(env, waitUntil, 'fees', { type: 'deleted', id })\n  await bumpVersions(env, ['sales'])"],
    ['approval bumps without awaiting', BUMP, "  if (feeAffectsSalesSnapshot(existing)) void bumpVersions(env, ['sales']).then(() => undefined)\n  await notify(env, waitUntil, 'fees', { type: 'deleted', id })"],
    ['approval bumps for every fee', BUMP, "  await bumpVersions(env, ['sales'])\n  await notify(env, waitUntil, 'fees', { type: 'deleted', id })"],
    ['approval bumps the wrong namespace', BUMP, "  if (feeAffectsSalesSnapshot(existing)) await bumpVersions(env, ['products'])\n  await notify(env, waitUntil, 'fees', { type: 'deleted', id })"],
  ]
  quiet = true
  for (const [name, from, to] of mutants) {
    let red = false
    try { await scenarios(() => makeWorld([{ file: APPLY, from, to }])) } catch (error) {
      if (/mutant anchor/.test(String(error && error.message))) throw error
      red = true
    }
    assert.ok(red, `mutant survived: ${name}`)
    console.log(`MUTANT killed: ${name}`)
  }
  console.log(`${passed} checks passed; ${mutants.length} mutants killed`)
}
main().catch((error) => { console.error(error); process.exit(1) })

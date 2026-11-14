'use strict'
// A-C2 (audit 14 Nov): the sales report snapshot reads `fees` (lib/salesAnalytics.ts: delivery cost, linked courier expenses) and its result
// is cached under the sales|returns|customers|products|stock versions (routes/sales.ts getSalesReadCacheVersion). Fee writes broadcast
// but never moved any of those versions, so the stats strip served a stale delivery total for up to 20 s after an expense change.
//
// The root-cause fix lives on the writer side: every fee write that changes fee rows awaits bumpVersions(env, ['sales']) AFTER its commit
// and BEFORE the response and the broadcast. (The alternative, a `fees` namespace in getSalesReadCacheVersion, needs a sales.ts change
// owned by another lane; the sales bump reaches the same readers today and needs no reader change.)
//
// Runs the REAL routes/fees.ts + routes/feesCatalog.ts over the full migration chain (harness/fees_world.cjs) with lib/cache and the
// push hub replaced by one ordered event log. Mutation controls at the bottom patch a plausible wrong implementation into the source.
//
// Run (from cloudflare/): node scripts/test-fees-writes-bump-sales-native.cjs
const assert = require('node:assert/strict')
const { createFeesWorld } = require('./harness/fees_world.cjs')

let passed = 0
let quiet = false
async function check(name, run) { await run(); if (!quiet) { passed += 1; console.log(`PASS ${name}`) } }

function makeWorld(patches = []) {
  const events = []
  const w = createFeesWorld({
    patches,
    overrides: {
      '../lib/cache': { bumpVersions: async (_env, namespaces) => { events.push(['bump', [...namespaces]]) } },
      '../durable-objects/broadcastHub': { broadcast: async (_env, channel, payload) => { events.push(['broadcast', channel, payload]) } },
    },
  })
  w.sql.exec("INSERT INTO branches (id, name, role, is_active) VALUES (1, 'Store', 'shop', 1)")
  return { w, events }
}
const insertFee = (w, row) => Number(w.sql.prepare(`INSERT INTO fees (fee_type, label, amount_usd, amount_khr, fee_date, branch_id, created_at, updated_at, created_by)
  VALUES (@fee_type, @label, 1, 0, '2026-10-10', 1, '2026-10-10 03:00:00', '2026-10-10 03:00:00', 2)`).run({ fee_type: 'other', label: null, ...row }).lastInsertRowid)

// What one request logged: [bumps, broadcasts, bump-before-every-broadcast?]
async function logged(events, run) {
  events.length = 0
  const response = await run()
  const bumps = events.filter((e) => e[0] === 'bump')
  const pushes = events.filter((e) => e[0] === 'broadcast')
  const firstPush = events.findIndex((e) => e[0] === 'broadcast')
  const lastBump = events.map((e) => e[0]).lastIndexOf('bump')
  return { response, bumps, pushes, ordered: firstPush === -1 || (lastBump !== -1 && lastBump < firstPush) }
}

async function scenarios(build) {
  const { w, events } = build()
  const U = w.users
  const salesBump = (r) => assert.deepEqual(r.bumps, [['bump', ['sales']]], 'exactly one bump, of the sales namespace')

  await check('create: a committed expense bumps sales once, before its push', async () => {
    const r = await logged(events, () => w.request('POST', '/api/fees', { client_request_id: 'bump-create-01', fee_type: 'delivery', amount_usd: 3, fee_date: '2026-10-10', branch_id: 1 }, U.full))
    assert.equal(r.response.status, 201, JSON.stringify(r.response.json))
    salesBump(r)
    assert.equal(r.pushes.length, 1)
    assert.ok(r.ordered, 'the bump resolved before the broadcast')
  })
  await check('create: a refused expense bumps nothing', async () => {
    const r = await logged(events, () => w.request('POST', '/api/fees', { client_request_id: 'bump-create-02', fee_type: 'not a type', amount_usd: 3, fee_date: '2026-10-10', branch_id: 1 }, U.full))
    assert.equal(r.response.status, 400)
    assert.deepEqual([r.bumps.length, r.pushes.length], [0, 0])
  })
  await check('update: bumps sales once, before the push', async () => {
    const id = insertFee(w, { fee_type: 'delivery' })
    const row = w.get('SELECT updated_at FROM fees WHERE id = ?', id)
    const r = await logged(events, () => w.request('PUT', `/api/fees/${id}`, { fee_type: 'other', amount_usd: 5, expectedUpdatedAt: row.updated_at }, U.full))
    assert.equal(r.response.status, 200, JSON.stringify(r.response.json))
    salesBump(r)
    assert.ok(r.ordered)
  })
  await check('update: a stale write (conflict) bumps nothing', async () => {
    const id = insertFee(w, {})
    const r = await logged(events, () => w.request('PUT', `/api/fees/${id}`, { fee_type: 'other', amount_usd: 5, expectedUpdatedAt: '2000-01-01 00:00:00' }, U.full))
    assert.notEqual(r.response.status, 200)
    assert.equal(r.bumps.length, 0)
  })
  await check('delete: bumps sales once, before the push', async () => {
    const id = insertFee(w, { fee_type: 'delivery' })
    const r = await logged(events, () => w.request('DELETE', `/api/fees/${id}`, undefined, U.full))
    assert.equal(r.response.status, 200, JSON.stringify(r.response.json))
    salesBump(r)
    assert.ok(r.ordered)
  })
  await check('type rename moves fee_type on linked rows: bumps sales; with no linked rows it writes none and bumps nothing', async () => {
    await w.request('POST', '/api/fees/types', { name: 'Rent' }, U.full)
    await w.request('POST', '/api/fees/types', { name: 'Unused' }, U.full)
    insertFee(w, { fee_type: 'Rent' })
    const used = await logged(events, () => w.request('POST', '/api/fees/types/rename', { from: 'Rent', to: 'Premises' }, U.full))
    assert.equal(used.response.status, 200, JSON.stringify(used.response.json))
    assert.equal(used.response.json.changed, 1)
    salesBump(used)
    assert.ok(used.ordered)
    const unused = await logged(events, () => w.request('POST', '/api/fees/types/rename', { from: 'Unused', to: 'Spare' }, U.full))
    assert.equal(unused.response.json.changed, 0)
    assert.equal(unused.bumps.length, 0)
  })
  await check('label replace rewrites linked expenses: bumps sales before the push', async () => {
    insertFee(w, { label: 'Boxes' })
    const r = await logged(events, () => w.request('POST', '/api/fees/labels/replace', { from: 'Boxes', to: 'Cartons' }, U.full))
    assert.equal(r.response.status, 200, JSON.stringify(r.response.json))
    salesBump(r)
    assert.ok(r.ordered)
  })
  await check('label classify re-types linked expenses (the delivery split): bumps sales; classifying rows already of that type bumps nothing', async () => {
    insertFee(w, { label: 'Bike courier', fee_type: 'other' })
    const first = await logged(events, () => w.request('POST', '/api/fees/labels/classify', { label: 'Bike courier', fee_type: 'delivery' }, U.full))
    assert.equal(first.response.status, 200, JSON.stringify(first.response.json))
    assert.equal(first.response.json.changed, 1)
    salesBump(first)
    assert.ok(first.ordered)
    const again = await logged(events, () => w.request('POST', '/api/fees/labels/classify', { label: 'Bike courier', fee_type: 'delivery' }, U.full))
    assert.equal(again.response.json.changed, 0)
    assert.equal(again.bumps.length, 0)
  })
  await check('catalog-only writes (add / archive / restore a type or a label) change no expense row and bump nothing', async () => {
    for (const [url, body] of [
      ['/api/fees/types', { name: 'Catalog only' }],
      ['/api/fees/types/archive', { name: 'Catalog only' }],
      ['/api/fees/types/restore', { name: 'Catalog only' }],
      ['/api/fees/labels', { label: 'Fresh label', fee_type: 'other' }],
      ['/api/fees/labels/archive', { label: 'Fresh label' }],
      ['/api/fees/labels/restore', { label: 'Fresh label' }],
    ]) {
      const r = await logged(events, () => w.request('POST', url, body, U.full))
      assert.ok(r.response.status < 300, `${url} ${JSON.stringify(r.response.json)}`)
      assert.equal(r.bumps.length, 0, url)
    }
  })
}

async function main() {
  await scenarios(() => makeWorld())

  // Mutation controls: each wrong implementation must turn at least one check red.
  const FEES = 'src/routes/fees.ts'
  const CATALOG = 'src/routes/feesCatalog.ts'
  const mutants = [
    ['create never bumps', FEES, "  await bumpVersions(c.env, ['sales'])\n  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { type: 'created'", "  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { type: 'created'"],
    ['update never bumps', FEES, "  await bumpVersions(c.env, ['sales'])\n  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { type: 'updated'", "  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { type: 'updated'"],
    ['delete never bumps', FEES, "  await bumpVersions(c.env, ['sales'])\n  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { type: 'deleted'", "  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { type: 'deleted'"],
    ['create bumps AFTER the broadcast', FEES, "  await bumpVersions(c.env, ['sales'])\n  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { type: 'created', id: committedReceipt.fee_id }))", "  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { type: 'created', id: committedReceipt.fee_id }))\n  c.executionCtx.waitUntil(bumpVersions(c.env, ['sales']))"],
    ['rename never bumps', CATALOG, "  if (linked > 0) await bumpVersions(c.env, ['sales'])\n", ''],
    ['replace never bumps', CATALOG, "  if (sourceUses > 0) await bumpVersions(c.env, ['sales'])\n", ''],
    ['classify never bumps', CATALOG, "  if (changing > 0) await bumpVersions(c.env, ['sales'])\n", ''],
    ['classify bumps even when nothing changed', CATALOG, "  if (changing > 0) await bumpVersions(c.env, ['sales'])\n", "  await bumpVersions(c.env, ['sales'])\n"],
  ]
  quiet = true
  for (const [name, file, from, to] of mutants) {
    let red = false
    try { await scenarios(() => makeWorld([{ file, from, to }])) } catch (error) {
      if (/mutant anchor/.test(String(error && error.message))) throw error
      red = true
    }
    assert.ok(red, `mutant survived: ${name}`)
    console.log(`MUTANT killed: ${name}`)
  }
  console.log(`${passed} checks passed; ${mutants.length} mutants killed`)
}
main().catch((error) => { console.error(error); process.exit(1) })

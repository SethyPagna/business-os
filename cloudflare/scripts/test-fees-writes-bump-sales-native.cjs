'use strict'
// A-C2 (audit 14 Nov): the sales report snapshot reads `fees` (lib/salesAnalytics.ts: delivery cost, linked courier expenses) and its result
// is cached under the sales|returns|customers|products|stock versions (routes/sales.ts getSalesReadCacheVersion). Fee writes broadcast
// but never moved any of those versions, so the stats strip served a stale delivery total for up to 20 s after an expense change.
//
// The root-cause fix lives on the writer side: every fee write that changes a row the snapshot reads awaits bumpVersions(env, ['sales']) AFTER its commit
// and BEFORE the response and the broadcast. What the snapshot reads is exactly: fee_type = 'delivery' rows (linked by sale_id) and rows with a
// delivery_contact_id (lib/feeSalesImpact.ts, proven from lib/salesAnalytics.ts), so a write bumps only when the row BEFORE or AFTER is one of those. (The alternative, a `fees` namespace in getSalesReadCacheVersion, needs a sales.ts change
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
const insertFee = (w, row) => Number(w.sql.prepare(`INSERT INTO fees (fee_type, label, amount_usd, amount_khr, fee_date, branch_id, delivery_contact_id, created_at, updated_at, created_by)
  VALUES (@fee_type, @label, 1, 0, '2026-10-10', 1, @delivery_contact_id, '2026-10-10 03:00:00', '2026-10-10 03:00:00', 2)`).run({ fee_type: 'other', label: null, delivery_contact_id: null, ...row }).lastInsertRowid)

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
  const noBump = (r, why) => assert.equal(r.bumps.length, 0, why)
  w.sql.exec("INSERT INTO delivery_contacts (id, name) VALUES (7, 'Rider')")
  const create = (id, extra) => w.request('POST', '/api/fees', { client_request_id: id, fee_type: 'delivery', amount_usd: 3, fee_date: '2026-10-10', branch_id: 1, ...extra }, U.full)
  const update = (id, patch) => w.request('PUT', '/api/fees/' + id, { expectedUpdatedAt: w.get('SELECT updated_at FROM fees WHERE id = ?', id).updated_at, ...patch }, U.full)

  // The cached sales snapshot reads only delivery-type fee rows and rows with a delivery contact (lib/feeSalesImpact.ts), so only a write whose row,
  // BEFORE or AFTER, is one of those moves the sales version. Every other expense (rent, stationery) is read by nothing under the sales key.
  await check('create: a committed delivery expense bumps sales once, before its push', async () => {
    const r = await logged(events, () => create('bump-create-01'))
    assert.equal(r.response.status, 201, JSON.stringify(r.response.json))
    salesBump(r)
    assert.equal(r.pushes.length, 1)
    assert.ok(r.ordered, 'the bump resolved before the broadcast')
  })
  await check('create: an expense carrying a delivery contact bumps sales (the courier expense totals read it)', async () => {
    const r = await logged(events, () => create('bump-create-03', { fee_type: 'expense', delivery_contact_id: 7 }))
    assert.equal(r.response.status, 201, JSON.stringify(r.response.json))
    salesBump(r)
    assert.ok(r.ordered)
  })
  await check('create: an ordinary expense (rent) bumps nothing; its push still goes out', async () => {
    const r = await logged(events, () => create('bump-create-04', { fee_type: 'expense' }))
    assert.equal(r.response.status, 201, JSON.stringify(r.response.json))
    noBump(r, 'the snapshot never reads a plain expense')
    assert.equal(r.pushes.length, 1)
  })
  await check('create: a refused expense bumps nothing', async () => {
    const r = await logged(events, () => create('bump-create-02', { fee_type: 'not a type' }))
    assert.equal(r.response.status, 400)
    assert.deepEqual([r.bumps.length, r.pushes.length], [0, 0])
  })
  await check('update: a delivery fee turned into a plain expense bumps (the BEFORE row was read)', async () => {
    const id = insertFee(w, { fee_type: 'delivery' })
    const r = await logged(events, () => update(id, { fee_type: 'other', amount_usd: 5 }))
    assert.equal(r.response.status, 200, JSON.stringify(r.response.json))
    salesBump(r)
    assert.ok(r.ordered)
  })
  await check('update: a plain expense turned into a delivery fee bumps (the AFTER row is read)', async () => {
    const id = insertFee(w, { fee_type: 'other' })
    const r = await logged(events, () => update(id, { fee_type: 'delivery', amount_usd: 5 }))
    assert.equal(r.response.status, 200, JSON.stringify(r.response.json))
    salesBump(r)
    assert.ok(r.ordered)
  })
  await check('update: a plain expense given a delivery contact bumps (the AFTER row is read)', async () => {
    const id = insertFee(w, { fee_type: 'other' })
    const r = await logged(events, () => update(id, { delivery_contact_id: 7 }))
    assert.equal(r.response.status, 200, JSON.stringify(r.response.json))
    salesBump(r)
  })
  await check('update: editing a delivery fee amount (delivery before and after) bumps once', async () => {
    const id = insertFee(w, { fee_type: 'delivery' })
    const r = await logged(events, () => update(id, { amount_usd: 8 }))
    assert.equal(r.response.status, 200, JSON.stringify(r.response.json))
    salesBump(r)
  })
  await check('update: an edit of a plain expense (neither side delivery) bumps nothing', async () => {
    const id = insertFee(w, { fee_type: 'other' })
    const r = await logged(events, () => update(id, { amount_usd: 5, notes: 'receipt kept' }))
    assert.equal(r.response.status, 200, JSON.stringify(r.response.json))
    noBump(r, 'neither the old nor the new row is read by the snapshot')
    assert.equal(r.pushes.length, 1)
  })
  await check('update: a stale write (conflict) bumps nothing', async () => {
    const id = insertFee(w, { fee_type: 'delivery' })
    const r = await logged(events, () => w.request('PUT', '/api/fees/' + id, { fee_type: 'other', amount_usd: 5, expectedUpdatedAt: '2000-01-01 00:00:00' }, U.full))
    assert.notEqual(r.response.status, 200)
    assert.equal(r.bumps.length, 0)
  })
  await check('delete: a delivery fee bumps sales once, before the push', async () => {
    const id = insertFee(w, { fee_type: 'delivery' })
    const r = await logged(events, () => w.request('DELETE', '/api/fees/' + id, undefined, U.full))
    assert.equal(r.response.status, 200, JSON.stringify(r.response.json))
    salesBump(r)
    assert.ok(r.ordered)
  })
  await check('delete: an expense with a delivery contact bumps; an ordinary expense does not', async () => {
    const withContact = await logged(events, () => w.request('DELETE', '/api/fees/' + insertFee(w, { fee_type: 'other', delivery_contact_id: 7 }), undefined, U.full))
    assert.equal(withContact.response.status, 200)
    salesBump(withContact)
    const plain = await logged(events, () => w.request('DELETE', '/api/fees/' + insertFee(w, { fee_type: 'other' }), undefined, U.full))
    assert.equal(plain.response.status, 200)
    noBump(plain, 'a plain expense is read by nothing under the sales key')
  })
  await check('type rename moves fee_type between two custom types: the snapshot reads fee_type only as = delivery, so it never bumps (with or without linked rows)', async () => {
    await w.request('POST', '/api/fees/types', { name: 'Rent' }, U.full)
    await w.request('POST', '/api/fees/types', { name: 'Unused' }, U.full)
    insertFee(w, { fee_type: 'Rent' })
    const used = await logged(events, () => w.request('POST', '/api/fees/types/rename', { from: 'Rent', to: 'Premises' }, U.full))
    assert.equal(used.response.status, 200, JSON.stringify(used.response.json))
    assert.equal(used.response.json.changed, 1)
    noBump(used, 'a custom-to-custom rename changes nothing the snapshot reads')
    const unused = await logged(events, () => w.request('POST', '/api/fees/types/rename', { from: 'Unused', to: 'Spare' }, U.full))
    assert.equal(unused.response.json.changed, 0)
    noBump(unused)
    const builtin = await logged(events, () => w.request('POST', '/api/fees/types/rename', { from: 'delivery', to: 'Courier' }, U.full))
    assert.equal(builtin.response.status, 400, 'the premise: a built-in type (delivery among them) can never be renamed')
    noBump(builtin)
  })
  await check('label replace rewrites only label, which the snapshot never reads: no bump even when delivery rows carry it', async () => {
    insertFee(w, { label: 'Boxes', fee_type: 'delivery' })
    const r = await logged(events, () => w.request('POST', '/api/fees/labels/replace', { from: 'Boxes', to: 'Cartons' }, U.full))
    assert.equal(r.response.status, 200, JSON.stringify(r.response.json))
    assert.equal(r.response.json.changed, 1)
    noBump(r, 'label is not a column the snapshot reads')
  })
  await check('label classify moving a row INTO delivery bumps; classifying rows already of that type bumps nothing', async () => {
    insertFee(w, { label: 'Bike courier', fee_type: 'other' })
    const first = await logged(events, () => w.request('POST', '/api/fees/labels/classify', { label: 'Bike courier', fee_type: 'delivery' }, U.full))
    assert.equal(first.response.status, 200, JSON.stringify(first.response.json))
    assert.equal(first.response.json.changed, 1)
    salesBump(first)
    assert.ok(first.ordered)
    const again = await logged(events, () => w.request('POST', '/api/fees/labels/classify', { label: 'Bike courier', fee_type: 'delivery' }, U.full))
    assert.equal(again.response.json.changed, 0)
    noBump(again)
  })
  await check('label classify moving a row OUT OF delivery bumps (the BEFORE row was read)', async () => {
    insertFee(w, { label: 'Misfiled', fee_type: 'delivery' })
    const r = await logged(events, () => w.request('POST', '/api/fees/labels/classify', { label: 'Misfiled', fee_type: 'other' }, U.full))
    assert.equal(r.response.status, 200, JSON.stringify(r.response.json))
    assert.equal(r.response.json.changed, 1)
    salesBump(r)
    assert.ok(r.ordered)
  })
  await check('label classify between two non-delivery types changes rows but not what the snapshot reads: no bump', async () => {
    insertFee(w, { label: 'Printer ink', fee_type: 'other' })
    const r = await logged(events, () => w.request('POST', '/api/fees/labels/classify', { label: 'Printer ink', fee_type: 'expense' }, U.full))
    assert.equal(r.response.status, 200, JSON.stringify(r.response.json))
    assert.equal(r.response.json.changed, 1)
    noBump(r, 'neither the old nor the new type is delivery')
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
      assert.ok(r.response.status < 300, url + ' ' + JSON.stringify(r.response.json))
      assert.equal(r.bumps.length, 0, url)
    }
  })
}

async function main() {
  await scenarios(() => makeWorld())

  // Mutation controls: each wrong implementation must turn at least one check red.
  const FEES = 'src/routes/fees.ts'
  const CATALOG = 'src/routes/feesCatalog.ts'
  const CREATE_BUMP = "  if (feeAffectsSalesSnapshot({ fee_type: feeType, delivery_contact_id: deliveryContactId })) await bumpVersions(c.env, ['sales'])\n  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { type: 'created', id: committedReceipt.fee_id }))"
  const UPDATE_BUMP = "  if (feeWriteNeedsSalesBump(existing, fee)) await bumpVersions(c.env, ['sales'])\n  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { type: 'updated', id }))"
  const DELETE_BUMP = "  if (feeAffectsSalesSnapshot(existing)) await bumpVersions(c.env, ['sales'])\n  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { type: 'deleted', id }))"
  const CLASSIFY_BUMP = "  if (deliveryMoved > 0) await bumpVersions(c.env, ['sales'])\n"
  const mutants = [
    ['create never bumps', FEES, CREATE_BUMP, "  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { type: 'created', id: committedReceipt.fee_id }))"],
    ['update never bumps', FEES, UPDATE_BUMP, "  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { type: 'updated', id }))"],
    ['delete never bumps', FEES, DELETE_BUMP, "  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { type: 'deleted', id }))"],
    ['create bumps AFTER the broadcast', FEES, CREATE_BUMP, "  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { type: 'created', id: committedReceipt.fee_id }))\n  c.executionCtx.waitUntil(bumpVersions(c.env, ['sales']))"],
    ['create bumps for every expense (round-1 shape)', FEES, CREATE_BUMP, "  await bumpVersions(c.env, ['sales'])\n  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { type: 'created', id: committedReceipt.fee_id }))"],
    ['update bumps for every edit (round-1 shape)', FEES, UPDATE_BUMP, "  await bumpVersions(c.env, ['sales'])\n  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { type: 'updated', id }))"],
    ['update judges only the row before the edit', FEES, UPDATE_BUMP, "  if (feeAffectsSalesSnapshot(existing)) await bumpVersions(c.env, ['sales'])\n  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { type: 'updated', id }))"],
    ['update judges only the row after the edit', FEES, UPDATE_BUMP, "  if (feeAffectsSalesSnapshot(fee)) await bumpVersions(c.env, ['sales'])\n  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { type: 'updated', id }))"],
    ['delete bumps for every expense (round-1 shape)', FEES, DELETE_BUMP, "  await bumpVersions(c.env, ['sales'])\n  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { type: 'deleted', id }))"],
    ['rename bumps when rows changed (round-1 shape)', CATALOG, "  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { action: 'type_rename', from: source.name, to }))", "  if (linked > 0) await bumpVersions(c.env, ['sales'])\n  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { action: 'type_rename', from: source.name, to }))"],
    ['replace bumps when rows changed (round-1 shape)', CATALOG, "  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { action: 'label_replace', from: sourceName, to: toName }))", "  if (sourceUses > 0) await bumpVersions(c.env, ['sales'])\n  c.executionCtx.waitUntil(broadcast(c.env, 'fees', { action: 'label_replace', from: sourceName, to: toName }))"],
    ['classify never bumps', CATALOG, CLASSIFY_BUMP, ''],
    ['classify bumps whenever rows changed (round-1 shape)', CATALOG, CLASSIFY_BUMP, "  if (changing > 0) await bumpVersions(c.env, ['sales'])\n"],
    ['classify bumps every time', CATALOG, CLASSIFY_BUMP, "  await bumpVersions(c.env, ['sales'])\n"],
    ['classify ignores a row leaving delivery', CATALOG, "AND (fee_type = 'delivery' OR @feeType = 'delivery')", "AND @feeType = 'delivery'"],
    ['classify ignores a row entering delivery', CATALOG, "AND (fee_type = 'delivery' OR @feeType = 'delivery')", "AND fee_type = 'delivery'"],
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

#!/usr/bin/env node
// QW2: the duplicates sweep on a cache miss clusters on identity columns alone (no branch_stock join over every product) and reads its members live, as a hit does.
// Parity: the same seeded world answers the same bytes, in the same order, from the old path (the full join, patched back in) and the new one, and the new one reads
// fewer rows. The world has duplicate groups across two stocking branches, child rows (same name, own barcode), an inactive twin, a group parent, members with stock
// and members with none, and a member stocked in the second branch only. Mutant: a new path that drops some members' live stock must be caught.
//
// Run: node scripts/test-products-duplicates-identity-parity-native.cjs
'use strict'

const assert = require('node:assert/strict')
const { bootWorld } = require('./read-budget/world.cjs')

const OLD_FLOW = [
  { name: 'old-full-join-sweep', file: 'src/routes/products.ts', from: 'return findPossiblySameProductClusters(getDb(c.env), { identityOnly: true })', to: 'return findPossiblySameProductClusters(getDb(c.env))' },
  { name: 'old-no-live-read-on-miss', file: 'src/routes/products.ts', from: 'const clusters = (await withLiveClusterMembers(c.env, cached)) ??', to: 'const clusters = cached ??' },
]
const MUTANT = [
  { name: 'mutant-drops-some-live-stock', file: 'src/routes/products.ts', from: 'stock_quantity: row.stock_quantity, image_path: row.image_path }', to: 'stock_quantity: Number(member.id) % 3 === 1 ? member.stock_quantity : row.stock_quantity, image_path: row.image_path }' },
]

const COLS = 'name,name_key,name_normalized,barcode,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,purchase_price_usd,brand,brand_compact,category,supplier,low_stock_threshold,image_path,created_at,updated_at'
async function extraRows(world) {
  const clone = (id, from, over = {}) => {
    const set = { is_active: 1, is_group: 0, ...over }
    return world.db.prepare(`INSERT INTO products(id,${COLS},is_active,is_group) SELECT ${id},COALESCE(?1,name),COALESCE(lower(?1),name_key),COALESCE(lower(?1),name_normalized),COALESCE(?2,barcode),'SKU-X'||${id},0,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,purchase_price_usd,brand,brand_compact,category,supplier,low_stock_threshold,image_path,created_at,updated_at,${set.is_active},${set.is_group} FROM products WHERE id = ${from}`)
      .bind(over.name || null, over.barcode || null)
  }
  const stock = (id, branch, quantity) => world.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').bind(id, branch, quantity)
  await world.db.prepare("INSERT OR REPLACE INTO system_flags(key, value) VALUES('stock_transaction_permit', 'legacy-separate-pool-v1')").run()
  await world.db.batch([
    // a barcode twin of 1003 under another name, stocked in both branches
    clone(900001, 1003, { name: 'Twin Under Another Name', barcode: '8850000001003' }), stock(900001, 1, 4), stock(900001, 2, 6),
    // an inactive same-name twin (the schema refuses stock on an inactive product): never in a group
    clone(900002, 1003, { is_active: 0 }),
    // a group parent with a seeded name: never in a group
    clone(900003, 1003, { is_group: 1 }),
    // child rows of 1003's name: own barcode each; one with no stock row at all, one stocked in the second branch only
    clone(900004, 1003, { barcode: 'CHILD-A-900004' }),
    clone(900005, 1003, { barcode: 'CHILD-B-900005' }), stock(900005, 2, 3),
    clone(900006, 1003, { barcode: 'CHILD-C-900006' }), stock(900006, 1, 11),
  ])
  await world.db.prepare("DELETE FROM system_flags WHERE key = 'stock_transaction_permit'").run()
}

const read = async (world) => { const r = await world.send('GET', '/api/products/possible-duplicates', undefined, { miss: true }); assert.equal(r.status, 200, r.text.slice(0, 200)); return r }
const ids = (clusters) => clusters.flatMap((c) => c.products.map((p) => p.id))

async function main() {
  const opts = { tier: 'free', switches: { ic_simple: 'on' } }
  const oldWorld = await bootWorld({ ...opts, patches: OLD_FLOW })
  const newWorld = await bootWorld(opts)
  const mutantWorld = await bootWorld({ ...opts, patches: MUTANT })
  try {
    for (const world of [oldWorld, newWorld, mutantWorld]) await extraRows(world)
    const before = await read(oldWorld)
    const after = await read(newWorld)
    assert.ok(before.json.clusters.length > 100, 'the seed has many groups')
    assert.deepEqual(after.json.clusters, before.json.clusters, 'old and new responses are deep equal, same order')
    assert.equal(after.text, before.text, 'and byte equal')
    const all = ids(after.json.clusters)
    for (const id of [900001, 900004, 900005, 900006]) assert.ok(all.includes(id), `the added member ${id} is in a group`)
    for (const id of [900002, 900003]) assert.ok(!all.includes(id), `${id} (inactive / group parent) is in no group`)
    const m = (id) => after.json.clusters.flatMap((c) => c.products).find((p) => p.id === id)
    assert.equal(m(900001).stock_quantity, 10, 'both branches summed')
    assert.equal(m(900004).stock_quantity, 0, 'no stock row reads 0')
    assert.equal(m(900005).stock_quantity, 3, 'second branch only')
    assert.equal(m(900006).stock_quantity, 11)
    const stocked = all.filter((id) => (m(id).stock_quantity || 0) > 0)
    assert.ok(stocked.length > 10 && all.length > stocked.length, 'members with stock and members without')
    assert.ok(stocked.some((id) => id % 3 === 1), 'control: the mutant has a stocked member to drop')
    assert.ok(after.rr < before.rr * 0.8, `the new miss reads fewer rows (${after.rr} vs ${before.rr})`)

    const mutated = await read(mutantWorld)
    assert.notDeepEqual(mutated.json.clusters, before.json.clusters, 'the mutant (some live stock dropped) is caught by the parity check')

    console.log(`PASS ${before.json.clusters.length} groups, ${all.length} members equal; rows read old ${before.rr} (calls ${before.calls}) -> new ${after.rr} (calls ${after.calls}); mutant caught`)
  } finally {
    await oldWorld.dispose(); await newWorld.dispose(); await mutantWorld.dispose()
  }
  process.exit(0)
}
main().catch((error) => { console.error(error); process.exit(1) })

const assert = require('node:assert/strict')
const { ready, options, state } = require('./test-product-merge-forward-catalog-native.cjs')
const { capture, load, reserve } = require('./test-product-merge-origin-plan-native.cjs')
const { productMergeProtocolSchemaSql } = load('lib/productMergeProtocol.ts')
const { executeProductMergeRequest } = load('lib/productMergeRequest.ts')
const compilerModule = load('lib/productMergeForwardStock.ts')
const request = { keeperId: 1, loserId: 2, requestId: 'complete-forward-request', requestDigest: 'c'.repeat(64) }
const identity = { planId: 1000, transitionId: 1001, historyId: 1000, origins: reserve }
async function setup(settings = {}) {
  const d1 = await ready()
  d1.db.exec(productMergeProtocolSchemaSql())
  const user = { id: 7, name: 'Operator', username: 'operator', is_active: 1, organization_id: null, role_id: null,
    role_code: null, role_permissions: null, must_change_password: 0, permissions: JSON.stringify(settings.permissions ?? { products: true, product_cost_edit: true }) }
  d1.db.prepare("INSERT INTO users(id,name,username,password,permissions,is_active) VALUES(7,'Operator','operator','synthetic',?,1)").run(user.permissions)
  let queries = 0, dispatches = 0, preparations = 0, captured, compiledRows
  const db = { prepare(sql) { return { getOnce: async params => { queries++; return d1.prepare(sql).get(params) }, get: async params => { queries++; return d1.prepare(sql).get(params) } } },
    batch: async rows => { queries += rows.length; return d1.batch(rows) },
    batchOnce: async rows => {
      queries += rows.length; dispatches++; compiledRows = rows
      if (settings.beforeDispatch) await settings.beforeDispatch(d1, rows)
      const result = await d1.batch(rows)
      if (settings.lostAck) throw new Error('network acknowledgement lost')
      return result
    } }
  const budget = { limit: settings.limit ?? 50, used: () => queries, tailReserve: 6 }
  const catalog = { ...options, ...(settings.catalog ?? {}) }
  const prepare = async () => { preparations++; queries++; captured = await capture(d1); return { snapshot: captured, identity, catalog, guards: [] } }
  return { d1, user, db, prepare, budget, catalog, apply: () => executeProductMergeRequest(db, user, request, budget, prepare),
    info: () => ({ queries, dispatches, preparations, captured, compiledRows }) }
}
async function positive(settings = {}) {
  const w = await setup(settings)
  try {
    const before = state(w.d1), result = await w.apply(), after = state(w.d1)
    assert.equal(result.receipt.quantityMoved, 2)
    const keeper = w.d1.db.prepare('SELECT * FROM products WHERE id=1').get()
    assert.equal(keeper.stock_quantity, 3)
    assert.equal(keeper.cost_price_usd, 5, 'weighted receipt cost must follow catalogue seed')
    assert.equal(keeper.cost_price_khr, settings.catalog?.keeperChoice?.cost?.cost_price_khr ?? 10000)
    assert.equal(keeper.selling_price_usd, settings.catalog?.keeperChoice?.fields?.selling_price_usd ?? 9.25)
    assert.equal(keeper.parent_id, null)
    assert.equal(w.d1.db.prepare('SELECT parent_id FROM products WHERE id=3').get().parent_id, 1)
    assert.equal(w.d1.db.prepare('SELECT is_active FROM products WHERE id=2').get().is_active, 0)
    assert.deepEqual(w.d1.db.prepare('SELECT id,image_path,sort_order FROM product_images WHERE product_id=1 ORDER BY sort_order,id').all().map(row => ({ ...row })), [
      { id: 101, image_path: 'shared', sort_order: 0 }, { id: 102, image_path: 'keeper-tail', sort_order: 1 },
      { id: 301, image_path: 'new-first', sort_order: 2 }, { id: 302, image_path: 'new-second', sort_order: 3 } ])
    for (const table of ['product_cost_entries', 'sale_items', 'return_items', 'sale_item_batch_allocations', 'return_item_batch_allocations', 'transfer_operation_members', 'transfer_operation_receipts']) assert.deepEqual(after[table], before[table], table)
    assert.deepEqual(after.inventory_movements.filter(row => row.id === 99), before.inventory_movements)
    const saved = JSON.parse(w.d1.db.prepare('SELECT payload_json FROM undo_snapshots WHERE id=1000').get().payload_json)
    assert.ok(saved.catalog, 'original immutable plan must retain catalogue effects')
    assert.equal(saved.catalog.version, 1)
    const raw = JSON.parse(saved.source_capture)
    for (const refs of Object.values(saved.catalog.beforeRefs)) for (const ref of Array.isArray(refs) ? refs : [refs]) assert.equal(raw[ref.section][ref.index][0], ref.id)
    assert.equal(saved.catalog.effects.keeperPatch.cost_price_usd, settings.catalog?.keeperChoice?.cost?.cost_price_usd ?? 5)
    assert.equal(w.info().compiledRows.filter(row => row.params?.observedCapture).length, 1, 'one original capture guard for stock and catalogue')
    const sealed = w.d1.db.prepare('SELECT status,payload_json FROM undo_snapshots WHERE id=1001').get()
    assert.equal(sealed.status, 'sealed')
    assert.deepEqual(JSON.parse(sealed.payload_json).post_capture, JSON.parse(load('lib/productMergeSnapshot.ts').productMergeCaptureGuard(await capture(w.d1)).params.observedCapture))
    const retry = await w.apply()
    assert.equal(retry.replayed, true)
    assert.deepEqual(retry.receipt, result.receipt)
    assert.deepEqual(state(w.d1), after)
    assert.equal(w.info().preparations, 1)
    assert.equal(w.info().dispatches, 1)
    assert.ok(w.info().queries + w.budget.tailReserve <= w.budget.limit)
    console.log(`PASS integrated catalogue/stock/request ${settings.limit ?? 50} ${settings.lostAck ? 'lostACK' : 'normal'}: ${w.info().queries} local statements including retry; original records preserved`)
  } finally { w.d1.db.close() }
}
async function main() {
  for (const limit of [50, 1000]) for (const lostAck of [false, true]) await positive({ limit, lostAck })
  await positive({ catalog: { keeperChoice: { follows: true, requiresProductEdit: true, cost: { cost_price_usd: 2.3456, cost_price_khr: 1234 }, fields: { selling_price_usd: 7.1234 } } } })
  await positive({ permissions: { products: true, 'products:edit': false, 'products:price': false } })
  for (const permission of ['image', 'price', 'edit', 'cost']) {
    const permissions = { products: true, product_cost_edit: permission !== 'cost', ...(permission !== 'cost' ? { ['products:' + permission]: false } : {}) }
    const catalog = permission === 'image' ? {} : { keeperChoice: { follows: true,
      ...(permission === 'price' ? { fields: { selling_price_usd: 7 } } : {}),
      ...(permission === 'edit' ? { requiresProductEdit: true, fields: { name: 'Typed name' } } : {}),
      ...(permission === 'cost' ? { cost: { cost_price_usd: 2 } } : {}) } }
    const w = await setup({ permissions, catalog })
    try { const before = state(w.d1); await assert.rejects(w.apply(), error => error.code === 'merge_request_permission'); assert.deepEqual(state(w.d1), before); assert.equal(w.info().dispatches, 0); console.log('PASS caller grant before writes: ' + permission) }
    finally { w.d1.db.close() }
  }
  for (const rival of ['gallery', 'permission', 'late']) {
    let before
    const w = await setup({ beforeDispatch: async (d1, rows) => {
      if (rival === 'gallery') d1.db.exec("INSERT INTO product_images(id,product_id,image_path) VALUES(301,4,'occupied')")
      if (rival === 'permission') d1.db.exec("UPDATE users SET permissions='{}' WHERE id=7")
      if (rival === 'late') rows.splice(rows.length - 1, 0, { sql: "SELECT json_extract('[1]','$[merge_late_failure]')" })
      before = state(d1)
    } })
    try { await assert.rejects(w.apply()); assert.deepEqual(state(w.d1), before); assert.equal(w.info().dispatches, 1); console.log('PASS integrated rollback preserves rival: ' + rival) }
    finally { w.d1.db.close() }
  }
  const w = await setup()
  try {
    await w.apply()
    w.user.permissions = JSON.stringify({ products: true, 'products:image': false })
    w.d1.db.prepare('UPDATE users SET permissions=? WHERE id=7').run(w.user.permissions)
    const before = state(w.d1)
    await assert.rejects(w.apply(), error => error.code === 'merge_request_permission')
    assert.deepEqual(state(w.d1), before)
    assert.equal(w.info().dispatches, 1)
    console.log('PASS saved catalogue requirements checked on fresh receipt recovery')
  } finally { w.d1.db.close() }
  const oversized = await setup()
  try {
    oversized.d1.db.prepare('UPDATE products SET description=? WHERE id=1').run('"'.repeat(200000))
    const snapshot = await capture(oversized.d1)
    const catalogue = { ...options, keeperChoice: { follows: true, fields: { brand: 'b'.repeat(250000) } } }
    assert.ok(load('lib/productMergeForwardCatalog.ts').planProductMergeForwardCatalog(snapshot, catalogue).catalogBytes < 512 * 1024)
    assert.throws(() => compilerModule.planProductMergeForwardStock(snapshot,
      { ...identity, actorId: 7, actorName: 'Operator', requestId: request.requestId, requestDigest: request.requestDigest }, catalogue), /merge_case_snapshot_limit/)
    console.log('PASS joint immutable plan bound rejects individually valid capture/catalogue payloads')
  } finally { oversized.d1.db.close() }
  for (const fault of ['catalogue-after-cost', 'missing-saved-catalogue']) {
    const original = compilerModule.planProductMergeForwardStock
    compilerModule.planProductMergeForwardStock = (...args) => {
      const compiled = original(...args)
      if (fault === 'catalogue-after-cost') {
        const catalogueRows = new Set(compiled.catalog.statements)
        compiled.statements = compiled.statements.filter(row => !catalogueRows.has(row))
        compiled.statements.splice(compiled.statements.findIndex(row => row.sql.startsWith('UPDATE products SET is_active=0')), 0, ...catalogueRows)
      } else {
        const row = compiled.statements.find(row => row.params?.plan)
        const saved = JSON.parse(row.params.plan)
        delete saved.catalog
        row.params.plan = JSON.stringify(saved)
      }
      return compiled
    }
    try {
      await assert.rejects(positive({ catalog: { keeperChoice: { follows: true, cost: { cost_price_usd: 2.3456, cost_price_khr: 1234 } } } }), assert.AssertionError)
      console.log('PASS actual wrong compiler control: ' + fault)
    } finally { compilerModule.planProductMergeForwardStock = original }
  }
  console.log('LOCAL INTEGRATED ACTION ONLY: HTTP request keys, source/review/session authority, audit/cursor/Undo, full invocation/provider gates remain open')
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { setup, positive, main }

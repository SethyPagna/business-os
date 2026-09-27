// FX-undo2 item 3 (R-undo C11): undoing a product merge recorded before
// 357bc6de7 (2026-09-05) must not overwrite what happened to the products
// after the merge.
//
// Those snapshots carry no mergedStateFingerprint, and their undo restores
// both products absolutely: the keeper's branch stock from keeperStockBefore,
// the folded-into lots from their before-images, the keeper's prices and its
// cover. Before this fix the only check was that both products still existed,
// so a keeper sale after the merge was silently put back on the shelf (the
// refuter's static finding, probed here). The fixtures come from a mirror of
// the fold as it stood at 357bc6de7^ (routes/products.ts
// foldDuplicateProductInto) and are recorded without a fingerprint, exactly as
// the pre-fingerprint recorders stored them.
//
// Real SQLite over the real migrated schema and the REAL transpiled
// lib/undoAppliers.ts (harness/load_undo_appliers.cjs).
//
// Run: node scripts/test-undo-product-merge-legacy-staleness-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { loadUndoAppliers } = require('./harness/load_undo_appliers.cjs')

const USER = { id: 42, name: 'Admin' }
const RECORD_CHANGED = 'undo_record_changed'
const PRICING = 'selling_price_usd, selling_price_khr, wholesale_price_usd, wholesale_price_khr, cost_price_usd, cost_price_khr'

function freshWorld() {
  const d1 = openDb(loadAll())
  const { undoAppliers } = loadUndoAppliers(d1)
  const run = (sql, params) => d1.db.prepare(sql).run(params == null ? {} : params)
  const get = (sql, params) => d1.db.prepare(sql).get(params == null ? {} : params)
  const all = (sql, params) => d1.db.prepare(sql).all(params == null ? {} : params)
  run("INSERT INTO branches (id, name) VALUES (1, 'B1'), (2, 'B2'), (3, 'B3')")
  return { d1, undoAppliers, run, get, all }
}

// Keeper 100 and duplicate 200 share lot key A (folds into lot 5000); the
// duplicate's lot B has no twin (re-pointed). Product 300 is unrelated.
function seedPair(world) {
  world.run(`INSERT INTO products (id, name, is_active, image_path, ${PRICING}, stock_quantity) VALUES
    (100, 'Serum', 1, '', 10, 41000, 8, 32800, 2, 8200, 8),
    (200, 'Serum 30ml', 1, 'dup.jpg', 12, 49200, 7, 28700, 2, 8200, 11),
    (300, 'Toner', 1, 'toner.jpg', 5, 20500, 4, 16400, 1, 4100, 9)`)
  world.run(`INSERT INTO branch_stock (product_id, branch_id, quantity, rfid_confirmed_qty) VALUES
    (100, 1, 5, 2), (100, 2, 3, 0), (200, 1, 4, 1), (200, 3, 7, 0), (300, 1, 9, 0)`)
  world.run(`INSERT INTO product_batches (id, variant_product_id, batch_key, batch_number, is_active) VALUES
    (5000, 100, 'A', 1, 1), (5001, 200, 'A', 1, 1), (5002, 200, 'B', 2, 1), (5003, 300, 'T', 1, 1)`)
  world.run(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES
    (5000, 1, 5), (5000, 2, 3), (5001, 1, 4), (5002, 3, 7), (5003, 1, 9)`)
  world.run(`INSERT INTO product_images (product_id, image_path, sort_order) VALUES (100, 'k1.jpg', 0), (200, 'k1.jpg', 0), (200, 'd1.jpg', 1)`)
  world.run('INSERT INTO sales (id) VALUES (900)')
  world.run("INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity) VALUES (700, 900, 200, 'Serum 30ml', 1)")
  world.run(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, movement_type, quantity, reason)
    VALUES (800, 200, 'Serum 30ml', 1, 'sale', -1, 'sold')`)
}

// Two groups for the whole-catalog run. 201's lot Y is re-pointed onto 100,
// then 202's lot Y folds into THAT lot, so the folds only reverse in order.
function seedCatalog(world) {
  world.run(`INSERT INTO products (id, name, is_active, image_path, ${PRICING}, stock_quantity) VALUES
    (100, 'Lip Tint', 1, 'lt.jpg', 6, 24600, 5, 20500, 2, 8200, 5),
    (201, 'Lip Tint', 1, '', 6, 24600, 5, 20500, 2, 8200, 5),
    (202, 'Lip Tint', 1, '', 7, 28700, 5, 20500, 2, 8200, 4),
    (300, 'Cleanser', 1, '', 3, 12300, 2, 8200, 1, 4100, 1),
    (301, 'Cleanser', 1, 'cl.jpg', 3, 12300, 2, 8200, 1, 4100, 8)`)
  world.run(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES
    (100, 1, 5), (201, 1, 2), (201, 2, 3), (202, 2, 4), (300, 3, 1), (301, 3, 2), (301, 1, 6)`)
  world.run(`INSERT INTO product_batches (id, variant_product_id, batch_key, batch_number, is_active) VALUES
    (6000, 100, 'X', 1, 1), (6001, 201, 'Y', 1, 1), (6002, 201, 'X', 2, 1), (6003, 202, 'Y', 1, 1),
    (6100, 300, 'Z', 1, 1), (6101, 301, 'Z', 1, 1), (6102, 301, 'W', 2, 1)`)
  world.run(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES
    (6000, 1, 5), (6001, 1, 2), (6002, 2, 3), (6003, 2, 4), (6100, 3, 1), (6101, 3, 2), (6102, 1, 6)`)
}

// routes/products.ts foldDuplicateProductInto at 357bc6de7^, both stock
// dispositions: every read first, then the writes in one transaction, then
// the adjustment ids. Fixture pairs share one cost, so the averaged cost it
// wrote is that cost.
function legacyFold(world, keeperId, dupId, { disposition = 'merge', context = 'possible-duplicates review merge' } = {}) {
  const { all, get } = world
  const keeper = get('SELECT id, name FROM products WHERE id = @id', { id: keeperId })
  const dup = get('SELECT id, name, image_path FROM products WHERE id = @id', { id: dupId })
  const keeperLots = all('SELECT id, batch_key, batch_number FROM product_batches WHERE variant_product_id = @id', { id: keeperId })
  const keeperLotByKey = new Map(keeperLots.map((lot) => [lot.batch_key, lot.id]))
  let nextNumber = keeperLots.reduce((max, lot) => Math.max(max, Number(lot.batch_number) || 0), 0) + 1
  const dupStock = all('SELECT branch_id, quantity, rfid_confirmed_qty FROM branch_stock WHERE product_id = @id', { id: dupId })
  const keeperStockBefore = all('SELECT branch_id, quantity FROM branch_stock WHERE product_id = @id', { id: keeperId })
  const before = get(`SELECT image_path, ${PRICING} FROM products WHERE id = @id`, { id: keeperId })
  const dupPricing = get(`SELECT ${PRICING} FROM products WHERE id = @id`, { id: dupId })
  const highest = (field) => {
    let best = null
    for (const row of [before, dupPricing]) {
      if (row[field] === null || row[field] === '') continue
      const value = Number(row[field])
      if (Number.isFinite(value) && (best === null || value > best)) best = value
    }
    return best ?? before[field] ?? 0
  }
  const dupLots = all('SELECT id, batch_key, batch_number FROM product_batches WHERE variant_product_id = @id', { id: dupId })
  const dupImages = all('SELECT image_path, sort_order FROM product_images WHERE product_id = @id ORDER BY sort_order ASC, id ASC', { id: dupId })
  const keeperImagePaths = new Set(all('SELECT image_path FROM product_images WHERE product_id = @id', { id: keeperId }).map((row) => String(row.image_path)))
  let nextImageOrder = keeperImagePaths.size
  const writes = []
  const write = (sql, params) => writes.push([sql, params])
  const writeOff = disposition === 'write_off'
  const lotRows = (id) => all('SELECT branch_id, quantity FROM branch_batch_stock WHERE batch_id = @id', { id })
    .map((row) => ({ branch_id: row.branch_id, quantity: Number(row.quantity) || 0 }))

  for (const row of dupStock) {
    const quantity = Number(row.quantity) || 0
    if (!quantity) continue
    if (writeOff) {
      write(`INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, reason, created_at)
        VALUES (@product, @name, @branch, 'adjustment', @quantity, @reason, CURRENT_TIMESTAMP)`,
      { product: dupId, name: dup.name, branch: row.branch_id, quantity: -quantity, reason: `Duplicate product "${dup.name}" (#${dupId}) removed -- stock written off instead of being merged -- ${context}` })
      continue
    }
    write(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@keeper, @branch, @quantity)
      ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity`, { keeper: keeperId, branch: row.branch_id, quantity })
    write(`INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, reason, created_at)
      VALUES (@keeper, @name, @branch, 'adjustment', @quantity, @reason, CURRENT_TIMESTAMP)`,
    { keeper: keeperId, name: keeper.name, branch: row.branch_id, quantity, reason: `Merged duplicate product "${dup.name}" (#${dupId}) into this product -- ${context}` })
  }
  write('DELETE FROM branch_stock WHERE product_id = @id', { id: dupId })
  const imagesMovedToKeeper = []
  for (const image of dupImages) {
    const path = String(image.image_path || '')
    if (!path || keeperImagePaths.has(path)) continue
    keeperImagePaths.add(path)
    imagesMovedToKeeper.push(path)
    write('INSERT INTO product_images (product_id, image_path, sort_order) VALUES (@keeper, @path, @order)', { keeper: keeperId, path, order: nextImageOrder++ })
  }
  write('DELETE FROM product_images WHERE product_id = @id', { id: dupId })
  write(`UPDATE products SET image_path = COALESCE(NULLIF(image_path, ''), @image)
    WHERE id = @keeper AND @image IS NOT NULL AND @image != ''`, { keeper: keeperId, image: dup.image_path ?? null })
  write('UPDATE products SET is_active = 0 WHERE id = @id', { id: dupId })
  write(`UPDATE products SET selling_price_usd = @su, selling_price_khr = @sk, wholesale_price_usd = @wu, wholesale_price_khr = @wk,
    cost_price_usd = @cu, cost_price_khr = @ck WHERE id = @keeper`, {
    keeper: keeperId, su: highest('selling_price_usd'), sk: highest('selling_price_khr'), wu: highest('wholesale_price_usd'),
    wk: highest('wholesale_price_khr'), cu: before.cost_price_usd ?? 0, ck: before.cost_price_khr ?? 0,
  })

  const repointedBatches = []
  const foldedBatches = []
  const writtenOffBatches = []
  for (const lot of dupLots) {
    const stockBefore = lotRows(lot.id)
    if (writeOff) {
      write('DELETE FROM branch_batch_stock WHERE batch_id = @id', { id: lot.id })
      write('UPDATE product_batches SET is_active = 0 WHERE id = @id', { id: lot.id })
      writtenOffBatches.push({ batchId: lot.id, stockBefore })
      continue
    }
    const keeperLotId = keeperLotByKey.get(lot.batch_key)
    if (keeperLotId) {
      const keeperStock = lotRows(keeperLotId)
      for (const row of stockBefore) {
        if (!row.quantity) continue
        write(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (@lot, @branch, @quantity)
          ON CONFLICT(batch_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity`, { lot: keeperLotId, branch: row.branch_id, quantity: row.quantity })
      }
      write('DELETE FROM branch_batch_stock WHERE batch_id = @id', { id: lot.id })
      write('UPDATE product_batches SET is_active = 0 WHERE id = @id', { id: lot.id })
      foldedBatches.push({ dupBatchId: lot.id, keeperBatchId: keeperLotId, dupStockBefore: stockBefore, keeperStockBefore: keeperStock })
    } else {
      write('UPDATE product_batches SET variant_product_id = @keeper, batch_number = @number WHERE id = @id', { keeper: keeperId, number: nextNumber, id: lot.id })
      keeperLotByKey.set(lot.batch_key, lot.id)
      nextNumber += 1
      repointedBatches.push({ id: lot.id, batchNumber: lot.batch_number })
    }
  }
  const reparentedByTable = []
  for (const { table, column } of world.undoAppliers.MERGE_REPARENT_TABLES) {
    const ids = all(`SELECT id FROM ${table} WHERE ${column} = @id`, { id: dupId }).map((row) => Number(row.id))
    if (!ids.length) continue
    reparentedByTable.push({ table, column, ids })
    write(`UPDATE ${table} SET ${column} = @keeper WHERE ${column} = @dup`, { keeper: keeperId, dup: dupId })
  }
  world.d1.db.exec('BEGIN')
  try {
    for (const [sql, params] of writes) world.d1.db.prepare(sql).run(params)
    world.d1.db.exec('COMMIT')
  } catch (error) {
    world.d1.db.exec('ROLLBACK')
    throw error
  }

  const adjustmentMovementIds = all(`SELECT id FROM inventory_movements WHERE product_id = @keeper AND movement_type = 'adjustment'
    AND (reason LIKE @merged OR reason LIKE @writtenOff)`,
  { keeper: keeperId, merged: `%(#${dupId}) into this product%`, writtenOff: `%(#${dupId}) removed -- stock written off%` }).map((row) => Number(row.id))
  const byTable = (table) => reparentedByTable.find((entry) => entry.table === table)?.ids ?? []
  return {
    keeperId, keeperName: keeper.name, dupId, dupName: dup.name ?? null,
    keeperImagePathBefore: before.image_path ?? null,
    keeperPricingBefore: {
      selling_price_usd: Number(before.selling_price_usd) || 0, selling_price_khr: Number(before.selling_price_khr) || 0,
      wholesale_price_usd: Number(before.wholesale_price_usd) || 0, wholesale_price_khr: Number(before.wholesale_price_khr) || 0,
      cost_price_usd: Number(before.cost_price_usd) || 0, cost_price_khr: Number(before.cost_price_khr) || 0,
    },
    keeperStockBefore: keeperStockBefore.map((row) => ({ branch_id: row.branch_id, quantity: Number(row.quantity) || 0 })),
    dupStockBefore: dupStock.map((row) => ({ branch_id: row.branch_id, quantity: Number(row.quantity) || 0, rfid_confirmed_qty: Number(row.rfid_confirmed_qty) || 0 })),
    dupImagesBefore: dupImages.map((row) => ({ image_path: String(row.image_path), sort_order: row.sort_order == null ? null : Number(row.sort_order) })),
    imagesMovedToKeeper, repointedBatches, foldedBatches, writtenOffBatches,
    reparentedSaleItemIds: byTable('sale_items'), reparentedMovementIds: byTable('inventory_movements'), reparentedByTable,
    adjustmentMovementIds, stockDisposition: disposition, mergeContext: context,
  }
}

function recount(world, productId) {
  world.run('UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @id) WHERE id = @id', { id: productId })
}

function recordLegacy(world, kind, payload) {
  return Number(world.run("INSERT INTO undo_snapshots (kind, status, payload_json) VALUES (@kind, 'applied', @payload)",
    { kind, payload: JSON.stringify(payload) }).lastInsertRowid)
}

// POST /possible-duplicates/merge at 357bc6de7^: fold, recount both rows, record.
function legacyPairMerge(world, keeperId, dupId, options) {
  const reversal = legacyFold(world, keeperId, dupId, options)
  recount(world, keeperId)
  recount(world, dupId)
  return { reversal, snapshotId: recordLegacy(world, 'product.merge', reversal) }
}

// POST /merge-duplicates at 357bc6de7^: each group's duplicates in order, the
// keeper recounted once per group, one composite snapshot.
function legacyCatalogMerge(world) {
  const reversals = []
  for (const [keeperId, dupIds] of [[100, [201, 202]], [300, [301]]]) {
    for (const dupId of dupIds) reversals.push(legacyFold(world, keeperId, dupId, { context: 'branch-only duplicate cleanup' }))
    recount(world, keeperId)
  }
  return recordLegacy(world, 'product.merge.bulk', { reversals })
}

// A till sale after the merge: the branch row and the lot it came from.
function laterSale(world, productId, branchId, lotId, quantity) {
  world.run('UPDATE branch_stock SET quantity = quantity - @quantity WHERE product_id = @productId AND branch_id = @branchId', { productId, branchId, quantity })
  world.run('UPDATE branch_batch_stock SET quantity = quantity - @quantity WHERE batch_id = @lotId AND branch_id = @branchId', { lotId, branchId, quantity })
  world.run('UPDATE products SET stock_quantity = stock_quantity - @quantity WHERE id = @productId', { productId, quantity })
  world.run(`INSERT INTO inventory_movements (product_id, product_name, branch_id, movement_type, quantity, reason)
    VALUES (@productId, 'later', @branchId, 'sale', @delta, 'later sale')`, { productId, branchId, delta: -quantity })
}

function laterReceipt(world, productId, branchId, lotId, quantity) {
  world.run(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@productId, @branchId, @quantity)
    ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity`, { productId, branchId, quantity })
  world.run(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (@lotId, @branchId, @quantity)
    ON CONFLICT(batch_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity`, { lotId, branchId, quantity })
  world.run('UPDATE products SET stock_quantity = stock_quantity + @quantity WHERE id = @productId', { productId, quantity })
}

function replay(world, kind, snapshotId, user = USER) {
  const payload = { applier: kind, snapshot_id: snapshotId }
  return world.undoAppliers.resolveUndoApplier(payload).run(payload, { env: {}, user, direction: 'undo', historyId: 1 })
}

function state(world) {
  const { all } = world
  return {
    products: all(`SELECT id, is_active, image_path, stock_quantity, ${PRICING} FROM products ORDER BY id`),
    branchStock: all('SELECT product_id, branch_id, quantity, rfid_confirmed_qty FROM branch_stock ORDER BY product_id, branch_id'),
    lots: all('SELECT id, variant_product_id, batch_number, is_active FROM product_batches ORDER BY id'),
    lotStock: all('SELECT batch_id, branch_id, quantity FROM branch_batch_stock ORDER BY batch_id, branch_id'),
    images: all('SELECT product_id, image_path, sort_order FROM product_images ORDER BY product_id, image_path'),
    saleItems: all('SELECT id, product_id FROM sale_items ORDER BY id'),
    movements: all('SELECT product_id, movement_type, quantity, reason FROM inventory_movements ORDER BY product_id, movement_type, quantity, reason'),
    snapshots: all('SELECT id, status FROM undo_snapshots ORDER BY id'),
  }
}

function withoutPrices(snapshot) {
  return { ...snapshot, products: snapshot.products.map(({ id, is_active, image_path, stock_quantity }) => ({ id, is_active, image_path, stock_quantity })) }
}

function snapshotStatus(world, snapshotId) {
  return world.get('SELECT status FROM undo_snapshots WHERE id = @id', { id: snapshotId }).status
}

function setPayload(world, snapshotId, edit) {
  const payload = JSON.parse(world.get('SELECT payload_json FROM undo_snapshots WHERE id = @id', { id: snapshotId }).payload_json)
  edit(payload)
  world.run('UPDATE undo_snapshots SET payload_json = @payload WHERE id = @id', { payload: JSON.stringify(payload), id: snapshotId })
}

async function assertRefused(promise, describeApplied) {
  let error = null
  try { await promise } catch (caught) { error = caught }
  if (!error) assert.fail(`expected the undo to be refused, but it was applied${describeApplied ? `: ${describeApplied()}` : ''}`)
  assert.equal(error.statusCode, 409, `a stale undo is a 409 conflict, got: ${error.statusCode} ${error.message}`)
  assert.equal(error.code, RECORD_CHANGED, `the refusal carries the record-changed code, got: ${error.code} (${error.message})`)
}

// A write that lands after the undo's own check and before one of its batches.
function raceBatch(world, write, skip = 0) {
  const batch = world.d1.batch.bind(world.d1)
  let calls = 0
  world.d1.batch = async (statements) => {
    if (calls++ === skip) {
      world.d1.batch = batch
      write()
    }
    return batch(statements)
  }
}

const branchTotal = (world, productIds, branchId) => world.get(
  `SELECT COALESCE(SUM(quantity), 0) AS total FROM branch_stock WHERE branch_id = @branchId AND product_id IN (${productIds.join(',')})`, { branchId }).total

let passed = 0
const failures = []
async function check(name, body) {
  try {
    await body()
    passed++
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}\n  ${String(error && error.stack || error).split('\n').slice(0, 6).join('\n  ')}`)
  }
}

;(async () => {
  await check('PROBE: a legacy merge undo after a keeper sale at a merged branch is refused; the sale stays sold', async () => {
    const world = freshWorld()
    seedPair(world)
    const { snapshotId } = legacyPairMerge(world, 100, 200)
    laterSale(world, 100, 1, 5000, 2)
    const before = state(world)
    await assertRefused(replay(world, 'product.merge', snapshotId),
      () => `branch 1 now holds ${branchTotal(world, [100, 200], 1)} across both rows; after the sale the shop has 7`)
    assert.deepEqual(state(world), before, 'nothing was written')
  })

  await check('PROBE: a legacy write-off merge undo after a keeper sale at the discarded row\'s branch is refused', async () => {
    const world = freshWorld()
    seedPair(world)
    const { snapshotId } = legacyPairMerge(world, 100, 200, { disposition: 'write_off' })
    laterSale(world, 100, 1, 5000, 2)
    const before = state(world)
    await assertRefused(replay(world, 'product.merge', snapshotId),
      () => `the keeper holds ${branchTotal(world, [100], 1)} at branch 1; after the sale it has 3`)
    assert.deepEqual(state(world), before)
  })

  await check('PROBE: a legacy whole-catalog merge undo after a keeper sale is refused; nothing is changed', async () => {
    const world = freshWorld()
    seedCatalog(world)
    const snapshotId = legacyCatalogMerge(world)
    laterSale(world, 100, 1, 6000, 3)
    const before = state(world)
    await assertRefused(replay(world, 'product.merge.bulk', snapshotId),
      () => `branch 1 now holds ${branchTotal(world, [100, 201, 202], 1)} across the group; after the sale the shop has 4`)
    assert.deepEqual(state(world), before)
  })

  await check('a later receipt into the re-pointed lot, at a branch the discarded row never stocked, is refused', async () => {
    const world = freshWorld()
    seedPair(world)
    const { snapshotId } = legacyPairMerge(world, 100, 200)
    laterReceipt(world, 100, 2, 5002, 5)
    const before = state(world)
    await assertRefused(replay(world, 'product.merge', snapshotId))
    assert.deepEqual(state(world), before)
  })

  await check('a later keeper price edit is refused', async () => {
    const world = freshWorld()
    seedPair(world)
    const { snapshotId } = legacyPairMerge(world, 100, 200)
    world.run('UPDATE products SET selling_price_usd = 15, selling_price_khr = 61500 WHERE id = 100')
    const before = state(world)
    await assertRefused(replay(world, 'product.merge', snapshotId))
    assert.deepEqual(state(world), before)
  })

  await check('a later keeper cover change is refused for an actor who may change images', async () => {
    const world = freshWorld()
    seedPair(world)
    const { snapshotId } = legacyPairMerge(world, 100, 200)
    world.run("UPDATE products SET image_path = 'new.jpg' WHERE id = 100")
    const before = state(world)
    await assertRefused(replay(world, 'product.merge', snapshotId))
    assert.deepEqual(state(world), before)
  })

  await check('a keeper merged away again later (chained merge) is refused', async () => {
    const world = freshWorld()
    seedPair(world)
    const { snapshotId } = legacyPairMerge(world, 100, 200)
    legacyPairMerge(world, 300, 100)
    const before = state(world)
    await assertRefused(replay(world, 'product.merge', snapshotId))
    assert.deepEqual(state(world), before)
  })

  await check('a legacy snapshot without its keeper stock before-image is refused, never guessed', async () => {
    const world = freshWorld()
    seedPair(world)
    const { snapshotId } = legacyPairMerge(world, 100, 200)
    setPayload(world, snapshotId, (payload) => { delete payload.keeperStockBefore })
    const before = state(world)
    await assertRefused(replay(world, 'product.merge', snapshotId))
    assert.deepEqual(state(world), before)
  })

  await check('CONTROL: a clean legacy merge undo restores both products exactly, whatever happened to other products', async () => {
    const world = freshWorld()
    seedPair(world)
    const expected = freshWorld()
    seedPair(expected)
    laterSale(expected, 300, 1, 5003, 2)
    const { snapshotId } = legacyPairMerge(world, 100, 200)
    laterSale(world, 300, 1, 5003, 2)
    await replay(world, 'product.merge', snapshotId)
    assert.equal(snapshotStatus(world, snapshotId), 'reversed')
    const after = state(world)
    assert.deepEqual({ ...after, snapshots: [] }, { ...state(expected), snapshots: [] })
  })

  await check('CONTROL: a clean legacy write-off merge undo restores both products exactly', async () => {
    const world = freshWorld()
    seedPair(world)
    const original = state(world)
    const { snapshotId } = legacyPairMerge(world, 100, 200, { disposition: 'write_off' })
    await replay(world, 'product.merge', snapshotId)
    assert.deepEqual({ ...state(world), snapshots: [] }, { ...original, snapshots: [] })
  })

  await check('CONTROL: the oldest snapshot shape (2026-09-01: no prices, no write-off fields) still undoes', async () => {
    const world = freshWorld()
    seedPair(world)
    const original = state(world)
    const { snapshotId } = legacyPairMerge(world, 100, 200)
    setPayload(world, snapshotId, (payload) => {
      for (const key of ['keeperPricingBefore', 'writtenOffBatches', 'reparentedByTable', 'stockDisposition']) delete payload[key]
    })
    await replay(world, 'product.merge', snapshotId)
    assert.equal(snapshotStatus(world, snapshotId), 'reversed')
    assert.deepEqual(withoutPrices({ ...state(world), snapshots: [] }), withoutPrices({ ...original, snapshots: [] }))
  })

  await check('CONTROL: without image permission the undo leaves the cover alone, so a later cover change does not block it', async () => {
    const world = freshWorld()
    seedPair(world)
    const original = state(world)
    const { snapshotId } = legacyPairMerge(world, 100, 200)
    world.run("UPDATE products SET image_path = 'new.jpg' WHERE id = 100")
    await replay(world, 'product.merge', snapshotId, null)
    const after = state(world)
    assert.equal(after.products.find((row) => row.id === 100).image_path, 'new.jpg', 'the later cover is kept')
    const coverless = (snapshot) => ({ ...snapshot, snapshots: [], images: [],
      products: snapshot.products.map((row) => ({ ...row, image_path: row.id === 100 ? null : row.image_path })) })
    assert.deepEqual(coverless(after), coverless(original))
  })

  await check('CONTROL: a clean legacy whole-catalog undo reverses the order-dependent folds exactly', async () => {
    const world = freshWorld()
    seedCatalog(world)
    const original = state(world)
    const snapshotId = legacyCatalogMerge(world)
    await replay(world, 'product.merge.bulk', snapshotId)
    assert.equal(snapshotStatus(world, snapshotId), 'reversed')
    assert.deepEqual({ ...state(world), snapshots: [] }, { ...original, snapshots: [] })
  })

  await check('RACE: a keeper sale landing after the check and before the undo batch aborts the whole undo', async () => {
    const world = freshWorld()
    seedPair(world)
    const { snapshotId } = legacyPairMerge(world, 100, 200)
    const merged = state(world)
    raceBatch(world, () => laterSale(world, 100, 1, 5000, 2))
    await assertRefused(replay(world, 'product.merge', snapshotId),
      () => `branch 1 now holds ${branchTotal(world, [100, 200], 1)} across both rows; after the sale the shop has 7`)
    const sold = freshWorld()
    seedPair(sold)
    legacyPairMerge(sold, 100, 200)
    laterSale(sold, 100, 1, 5000, 2)
    assert.deepEqual(state(world), state(sold), 'only the sale was written')
    assert.notDeepEqual(state(world), merged)
  })

  await check('RACE: in a whole-catalog undo, a sale landing before a later fold\'s batch stops the undo there and is kept', async () => {
    const world = freshWorld()
    seedCatalog(world)
    const snapshotId = legacyCatalogMerge(world)
    raceBatch(world, () => laterSale(world, 100, 2, 6001, 1), 1)
    await assertRefused(replay(world, 'product.merge.bulk', snapshotId))
    const after = state(world)
    assert.equal(snapshotStatus(world, snapshotId), 'applied')
    const row = (productId, branchId) => after.branchStock.find((r) => r.product_id === productId && r.branch_id === branchId)
    assert.equal(row(100, 2).quantity, 6, 'the sale is kept: 3 + 4 merged, less 1 sold')
    assert.deepEqual([row(300, 3).quantity, row(301, 3).quantity, row(301, 1).quantity], [1, 2, 6], 'the first fold undone was the Cleanser group')
    assert.equal(after.products.find((p) => p.id === 202).is_active, 0, 'the Lip Tint folds were not undone')
  })

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) process.exit(1)
})()

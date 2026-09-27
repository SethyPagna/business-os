// FX-undo applier audit: supplier.backfill had the same gap as branch.update.
// Its undo rewrote every lot's (supplier_id, supplier_name) back to the prior
// attribution, and its redo rewrote them to the supplier, with no check that
// the lots still held what the recorded action left -- so undoing an old
// backfill silently reverted a later re-attribution of the same lot (a batch
// edit, a supplier merge, another backfill), and a redo clobbered anything
// attributed while the action sat reversed.
//
// Real SQLite over the real migrated schema, the REAL transpiled
// lib/undoAppliers.ts (harness/load_undo_appliers.cjs). The forward backfill
// mirrors routes/products.ts POST /:id/suppliers/backfill and is recorded
// through the real recordSupplierBackfillSnapshot.
//
// Run: node scripts/test-undo-supplier-backfill-staleness-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { loadUndoAppliers } = require('./harness/load_undo_appliers.cjs')

const USER = { id: 42, name: 'Editor' }
const LOTS = [5000, 5001]

function freshWorld() {
  const d1 = openDb(loadAll())
  const { undoAppliers } = loadUndoAppliers(d1)
  const run = (sql, params) => d1.db.prepare(sql).run(params == null ? {} : params)
  run(`INSERT INTO suppliers (id, name) VALUES (7, 'Acme Co'), (9, 'Gamma Ltd')`)
  run(`INSERT INTO products (id, name, is_active) VALUES (100, 'ProdA', 1)`)
  // One blank lot and one name-only lot (supplier_id NULL), both backfillable.
  run(`INSERT INTO product_batches (id, variant_product_id, batch_key, batch_number, is_active, supplier_id, supplier_name) VALUES
    (5000, 100, 'A1', 1, 1, NULL, NULL),
    (5001, 100, 'A2', 2, 1, NULL, 'Acme Co')`)
  return { d1, undoAppliers, run }
}

// routes/products.ts POST /:id/suppliers/backfill, then the real recorder.
async function backfill(world, supplier) {
  const { d1, undoAppliers } = world
  const targets = d1.db.prepare(
    'SELECT id, supplier_id, supplier_name FROM product_batches WHERE variant_product_id = 100 AND is_active = 1 AND supplier_id IS NULL ORDER BY id',
  ).all()
  const ids = targets.map((t) => Number(t.id))
  d1.db.prepare(`UPDATE product_batches SET supplier_id = @sid, supplier_name = @name, updated_at = CURRENT_TIMESTAMP WHERE id IN (${ids.join(',')})`)
    .run({ sid: supplier.id, name: supplier.name })
  const rec = await undoAppliers.recordSupplierBackfillSnapshot({}, USER, {
    productId: 100, supplierId: supplier.id, supplierName: supplier.name,
    lots: targets.map((t) => ({ id: Number(t.id), prevSupplierId: t.supplier_id == null ? null : Number(t.supplier_id), prevSupplierName: t.supplier_name ?? null })),
  })
  return rec.snapshotId
}

function replay(world, snapshotId, direction) {
  const payload = { applier: 'supplier.backfill', snapshot_id: snapshotId }
  return world.undoAppliers.resolveUndoApplier(payload).run(payload, { env: {}, user: USER, direction })
}

function lots(world) {
  return world.d1.db.prepare(`SELECT id, supplier_id, supplier_name FROM product_batches WHERE id IN (${LOTS.join(',')}) ORDER BY id`).all()
    .map((r) => ({ id: Number(r.id), supplier_id: r.supplier_id == null ? null : Number(r.supplier_id), supplier_name: r.supplier_name ?? null }))
}

function snapshotStatus(world, snapshotId) {
  return world.d1.db.prepare('SELECT status FROM undo_snapshots WHERE id = ?').get(snapshotId).status
}

async function assertConflict(promise, pattern) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.statusCode, 409, `expected a 409 conflict, got: ${error.message}`)
    assert.match(error.message, pattern)
    return true
  })
}

let passed = 0
const failed = []
// Every check runs even after a failure, so a red run names each broken case.
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failed.push(name)
    console.log(`FAIL ${name}\n  ${String((error && error.message) || error).split('\n')[0]}`)
  }
}

async function main() {
  await check('control: undo and redo with no later edit restore and reapply the attribution', async () => {
    const world = freshWorld()
    const snap = await backfill(world, { id: 7, name: 'Acme Co' })
    await replay(world, snap, 'undo')
    assert.deepEqual(lots(world), [
      { id: 5000, supplier_id: null, supplier_name: null },
      { id: 5001, supplier_id: null, supplier_name: 'Acme Co' },
    ])
    await replay(world, snap, 'redo')
    assert.deepEqual(lots(world), [
      { id: 5000, supplier_id: 7, supplier_name: 'Acme Co' },
      { id: 5001, supplier_id: 7, supplier_name: 'Acme Co' },
    ])
  })

  await check('control: a supplier rename that re-stamps the lot name is the same attribution, so undo still runs', async () => {
    const world = freshWorld()
    const snap = await backfill(world, { id: 7, name: 'Acme Co' })
    // routes/contacts.ts supplier rename cascade.
    world.run("UPDATE suppliers SET name = 'Acme Corporation' WHERE id = 7")
    world.run("UPDATE product_batches SET supplier_name = 'Acme Corporation' WHERE supplier_id = 7")
    await replay(world, snap, 'undo')
    assert.deepEqual(lots(world), [
      { id: 5000, supplier_id: null, supplier_name: null },
      { id: 5001, supplier_id: null, supplier_name: 'Acme Co' },
    ])
  })

  // FX-undo2 (R-undo C8, PROBE S1): routes/batches.ts writes a lot's
  // supplier_name and supplier_id independently, so a later edit can rename
  // the lot's supplier while leaving the id alone. The undo compared only the
  // id and put the prior attribution back over that edit.
  await check('DISCRIMINATING (C8): undo refuses when only a backfilled lot\'s supplier name was edited after the backfill', async () => {
    const world = freshWorld()
    const snap = await backfill(world, { id: 7, name: 'Acme Co' })
    world.run("UPDATE product_batches SET supplier_name = 'Acme Warehouse' WHERE id = 5001")
    await assertConflict(replay(world, snap, 'undo'), /1 lot was re-attributed after this change/)
    assert.deepEqual(lots(world), [
      { id: 5000, supplier_id: 7, supplier_name: 'Acme Co' },
      { id: 5001, supplier_id: 7, supplier_name: 'Acme Warehouse' },
    ], 'the later name survives and the untouched lot is not half-reverted')
    assert.equal(snapshotStatus(world, snap), 'applied')
  })

  await check('control: a record-only supplier rename leaves the stamped name, which is still the same attribution', async () => {
    const world = freshWorld()
    const snap = await backfill(world, { id: 7, name: 'Acme Co' })
    world.run("UPDATE suppliers SET name = 'Acme Corporation' WHERE id = 7")
    await replay(world, snap, 'undo')
    assert.deepEqual(lots(world), [
      { id: 5000, supplier_id: null, supplier_name: null },
      { id: 5001, supplier_id: null, supplier_name: 'Acme Co' },
    ])
  })

  await check('control: the name is compared as the redo compares it (case and outer spaces aside)', async () => {
    const world = freshWorld()
    const snap = await backfill(world, { id: 7, name: 'Acme Co' })
    world.run("UPDATE product_batches SET supplier_name = ' ACME CO ' WHERE id = 5000")
    await replay(world, snap, 'undo')
    assert.deepEqual(lots(world)[0], { id: 5000, supplier_id: null, supplier_name: null })
  })

  await check('control: after a redo stamps a renamed supplier, a later undo accepts that stamped name', async () => {
    const world = freshWorld()
    const snap = await backfill(world, { id: 7, name: 'Acme Co' })
    await replay(world, snap, 'undo')
    world.run("UPDATE suppliers SET name = 'Acme Corporation' WHERE id = 7")
    await replay(world, snap, 'redo')
    assert.equal(lots(world)[1].supplier_name, 'Acme Corporation', 'the redo stamps the current name')
    world.run("UPDATE suppliers SET name = 'Acme Group' WHERE id = 7")
    await replay(world, snap, 'undo')
    assert.deepEqual(lots(world), [
      { id: 5000, supplier_id: null, supplier_name: null },
      { id: 5001, supplier_id: null, supplier_name: 'Acme Co' },
    ])
  })

  await check('undo refuses when a lot was re-attributed to another supplier after the backfill', async () => {
    const world = freshWorld()
    const snap = await backfill(world, { id: 7, name: 'Acme Co' })
    // routes/batches.ts lot edit sets supplier_name + supplier_id.
    world.run("UPDATE product_batches SET supplier_id = 9, supplier_name = 'Gamma Ltd' WHERE id = 5001")
    await assertConflict(replay(world, snap, 'undo'), /1 lot was re-attributed after this change/)
    assert.deepEqual(lots(world), [
      { id: 5000, supplier_id: 7, supplier_name: 'Acme Co' },
      { id: 5001, supplier_id: 9, supplier_name: 'Gamma Ltd' },
    ], 'the later attribution survives and the untouched lot is not half-reverted')
    assert.equal(snapshotStatus(world, snap), 'applied', 'a refused undo does not mark the snapshot reversed')
  })

  await check('redo refuses when a lot was attributed by someone else while the action sat reversed', async () => {
    const world = freshWorld()
    const snap = await backfill(world, { id: 7, name: 'Acme Co' })
    await replay(world, snap, 'undo')
    world.run("UPDATE product_batches SET supplier_id = 9, supplier_name = 'Gamma Ltd' WHERE id = 5000")
    await assertConflict(replay(world, snap, 'redo'), /re-attributed after this change, so it can no longer be redone/)
    assert.deepEqual(lots(world), [
      { id: 5000, supplier_id: 9, supplier_name: 'Gamma Ltd' },
      { id: 5001, supplier_id: null, supplier_name: 'Acme Co' },
    ])
    assert.equal(snapshotStatus(world, snap), 'reversed')
  })

  await check('redo refuses when a name-only lot was given a different supplier name while reversed', async () => {
    const world = freshWorld()
    const snap = await backfill(world, { id: 7, name: 'Acme Co' })
    await replay(world, snap, 'undo')
    world.run("UPDATE product_batches SET supplier_name = 'Local Market' WHERE id = 5001")
    await assertConflict(replay(world, snap, 'redo'), /re-attributed/)
    assert.equal(lots(world)[1].supplier_name, 'Local Market')
  })

  await check('a re-attribution that lands between the check and the write aborts the whole batch', async () => {
    const world = freshWorld()
    const snap = await backfill(world, { id: 7, name: 'Acme Co' })
    const batch = world.d1.batch.bind(world.d1)
    world.d1.batch = async (statements) => {
      world.d1.batch = batch
      world.run("UPDATE product_batches SET supplier_id = 9, supplier_name = 'Gamma Ltd' WHERE id = 5001")
      return batch(statements)
    }
    await assertConflict(replay(world, snap, 'undo'), /re-attributed while this change was being undone/)
    assert.deepEqual(lots(world), [
      { id: 5000, supplier_id: 7, supplier_name: 'Acme Co' },
      { id: 5001, supplier_id: 9, supplier_name: 'Gamma Ltd' },
    ])
  })

  await check('DISCRIMINATING (C8): a name-only lot edit that lands between the check and the write aborts the whole batch', async () => {
    const world = freshWorld()
    const snap = await backfill(world, { id: 7, name: 'Acme Co' })
    const batch = world.d1.batch.bind(world.d1)
    world.d1.batch = async (statements) => {
      world.d1.batch = batch
      world.run("UPDATE product_batches SET supplier_name = 'Acme Warehouse' WHERE id = 5001")
      return batch(statements)
    }
    await assertConflict(replay(world, snap, 'undo'), /re-attributed while this change was being undone/)
    assert.deepEqual(lots(world), [
      { id: 5000, supplier_id: 7, supplier_name: 'Acme Co' },
      { id: 5001, supplier_id: 7, supplier_name: 'Acme Warehouse' },
    ])
  })

  console.log(`\n${passed} check(s) passed, ${failed.length} failed.`)
  if (failed.length) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })

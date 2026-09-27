// FX-undo2 item 2 (R-undo C10): the LEGACY sale.add_items replay must not
// overwrite a later sale edit.
//
// Legacy snapshots are the ones routes/sales.ts recorded before the atomic
// path (2026-09-04..05): no operation id and no sale revision; the oldest have
// no saleStateFingerprint either. Both directions write ABSOLUTE money columns
// (undo restores moneyBefore, redo restores moneyAfter), and before this fix a
// redo was never checked at all and an undo was checked only when a
// fingerprint had been saved. The refuter's probes, kept here as fixtures:
//   L1  redo after a $2 line was added while the action sat reversed:
//       the sale total became $15 while its lines summed to $17;
//   L2  undo of a snapshot without a fingerprint after a later $2 line:
//       the sale total became $10 while its lines summed to $12.
// Controls: a clean legacy undo -> redo -> undo still replays correctly, with
// and without a fingerprint, and the refuter's own positive control (L3).
//
// Real SQLite over the real migrated schema, the REAL transpiled
// lib/undoAppliers.ts with the REAL lib/saleLineAddition.ts and
// lib/saleAmendments.ts (harness/load_undo_appliers.cjs realSaleModules).
//
// Run: node scripts/test-undo-sale-add-items-legacy-staleness-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { loadUndoAppliers } = require('./harness/load_undo_appliers.cjs')

const USER = { id: 42, name: 'Admin' }
const RATE = 4100
const SALE = 77
const RECORD_CHANGED = 'undo_record_changed'
const money = (usd) => ({ subtotal_usd: usd, subtotal_khr: usd * RATE, total_usd: usd, total_khr: usd * RATE, change_usd: 0, change_khr: 0 })

function freshWorld() {
  const d1 = openDb(loadAll())
  const { undoAppliers } = loadUndoAppliers(d1, { realSaleModules: true })
  const run = (sql, params) => d1.db.prepare(sql).run(params == null ? {} : params)
  const get = (sql, params) => d1.db.prepare(sql).get(params == null ? {} : params)
  run("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Shop', 1, 1)")
  run("INSERT INTO products (id, name, is_active) VALUES (100, 'Serum', 1), (101, 'Toner', 1)")
  return { d1, undoAppliers, run, get }
}

function insertSale(world, usd) {
  world.run(`INSERT INTO sales (id, receipt_number, sale_status, branch_id, subtotal_usd, subtotal_khr, total_usd, total_khr,
      change_usd, change_khr, exchange_rate, money_precision_version)
    VALUES (@id, 'R-77', 'completed', 1, @usd, @khr, @usd, @khr, 0, 0, @rate, 0)`, { id: SALE, usd, khr: usd * RATE, rate: RATE })
}

function insertLine(world, productId, name, usd) {
  return Number(world.run(`INSERT INTO sale_items (sale_id, product_id, product_name, quantity, applied_price_usd, total_usd, branch_id)
    VALUES (@sale, @productId, @name, 1, @usd, @usd, 1)`, { sale: SALE, productId, name, usd }).lastInsertRowid)
}

function reversal(addedLineId) {
  return {
    saleId: SALE, receiptNumber: 'R-77', saleStatus: 'completed', exchangeRate: RATE,
    moneyBefore: money(10), moneyAfter: money(15),
    lines: [{ saleItemId: addedLineId, productId: 100, productName: 'Serum', quantity: 1, branchId: 1, heldUnits: 0,
      unitPriceUsd: 5, lineTotalUsd: 5, costPriceUsd: null, costPriceKhr: null, takes: [] }],
  }
}

// The sale right after a legacy addition: a $10 line, then the added $5 line,
// totals $15. `fingerprint` records through the real recorder (which saves
// the fingerprint); otherwise the row is written as the pre-fingerprint
// recorder left it.
async function afterAddition(world, { fingerprint }) {
  insertSale(world, 15)
  insertLine(world, 100, 'Serum', 10)
  const added = insertLine(world, 100, 'Serum', 5)
  if (fingerprint) return (await world.undoAppliers.recordSaleAddItemsUndoSnapshot({}, USER, reversal(added))).snapshotId
  return Number(world.run("INSERT INTO undo_snapshots (kind, status, payload_json) VALUES ('sale.add_items', 'applied', @p)",
    { p: JSON.stringify(reversal(added)) }).lastInsertRowid)
}

// A later edit through the app: one more $2 line, and the sale re-totalled.
function laterLine(world, usd = 2) {
  insertLine(world, 101, 'Toner', usd)
  world.run(`UPDATE sales SET subtotal_usd = subtotal_usd + @usd, total_usd = total_usd + @usd,
    subtotal_khr = subtotal_khr + @khr, total_khr = total_khr + @khr WHERE id = @id`, { usd, khr: usd * RATE, id: SALE })
}

function replay(world, snapshotId, direction) {
  const payload = { applier: 'sale.add_items', snapshot_id: snapshotId }
  return world.undoAppliers.resolveUndoApplier(payload).run(payload, { env: {}, user: USER, direction, historyId: 1 })
}

function state(world, snapshotId) {
  const sale = world.get('SELECT subtotal_usd, total_usd, total_khr FROM sales WHERE id = @id', { id: SALE })
  const lines = world.get('SELECT COUNT(*) AS rows, COALESCE(SUM(total_usd), 0) AS sum FROM sale_items WHERE sale_id = @id', { id: SALE })
  const snap = world.get('SELECT status, payload_json FROM undo_snapshots WHERE id = @id', { id: snapshotId })
  const amendments = world.get('SELECT COUNT(*) AS n FROM sale_amendments WHERE sale_id = @id', { id: SALE }).n
  return { total: sale.total_usd, subtotal: sale.subtotal_usd, totalKhr: sale.total_khr, rows: lines.rows, sum: lines.sum,
    snapStatus: snap.status, recordedLineIds: JSON.parse(snap.payload_json).lines.map((l) => l.saleItemId), amendments }
}

async function assertRefused(promise, pattern) {
  let error = null
  try { await promise } catch (caught) { error = caught }
  assert.ok(error, 'expected the replay to be refused, but it was applied')
  assert.equal(error.statusCode, 409, `a stale replay is a 409 conflict, got: ${error.statusCode} ${error.message}`)
  assert.equal(error.code, RECORD_CHANGED, `the refusal carries the record-changed code, got: ${error.code} (${error.message})`)
  if (pattern) assert.match(error.message, pattern)
}

// A write that lands after the replay's own check and before its batch.
function raceNextBatch(world, write) {
  const batch = world.d1.batch.bind(world.d1)
  world.d1.batch = async (statements) => {
    world.d1.batch = batch
    write()
    return batch(statements)
  }
}

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
  await check('PROBE L1: a legacy redo after a later $2 line is refused and the $12 sale is left as it is', async () => {
    const world = freshWorld()
    // The refuter's fixture: the sale as the legacy undo left it ($10), the
    // snapshot reversed, then a $2 line added while it sat reversed.
    insertSale(world, 10)
    insertLine(world, 100, 'Serum', 10)
    const snap = Number(world.run("INSERT INTO undo_snapshots (kind, status, payload_json) VALUES ('sale.add_items', 'reversed', @p)",
      { p: JSON.stringify(reversal(999)) }).lastInsertRowid)
    laterLine(world)
    const before = state(world, snap)
    await assertRefused(replay(world, snap, 'redo'))
    const after = state(world, snap)
    assert.deepEqual(after, before, 'nothing was written')
    assert.equal(after.total, 12)
    assert.equal(after.sum, 12, 'the header still matches its lines')
  })

  await check('PROBE L2: a legacy undo WITHOUT a fingerprint after a later $2 line is refused and the $17 sale is left as it is', async () => {
    const world = freshWorld()
    const snap = await afterAddition(world, { fingerprint: false })
    assert.equal(JSON.parse(world.get('SELECT payload_json FROM undo_snapshots WHERE id = @id', { id: snap }).payload_json).saleStateFingerprint, undefined)
    laterLine(world)
    const before = state(world, snap)
    await assertRefused(replay(world, snap, 'undo'), /edited after the items were added/)
    const after = state(world, snap)
    assert.deepEqual(after, before, 'nothing was written')
    assert.equal(after.total, 17)
    assert.equal(after.sum, 17)
  })

  await check('L3 (refuter control): a legacy undo WITH a fingerprint after a later line is refused, now with the code', async () => {
    const world = freshWorld()
    const snap = await afterAddition(world, { fingerprint: true })
    laterLine(world)
    const before = state(world, snap)
    await assertRefused(replay(world, snap, 'undo'), /edited after the items were added/)
    assert.deepEqual(state(world, snap), before)
  })

  for (const fingerprint of [false, true]) {
    const kind = fingerprint ? 'with' : 'without'
    await check(`control (${kind} a fingerprint): an untouched legacy addition still undoes, redoes and undoes again`, async () => {
      const world = freshWorld()
      const snap = await afterAddition(world, { fingerprint })
      await replay(world, snap, 'undo')
      let now = state(world, snap)
      assert.deepEqual([now.total, now.subtotal, now.totalKhr, now.rows, now.sum, now.snapStatus], [10, 10, 10 * RATE, 1, 10, 'reversed'])
      await replay(world, snap, 'redo')
      now = state(world, snap)
      assert.deepEqual([now.total, now.subtotal, now.totalKhr, now.rows, now.sum, now.snapStatus], [15, 15, 15 * RATE, 2, 15, 'applied'])
      const readded = world.get('SELECT id, product_id, total_usd FROM sale_items WHERE id = @id', { id: now.recordedLineIds[0] })
      assert.deepEqual([readded && readded.product_id, readded && readded.total_usd], [100, 5], 'the snapshot points at the re-added line')
      await replay(world, snap, 'undo')
      now = state(world, snap)
      assert.deepEqual([now.total, now.rows, now.sum, now.snapStatus], [10, 1, 10, 'reversed'])
      assert.equal(now.amendments, 3, 'each replay appended its compensating ledger entry')
    })

    await check(`L1 through the real undo (${kind} a fingerprint): a redo after a later line is refused`, async () => {
      const world = freshWorld()
      const snap = await afterAddition(world, { fingerprint })
      await replay(world, snap, 'undo')
      laterLine(world)
      const before = state(world, snap)
      await assertRefused(replay(world, snap, 'redo'))
      assert.deepEqual(state(world, snap), before, 'nothing was written')
    })
  }

  await check('a legacy redo after a later discount (totals moved, lines did not) is refused', async () => {
    const world = freshWorld()
    const snap = await afterAddition(world, { fingerprint: false })
    await replay(world, snap, 'undo')
    world.run('UPDATE sales SET total_usd = 9, total_khr = @khr WHERE id = @id', { khr: 9 * RATE, id: SALE })
    const before = state(world, snap)
    await assertRefused(replay(world, snap, 'redo'))
    assert.deepEqual(state(world, snap), before)
  })

  await check('a legacy undo without a fingerprint after the added line itself was edited is refused', async () => {
    const world = freshWorld()
    const snap = await afterAddition(world, { fingerprint: false })
    const added = state(world, snap).recordedLineIds[0]
    world.run('UPDATE sale_items SET quantity = 2, total_usd = 10 WHERE id = @id', { id: added })
    world.run('UPDATE sales SET subtotal_usd = 20, total_usd = 20 WHERE id = @id', { id: SALE })
    const before = state(world, snap)
    await assertRefused(replay(world, snap, 'undo'))
    assert.deepEqual(state(world, snap), before)
  })

  await check('race: a line added between the undo check and its write aborts the whole undo', async () => {
    const world = freshWorld()
    const snap = await afterAddition(world, { fingerprint: false })
    raceNextBatch(world, () => laterLine(world))
    await assertRefused(replay(world, snap, 'undo'))
    const after = state(world, snap)
    assert.deepEqual([after.total, after.rows, after.sum, after.snapStatus, after.amendments], [17, 3, 17, 'applied', 0])
  })

  await check('race: a line added between the redo check and its write aborts the whole redo', async () => {
    const world = freshWorld()
    const snap = await afterAddition(world, { fingerprint: false })
    await replay(world, snap, 'undo')
    const amendments = state(world, snap).amendments
    raceNextBatch(world, () => laterLine(world))
    await assertRefused(replay(world, snap, 'redo'))
    const after = state(world, snap)
    assert.deepEqual([after.total, after.rows, after.sum, after.snapStatus, after.amendments], [12, 2, 12, 'reversed', amendments])
  })

  await check('a legacy snapshot too incomplete to derive the expected sale from is refused, not replayed on a guess', async () => {
    const world = freshWorld()
    insertSale(world, 15)
    insertLine(world, 100, 'Serum', 10)
    const added = insertLine(world, 100, 'Serum', 5)
    const partial = { ...reversal(added), moneyAfter: {} }
    const snap = Number(world.run("INSERT INTO undo_snapshots (kind, status, payload_json) VALUES ('sale.add_items', 'applied', @p)",
      { p: JSON.stringify(partial) }).lastInsertRowid)
    const before = state(world, snap)
    await assertRefused(replay(world, snap, 'undo'))
    assert.deepEqual(state(world, snap), before)
  })

  console.log(`\n${passed} check(s) passed, ${failures.length} failed.`)
  if (failures.length) process.exit(1)
})().catch((error) => { console.error(error); process.exit(1) })

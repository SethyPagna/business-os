#!/usr/bin/env node
// Native proof for the lot-insert guard (migration 0320 + lib/db.ts guardD1), on the real Worker under Miniflare with the counting D1 proxy.
//   (a) rows read and D1 calls of each lot writer, BEFORE (0155's insert trigger re-created from its exact text) and AFTER (the schema as migrated, 0320 applied):
//       fast stock-in (1 and 3 lines), bulk transfer (5 lines), return restock (1 line), product create with starting stock, and the import's lot insert
//       (50 and 200 rows, the statement the importer sends per new stocked row, in chunks of 50 as one db.batch each).
//   (b) a replacing insert into product_batches through the Worker's database layer (guardD1 over the real D1 binding) is refused and nothing is written.
//   (c) the three remaining 0155 triggers still refuse a delete, an id change and an orphaning update of a stocked lot, on the real D1.
//   (d) INSERT OR IGNORE and an upsert on an existing lot still work, through the guard.
// Mutation hooks: LOT_GUARD_NONE=1 builds the guard as a pass-through (the (b) check must go red); LOT_GUARD_KEEP_TRIGGER=1 skips nothing but treats the
// migrated schema as "before" (the (a) comparison must go red). Run only under the native-test lock: node scripts/test-lot-replace-migration-native.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { bootWorld, ROOT } = require('./read-budget/world.cjs')
const { writeShapes, measureWrite, lots } = require('./read-budget/writes.cjs')

const PERMIT = "INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'"
const RELEASE = "DELETE FROM system_flags WHERE key='stock_transaction_permit'"
const REMOVED = 'positive_lot_reject_parent_insert_orphan_0155'
const KEPT = ['positive_lot_reject_parent_delete_0155', 'positive_lot_reject_parent_id_update_0155', 'positive_lot_reject_parent_update_orphan_0155']

async function loadGuard() {
  const out = await build({ entryPoints: [path.join(ROOT, 'src/lib/db.ts')], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'error' })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require)
  if (process.env.LOT_GUARD_NONE === '1') return { ...mod.exports, guardD1: (d1) => d1 }
  return mod.exports
}
const triggerText = () => {
  const sql = fs.readFileSync(path.join(ROOT, 'migrations/0155_positive_lot_parent_identity_guard.sql'), 'utf8').replace(/\r\n/g, '\n')
  const m = /CREATE TRIGGER positive_lot_reject_parent_insert_orphan_0155[\s\S]*?\nEND;/.exec(sql)
  assert(m, '0155 trigger text')
  return m[0].replace(/;$/, '')
}
const lotCount = async (world) => Number((await world.all('SELECT COUNT(*) AS n FROM product_batches'))[0].n)
const triggers = async (world) => (await world.all("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE '%0155' ORDER BY name")).map((r) => r.name)

async function measure(world, shape) {
  const before = await lotCount(world)
  const m = await measureWrite(world, shape)
  return { status: m.status, rowsRead: m.rowsRead, calls: m.calls, lotsAdded: (await lotCount(world)) - before }
}

async function createWithStock(world, tag) {
  const shape = { id: 'create-with-stock', method: 'POST', url: '/api/products',
    run: async (w, send) => send('POST', '/api/products', { name: `Guard product ${tag}`, barcode: `88500${String(Date.now()).slice(-7)}${tag}`, stock_quantity: 7, branch_id: 1, cost_price_usd: 3.5, selling_price_usd: 6, client_request_id: `guard-create-${tag}-${Date.now()}` }) }
  return measure(world, shape)
}

// The importer's lot insert (importEngine.ts, one per new stocked row), in chunks of 50 statements per db.batch, as the importer sends them.
async function importLots(world, rows, tag) {
  const product = (await world.all('SELECT id FROM products WHERE is_active=1 ORDER BY id LIMIT 1'))[0].id
  let maxId = Number((await world.all('SELECT COALESCE(MAX(id),0) AS m FROM product_batches'))[0].m)
  let read = 0, calls = 0
  for (let at = 0; at < rows; at += 50) {
    const statements = []
    for (let i = at; i < Math.min(rows, at + 50); i++) {
      statements.push(world.db.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, expiry_date, received_at, is_active, notes, batch_number, unit_cost_usd, received_quantity, received_branch_id, received_cost_usd)
        VALUES (?, ?, ?, NULL, NULL, '2026-11-20', 1, 'import', (SELECT COALESCE(MAX(batch_number), 0) + 1 FROM product_batches WHERE variant_product_id = ?), 2, 1, 1, 2)`).bind(++maxId, product, `guard-import-${tag}-${i}`, product))
    }
    const results = await world.db.batch([world.db.prepare(PERMIT), ...statements, world.db.prepare(RELEASE)])
    for (const r of results) read += Number(r.meta && r.meta.rows_read) || 0
    calls += 1
  }
  return { rowsRead: read, calls, lotsAdded: rows }
}

async function main() {
  const guardModule = await loadGuard()
  const { guardD1, ProductBatchesReplaceRefusedError } = guardModule
  const world = await bootWorld({ tier: 'free', switches: { call_counting: 'on' } })
  const lines = []
  const say = (text) => { lines.push(text); console.log(text) }
  try {
    const shapes = new Map(writeShapes(world.ctx).filter((s) => s.variant === 'base').map((s) => [s.id, s]))
    const ids = ['w-fast-stock-in-1-line', 'w-fast-stock-in-3-lines', 'w-transfer-bulk-5-lines', 'w-return-1-lines']
    for (const id of ids) assert(shapes.has(id), `no write shape ${id}`)

    // ---- the schema as migrated: 0320 applied
    assert.deepEqual(await triggers(world), KEPT, 'the migrated schema holds exactly the three remaining 0155 triggers')
    assert.equal((await world.all("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name='idx_branch_batch_stock_positive_batch_0155'"))[0].n, 1)

    const after = new Map()
    for (const id of ids) after.set(id, await measure(world, shapes.get(id)))
    after.set('product-create-with-stock', await createWithStock(world, 'a'))
    after.set('import-50-lots', await importLots(world, 50, 'a'))
    after.set('import-200-lots', await importLots(world, 200, 'b'))

    // ---- (c) and (d), on the real D1
    const stocked = (await lots(world, 1, 1200))[0]
    const guarded = guardD1(world.db)
    const permitted = async (db, sql, binds = []) => db.batch([db.prepare(PERMIT), db.prepare(sql).bind(...binds), db.prepare(RELEASE)])
    const lotRow = async (id) => (await world.all('SELECT id, variant_product_id, batch_key, is_active FROM product_batches WHERE id = ?', id))[0]
    const lotBefore = await lotRow(stocked.batch)
    assert(lotBefore, 'the stocked lot exists')
    await assert.rejects(() => permitted(world.db, 'DELETE FROM product_batches WHERE id = ?', [stocked.batch]), /Cannot delete a received lot/)
    await assert.rejects(() => permitted(world.db, 'UPDATE product_batches SET id = ? WHERE id = ?', [stocked.batch + 700000, stocked.batch]), /Cannot change the identity/)
    const other = (await world.all('SELECT id FROM product_batches WHERE id <> ? AND variant_product_id = ? LIMIT 1', stocked.batch, lotBefore.variant_product_id))[0]
    if (other) await assert.rejects(() => permitted(world.db, 'UPDATE OR REPLACE product_batches SET batch_key = ? WHERE id = ?', [lotBefore.batch_key, other.id]), /Cannot orphan positive branch stock|UNIQUE/)
    assert.deepEqual(await lotRow(stocked.batch), lotBefore, '(c) the stocked lot is untouched')
    say('(c) delete, id change and orphaning update of a stocked lot are refused on the real D1 after 0320')

    const ignored = await guarded.batch([guarded.prepare(PERMIT), guarded.prepare("INSERT OR IGNORE INTO product_batches(variant_product_id, batch_key, is_active) VALUES (?, ?, 1)").bind(lotBefore.variant_product_id, lotBefore.batch_key), guarded.prepare(RELEASE)])
    assert.equal(ignored[1].meta.changes, 0, '(d) INSERT OR IGNORE on an existing lot changes nothing')
    await guarded.batch([guarded.prepare(PERMIT), guarded.prepare("INSERT INTO product_batches(variant_product_id, batch_key, is_active, notes) VALUES (?, ?, 1, 'upserted') ON CONFLICT(variant_product_id, batch_key) DO UPDATE SET notes = excluded.notes").bind(lotBefore.variant_product_id, lotBefore.batch_key), guarded.prepare(RELEASE)])
    assert.equal((await world.all('SELECT notes FROM product_batches WHERE id = ?', stocked.batch))[0].notes, 'upserted')
    say('(d) INSERT OR IGNORE and an upsert on an existing lot still work through the guard')

    // ---- (b) a replacing insert through the database layer is refused and nothing is written
    const snapshot = async () => JSON.stringify([await world.all('SELECT * FROM product_batches ORDER BY id'), await world.all('SELECT * FROM branch_batch_stock ORDER BY id')])
    const frozen = await snapshot()
    const replaces = [
      `REPLACE INTO product_batches(id, variant_product_id, batch_key, is_active) VALUES (${stocked.batch + 800000}, ${lotBefore.variant_product_id}, '${lotBefore.batch_key}', 1)`,
      `insert or replace into product_batches(id, variant_product_id, batch_key, is_active) values (${stocked.batch + 800001}, ${lotBefore.variant_product_id}, '${lotBefore.batch_key}', 1)`,
      `INSERT OR REPLACE INTO "main"."product_batches"(id, variant_product_id, batch_key, is_active) VALUES (${stocked.batch + 800002}, ${lotBefore.variant_product_id}, '${lotBefore.batch_key}', 1)`,
    ]
    for (const sql of replaces) {
      assert.throws(() => guarded.prepare(sql), ProductBatchesReplaceRefusedError, `(b) refused before it is sent: ${sql.slice(0, 40)}`)
      assert.throws(() => guardD1(world.db).prepare(sql), ProductBatchesReplaceRefusedError)
    }
    assert.equal(await snapshot(), frozen, '(b) nothing was written')
    say('(b) a replacing insert (REPLACE INTO, lower case, schema-quoted) is refused before it is sent, through the guard and through the raw binding wrapped the way the Worker entry points wrap it; nothing was written')

    // ---- (a) BEFORE: a second world, seeded the same way, with 0155's insert trigger back exactly as written. A fresh world, because a second
    // run of the same shape in the first world finds its lots already stocked and adds none.
    const before = new Map()
    const old = await bootWorld({ tier: 'free', switches: { call_counting: 'on' } })
    try {
      const oldShapes = new Map(writeShapes(old.ctx).filter((s) => s.variant === 'base').map((s) => [s.id, s]))
      if (process.env.LOT_GUARD_KEEP_TRIGGER !== '1') {
        await old.db.prepare(triggerText()).run()
        assert.deepEqual(await triggers(old), [...KEPT, REMOVED].sort())
      }
      for (const id of ids) before.set(id, await measure(old, oldShapes.get(id)))
      before.set('product-create-with-stock', await createWithStock(old, 'b'))
      before.set('import-50-lots', await importLots(old, 50, 'c'))
      before.set('import-200-lots', await importLots(old, 200, 'd'))
    } finally { await old.dispose() }

    say('writer | lots added after/before | rows read BEFORE (0155 insert scan) | rows read AFTER (0320) | calls before -> after')
    const problems = []
    for (const key of after.keys()) {
      const a = after.get(key), b = before.get(key)
      say(`${key} | ${a.lotsAdded}/${b.lotsAdded} | ${b.rowsRead} | ${a.rowsRead} | ${b.calls} -> ${a.calls}`)
      if (a.status !== undefined && (a.status >= 300 || b.status >= 300)) problems.push(`${key}: answered ${b.status} before and ${a.status} after`)
      if (a.lotsAdded > 0) {
        // Each new lot paid a scan of every positive stock row; the seed holds thousands of them.
        if (!(b.rowsRead - a.rowsRead >= a.lotsAdded * 1000)) problems.push(`${key}: rows read fell from ${b.rowsRead} to ${a.rowsRead}, expected at least ${a.lotsAdded * 1000} fewer for ${a.lotsAdded} new lot(s)`)
      }
      if (a.calls > b.calls) problems.push(`${key}: more calls after (${a.calls}) than before (${b.calls})`)
    }
    // What is left is the importer's own batch_number subselect (all lots here go to one product), not the scan: the scan was 99% of the BEFORE reads.
    if (!(after.get('import-200-lots').rowsRead * 8 < before.get('import-200-lots').rowsRead)) problems.push(`200 imported lots still read ${after.get('import-200-lots').rowsRead} rows against ${before.get('import-200-lots').rowsRead} before`)
    assert.deepEqual(problems, [], problems.join('\n'))
    console.log('test-lot-replace-migration-native: all checks passed')
  } finally { await world.dispose() }
}

main().catch((e) => { console.error(`test-lot-replace-migration-native: ${e && e.stack}`); process.exitCode = 1 })

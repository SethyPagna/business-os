// The product-merge state fingerprint (lib/undoAppliers.ts mergeStateFingerprint)
// hashes `SELECT * FROM products` rows. Migration 0233 adds products.search_doc and
// search_doc_version, and the search backfill/repair rewrite them later, so without
// care EVERY merge recorded before the migration would read as "changed since" and
// its undo would be refused ("later stock or received-date activity"), and a repair
// after a merge would do the same. The derived columns are not merge state.
//
//  1. A fingerprint computed on the schema BEFORE 0233 equals the one computed on the
//     schema AFTER it, for the same rows (a snapshot saved yesterday still matches).
//  2. Writing, changing or clearing search_doc / search_doc_version never changes it.
//  3. POSITIVE CONTROL: a real column (description, then stock) still changes it, so
//     the fingerprint was not neutered.
//  4. The in-transaction guard built from the same read (transactionGuards) is
//     satisfied after a document write and violated by a real change.
//
// Run: node scripts/test-merge-fingerprint-search-doc-pure.cjs
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { loadUndoAppliers } = require('./harness/load_undo_appliers.cjs')

const migrationsDir = path.join(__dirname, '..', 'migrations')
let checks = 0
function check(label, cond) {
  assert.ok(cond, `FAIL: ${label}`)
  checks += 1
  console.log(`  ok  ${label}`)
}

function database(through) {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = OFF')
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort().filter((f) => through(f))) db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
  db.exec(`INSERT INTO branches(id, name, is_default, is_active) VALUES (1, 'Shop', 1, 1);
    INSERT INTO products(id, name, brand, barcode, cost_price_usd, selling_price_usd, stock_quantity, is_active, created_at, updated_at) VALUES
      (1, 'Keeper', 'Brand', '111', 1, 2, 5, 1, '2026-10-01 00:00:00', '2026-10-01 00:00:00'), (2, 'Duplicate', 'Brand', '222', 1, 2, 3, 1, '2026-10-01 00:00:00', '2026-10-01 00:00:00');`)
  return db
}

function wrap(sqlite) {
  const run = (sql, params, method) => {
    const st = sqlite.prepare(sql)
    return Array.isArray(params) ? st[method](...params) : st[method](params || {})
  }
  return {
    prepare: (sql) => ({ get: (p) => run(sql, p, 'get'), all: (p) => run(sql, p, 'all'), run: (p) => run(sql, p, 'run') }),
    batch: (statements) => statements.map((s) => ({ results: sqlite.prepare(s.sql).all(...(Array.isArray(s.params) ? s.params : s.params ? [s.params] : [])) })),
  }
}

const reversal = {
  keeperId: 1, dupId: 2, keeperName: 'Keeper', dupName: 'Duplicate', mergeContext: 'test',
  keeperStockBefore: [], dupStockBefore: [], dupImagesBefore: [], imagesMovedToKeeper: [], repointedBatches: [], foldedBatches: [],
  reparentedSaleItemIds: [], reparentedMovementIds: [], adjustmentMovementIds: [], operationId: 'op-1',
}

;(async () => {
  const { undoAppliers } = loadUndoAppliers(openDb(loadAll()))
  const before = database((f) => f < '0233')
  const after = database((f) => f <= '0233_z')
  check('the pre-0233 schema has no search_doc column, the post one has', !before.prepare("SELECT COUNT(*) n FROM pragma_table_info('products') WHERE name = 'search_doc'").get().n
    && after.prepare("SELECT COUNT(*) n FROM pragma_table_info('products') WHERE name = 'search_doc'").get().n === 1)

  const fingerprintBefore = await undoAppliers.mergeStateFingerprint(wrap(before), [reversal])
  const fingerprintAfter = await undoAppliers.mergeStateFingerprint(wrap(after), [reversal])
  check('1. a fingerprint saved BEFORE the migration equals the one computed AFTER it (old merges stay undoable)', fingerprintBefore === fingerprintAfter && fingerprintBefore.length > 100)
  check('the fingerprint does not mention the derived columns', !/search_doc/.test(fingerprintAfter))

  after.prepare("UPDATE products SET search_doc = 'keeper brand', search_doc_version = 1 WHERE id IN (1, 2)").run()
  check('2. writing the document (the backfill) does not change it', await undoAppliers.mergeStateFingerprint(wrap(after), [reversal]) === fingerprintAfter)
  after.prepare("UPDATE products SET search_doc = 'something else entirely', search_doc_version = 7 WHERE id = 1").run()
  after.prepare('UPDATE products SET search_doc = NULL, search_doc_version = NULL WHERE id = 2').run()
  check('changing and clearing the document (a repair, the stale trigger) does not change it', await undoAppliers.mergeStateFingerprint(wrap(after), [reversal]) === fingerprintAfter)

  after.prepare("UPDATE products SET description = 'edited' WHERE id = 1").run()
  const edited = await undoAppliers.mergeStateFingerprint(wrap(after), [reversal])
  check('3. POSITIVE CONTROL: a real column (description) still changes it', edited !== fingerprintAfter)
  after.prepare("UPDATE products SET description = NULL WHERE id = 1").run()
  check('and restoring it restores the fingerprint', await undoAppliers.mergeStateFingerprint(wrap(after), [reversal]) === fingerprintAfter)
  after.prepare('UPDATE products SET stock_quantity = 99 WHERE id = 2').run()
  check('POSITIVE CONTROL: stock still changes it', await undoAppliers.mergeStateFingerprint(wrap(after), [reversal]) !== fingerprintAfter)
  after.prepare('UPDATE products SET stock_quantity = 3 WHERE id = 2').run()

  // 4. the transaction guard
  const guards = []
  const expected = await undoAppliers.mergeStateFingerprint(wrap(after), [reversal], guards)
  check('the guarded read produces the same fingerprint and one guard per read', expected === fingerprintAfter && guards.length > 0)
  const run = (guard) => after.prepare(guard.sql).get(...(guard.params ? [guard.params] : []))
  const productGuard = guards.find((guard) => /FROM products/.test(guard.sql) && /live\."id"/.test(guard.sql))
  check('a products guard exists and does not compare the derived columns', Boolean(productGuard) && !/search_doc/.test(productGuard.sql))
  after.prepare("UPDATE products SET search_doc = 'rewritten by a repair', search_doc_version = 1 WHERE id = 1").run()
  let satisfied = true
  try { run(productGuard) } catch { satisfied = false }
  check('4. the in-transaction guard still holds after a document write', satisfied)
  after.prepare("UPDATE products SET barcode = 'CHANGED' WHERE id = 1").run()
  let violated = false
  try { run(productGuard) } catch { violated = true }
  check('4. POSITIVE CONTROL: the guard fires on a real change', violated)

  console.log(`\nPASS test-merge-fingerprint-search-doc-pure (${checks} checks)`)
})().catch((error) => { console.error(error); process.exit(1) })

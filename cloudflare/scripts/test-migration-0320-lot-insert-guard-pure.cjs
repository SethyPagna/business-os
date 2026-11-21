// Migration 0320 drops 0155's per-insert orphan scan (positive_lot_reject_parent_insert_orphan_0155) and nothing else.
// Pins: the file is LF-only and is exactly one DROP TRIGGER IF EXISTS statement; it applies to the complete fresh chain and to a
// database that already holds stocked lots; it changes no row; the three other 0155 triggers and the partial index exist by name
// before and after and still refuse a delete, an id change and an orphaning update of a stocked lot; INSERT OR IGNORE and an
// upsert on an existing lot still work; the invariant query (ops/queries/positive-stock-orphan-lots.sql) is empty before and after;
// re-applying is harmless. Mutation hook: MIGRATION_0320_SOURCE points at another copy of the file.
// Run: node scripts/test-migration-0320-lot-insert-guard-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const dir = path.join(__dirname, '../migrations')
const file = '0320_drop_lot_insert_orphan_scan.sql'
const sql = fs.readFileSync(process.env.MIGRATION_0320_SOURCE || path.join(dir, file), 'utf8')
const REMOVED = 'positive_lot_reject_parent_insert_orphan_0155'
const KEPT_TRIGGERS = ['positive_lot_reject_parent_delete_0155', 'positive_lot_reject_parent_id_update_0155', 'positive_lot_reject_parent_update_orphan_0155']
const KEPT_INDEX = 'idx_branch_batch_stock_positive_batch_0155'
const INVARIANT = `SELECT bbs.id, bbs.batch_id, bbs.branch_id, bbs.quantity FROM branch_batch_stock bbs LEFT JOIN product_batches pb ON pb.id=bbs.batch_id
  WHERE bbs.quantity>0 AND (pb.id IS NULL OR pb.is_active IS NOT 1)`

const base = new Database(':memory:')
for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.sql') && f < file).sort()) base.exec(fs.readFileSync(path.join(dir, name), 'utf8'))
const schema = base.serialize()
base.close()

// Stock tables accept writes only inside a stock transaction (the permit row); the fixture and every probe run inside one.
const write = (db, fn) => seedStockFixture(db, typeof fn === 'string' ? () => db.exec(fn) : fn)
function fixture(migrate) {
  const db = new Database(schema)
  write(db, `INSERT INTO products(id,name) VALUES(900001,'Lot guard product'); INSERT INTO branches(id,name) VALUES(900001,'Shop'),(900002,'Warehouse');
    INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,is_active,unit_cost_usd,received_quantity,received_cost_usd,notes)
      VALUES(900001,900001,'original-receipt','2026-09-03',1,17.5,12,210,'Original receipt'),(900002,900001,'zero-stock-receipt','2026-09-04',0,19,5,95,'Historical');
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(900001,900001,0),(900001,900002,3),(900002,900001,0)`)
  if (migrate) db.exec(sql)
  return db
}
const names = (db, type) => db.prepare('SELECT name FROM sqlite_master WHERE type=? AND name LIKE ? ORDER BY name').all(type, '%0155').map((r) => r.name)
const snapshot = (db) => ['product_batches', 'branch_batch_stock'].map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY id`).all())
let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`) }

check('the file is LF-only and is exactly one DROP TRIGGER IF EXISTS statement', () => {
  assert(!sql.includes('\r'), 'LF only')
  const code = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n').trim()
  assert.equal(code, `DROP TRIGGER IF EXISTS ${REMOVED};`)
  for (const line of sql.split('\n')) {
    const n = (line.match(/'/g) || []).length
    assert(n === 0 || (/^--/.test(line) && n % 2 === 0), `an apostrophe outside a comment, or an unbalanced one, could confuse a statement splitter: ${line}`)
  }
})
check('the header carries the why, the pre and post assertions and the recovery note', () => {
  for (const need of ['Why:', 'Preflight and postflight', 'WHERE bbs.quantity>0 AND (pb.id IS NULL OR pb.is_active IS NOT 1)', ...KEPT_TRIGGERS, KEPT_INDEX, 'Recovery:', '0155_positive_lot_parent_identity_guard.sql', 'ops/queries/positive-stock-orphan-lots.sql', 'test-lot-replace-sweep-pure.cjs', 'after every deploy and weekly']) {
    assert(sql.includes(need), `header lacks ${need}`)
  }
  assert(!/daily/i.test(sql), 'no daily check was decided')
})
check('the recovery note carries the exact CREATE TRIGGER statement of 0155, which re-creates the dropped trigger', () => {
  const original = fs.readFileSync(path.join(dir, '0155_positive_lot_parent_identity_guard.sql'), 'utf8').replace(/\r/g, '').split('\n')
  const from = original.findIndex((l) => l.startsWith(`CREATE TRIGGER ${REMOVED}`))
  const statement = original.slice(from, original.findIndex((l, i) => i > from && l === 'END;') + 1)
  assert(statement.length > 5, 'found the statement in 0155')
  const pasted = sql.split('\n').filter((l) => l.startsWith('--   ')).map((l) => l.slice(5))
  const at = pasted.findIndex((l) => l === statement[0])
  assert(at >= 0 && statement.every((l, i) => pasted[at + i] === l), 'the pasted statement equals the 0155 statement line for line')
  const db = new Database(schema)
  db.exec(`DROP TRIGGER ${REMOVED}`)
  db.exec(pasted.slice(at, at + statement.length).join('\n'))
  assert.deepEqual(names(db, 'trigger'), [...KEPT_TRIGGERS, REMOVED].sort())
  db.close()
})
check('before 0320 all four triggers and the partial index exist; after it only the insert scan is gone', () => {
  const before = fixture(false)
  assert.deepEqual(names(before, 'trigger'), [...KEPT_TRIGGERS, REMOVED].sort())
  assert.deepEqual(names(before, 'index'), [KEPT_INDEX])
  const rows = snapshot(before)
  before.exec(sql)
  assert.deepEqual(names(before, 'trigger'), KEPT_TRIGGERS)
  assert.deepEqual(names(before, 'index'), [KEPT_INDEX])
  assert.deepEqual(snapshot(before), rows, 'no row changed')
  assert.equal(before.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  before.close()
})
check('the invariant query returns no rows before and after', () => {
  const before = fixture(false)
  assert.deepEqual(before.prepare(INVARIANT).all(), [])
  before.exec(sql)
  assert.deepEqual(before.prepare(INVARIANT).all(), [])
  before.close()
})
check('it touches no other trigger or index of the schema', () => {
  const plain = new Database(schema)
  const all = () => plain.prepare("SELECT type,name,sql FROM sqlite_master WHERE type IN ('trigger','index') ORDER BY type,name").all()
  const before = all()
  plain.exec(sql)
  const after = all()
  assert.deepEqual(before.filter((r) => r.name !== REMOVED), after)
  assert.equal(before.length - 1, after.length)
  plain.close()
})
check('the three remaining guards still refuse a delete, an id change and an orphaning update of a stocked lot', () => {
  const db = fixture(true), before = snapshot(db)
  assert.throws(() => write(db, 'DELETE FROM product_batches WHERE id=900001'), /Cannot delete a received lot/)
  assert.throws(() => write(db, 'UPDATE product_batches SET id=900003 WHERE id=900001'), /Cannot change the identity/)
  assert.throws(() => write(db, 'UPDATE product_batches SET rowid=900003 WHERE id=900001'), /Cannot orphan positive branch stock|Cannot change the identity/)
  assert.throws(() => write(db, "UPDATE OR REPLACE product_batches SET batch_key='original-receipt',is_active=1 WHERE id=900002"), /Cannot orphan positive branch stock/)
  assert.deepEqual(snapshot(db), before)
  assert.deepEqual(db.prepare(INVARIANT).all(), [])
  db.close()
})
check('INSERT, INSERT OR IGNORE on an existing lot and an upsert still work; a new lot adds no orphan check', () => {
  const db = fixture(true)
  write(db, "INSERT INTO product_batches(variant_product_id,batch_key,is_active) VALUES(900001,'new-receipt',1)")
  const ignored = write(db, () => db.prepare("INSERT OR IGNORE INTO product_batches(variant_product_id,batch_key,is_active) VALUES(900001,'original-receipt',1)").run())
  assert.equal(ignored.changes, 0)
  write(db, "INSERT INTO product_batches(variant_product_id,batch_key,is_active,notes) VALUES(900001,'original-receipt',1,'Upserted') ON CONFLICT(variant_product_id,batch_key) DO UPDATE SET notes=excluded.notes")
  assert.equal(db.prepare('SELECT notes FROM product_batches WHERE id=900001').get().notes, 'Upserted')
  assert.deepEqual(db.prepare(INVARIANT).all(), [])
  db.close()
})
check('applying twice is harmless (IF EXISTS), and it applies to an empty chain', () => {
  const db = fixture(true)
  db.exec(sql)
  assert.deepEqual(names(db, 'trigger'), KEPT_TRIGGERS)
  db.close()
  const fresh = new Database(schema)
  fresh.exec(sql)
  assert.deepEqual(names(fresh, 'trigger'), KEPT_TRIGGERS)
  fresh.close()
})
console.log(`${passed} migration 0320 checks passed`)

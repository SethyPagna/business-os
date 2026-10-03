'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.resolve(__dirname, '../..')
const queryPath = path.join(root, 'ops/queries/branch-cutover-inventory.sql')

async function main() {
  const { guardSql } = await import(pathToFileURL(path.join(root, 'ops/scripts/ops-sql-guard.mjs')))
  const source = fs.readFileSync(queryPath, 'utf8')
  const { sql, rules } = guardSql(source)
  const lfSource = source.replace(/\r\n/g, '\n')
  assert.deepEqual(guardSql(lfSource), guardSql(lfSource.replace(/\n/g, '\r\n')))
  assert.equal(rules.minRows, 0)
  assert.equal(rules.maxRows, null)
  const migrated = openDb(loadAll())
  assert.equal(migrated.db.limits.exprDepth, 100)
  migrated.db.prepare(sql).all()
  migrated.db.close()

  const fixture = openDb([`
    CREATE TABLE branches(id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER, is_default INTEGER);
    CREATE TABLE branch_stock(product_id INTEGER, branch_id INTEGER, quantity REAL);
    CREATE TABLE product_batches(id INTEGER PRIMARY KEY, variant_product_id INTEGER, received_at TEXT);
    CREATE TABLE branch_batch_stock(batch_id INTEGER, branch_id INTEGER, quantity REAL);
    CREATE TABLE damaged_stock_lots(branch_id INTEGER, quantity_remaining REAL);
    CREATE TABLE rfid_tags(branch_id INTEGER, status TEXT);
    CREATE TABLE shift_sessions(branch_id INTEGER, closed_at TEXT, cancelled_at TEXT);
    CREATE TABLE stock_transfers(from_branch_id INTEGER, to_branch_id INTEGER);
    CREATE TABLE stock_session_members(branch_id INTEGER);
    INSERT INTO branches VALUES(41,'Shop',1,0),(73,'Warehouse',1,1),(91,'Historical',0,0);
    INSERT INTO branch_stock VALUES(101,41,5.5),(102,41,1),(101,73,4),(103,91,0),(999,999,2);
    INSERT INTO product_batches VALUES(201,101,'2026-08-01 03:00:00'),(202,101,'2026-08-01 03:00:00'),(203,102,NULL),(204,104,'2026-09-02 00:00:00');
    INSERT INTO branch_batch_stock VALUES(201,41,2),(202,41,0.5),(203,41,2),(204,41,1),(201,73,3),(999,41,0.25),(201,999,0.2);
    INSERT INTO damaged_stock_lots VALUES(41,0.5),(41,0),(73,1);
    INSERT INTO rfid_tags VALUES(41,'active'),(41,'sold'),(73,'active');
    INSERT INTO shift_sessions VALUES(41,NULL,NULL),(41,'closed',NULL),(73,NULL,'cancelled');
    INSERT INTO stock_transfers VALUES(41,73),(73,41);
    INSERT INTO stock_session_members VALUES(41),(41),(73);
  `])
  const before = fixture.db.prepare('SELECT total_changes() AS changes').get().changes
  const rows = fixture.db.prepare(sql).all()
  assert.deepEqual(rows.map(row => row.branch_id), [41,73,91])
  const shop = rows[0]
  assert.equal(shop.name, 'Shop')
  assert.equal(shop.stock_rows, 2)
  assert.equal(shop.positive_products, 2)
  assert.equal(shop.stock_quantity, 6.5)
  assert.equal(shop.fractional_stock_rows, 1)
  assert.equal(shop.positive_lot_rows, 5)
  assert.equal(shop.lot_quantity, 5.75)
  assert.equal(shop.positive_untracked_quantity, 3)
  assert.equal(shop.lots_exceed_stock_pairs, 2)
  assert.equal(shop.missing_batch_rows, 1)
  assert.equal(shop.positive_shared_batch_rows, 1)
  assert.equal(shop.unknown_received_date_rows, 2)
  assert.equal(shop.first_received_at, '2026-08-01 03:00:00')
  assert.equal(shop.last_received_at, '2026-09-02 00:00:00')
  assert.equal(shop.damaged_remaining, 0.5)
  assert.equal(shop.active_rfid_tags, 1)
  assert.equal(shop.open_shifts, 1)
  assert.equal(shop.transfer_rows, 2)
  assert.equal(shop.stock_session_members, 2)
  assert.equal(shop.orphan_branch_stock_rows, 1)
  assert.equal(shop.orphan_branch_lot_rows, 1)
  assert.equal(rows[1].positive_untracked_quantity, 1)
  assert.equal(rows[1].open_shifts, 0)
  assert.equal(rows[2].stock_quantity, 0)
  assert.equal(rows[2].positive_lot_rows, 0)
  assert.equal(rows[2].is_active, 0)
  assert.equal(fixture.db.prepare('SELECT total_changes() AS changes').get().changes, before)
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS n FROM product_batches WHERE received_at=?').get('2026-08-01 03:00:00').n, 2)
  const missingPairControl = sql.replace('UNION SELECT product_id, branch_id FROM lots', '')
  assert.equal(fixture.db.prepare(missingPairControl).all()[0].lots_exceed_stock_pairs, 1)
  const cancelledControl = sql.replace('AND s.cancelled_at IS NULL', '')
  assert.equal(fixture.db.prepare(cancelledControl).all()[1].open_shifts, 1)
  fixture.db.close()
  console.log('PASS branch cutover inventory query: migrated depth100, fixture assertions, 2 discriminating controls, no writes')
}

main().catch(error => { console.error(error); process.exitCode = 1 })

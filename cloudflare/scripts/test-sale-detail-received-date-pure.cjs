const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

// Execute the exact item read used by GET /sales, which supplies both the
// list and SaleDetailModal (including refreshes after amendments).
const source = fs.readFileSync(path.join(__dirname, '../src/routes/sales.ts'), 'utf8')
const marker = 'const itemRows = await selectInChunks(saleIds'
const begin = source.indexOf('`', source.indexOf(marker)) + 1
const end = source.indexOf('`).all<', begin)
assert.ok(begin > 0 && end > begin)
const query = source.slice(begin, end).replace("${chunk.map(() => '?').join(',')}", '?')
assert.match(query, /AS batch_received_at/)
const db = new Database(':memory:')
for (const migration of loadAll()) db.exec(migration)
db.exec(`
  INSERT INTO branches(id,name) VALUES(1,'Shop');
  INSERT INTO products(id,name) VALUES(1,'A'),(2,'B');
  INSERT INTO sales(id,branch_id) VALUES(1,1);
  INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,is_active) VALUES
    (11,1,'original','2025-02-03',0),(12,1,'other','2026-08-09',1),(13,2,'foreign','2026-09-10',1);
  INSERT INTO sale_items(id,sale_id,product_id,quantity,batch_id) VALUES
    (1,1,1,2,11),(2,1,1,2,NULL),(3,1,1,2,NULL),(4,1,1,2,NULL),(5,1,1,2,NULL),(6,1,1,2,13);
  INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,quantity,released_quantity) VALUES
    (2,11,2,0),(3,11,1,0),(3,12,1,0),(4,11,1,0),(5,11,2,2);
`)
const rows = db.prepare(query).all(1)
assert.equal(rows.length, 6, 'lot joins never multiply sale lines')
const byId = new Map(rows.map((row) => [row.id, row]))
assert.equal(byId.get(1).batch_received_at, '2025-02-03', 'explicit historical/inactive lot retains its received date')
assert.equal(byId.get(2).batch_received_at, '2025-02-03', 'one fully allocated lot resolves even when line.batch_id is null')
assert.equal(byId.get(3).batch_received_at, null, 'two lots are never collapsed to an arbitrary date')
assert.equal(byId.get(3).lot_allocation_count, 2)
assert.equal(byId.get(4).batch_received_at, null, 'partial known provenance cannot label the whole line')
assert.equal(byId.get(5).batch_received_at, '2025-02-03', 'released allocation retains historical provenance')
assert.equal(byId.get(5).lot_allocation_count, 0, 'existing outstanding-allocation count is unchanged')
assert.equal(byId.get(6).batch_received_at, null, 'a foreign-product lot cannot supply a received date')
assert.equal(rows.reduce((sum, row) => sum + row.quantity, 0), 12)
console.log('PASS Sales detail received dates: explicit, single-allocation, multi-lot, incomplete, released, foreign-product and row-count parity')

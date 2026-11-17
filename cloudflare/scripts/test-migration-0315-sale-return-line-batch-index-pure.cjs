'use strict'
// Pins migration 0315 (idx_sale_items_batch_id_partial, idx_return_items_batch_id_partial) on the REAL migration chain:
//   - the file is LF-only, numbered 0315 once, keeps rowid, carries PRE / POST / RECOVERY, is exactly one PRE check and two single-line CREATE INDEX statements,
//     and a second run aborts on its PRE check;
//   - it adds exactly the two indexes, changes no row, and each index is PARTIAL on batch_id IS NOT NULL and holds ONLY the lot-bearing rows (count pinned: a copy
//     of the migration without its WHERE clause indexes every row and fails here);
//   - PLAN: every sale_items / return_items read and re-point of the product merge fold (the planner's reads and mergeFoldStatements(), compiled from the source)
//     SEARCHes the new index, never SCANs the line table; before the migration the same statements SCAN (the control that proves the index is what changed);
//   - EXACT: the fold's statements move every line naming a folded lot whatever product the line carries (the discarded product's, the keeper's, a third product's),
//     with and without the indexes (identical rows);
//   - UNDO: the reversal's line statements are keyed by the saved row ids (a rowid SEARCH) and carry no batch_id scan.
//
// Run (from cloudflare/): node scripts/test-migration-0315-sale-return-line-batch-index-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

const directory = path.join(__dirname, '../migrations')
const migration = '0315_sale_return_line_batch_index.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const files = fs.readdirSync(directory).filter((f) => f.endsWith('.sql') && f < migration).sort()
const chain = (withMigration, text = sql) => {
  const db = new DatabaseSync(':memory:')
  for (const f of files) db.exec(fs.readFileSync(path.join(directory, f), 'utf8'))
  if (withMigration) db.exec(text)
  return db
}
const objects = (db) => db.prepare("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_autoindex%' ORDER BY name").all().map((r) => `${r.type}:${r.name}`)
let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }

const INDEXES = ['idx_return_items_batch_id_partial', 'idx_sale_items_batch_id_partial']

check('the file is LF-only, numbered 0315 once, keeps rowid, and carries PRE / POST / RECOVERY notes', () => {
  assert.equal(sql.includes('\r'), false)
  assert.equal(/WITHOUT\s+ROWID/i.test(sql.replace(/^--.*$/gm, '')), false)
  assert.match(sql, /^-- PRE:/m); assert.match(sql, /^-- POST:/m); assert.match(sql, /^-- RECOVERY:/m)
  assert.match(sql, /NEVER|generic \(no client data\)/)
  assert.deepEqual(fs.readdirSync(directory).filter((f) => f.startsWith('0315_')), [migration])
  assert.equal(/\bANALYZE\b|PRAGMA\s+optimize/i.test(sql.replace(/^--.*$/gm, '')), false, 'no ANALYZE / PRAGMA optimize on production')
})

check('it is one PRE check and two single-line partial CREATE INDEX statements, as the D1 runner will split them', () => {
  const statements = sql.replace(/^--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean)
  assert.equal(statements.length, 3)
  assert.match(statements[0], /^SELECT CASE WHEN/)
  assert.equal(statements[1], 'CREATE INDEX idx_sale_items_batch_id_partial ON sale_items (batch_id) WHERE batch_id IS NOT NULL')
  assert.equal(statements[2], 'CREATE INDEX idx_return_items_batch_id_partial ON return_items (batch_id) WHERE batch_id IS NOT NULL')
})

// A world: lines with and without a lot, on the discarded product 2, the keeper 1 and a third product 3.
const seed = (db) => {
  for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name IN ('sale_items','return_items','sale_item_batch_allocations','return_item_batch_allocations','sales','returns','product_batches','branch_batch_stock','products')").all()) db.exec(`DROP TRIGGER "${t.name}"`)
  db.exec("INSERT INTO products(id,name,is_active) VALUES(1,'Keeper',1),(2,'Twin',1),(3,'Third',1)")
  db.exec("INSERT INTO sales(id,receipt_number) VALUES(1,'S1')")
  db.exec("INSERT INTO returns(id,return_number,sale_id) VALUES(1,'R1',1)")
  db.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,lot_code,received_at,is_active) VALUES(101,2,'D1',1,'D1','2026-01-01',1),(102,2,'D2',2,'D2','2026-01-02',1),(201,1,'D1',1,'D1','2026-01-01',1),(202,1,'D2',2,'D2','2026-01-02',1),(301,3,'T1',1,'T1','2026-01-03',1)")
  const sale = db.prepare('INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,batch_id) VALUES(?,1,?,?,1,?)')
  const ret = db.prepare('INSERT INTO return_items(id,return_id,product_id,product_name,quantity,batch_id) VALUES(?,1,?,?,1,?)')
  // 1..3 the discarded product on its lots, 4 a keeper line naming a duplicate lot (the review's A2 shape), 5 a third product's line naming one,
  // 6..7 lines on lots that are NOT folded, 8..60 lines with no lot at all.
  sale.run(1, 2, 'Twin', 101); sale.run(2, 2, 'Twin', 101); sale.run(3, 2, 'Twin', 102)
  sale.run(4, 1, 'Keeper', 101); sale.run(5, 3, 'Third', 102)
  sale.run(6, 3, 'Third', 301); sale.run(7, 1, 'Keeper', 202)
  for (let i = 8; i <= 60; i++) sale.run(i, 1 + (i % 3), 'x', null)
  ret.run(1, 2, 'Twin', 101); ret.run(2, 1, 'Keeper', 102); ret.run(3, 3, 'Third', 101); ret.run(4, 3, 'Third', 301)
  for (let i = 5; i <= 40; i++) ret.run(i, 1, 'x', null)
}

const before = chain(false); seed(before)
const rowsBefore = (db) => JSON.stringify(['sale_items', 'return_items'].map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()))
check('it applies on a fresh chain, adds exactly the two indexes, changes no row, and a second run aborts on its PRE check', () => {
  const db = chain(false); seed(db)
  const objs = objects(db), rows = rowsBefore(db)
  db.exec(sql)
  assert.deepEqual(objects(db).filter((o) => !objs.includes(o)), INDEXES.map((n) => `index:${n}`))
  assert.equal(rowsBefore(db), rows)
  assert.throws(() => db.exec(sql), /bad JSON path|already exists/i)
})

const after = chain(true); seed(after)
check('each index is PARTIAL on batch_id IS NOT NULL and holds only the lot-bearing rows', () => {
  const stored = (name) => after.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(name).sql
  assert.equal(stored('idx_sale_items_batch_id_partial'), 'CREATE INDEX idx_sale_items_batch_id_partial ON sale_items (batch_id) WHERE batch_id IS NOT NULL')
  assert.equal(stored('idx_return_items_batch_id_partial'), 'CREATE INDEX idx_return_items_batch_id_partial ON return_items (batch_id) WHERE batch_id IS NOT NULL')
  const cols = (name) => after.prepare(`SELECT name FROM pragma_index_info('${name}') ORDER BY seqno`).all().map((r) => r.name).join(',')
  assert.equal(cols('idx_sale_items_batch_id_partial'), 'batch_id'); assert.equal(cols('idx_return_items_batch_id_partial'), 'batch_id')
  // A COVERING read of the whole index (the planner may scan a covering partial index for an IS NOT NULL read) returns one entry per lot-bearing row, not per row.
  const entries = (table, index) => after.prepare(`SELECT COUNT(*) n FROM ${table} INDEXED BY ${index} WHERE batch_id IS NOT NULL`).get().n
  assert.equal(entries('sale_items', 'idx_sale_items_batch_id_partial'), 7, '7 of 60 sale lines name a lot')
  assert.equal(entries('return_items', 'idx_return_items_batch_id_partial'), 4, '4 of 40 return lines name a lot')
  // Positive control: the same index WITHOUT its WHERE clause would hold every row.
  const wide = chain(false); seed(wide)
  wide.exec('CREATE INDEX wide ON sale_items (batch_id)')
  assert.equal(wide.prepare('SELECT COUNT(*) n FROM sale_items INDEXED BY wide').get().n, 60, 'control: an unfiltered index holds all 60 rows')
})

// ---- the statements the fold really emits, compiled from the route and lib sources ------------------------------------------------------------------------
const h = createProductsRouteHarness()
const { mergeFoldStatements } = h.load('routes/products.ts')
const { planProductMergeDependentLotSnapshots } = h.load('lib/productMergeSnapshot.ts')
const { mergeFoldReversalStatements } = h.load('lib/undoAppliers.ts')
const positional = (text, params) => { const values = []; const out = text.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_m, name) => { values.push(params[name]); return `?${values.length}` }); return { text: out, values } }
const planOf = (db, statement) => { const { text, values } = positional(statement.sql, statement.params); return db.prepare(`EXPLAIN QUERY PLAN ${text}`).all(...values).map((r) => r.detail).join(' | ') }
const lotRow = (id, key) => ({ id, batch_key: key, batch_number: 1, received_at: '2026-01-01', expiry_date: null, unit_cost_usd: 1, is_active: 1 })
const snapshot = {
  canonicalBatchRows: [lotRow(201, 'D1'), lotRow(202, 'D2')], duplicateBatchRows: [lotRow(101, 'D1'), lotRow(102, 'D2')],
  duplicateProduct: { id: 2, name: 'Twin', barcode: null, is_active: 1, updated_at: null },
}
const reads = planProductMergeDependentLotSnapshots(snapshot, 'merge').reads
const lineReads = reads.filter((r) => r.key === 'saleAllocations' || r.key === 'returnAllocations')
const fold = mergeFoldStatements([{ dup: 101, target: 201 }, { dup: 102, target: 202 }], [], [])
const lineUpdates = fold.filter((s) => /^UPDATE (sale_items|return_items) /.test(s.sql))

check('the planner reads and fold re-points on sale_items / return_items SEARCH the partial indexes and never SCAN the line tables', () => {
  assert.equal(lineReads.length, 2); assert.equal(lineUpdates.length, 2)
  for (const s of [...lineReads, ...lineUpdates]) {
    const p = planOf(after, s)
    assert.match(p, /SEARCH (sale_items|return_items) USING (COVERING )?INDEX idx_(sale|return)_items_batch_id_partial \(batch_id=\?\)/, p)
    assert.doesNotMatch(p, /SCAN (sale_items|return_items)\b/, p)
  }
  // Both tables, each by its own index.
  assert.match(planOf(after, lineReads[0]), /sale_items USING (COVERING )?INDEX idx_sale_items_batch_id_partial/)
  assert.match(planOf(after, lineReads[1]), /return_items USING (COVERING )?INDEX idx_return_items_batch_id_partial/)
  assert.match(planOf(after, lineUpdates[0]), /sale_items USING (COVERING )?INDEX idx_sale_items_batch_id_partial/)
  assert.match(planOf(after, lineUpdates[1]), /return_items USING (COVERING )?INDEX idx_return_items_batch_id_partial/)
})

check('CONTROL: before the migration the same statements SCAN the line tables', () => {
  for (const s of [...lineReads, ...lineUpdates]) assert.match(planOf(before, s), /SCAN (sale_items|return_items)\b/)
})

check('the undo reversal moves lines by their saved row ids (a rowid SEARCH) and scans neither line table', () => {
  const reversal = mergeFoldReversalStatements([{ dupBatchId: 101, keeperBatchId: 201, saleAllocationIds: [], returnAllocationIds: [], saleItemIds: [1, 2], returnItemIds: [1], sourceWasActive: true }])
  const lines = reversal.filter((s) => /^UPDATE (sale_items|return_items) /.test(s.sql))
  assert.equal(lines.length, 2)
  for (const s of lines) { const p = planOf(after, s); assert.match(p, /SEARCH (sale_items|return_items) USING INTEGER PRIMARY KEY \(rowid=\?\)/, p); assert.doesNotMatch(p, /SCAN (sale_items|return_items)\b/, p) }
})

// ---- exactness: every line naming a folded lot moves, whatever product it carries; identical with and without the indexes ---------------------------------
const run = (db) => {
  for (const s of fold.filter((x) => /^UPDATE (sale_items|return_items|sale_item_batch_allocations|return_item_batch_allocations) /.test(x.sql))) {
    const { text, values } = positional(s.sql, s.params)
    db.prepare(text).run(...values)
  }
  return {
    sale: db.prepare('SELECT id, product_id, batch_id FROM sale_items WHERE batch_id IS NOT NULL ORDER BY id').all().map((r) => ({ ...r })),
    ret: db.prepare('SELECT id, product_id, batch_id FROM return_items WHERE batch_id IS NOT NULL ORDER BY id').all().map((r) => ({ ...r })),
  }
}
check('the fold moves a keeper line and a third product\'s line naming a folded lot too (not only the discarded product\'s), with and without the indexes', () => {
  const withIndexes = run(after)
  const without = chain(false); seed(without)
  assert.deepEqual(run(without), withIndexes, 'the indexes change no result')
  assert.deepEqual(withIndexes.sale, [
    { id: 1, product_id: 2, batch_id: 201 }, { id: 2, product_id: 2, batch_id: 201 }, { id: 3, product_id: 2, batch_id: 202 },
    { id: 4, product_id: 1, batch_id: 201 }, // the keeper's line naming the duplicate's lot (review r5 probe A2): points at the kept lot, as in round 4
    { id: 5, product_id: 3, batch_id: 202 }, // a third product's line naming the lot
    { id: 6, product_id: 3, batch_id: 301 }, { id: 7, product_id: 1, batch_id: 202 },
  ])
  assert.deepEqual(withIndexes.ret, [
    { id: 1, product_id: 2, batch_id: 201 }, { id: 2, product_id: 1, batch_id: 202 }, { id: 3, product_id: 3, batch_id: 201 }, { id: 4, product_id: 3, batch_id: 301 },
  ])
  // Double apply: a second run moves nothing more (the discarded lots no longer appear on any line).
  assert.deepEqual(run(after), withIndexes)
})

console.log(`test-migration-0315-sale-return-line-batch-index-pure: ${passed} check(s) passed`)

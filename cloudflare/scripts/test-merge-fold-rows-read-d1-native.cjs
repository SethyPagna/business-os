'use strict'
// Rows READ by one product merge's lot fold on workerd's real D1 (Miniflare), on a production-sized history: 40,000 sale_items,
// 40,000 sale allocations, 3,000 return_items, 3,000 return allocations. Cloudflare Free bills every row the engine reads, and sale_items,
// return_items and return_item_batch_allocations have NO index on batch_id. Rounds 2 to 4 selected a lot's sale lines by batch_id alone, a full
// scan of sale_items twice per merge: 92,421 rows read for 5 folded lots, against 30,080 for base 1ae9f2041 (per-lot allocation reads). The fix
// selects the sale lines through idx_sale_items_product_branch_sale_pg (product_id first), in the planner's line read and in mergeFoldStatements().
//
// This pins the rows read of the REAL statements (the production planner's reads plus the fold's four re-points) at 1, 5 and 30 folded lots,
// against (a) base's per-lot statements measured on the same world and (b) the literal 30,080; includes the old batch_id-only statements as a
// positive control that must exceed the pin; shows the index in EXPLAIN QUERY PLAN; and checks the product-filtered fold moves exactly the sale
// lines the old fold moved and leaves another product's lines alone.
// Run (from cloudflare/): node scripts/test-merge-fold-rows-read-d1-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { Miniflare } = require('miniflare')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

function migrationStatements(source) {
  const statements = []
  let buffer = []
  let trigger = false
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/\s+--.*$/, '').trim()
    if (!line || line.startsWith('--')) continue
    if (!buffer.length) trigger = /^CREATE\s+TRIGGER\b/i.test(line)
    buffer.push(line)
    if ((trigger && /^END;$/i.test(line)) || (!trigger && /;$/.test(line))) { statements.push(buffer.join(' ')); buffer = []; trigger = false }
  }
  if (buffer.length) statements.push(buffer.join(' '))
  return statements
}

// The reviewer measured base at 30,080 rows read for 5 folded lots on this world (dominated by 5 x 2 scans of the 3,000 return allocations).
const BASE_ROWS_READ_5_LOTS = 30080
const SALE_ITEMS = 40000
const RETURN_ITEMS = 3000
const PRODUCTS = 500
const DUP = 2
const SALE_LINES_PER_LOT = 40
const RETURN_LINES_PER_LOT = 4

async function main() {
  const h = createProductsRouteHarness()
  const { mergeFoldStatements } = h.load('routes/products.ts')
  const { planProductMergeDependentLotSnapshots } = h.load('lib/productMergeSnapshot.ts')
  const { D1Compat } = h.load('lib/db.ts')
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', compatibilityDate: '2026-08-01', d1Databases: ['DB'] })
  try {
    const native = await mf.getD1Database('DB')
    const migrationDir = path.join(__dirname, '..', 'migrations')
    for (const file of fs.readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort()) {
      for (const sql of migrationStatements(fs.readFileSync(path.join(migrationDir, file), 'utf8'))) {
        try { await native.prepare(sql).run() } catch (error) {
          if (/too many terms in compound SELECT/i.test(String(error)) && /^INSERT\b/i.test(sql)) continue
          throw new Error(`${file}: ${sql.slice(0, 160)} :: ${error}`)
        }
      }
    }
    // Seed on a scratch in-memory database: triggers are dropped for the bulk inserts only.
    for (const t of (await native.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name IN ('sale_items','return_items','sale_item_batch_allocations','return_item_batch_allocations','sales','returns','product_batches','branch_batch_stock','products')").all()).results) {
      await native.prepare(`DROP TRIGGER "${t.name}"`).run()
    }
    await native.batch([
      native.prepare("INSERT INTO products(id,name,is_active) VALUES(1,'Keeper',1),(2,'Twin',1)"),
      native.prepare("INSERT INTO sales(id,receipt_number) VALUES(1,'S1')"),
      native.prepare("INSERT INTO returns(id,return_number,sale_id) VALUES(1,'R1',1)"),
    ])
    // The discarded product 2 owns lots 100001..100030, the keeper owns 200001..200030. Each discarded lot carries 40 sale lines and 4 return lines
    // of product 2; the rest of the history is spread over other products and lots, as production's is.
    await native.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<30) INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,lot_code,received_at,is_active) SELECT 100000+i,2,'D'||i,i,'D'||i,'2026-01-01',1 FROM n").run()
    await native.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<30) INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,lot_code,received_at,is_active) SELECT 200000+i,1,'K'||i,i,'K'||i,'2026-01-01',1 FROM n").run()
    const dupSale = 30 * SALE_LINES_PER_LOT
    const dupReturn = 30 * RETURN_LINES_PER_LOT
    await native.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${dupSale}) INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,batch_id) SELECT i,1,2,'Twin',1,100001+(i%30) FROM n`).run()
    await native.prepare(`WITH RECURSIVE n(i) AS (SELECT ${dupSale + 1} UNION ALL SELECT i+1 FROM n WHERE i<${SALE_ITEMS}) INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,batch_id) SELECT i,1,3+(i%${PRODUCTS - 2}),'x',1,500000+(i%9000) FROM n`).run()
    await native.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${SALE_ITEMS}) INSERT INTO sale_item_batch_allocations(id,sale_item_id,batch_id,branch_id,quantity) SELECT i,i,(SELECT batch_id FROM sale_items WHERE id=i),1,1 FROM n`).run()
    await native.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${dupReturn}) INSERT INTO return_items(id,return_id,product_id,product_name,quantity,batch_id) SELECT i,1,2,'Twin',1,100001+(i%30) FROM n`).run()
    await native.prepare(`WITH RECURSIVE n(i) AS (SELECT ${dupReturn + 1} UNION ALL SELECT i+1 FROM n WHERE i<${RETURN_ITEMS}) INSERT INTO return_items(id,return_id,product_id,product_name,quantity,batch_id) SELECT i,1,3+(i%${PRODUCTS - 2}),'x',1,500000+(i%9000) FROM n`).run()
    await native.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${RETURN_ITEMS}) INSERT INTO return_item_batch_allocations(id,return_item_id,batch_id,branch_id,quantity) SELECT i,i,(SELECT batch_id FROM return_items WHERE id=i),1,1 FROM n`).run()
    const counts = (await native.prepare('SELECT (SELECT COUNT(*) FROM sale_items) si,(SELECT COUNT(*) FROM sale_item_batch_allocations) sa,(SELECT COUNT(*) FROM return_items) ri,(SELECT COUNT(*) FROM return_item_batch_allocations) ra').all()).results[0]
    assert.deepEqual({ ...counts }, { si: SALE_ITEMS, sa: SALE_ITEMS, ri: RETURN_ITEMS, ra: RETURN_ITEMS })
    // One line of ANOTHER product on a discarded lot is not the discarded product's: the product-filtered fold must leave it (see the end).
    const lotsOfDup = Array.from({ length: 30 }, (_, i) => 100001 + i)

    const positional = (sql, params) => {
      const values = []
      const text = sql.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_m, name) => { values.push(params[name]); return `?${values.length}` })
      return { text, values }
    }
    const rowsRead = async (sql, params = {}) => {
      const { text, values } = positional(sql, params)
      return (await native.prepare(text).bind(...values).run()).meta.rows_read
    }
    const planOf = async (sql, params = {}) => {
      const { text, values } = positional(sql, params)
      return (await native.prepare('EXPLAIN QUERY PLAN ' + text).bind(...values).all()).results.map((row) => row.detail).join(' | ')
    }
    const lotRow = (id, key) => ({ id, batch_key: key, batch_number: 1, received_at: '2026-01-01', expiry_date: null, unit_cost_usd: 1, is_active: 1 })
    const snapshotOf = (lots) => ({
      canonicalBatchRows: Array.from({ length: lots }, (_, i) => lotRow(200001 + i, 'D' + (i + 1))),
      duplicateBatchRows: lotsOfDup.slice(0, lots).map((id, i) => lotRow(id, 'D' + (i + 1))),
      duplicateProduct: { id: DUP, name: 'Twin', barcode: null, is_active: 1, updated_at: null },
    })
    const UPDATE_LINES = /^UPDATE (sale_items|return_items|sale_item_batch_allocations|return_item_batch_allocations) /
    const measure = async (lots) => {
      const plan = planProductMergeDependentLotSnapshots(snapshotOf(lots), 'merge')
      assert.deepEqual(plan.reads.map((r) => r.key), ['lotStock', 'saleAllocations', 'returnAllocations'])
      let read = 0
      for (const r of plan.reads) read += await rowsRead(r.sql, r.params)
      // target = the lot itself: the re-point reads exactly the same rows and changes none, so every measurement sees the same world.
      const fold = mergeFoldStatements(lotsOfDup.slice(0, lots).map((dup) => ({ dup, target: dup })), [], [], DUP)
      let write = 0
      for (const s of fold) if (UPDATE_LINES.test(s.sql)) write += await rowsRead(s.sql, s.params)
      return { read, write, total: read + write }
    }
    // base 1ae9f2041: per folded lot, the two allocation reads and the two allocation re-points (no line statements at all).
    const baseRows = async (lots) => {
      let total = 0
      for (const id of lotsOfDup.slice(0, lots)) {
        total += await rowsRead('SELECT id FROM sale_item_batch_allocations WHERE batch_id = @id', { id })
        total += await rowsRead('SELECT id FROM return_item_batch_allocations WHERE batch_id = @id', { id })
        total += await rowsRead('UPDATE sale_item_batch_allocations SET batch_id = batch_id WHERE batch_id = @id', { id })
        total += await rowsRead('UPDATE return_item_batch_allocations SET batch_id = batch_id WHERE batch_id = @id', { id })
      }
      return total
    }
    // The round 2 to 4 statements: sale_items and return_items by batch_id alone, read and re-point.
    const oldRows = async (lots) => {
      const ids = JSON.stringify(lotsOfDup.slice(0, lots))
      const dupList = JSON.stringify(lotsOfDup.slice(0, lots).map((dup) => ({ dup, target: dup })))
      let total = 0
      total += await rowsRead("SELECT 'line' AS kind, batch_id, id FROM sale_items WHERE batch_id IN (SELECT value FROM json_each(@ids))", { ids })
      total += await rowsRead("SELECT 'line' AS kind, batch_id, id FROM return_items WHERE batch_id IN (SELECT value FROM json_each(@ids))", { ids })
      total += await rowsRead("UPDATE sale_items SET batch_id = (SELECT CAST(json_extract(f.value, '$.target') AS INTEGER) FROM json_each(@fold) f WHERE CAST(json_extract(f.value, '$.dup') AS INTEGER) = batch_id) WHERE batch_id IN (SELECT CAST(json_extract(value, '$.dup') AS INTEGER) FROM json_each(@fold))", { fold: dupList })
      return total
    }

    const table = []
    for (const lots of [1, 5, 30]) {
      const now = await measure(lots)
      table.push({ lots, base: await baseRows(lots), now: now.total, read: now.read, fold: now.write })
    }
    console.log('rows read per merge (planner reads + fold re-points):')
    for (const row of table) console.log(`  ${String(row.lots).padStart(2)} lots: now ${row.now} (reads ${row.read}, fold ${row.fold}); base per-lot statements ${row.base}`)
    const oldSale5 = await oldRows(5)
    console.log(`  old batch_id-only sale_items/return_items statements alone, 5 lots: ${oldSale5}`)

    // The pin. Per lot count, with honest headroom over the measured figure (14,763 / 17,075 / 63,425 when this was written):
    //  - 5 lots (the reviewer's case): no more than base's 30,080, and no more than the measured base on this world.
    //  - 30 lots: no more than the measured base (base scans the 3,000 return allocations once per lot, so it grows with the lot count; this does not).
    //  - 1 lot: base reads 6,162 here and this reads more: the two return tables have no index on batch_id and no exact indexed route exists for
    //    them (a return line has no product-first index, and not every return line has an allocation row), so return_items is read once and
    //    re-pointed once, 2 x 3,000 rows, on top of base's 2 x 3,000 allocation passes. That fixed cost is the pin's 1-lot ceiling.
    const byLots = new Map(table.map((row) => [row.lots, row]))
    const five = byLots.get(5), thirty = byLots.get(30), one = byLots.get(1)
    assert.ok(five.now <= 20000 && five.now <= BASE_ROWS_READ_5_LOTS && five.now <= five.base, `5 lots read ${five.now}, base reads ${five.base}`)
    assert.ok(thirty.now <= 70000 && thirty.now <= thirty.base, `30 lots read ${thirty.now}, base reads ${thirty.base}`)
    assert.ok(one.now <= 16500, `1 lot read ${one.now}`)
    // sale_items is not scanned at 1 and 5 lots: those totals are below ONE pass over its 40,000 rows, which the old statements made twice.
    for (const row of [one, five]) assert.ok(row.now < SALE_ITEMS, `${row.lots} lots: ${row.now} rows read is a full pass over sale_items`)
    // Positive control: the old statements exceed the pin (two full passes over sale_items alone), so the pin can fail.
    assert.ok(oldSale5 > BASE_ROWS_READ_5_LOTS, `positive control: the batch_id-only statements read ${oldSale5}, they must exceed ${BASE_ROWS_READ_5_LOTS}`)
    assert.ok(oldSale5 >= 2 * SALE_ITEMS, 'positive control: at least two full passes over sale_items')

    // EXPLAIN QUERY PLAN for each changed sale_items statement: an index SEARCH on the product-first index, never a SCAN of sale_items.
    const plan1 = planProductMergeDependentLotSnapshots(snapshotOf(1), 'merge')
    const saleRead = plan1.reads.find((r) => r.key === 'saleAllocations')
    const readPlan = await planOf(saleRead.sql, saleRead.params)
    const foldSale = mergeFoldStatements([{ dup: 100001, target: 200001 }], [], [], DUP).find((s) => /^UPDATE sale_items /.test(s.sql))
    const foldPlan = await planOf(foldSale.sql, foldSale.params)
    console.log('EXPLAIN planner saleAllocations read:', readPlan)
    console.log('EXPLAIN fold UPDATE sale_items      :', foldPlan)
    for (const text of [readPlan, foldPlan]) {
      assert.match(text, /SEARCH sale_items USING (COVERING )?INDEX idx_sale_items_product_branch_sale_pg \(product_id=\?\)/, text)
      assert.doesNotMatch(text, /SCAN sale_items/, text)
    }
    assert.match(await planOf('SELECT id FROM sale_items WHERE batch_id IN (SELECT value FROM json_each(@ids))', { ids: '[1]' }), /SCAN sale_items/, 'positive control: the batch_id-only read scans sale_items')

    // The filtered fold moves exactly the sale lines the old fold moved on this world, and not another product's line on the same lot.
    const fiveLots = lotsOfDup.slice(0, 5)
    await native.prepare("INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,batch_id) VALUES(900001,1,7,'other',1,?)").bind(fiveLots[0]).run()
    const expected = (await native.prepare(`SELECT id FROM sale_items WHERE batch_id IN (${fiveLots.join(',')}) AND product_id = 2 ORDER BY id`).all()).results.map((r) => r.id)
    const expectedReturns = (await native.prepare(`SELECT id FROM return_items WHERE batch_id IN (${fiveLots.join(',')}) ORDER BY id`).all()).results.map((r) => r.id)
    assert.equal(expected.length, 5 * SALE_LINES_PER_LOT)
    const fold5 = mergeFoldStatements(fiveLots.map((dup, i) => ({ dup, target: 200001 + i })), [], [], DUP)
    await new D1Compat(native).batch(fold5.filter((s) => /^UPDATE (sale_items|return_items) /.test(s.sql)))
    const moved = (await native.prepare('SELECT id FROM sale_items WHERE batch_id BETWEEN 200001 AND 200005 ORDER BY id').all()).results.map((r) => r.id)
    const movedReturns = (await native.prepare('SELECT id FROM return_items WHERE batch_id BETWEEN 200001 AND 200005 ORDER BY id').all()).results.map((r) => r.id)
    assert.deepEqual(moved, expected, 'the product-filtered fold re-points every sale line of the discarded product on the folded lots')
    assert.deepEqual(movedReturns, expectedReturns, 'return lines are re-pointed with no product filter')
    assert.equal((await native.prepare('SELECT batch_id FROM sale_items WHERE id=900001').all()).results[0].batch_id, fiveLots[0], 'a line of another product is not this fold\'s')
    // Filtering by the KEEPER's id would move nothing: the lines belong to the discarded product.
    const keeperFold = mergeFoldStatements([{ dup: lotsOfDup[10], target: 200011 }], [], [], 1).find((s) => /^UPDATE sale_items /.test(s.sql))
    await new D1Compat(native).batch([keeperFold])
    assert.equal((await native.prepare('SELECT COUNT(*) n FROM sale_items WHERE batch_id = 200011').all()).results[0].n, 0, 'the keeper id selects none of the discarded lot lines')
    console.log('test-merge-fold-rows-read-d1-native: all checks passed')
  } finally { await mf.dispose() }
}
main().catch((error) => { console.error(error); process.exit(1) })

'use strict'
// Rows READ by one product merge's lot fold on workerd's real D1 (Miniflare) with migration 0315 applied, on production-shaped histories:
//   CENSUS world: 40,000 sale_items (2,763 name a lot, the discarded product owns 600 lines, 300 of them on its lots), 40,000 sale allocations,
//                 3,000 return_items, 3,000 return allocations (the review's census-shaped world; production counts 2,777 lot-bearing sale lines).
//   HEAVY world : the discarded product owns 1,200 sale lines, all on its lots.
// Cloudflare Free bills every row the engine reads. sale_items and return_items had NO index on batch_id: rounds 2 to 4 selected a lot's lines by batch_id alone, a
// full pass over each table for the planner's read and again for each re-point (92,109 rows read to fold 1 lot, base 6,042). Round 5 selected the sale lines through
// the product-first index (cheap, but NOT exact: a line naming a lot of another product stayed on the inactive lot, review r5 F2). Round 6 selects by batch_id alone
// again (exact) and migration 0315 adds the two partial indexes that make that a seek.
//
// This pins the rows read of the REAL statements (the production planner's reads plus the fold's four re-points) at 1, 5 and 30 folded lots in both worlds, against
// base's per-lot statements and round 5's statements measured on the same world (printed beside r6); the same SQL with the indexes DROPPED is the positive control
// and must exceed the pin; EXPLAIN QUERY PLAN shows the SEARCH; and the fold is EXACT: a keeper line naming the duplicate's lot (the review's probe A2 shape), a line on
// a third product and a return line all point at the kept lot afterwards, exactly as in round 4, where round 5's filter would leave them behind.
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

const SALE_ITEMS = 40000
const RETURN_ITEMS = 3000
const DUP = 2
const KEEP = 1
const LOTS = 30
const dupLots = Array.from({ length: LOTS }, (_, i) => 100001 + i)
const keepLots = Array.from({ length: LOTS }, (_, i) => 200001 + i)
const dateOf = (i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)
const lotRow = (id, i) => ({ id, batch_key: 'L' + i, batch_number: i + 1, received_at: dateOf(i), expiry_date: null, unit_cost_usd: 1, is_active: 1 })
const snapshotOf = (lots) => ({
  canonicalBatchRows: keepLots.slice(0, lots).map((id, i) => lotRow(id, i)),
  duplicateBatchRows: dupLots.slice(0, lots).map((id, i) => lotRow(id, i)),
  duplicateProduct: { id: DUP, name: 'Twin', barcode: null, is_active: 1, updated_at: null },
})
const UPDATE_LINES = /^UPDATE (sale_items|return_items|sale_item_batch_allocations|return_item_batch_allocations) /
const positional = (sql, params) => {
  const values = []
  const text = sql.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_m, name) => { values.push(params[name]); return `?${values.length}` })
  return { text, values }
}

// Round 5 (08928c5a1), reproduced for the comparison column only: the sale_items read and re-point carried `product_id = @dupProductId AND`.
const R5_SALE_READ = "SELECT 'line' AS kind, batch_id, id FROM sale_items WHERE product_id = @dup AND batch_id IN (SELECT value FROM json_each(@ids))"
const R5_SALE_UPDATE = "UPDATE sale_items SET batch_id = (SELECT CAST(json_extract(f.value, '$.target') AS INTEGER) FROM json_each(@fold) f WHERE CAST(json_extract(f.value, '$.dup') AS INTEGER) = batch_id) WHERE product_id = @dup AND batch_id IN (SELECT CAST(json_extract(value, '$.dup') AS INTEGER) FROM json_each(@fold))"

// The pins: honest headroom (about 10 to 25%) over what r6 measured when this was written: census 6,141 / 6,941 / 20,641 and heavy 6,441 / 9,041 / 55,741 rows at 1 / 5 / 30 lots
// (base 6,042 / 30,210 / 181,260 and 6,162 / 30,810 / 184,860; round 5 13,311 / 13,983 / 26,883 and 14,751 / 16,983 / 61,383 as the reviewer measured them). The heavy 30-lot figure is
// the per-row lookup in the re-point's SET (1,200 lines x 30 map entries), not a table scan; it is the same in r5 and is left alone (review r5, cheap cut 2, out of scope).
const WORLDS = {
  census: { dupLines: 600, dupLotLines: 300, pin: { 1: 7500, 5: 8500, 30: 24500 } },
  heavy: { dupLines: 1200, dupLotLines: 1200, pin: { 1: 7800, 5: 11000, 30: 62000 } },
}

async function runWorld(name, { dupLines, dupLotLines, pin }, h) {
  const { mergeFoldStatements } = h.load('routes/products.ts')
  const { planProductMergeDependentLotSnapshots } = h.load('lib/productMergeSnapshot.ts')
  const { D1Compat } = h.load('lib/db.ts')
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', compatibilityDate: '2026-08-01', d1Databases: ['DB'] })
  try {
    const native = await mf.getD1Database('DB')
    const migrationDir = path.join(__dirname, '..', 'migrations')
    for (const file of fs.readdirSync(migrationDir).filter((n) => n.endsWith('.sql')).sort()) {
      for (const sql of migrationStatements(fs.readFileSync(path.join(migrationDir, file), 'utf8'))) {
        try { await native.prepare(sql).run() } catch (error) {
          if (/too many terms in compound SELECT/i.test(String(error)) && /^INSERT\b/i.test(sql)) continue
          throw new Error(`${file}: ${sql.slice(0, 160)} :: ${error}`)
        }
      }
    }
    const indexNames = (await native.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_sale_items_batch_id_partial','idx_return_items_batch_id_partial') ORDER BY name").all()).results.map((r) => r.name)
    assert.deepEqual(indexNames, ['idx_return_items_batch_id_partial', 'idx_sale_items_batch_id_partial'], 'migration 0315 is applied by the real chain')
    // Seed on the migrated database: triggers are dropped for the bulk inserts only (the indexes stay and are maintained by the inserts).
    for (const t of (await native.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name IN ('sale_items','return_items','sale_item_batch_allocations','return_item_batch_allocations','sales','returns','product_batches','branch_batch_stock','products')").all()).results) {
      await native.prepare(`DROP TRIGGER "${t.name}"`).run()
    }
    const run = (sql) => native.prepare(sql).run()
    await run("INSERT INTO sales(id,receipt_number) VALUES(1,'S1')")
    await run("INSERT INTO returns(id,return_number,sale_id) VALUES(1,'R1',1)")
    await run("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<500) INSERT INTO products(id,name,is_active) SELECT i,'P'||i,1 FROM n")
    await run("WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i<29) INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,lot_code,received_at,is_active) SELECT 100001+i,2,'L'||i,i+1,'L'||i,date('2026-01-01','+'||i||' days'),1 FROM n")
    await run("WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i<29) INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,lot_code,received_at,is_active) SELECT 200001+i,1,'L'||i,i+1,'L'||i,date('2026-01-01','+'||i||' days'),1 FROM n")
    await run("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<5000) INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,received_at,is_active) SELECT 300000+i,3+(i%497),'O'||i,i,'2026-02-01',1 FROM n")
    await run(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${dupLines}) INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,batch_id) SELECT i,1,2,'Twin',1,1,CASE WHEN i<=${dupLotLines} THEN 100001+(i%30) END FROM n`)
    await run(`WITH RECURSIVE n(i) AS (SELECT ${dupLines + 1} UNION ALL SELECT i+1 FROM n WHERE i<${SALE_ITEMS}) INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,batch_id) SELECT i,1,3+(i%497),'x',1,1,CASE WHEN i%16=0 THEN 300001+(i%5000) END FROM n`)
    await run(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${SALE_ITEMS}) INSERT INTO sale_item_batch_allocations(id,sale_item_id,batch_id,branch_id,quantity) SELECT i,i,COALESCE((SELECT batch_id FROM sale_items WHERE id=n.i),300001+(i%5000)),1,1 FROM n`)
    await run(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${RETURN_ITEMS}) INSERT INTO return_items(id,return_id,product_id,product_name,quantity,batch_id) SELECT i,1,CASE WHEN i<=60 THEN 2 ELSE 3+(i%497) END,'x',1,CASE WHEN i<=60 THEN 100001+(i%30) WHEN i%100=0 THEN 300001+i END FROM n`)
    await run(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${RETURN_ITEMS}) INSERT INTO return_item_batch_allocations(id,return_item_id,batch_id,branch_id,quantity) SELECT i,i,COALESCE((SELECT batch_id FROM return_items WHERE id=n.i),300001+(i%5000)),1,1 FROM n`)
    const counts = (await native.prepare('SELECT (SELECT COUNT(*) FROM sale_items) si,(SELECT COUNT(*) FROM sale_items WHERE batch_id IS NOT NULL) si_lot,(SELECT COUNT(*) FROM sale_items WHERE product_id=2) si_dup,(SELECT COUNT(*) FROM sale_item_batch_allocations) sa,(SELECT COUNT(*) FROM return_items) ri,(SELECT COUNT(*) FROM return_item_batch_allocations) ra').all()).results[0]
    assert.equal(counts.si, SALE_ITEMS); assert.equal(counts.sa, SALE_ITEMS); assert.equal(counts.ri, RETURN_ITEMS); assert.equal(counts.ra, RETURN_ITEMS)
    assert.equal(counts.si_dup, dupLines)
    if (name === 'census') assert.ok(counts.si_lot >= 2700 && counts.si_lot <= 2800, `census world: ${counts.si_lot} lot-bearing sale lines (production: 2,777)`)
    console.log(`world ${name}: ${JSON.stringify({ ...counts })}`)

    const rowsRead = async (sql, params = {}) => {
      const { text, values } = positional(sql, params)
      return (await native.prepare(text).bind(...values).run()).meta.rows_read
    }
    const planOf = async (sql, params = {}) => {
      const { text, values } = positional(sql, params)
      return (await native.prepare('EXPLAIN QUERY PLAN ' + text).bind(...values).all()).results.map((row) => row.detail).join(' | ')
    }
    // target = the lot itself: the re-point reads exactly the same rows and changes none, so every measurement sees the same world.
    const measure = async (lots) => {
      const plan = planProductMergeDependentLotSnapshots(snapshotOf(lots), 'merge')
      assert.deepEqual(plan.reads.map((r) => r.key), ['lotStock', 'saleAllocations', 'returnAllocations'])
      let read = 0
      for (const r of plan.reads) read += await rowsRead(r.sql, r.params)
      let write = 0
      for (const s of mergeFoldStatements(dupLots.slice(0, lots).map((dup) => ({ dup, target: dup })), [], [])) if (UPDATE_LINES.test(s.sql)) write += await rowsRead(s.sql, s.params)
      return read + write
    }
    // base 1ae9f2041: per folded lot, the two allocation reads and the two allocation re-points (no line statements at all).
    const baseRows = async (lots) => {
      let total = 0
      for (const id of dupLots.slice(0, lots)) {
        total += await rowsRead('SELECT id FROM sale_item_batch_allocations WHERE batch_id = @id', { id })
        total += await rowsRead('SELECT id FROM return_item_batch_allocations WHERE batch_id = @id', { id })
        total += await rowsRead('UPDATE sale_item_batch_allocations SET batch_id = batch_id WHERE batch_id = @id', { id })
        total += await rowsRead('UPDATE return_item_batch_allocations SET batch_id = batch_id WHERE batch_id = @id', { id })
      }
      return total
    }
    // r5 (08928c5a1) = r6's statements with the sale_items read and re-point carrying the product filter (the return tables unchanged, so they use the index too here;
    // the real r5 had no index, so its return statements read 6,006 + 3,005 + 3,005 more at 1 lot: the reviewer's 13,311 / 13,983 / 26,883 census figures).
    const r5Sale = async (lots) => {
      const ids = JSON.stringify(dupLots.slice(0, lots))
      const fold = JSON.stringify(dupLots.slice(0, lots).map((dup) => ({ dup, target: dup })))
      return (await rowsRead(R5_SALE_READ, { dup: DUP, ids })) + (await rowsRead(R5_SALE_UPDATE, { dup: DUP, fold }))
    }
    const r6Sale = async (lots) => {
      const ids = JSON.stringify(dupLots.slice(0, lots))
      const fold = JSON.stringify(dupLots.slice(0, lots).map((dup) => ({ dup, target: dup })))
      return (await rowsRead("SELECT 'line' AS kind, batch_id, id FROM sale_items WHERE batch_id IN (SELECT value FROM json_each(@ids))", { ids }))
        + (await rowsRead(mergeFoldStatements([{ dup: dupLots[0], target: dupLots[0] }], [], []).find((s) => /^UPDATE sale_items /.test(s.sql)).sql, { fold }))
    }

    const table = []
    for (const lots of [1, 5, 30]) table.push({ lots, now: await measure(lots), base: await baseRows(lots), r5Sale: await r5Sale(lots), r6Sale: await r6Sale(lots) })
    console.log(`rows read per merge, ${name} world (planner reads + fold re-points):`)
    for (const row of table) console.log(`  ${String(row.lots).padStart(2)} lots: r6 ${row.now}; base per-lot statements ${row.base}; sale_items statements alone: r6 ${row.r6Sale}, r5 ${row.r5Sale}`)

    for (const row of table) {
      assert.ok(row.now <= pin[row.lots], `${name}: ${row.lots} lots read ${row.now}, pin ${pin[row.lots]}`)
      // sale_items is never a full pass, and r6's sale line statements cost no more than r5's filtered ones (within 10%): the index is as cheap as the product filter, and exact.
      assert.ok(row.r6Sale < SALE_ITEMS && row.r6Sale <= row.r5Sale * 1.1 + 100, `${name}: ${row.lots} lots: the sale_items statements read ${row.r6Sale} (r5 ${row.r5Sale})`)
    }
    const byLots = new Map(table.map((row) => [row.lots, row]))
    // At 5 and 30 lots the set-based fold beats base's per-lot statements (base scans the 3,000 return allocations once per lot).
    assert.ok(byLots.get(5).now < byLots.get(5).base && byLots.get(30).now < byLots.get(30).base, `${name}: the fold reads less than base at 5 and 30 lots`)
    // At 1 lot r6 stays within a few hundred rows of base: both pay one pass over the 3,000 return allocations, and r6's line statements are index seeks.
    assert.ok(byLots.get(1).now <= byLots.get(1).base + 2500, `${name}: 1 lot reads ${byLots.get(1).now}, base ${byLots.get(1).base}`)

    // EXPLAIN QUERY PLAN of every changed sale_items / return_items statement: a SEARCH of the partial index, never a SCAN of the line table.
    const plan5 = planProductMergeDependentLotSnapshots(snapshotOf(5), 'merge')
    const statements = [
      ...plan5.reads.filter((r) => r.key === 'saleAllocations' || r.key === 'returnAllocations'),
      ...mergeFoldStatements(dupLots.slice(0, 5).map((dup, i) => ({ dup, target: keepLots[i] })), [], []).filter((s) => /^UPDATE (sale_items|return_items) /.test(s.sql)),
    ]
    assert.equal(statements.length, 4)
    for (const s of statements) {
      const plan = await planOf(s.sql, s.params)
      if (name === 'census') console.log('EXPLAIN', s.key || s.sql.slice(0, 20), ':', plan.replace(/ \| (LIST SUBQUERY|SCAN json_each|CREATE BLOOM|USE TEMP|CORRELATED|SCAN f)[^|]*/g, ''))
      assert.match(plan, /SEARCH (sale_items|return_items) USING (COVERING )?INDEX idx_(sale|return)_items_batch_id_partial \(batch_id=\?\)/, plan)
      assert.doesNotMatch(plan, /SCAN (sale_items|return_items)\b/, plan)
    }

    // EXACT: lines naming a folded lot but carrying another product, written to the world before the fold runs.
    //   900001 a KEEPER line naming the duplicate's lot (the review's probe A2: a merge moved the lot, a historical import wrote the line, the merge was undone)
    //   900002 a THIRD product's line naming it    900003 a sale line with an allocation row    900004 / 900005 return lines of the keeper and a third product
    const fiveLots = dupLots.slice(0, 5)
    await native.batch([
      native.prepare("INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,batch_id) VALUES(900001,1,?,'Keeper line',1,1,?)").bind(KEEP, fiveLots[0]),
      native.prepare("INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,batch_id) VALUES(900002,1,7,'Third line',1,1,?)").bind(fiveLots[1]),
      native.prepare("INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,batch_id) VALUES(900003,1,KEEP_ID,'Allocated',1,1,?)".replace('KEEP_ID', String(KEEP))).bind(fiveLots[2]),
      native.prepare('INSERT INTO sale_item_batch_allocations(id,sale_item_id,batch_id,branch_id,quantity) VALUES(900003,900003,?,1,1)').bind(fiveLots[2]),
      native.prepare("INSERT INTO return_items(id,return_id,product_id,product_name,quantity,batch_id) VALUES(900004,1,?,'Keeper return',1,?)").bind(KEEP, fiveLots[3]),
      native.prepare("INSERT INTO return_items(id,return_id,product_id,product_name,quantity,batch_id) VALUES(900005,1,7,'Third return',1,?)").bind(fiveLots[4]),
    ])
    const inList = fiveLots.join(',')
    const ids = async (sql) => (await native.prepare(sql).all()).results.map((r) => r.id)
    const everySale = await ids(`SELECT id FROM sale_items WHERE batch_id IN (${inList}) ORDER BY id`)
    const everyReturn = await ids(`SELECT id FROM return_items WHERE batch_id IN (${inList}) ORDER BY id`)
    const r5Selected = await ids(`SELECT id FROM sale_items WHERE product_id = ${DUP} AND batch_id IN (${inList}) ORDER BY id`)
    assert.ok(everySale.includes(900001) && everySale.includes(900002) && everySale.includes(900003))
    assert.deepEqual(everySale.filter((id) => !r5Selected.includes(id)), [900001, 900002, 900003], 'control: round 5\'s product filter would NOT have selected the three mismatched lines')
    // The real planner read sees them all too (the fold's rows-to-move list is the undo's payload).
    const read = planProductMergeDependentLotSnapshots(snapshotOf(5), 'merge').reads.find((r) => r.key === 'saleAllocations')
    const seen = (await native.prepare(positional(read.sql, read.params).text).bind(...positional(read.sql, read.params).values).all()).results
    for (const id of [900001, 900002, 900003]) assert.ok(seen.some((row) => row.kind === 'line' && row.id === id), `the planner read lists line ${id}`)
    const fold5 = mergeFoldStatements(fiveLots.map((dup, i) => ({ dup, target: keepLots[i] })), [], [])
    await new D1Compat(native).batch(fold5.filter((s) => UPDATE_LINES.test(s.sql)))
    const keepRange = `BETWEEN 200001 AND 200005`
    assert.deepEqual(await ids(`SELECT id FROM sale_items WHERE batch_id ${keepRange} ORDER BY id`), everySale, 'every sale line that named a folded lot (any product) now names the kept lot')
    assert.deepEqual(await ids(`SELECT id FROM return_items WHERE batch_id ${keepRange} ORDER BY id`), everyReturn, 'every return line that named a folded lot (any product) now names the kept lot')
    assert.equal((await native.prepare(`SELECT COUNT(*) n FROM sale_items WHERE batch_id IN (${inList})`).all()).results[0].n, 0, 'no sale line is left on a folded (now inactive) lot')
    assert.equal((await native.prepare(`SELECT COUNT(*) n FROM return_items WHERE batch_id IN (${inList})`).all()).results[0].n, 0, 'no return line is left on a folded lot')
    assert.equal((await native.prepare('SELECT batch_id FROM sale_items WHERE id=900001').all()).results[0].batch_id, keepLots[0], 'A2: the keeper line points at the kept lot, as in round 4')
    assert.equal((await native.prepare('SELECT batch_id FROM sale_items WHERE id=900002').all()).results[0].batch_id, keepLots[1], 'a third product\'s line points at the kept lot')
    assert.equal((await native.prepare('SELECT batch_id FROM sale_item_batch_allocations WHERE id=900003').all()).results[0].batch_id, keepLots[2], 'its allocation moved with it')
    // A lot that was NOT folded keeps its lines. Double apply: the same fold again moves nothing (the folded lots are named by no line any more).
    const untouched = (await native.prepare('SELECT COUNT(*) n FROM sale_items WHERE batch_id = 100006').all()).results[0].n
    const before2 = JSON.stringify((await native.prepare('SELECT id,batch_id FROM sale_items WHERE batch_id BETWEEN 100001 AND 200030 ORDER BY id').all()).results)
    await new D1Compat(native).batch(fold5.filter((s) => UPDATE_LINES.test(s.sql)))
    assert.equal(JSON.stringify((await native.prepare('SELECT id,batch_id FROM sale_items WHERE batch_id BETWEEN 100001 AND 200030 ORDER BY id').all()).results), before2, 'double apply changes nothing')
    assert.equal((await native.prepare('SELECT COUNT(*) n FROM sale_items WHERE batch_id = 100006').all()).results[0].n, untouched)

    // Positive control: the same SQL with the indexes DROPPED exceeds the pin (full passes over sale_items and return_items), and the plan scans.
    await native.prepare('DROP INDEX idx_sale_items_batch_id_partial').run()
    await native.prepare('DROP INDEX idx_return_items_batch_id_partial').run()
    const dropped5 = await measure(5)
    console.log(`  positive control, indexes dropped, 5 lots: ${dropped5} (pin ${pin[5]})`)
    assert.ok(dropped5 > pin[5], `positive control: ${dropped5} rows read without the indexes must exceed the 5-lot pin ${pin[5]}`)
    assert.ok(dropped5 >= SALE_ITEMS, 'positive control: at least one full pass over sale_items')
    // (a distinct statement text: workerd keeps the compiled EXPLAIN of an identical text across a DROP INDEX)
    const scanPlan = await planOf(statements[0].sql + ' /* indexes dropped */', statements[0].params)
    assert.match(scanPlan, /SCAN sale_items/, 'positive control: without the index the sale line read scans sale_items')
  } finally { await mf.dispose() }
}

async function main() {
  const h = createProductsRouteHarness()
  for (const [name, world] of Object.entries(WORLDS)) await runWorld(name, world, h)
  console.log('test-merge-fold-rows-read-d1-native: all checks passed')
}
main().catch((error) => { console.error(error); process.exit(1) })

'use strict'
// The set-based merge fold (routes/products.ts mergeFoldStatements) and its set-based reversal (lib/undoAppliers.ts mergeFoldReversalStatements)
// on workerd's REAL D1 (Miniflare), not only on node:sqlite: both use json_each parameters, correlated lookups in SET, row-value IN, and
// INSERT ... SELECT ... WHERE true ON CONFLICT, so the engine D1 actually runs has to accept them. 77 lots, two branches, sale/return lines and
// allocations, sent through the production D1Compat adapter (named parameters -> positional) as ONE batch each, inside the stock-transaction permit.
// Asserts the batch is under 100 statements and every statement under 100 bindings, the result (stock, cost, expiry, marks, lines) and that the
// reversal restores every table exactly.
// Run (from cloudflare/): node scripts/test-merge-fold-set-based-d1-native.cjs
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
    if ((trigger && /^END;$/i.test(line)) || (!trigger && /;$/.test(line))) {
      statements.push(buffer.join(' '))
      buffer = []
      trigger = false
    }
  }
  if (buffer.length) statements.push(buffer.join(' '))
  return statements
}

const PERMIT = { sql: "INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'", params: {} }
const UNPERMIT = { sql: "DELETE FROM system_flags WHERE key='stock_transaction_permit'", params: {} }
const N = 77

async function main() {
  const h = createProductsRouteHarness()
  const { mergeFoldStatements, mergeFoldStatementCount } = h.load('routes/products.ts')
  const { mergeFoldReversalStatements } = h.load('lib/undoAppliers.ts')
  const { D1Compat } = h.load('lib/db.ts')
  assert.equal(typeof mergeFoldStatements, 'function')
  assert.equal(typeof mergeFoldReversalStatements, 'function')

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
    const compat = new D1Compat(native)
    const all = async (sql) => (await native.prepare(sql).all()).results.map((row) => ({ ...row }))
    const dump = async () => JSON.stringify({
      lots: await all('SELECT id,variant_product_id,batch_number,batch_key,received_at,expiry_date,unit_cost_usd,is_active,merge_deactivated_at IS NOT NULL AS marked FROM product_batches ORDER BY id'),
      stock: await all('SELECT batch_id,branch_id,quantity FROM branch_batch_stock WHERE quantity<>0 ORDER BY batch_id,branch_id'),
      saleAllocations: await all('SELECT id,batch_id FROM sale_item_batch_allocations ORDER BY id'),
      returnAllocations: await all('SELECT id,batch_id FROM return_item_batch_allocations ORDER BY id'),
      saleItems: await all('SELECT id,batch_id FROM sale_items ORDER BY id'),
      returnItems: await all('SELECT id,batch_id FROM return_items ORDER BY id'),
    })

    await native.batch([
      native.prepare(PERMIT.sql),
      native.prepare("INSERT INTO branches(id,name,is_active) VALUES(1,'Shop',1),(2,'Warehouse',1)"),
      native.prepare("INSERT INTO products(id,name,is_active) VALUES(1,'Twin',1),(2,'Twin',1),(3,'Twin B',1),(4,'Twin B',1)"),
      native.prepare("INSERT INTO sales(id,receipt_number) VALUES(9000,'S-9000')"),
      native.prepare("INSERT INTO returns(id,return_number,sale_id) VALUES(9300,'RET-9300',9000)"),
      native.prepare(UNPERMIT.sql),
    ])

    // kind 'B': all 77 discarded lots meet ONE kept lot (1001); kind 'C': lot i meets kept lot 1000 + i (77 kept lots).
    for (const kind of ['B', 'C']) {
      const keeperProduct = kind === 'B' ? 1 : 3
      const dupProduct = keeperProduct + 1
      const base = kind === 'B' ? 0 : 10000
      const targets = kind === 'B' ? [base + 1001] : Array.from({ length: N }, (_, i) => base + 1000 + i)
      const targetOf = (i) => (kind === 'B' ? targets[0] : targets[i])
      const seed = [native.prepare(PERMIT.sql)]
      const keeperStock = new Map() // target -> { branch: qty }
      for (const [index, target] of targets.entries()) {
        const date = kind === 'B' ? '2026-09-01' : new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10)
        seed.push(native.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,lot_code,received_at,expiry_date,unit_cost_usd,is_active,received_quantity,received_cost_usd)
          VALUES(?,?,?,?,?,?,'2027-06-15',2,1,3,6)`).bind(target, keeperProduct, `K${kind}-${target}`, index + 1, `KL${kind}-${target}`, date))
        seed.push(native.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,3)').bind(target))
        keeperStock.set(target, { 1: 3 })
      }
      const dups = []
      for (let i = 0; i < N; i++) {
        const id = base + 2000 + i
        const date = kind === 'B' ? '2026-09-01' : new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)
        const stock = { 1: (i % 5) + 1, ...(i % 2 === 0 ? { 2: (i % 3) + 1 } : {}) }
        dups.push({ id, i, stock })
        seed.push(native.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,lot_code,received_at,expiry_date,unit_cost_usd,is_active,received_quantity,received_cost_usd)
          VALUES(?,?,?,?,?,?,?,1.5,1,3,4.5)`).bind(id, dupProduct, `D${kind}-${id}`, i + 1, `DL${kind}-${id}`, date, `2027-0${(i % 9) + 1}-10`))
        for (const [branch, quantity] of Object.entries(stock)) seed.push(native.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)').bind(id, Number(branch), quantity))
        if (i % 5 === 0) {
          const sale = base + 9100 + i, ret = base + 9400 + i
          seed.push(native.prepare("INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,batch_id) VALUES(?,9000,?,'Twin',1,?)").bind(sale, dupProduct, id))
          seed.push(native.prepare('INSERT INTO sale_item_batch_allocations(id,sale_item_id,batch_id,branch_id,quantity,released_quantity) VALUES(?,?,?,1,1,0)').bind(base + 9200 + i, sale, id))
          seed.push(native.prepare("INSERT INTO return_items(id,return_id,product_id,product_name,quantity,batch_id) VALUES(?,9300,?,'Twin',1,?)").bind(ret, dupProduct, id))
          seed.push(native.prepare('INSERT INTO return_item_batch_allocations(id,return_item_id,sale_item_id,batch_id,branch_id,quantity) VALUES(?,?,?,?,1,1)').bind(base + 9500 + i, ret, sale, id))
        }
      }
      seed.push(native.prepare(UNPERMIT.sql))
      await native.batch(seed)

      // ---- forward fold: 77 lots, one batch -------------------------------------------------------------------------------------------
      const prior = await dump()
      const lotRows = dups.map((d) => ({ dup: d.id, target: targetOf(d.i) }))
      const stockRows = dups.flatMap((d) => Object.entries(d.stock).map(([branch, qty]) => ({ target: targetOf(d.i), branch: Number(branch), qty })))
      const metaRows = targets.map((id, index) => ({ id, cost: 1.75 + index / 100, expiry: '2027-01-02' }))
      const fold = mergeFoldStatements(lotRows, stockRows, metaRows)
      assert.equal(fold.length, mergeFoldStatementCount(lotRows.length, stockRows.length, metaRows.length), 'the estimate is the exact statement count')
      assert.ok(fold.length + 2 <= 100, `${kind}: ${fold.length} statements`)
      for (const s of fold) assert.ok(Object.keys(s.params).length <= 100)
      await compat.batch([PERMIT, ...fold, UNPERMIT])
      const after = await dump()
      assert.notEqual(after, prior)
      const lotsAfter = new Map(JSON.parse(after).lots.map((row) => [row.id, row]))
      const stockAfter = new Map()
      for (const row of JSON.parse(after).stock) (stockAfter.get(row.batch_id) ?? stockAfter.set(row.batch_id, {}).get(row.batch_id))[row.branch_id] = row.quantity
      for (const d of dups) {
        const row = lotsAfter.get(d.id)
        assert.deepEqual([row.is_active, row.marked, row.variant_product_id], [0, 1, dupProduct], `${kind}: lot ${d.id} inactive, marked, still on the discarded record`)
        assert.equal(stockAfter.get(d.id), undefined, `${kind}: lot ${d.id} holds nothing`)
      }
      const expectStock = new Map(targets.map((t) => [t, { ...keeperStock.get(t) }]))
      for (const d of dups) for (const [branch, qty] of Object.entries(d.stock)) { const m = expectStock.get(targetOf(d.i)); m[branch] = (m[branch] || 0) + qty }
      for (const [target, expected] of expectStock) assert.deepEqual(stockAfter.get(target), expected, `${kind}: kept lot ${target} stock`)
      for (const [index, target] of targets.entries()) {
        assert.equal(lotsAfter.get(target).unit_cost_usd, 1.75 + index / 100)
        assert.equal(lotsAfter.get(target).expiry_date, '2027-01-02')
      }
      const parsed = JSON.parse(after)
      for (const d of dups.filter((x) => x.i % 5 === 0)) {
        const target = targetOf(d.i)
        for (const [list, id] of [[parsed.saleItems, base + 9100 + d.i], [parsed.saleAllocations, base + 9200 + d.i], [parsed.returnItems, base + 9400 + d.i], [parsed.returnAllocations, base + 9500 + d.i]]) {
          assert.equal(list.find((row) => row.id === id).batch_id, target, `${kind}: row ${id} follows its lot`)
        }
      }

      // ---- reversal: one batch, exact ---------------------------------------------------------------------------------------------------
      const foldedBatches = dups.map((d) => {
        const target = targetOf(d.i)
        return {
          dupBatchId: d.id,
          keeperBatchId: target,
          dupStockBefore: Object.entries(d.stock).map(([branch_id, quantity]) => ({ branch_id: Number(branch_id), quantity })),
          keeperStockBefore: [{ branch_id: 1, quantity: 3 }],
          saleAllocationIds: d.i % 5 === 0 ? [base + 9200 + d.i] : [],
          returnAllocationIds: d.i % 5 === 0 ? [base + 9500 + d.i] : [],
          saleItemIds: d.i % 5 === 0 ? [base + 9100 + d.i] : [],
          returnItemIds: d.i % 5 === 0 ? [base + 9400 + d.i] : [],
          keeperLotBefore: { unit_cost_usd: 2, expiry_date: '2027-06-15', is_active: 1 },
        }
      })
      const reversal = mergeFoldReversalStatements(foldedBatches)
      assert.ok(reversal.length + 2 <= 100, `${kind}: ${reversal.length} reversal statements`)
      for (const s of reversal) assert.ok(Object.keys(s.params).length <= 100)
      await compat.batch([PERMIT, ...reversal, UNPERMIT])
      assert.equal(await dump(), prior, `${kind}: the reversal restores every table exactly`)
      assert.equal((await all("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'"))[0].n, 0)
      console.log(`PASS ${kind}: 77 lots fold in ${fold.length} statements and reverse in ${reversal.length}, exactly, on workerd D1`)
    }
    console.log('test-merge-fold-set-based-d1-native: all checks passed')
  } finally { await mf.dispose() }
}
main().catch((error) => { console.error(error); process.exit(1) })

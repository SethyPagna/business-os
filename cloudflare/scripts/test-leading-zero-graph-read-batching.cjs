// Actual SQL over migrated local SQLite; compare the former serial orchestration
// with the current scoped helper and its unchanged canonical digest projection.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { createHash } = require('node:crypto')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const src = path.join(__dirname, '../src')

function declarations(file, names) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  return source.statements.filter(node => names.some(name => node.name?.text === name
    || (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(source) === name))))
    .map(node => node.getText(source).replace(/^export /, '')).join('\n')
}
function evaluate(code, dependencies = {}) {
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', ...Object.keys(dependencies), output)(mod.exports, mod, ...Object.values(dependencies))
  return mod.exports
}
const snapshot = evaluate(fs.readFileSync(path.join(src, 'lib/productMergeSnapshot.ts'), 'utf8'))
const tables = evaluate(declarations(path.join(src, 'lib/undoAppliers.ts'), ['MERGE_REPARENT_TABLES'])
  + '\nexports.tables=MERGE_REPARENT_TABLES').tables
const names = ['runLeadingZeroReadPlans', 'readLeadingZeroGraphSnapshots', 'canonicalLeadingZeroGraphSnapshot']
const helpers = evaluate(declarations(path.join(src, 'routes/products.ts'), names)
  + '\nexports.read=readLeadingZeroGraphSnapshots; exports.canonical=canonicalLeadingZeroGraphSnapshot; exports.run=runLeadingZeroReadPlans', {
  ...snapshot, MERGE_REPARENT_TABLES: tables, productMergeCaseKey: (a, b) => `${a}:${b}`,
})

function adapter(d1, failAt = 0, shortAt = 0) {
  const calls = []
  return {
    calls,
    prepare(sql) { return { all: async (params) => { calls.push([sql]); return d1.prepare(sql).all(params) } } },
    async batch(statements) {
      calls.push(statements.map(s => s.sql))
      assert.ok(statements.every(s => /^\s*SELECT\b/.test(s.sql)), 'graph phase never writes')
      if (calls.length === failAt) throw new Error('injected_read_failure')
      let results
      d1.db.exec('BEGIN')
      try {
        results = statements.map(({ sql, params }) => ({ success: true, results: d1.prepare(sql).all(params || {}) }))
        d1.db.exec('COMMIT')
      } catch (error) { d1.db.exec('ROLLBACK'); throw error }
      return calls.length === shortAt ? results.slice(1) : results
    },
  }
}

async function serial(db, groups) {
  const result = new Map()
  for (const group of groups) {
    const id = group.duplicates[0].id
    const s = await snapshot.readProductMergeCaseSnapshot(db, group.canonical.id, id, tables)
    const dependentLots = await snapshot.readProductMergeDependentLotSnapshots(db, s, 'merge')
    const duplicateBatchRowsFull = await db.prepare('SELECT * FROM product_batches WHERE variant_product_id=@id ORDER BY id').all({ id })
    const duplicateBatchStockRows = await db.prepare(`SELECT bbs.* FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id
      WHERE pb.variant_product_id=@id ORDER BY bbs.id`).all({ id })
    const saleAllocationRows = await db.prepare(`SELECT a.id,a.batch_id FROM sale_item_batch_allocations a JOIN product_batches pb ON pb.id=a.batch_id
      WHERE pb.variant_product_id=@id ORDER BY a.id`).all({ id })
    const returnAllocationRows = await db.prepare(`SELECT a.id,a.batch_id FROM return_item_batch_allocations a JOIN product_batches pb ON pb.id=a.batch_id
      WHERE pb.variant_product_id=@id ORDER BY a.id`).all({ id })
    result.set(`${group.canonical.id}:${id}`, { snapshot: s, dependentLots, duplicateBatchRowsFull, duplicateBatchStockRows, saleAllocationRows, returnAllocationRows })
  }
  return result
}

function fixture(count, lots = false) {
  const d1 = openDb(loadAll())
  d1.db.exec("INSERT INTO branches(id,name) VALUES(1,'Shop'),(2,'Warehouse')")
  const groups = []
  for (let i = 0; i < count; i++) {
    const keeper = 100 + i * 2, duplicate = keeper + 1, lot = 1000 + i * 3
    for (const id of [keeper, duplicate]) {
      d1.db.prepare(`INSERT INTO products(id,name,barcode,is_active,cost_price_usd,cost_price_khr,updated_at)
        VALUES(?,?,?,1,?,?,?)`).run(id, `Fixture ${i}`, String(id), id === keeper ? 0 : null, id * 4, '2026-09-12')
      d1.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity,rfid_confirmed_qty) VALUES(?,1,?,1)').run(id, id % 7)
      d1.db.prepare('INSERT INTO product_images(product_id,image_path,sort_order) VALUES(?,?,?)').run(id, `/${id}.png`, id % 2)
    }
    d1.db.prepare(`INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity)
      VALUES(?,'Fixture',1,'Shop','add',2)`).run(duplicate)
    d1.db.prepare('INSERT INTO sale_items(sale_id,product_id) VALUES(1,?)').run(duplicate)
    d1.db.prepare('INSERT INTO return_items(return_id,product_id) VALUES(1,?)').run(duplicate)
    d1.db.prepare('INSERT INTO return_replacement_items(return_id,product_id) VALUES(1,?)').run(duplicate)
    d1.db.prepare('INSERT INTO damaged_stock_lots(product_id) VALUES(?)').run(duplicate)
    d1.db.prepare('INSERT INTO stock_transfers(product_id) VALUES(?)').run(duplicate)
    d1.db.prepare('INSERT INTO rfid_tags(epc_id,product_id,branch_id) VALUES(?,?,1)').run(`E${i}`, duplicate)
    d1.db.prepare("INSERT INTO rfid_events(session_id,epc_id,event_type,product_id) VALUES(1,?,'scan',?)").run(`E${i}`, duplicate)
    d1.db.prepare("INSERT INTO rfid_session_items(session_id,epc_id,status,product_id) VALUES(1,?,'confirmed',?)").run(`E${i}`, duplicate)
    d1.db.prepare("INSERT INTO promotions(title,link_product_id) VALUES('Fixture',?)").run(duplicate)
    d1.db.prepare("INSERT INTO promotion_rules(title,product_ids) VALUES('Both',?)").run(JSON.stringify([keeper, duplicate]))
    d1.db.prepare("INSERT INTO products(id,name,barcode,parent_id) VALUES(?,'Child',?,?)").run(10000 + i, `child${i}`, duplicate)
    if (lots) {
      for (let n = 0; n < 3; n++) {
        d1.db.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,lot_code,received_at,expiry_date,unit_cost_usd,is_active)
          VALUES(?,?,?,?,?,'2026-01-01','2030-12-31',?,?)`).run(lot + n, n === 0 ? keeper : duplicate, n === 2 ? 'repoint' : 'overlap', n + 1, `L${lot+n}`, n === 1 ? null : 0, n === 2 ? 0 : 1)
        d1.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)').run(lot + n, n === 2 ? 2 : 1, n === 2 ? 0 : n + 1)
      }
      for (const batch of [lot + 1, lot + 2]) {
        d1.db.prepare('INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,quantity) VALUES(1,?,1)').run(batch)
        d1.db.prepare('INSERT INTO return_item_batch_allocations(return_item_id,batch_id,quantity) VALUES(1,?,1)').run(batch)
      }
    }
    groups.push({ canonical: { id: keeper }, duplicates: [{ id: duplicate }] })
  }
  return { d1, groups }
}
const digest = value => createHash('sha256').update(JSON.stringify([...value].map(([key, graph]) => [key, helpers.canonical(graph)]))).digest('hex')

async function main() {
  for (const [count, lots] of [[0, false], [1, false], [1, true], [25, false], [25, true]]) {
    const { d1, groups } = fixture(count, lots)
    const oldDb = adapter(d1), newDb = adapter(d1)
    const before = d1.db.prepare('SELECT total_changes() AS n').get().n
    const oldGraph = await serial(oldDb, groups), newGraph = await helpers.read(newDb, groups)
    assert.deepEqual(newGraph, oldGraph, 'all fields, nulls, ordering, maps and inactive lots preserved')
    for (const graph of newGraph.values()) assert.equal(graph.snapshot.reparentedByTable.length, tables.length, 'every reparent table has a captured row')
    assert.equal(digest(newGraph), digest(oldGraph), 'canonical graph digest identical')
    assert.equal(d1.db.prepare('SELECT total_changes() AS n').get().n, before)
    assert.ok(newDb.calls.every(call => call.length <= 80))
    const expected = Math.ceil(count / 3) + (lots ? Math.ceil(count / 20) : 0)
    assert.equal(newDb.calls.length, expected)
    assert.equal(oldDb.calls.length, count * (lots ? 6 : 5))
    if (count === 25) {
      await assert.rejects(helpers.read(adapter(d1, 2), groups), /injected_read_failure/)
      await assert.rejects(helpers.read(adapter(d1, 0, 2), groups), /incomplete result set/)
    }
    console.log(JSON.stringify({ count, lots, oldCalls: oldDb.calls.length, newCalls: newDb.calls.length, parity: true }))
    d1.db.close()
  }
  await assert.rejects(helpers.run({}, [{ reads: Array.from({ length: 81 }, () => ({})), decode: () => null }]), /exceeds_limit/)
  await assert.rejects(helpers.read({}, [{ canonical: { id: 1 }, duplicates: [{ id: 2 }, { id: 3 }] }]), /requires_pairs/)
  console.log('test-leading-zero-graph-read-batching: PASS')
}
main().catch(error => { console.error(error); process.exitCode = 1 })

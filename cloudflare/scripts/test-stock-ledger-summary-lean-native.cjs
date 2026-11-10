'use strict'
// Read switch `ledger_summary_lean` (lane stock-changes-summary): the Stock Changes total, In/Out summary and a view chip's count read the movements alone when no
// filter needs products or batches (measured on the production-sized seed: 3 reads per movement became 1), and the view's count comes out of that one summary.
// The numbers must stay exactly the ones the old statements give. Real routes (GET /api/products/stock-ledger), every migration, an in-memory D1.
//   - parity: for 23 filter sets x 3 views x ledger_keyset / ledger_summary_lean on and off, the answer equals the OFF answer (page 1 and page 2), and OFF equals the
//     kernel's own old SQL (COUNT + summary statements run directly), so "equal to OFF" cannot be two copies of one mistake;
//   - the fixture holds what breaks a wrong derivation: NULL movement_type rows (the In summary counts them, the In view excludes them), NULL created_at, both
//     timestamp forms, business-midnight edges, name-only supplier attribution, a Khmer-digit barcode search, two branches;
//   - the lean statement joins products / batches only when a filter reads them (search, supplier), checked on the query plan;
//   - staleness: nothing is cached, so after EVERY kind of writer (insert, delete, type / quantity / branch / date update, product rename, barcode change, batch supplier
//     change, merge) the lean answer equals the OFF answer at once, and the watched figure moved where the writer moves it (so equality is not two stale copies);
//   - OFF path: the route with the switch stored off, unset, or switched on and removed answers the same bytes, in the old key order.
// Run: node scripts/test-stock-ledger-summary-lean-native.cjs
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

const h = createProductsRouteHarness()
h.setUser({ id: 1, username: 'tester', name: 'Test User', role_code: 'admin', role_id: 1, permissions: '{}', organization_id: null, is_active: 1 })
const { resetReadSwitchMemo } = h.load('lib/readSwitches.ts')
const kernel = h.load('lib/stockLedgerQuery.ts')
const PERMIT_ON = "INSERT OR REPLACE INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch';"
const PERMIT_OFF = "DELETE FROM system_flags WHERE key='stock_transaction_permit';"
const permit = (sql) => h.raw.db.exec(`${PERMIT_ON} ${sql}; ${PERMIT_OFF}`)
const setSwitches = (names) => {
  h.raw.db.exec("DELETE FROM system_flags WHERE key='read_switches'")
  if (names) h.raw.db.prepare('INSERT INTO system_flags(key,value) VALUES(\'read_switches\',?)').run(JSON.stringify({ epoch: 1, set_at: '2026-11-10T00:00:00.000Z', set_by: 1, switches: Object.fromEntries(names.map((n) => [n, 'on'])) }))
  resetReadSwitchMemo()
}
const get = async (query) => { const r = await h.request('GET', `/stock-ledger?${query}`); assert.equal(r.status, 200, `${query}: ${JSON.stringify(r.json)}`); return r.json }
const strip = (body) => { const { next_cursor: _cursor, ...rest } = body; return rest }

// ---- the fixture -----------------------------------------------------------------------------------------------------------------------------
permit(`INSERT INTO branches(id,name,is_default,is_active) SELECT 1,'Shop',1,1 WHERE NOT EXISTS(SELECT 1 FROM branches WHERE id=1);
  INSERT OR IGNORE INTO branches(id,name,is_default,is_active) VALUES(2,'Store',0,1);
  INSERT INTO suppliers(id,name) VALUES(1,'Alpha Supply'),(2,'Beta Supply');
  INSERT INTO products(id,name,barcode,unit,is_active,stock_quantity) VALUES(1,'Lean Serum','8801000000011','pcs',1,40),(2,'Lean Cream','8801000000028','pcs',1,40),(3,'Lean Balm','8801000000035','pcs',1,40);
  INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active,supplier_id,supplier_name) VALUES
    (1,1,'A','A','2026-10-01',1,2,1,1,'Alpha Supply'),(2,2,'B','B','2026-10-01',1,2,1,NULL,'  beta SUPPLY '),(3,3,'C','C','2026-10-01',1,2,1,2,'Beta Supply'),(4,1,'D','D','2026-10-02',2,2,1,NULL,NULL)`)
let seed = 20261110
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >> 10) % n }
const TYPES = ['sale', 'remove', 'transfer_out', 'damage_out', 'add', 'return', 'transfer_in', 'stock_in', 'adjustment', 'supplier_return', 'return_reversal']
const pad = (n) => String(n).padStart(2, '0')
let nextId = 1
const NAMES = ['Lean Serum', 'Lean Cream', 'Lean Balm']
const insertStmt = h.raw.db.prepare('INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity, batch_id, reason, user_name, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
const addMovement = (createdAt, over = {}) => {
  const product = over.product ?? rnd(3)
  const type = 'type' in over ? over.type : TYPES[rnd(TYPES.length)]
  const batch = 'batch' in over ? over.batch : [1, 2, 3, 4, null][rnd(5)]
  h.raw.db.exec(PERMIT_ON)
  insertStmt.run(nextId++, product + 1, NAMES[product], over.branch ?? 1 + rnd(2), 'Branch', type, over.qty ?? (rnd(5) - 1), batch, 'fixture', 'tester', createdAt)
  h.raw.db.exec(PERMIT_OFF)
}
for (let day = 1; day <= 12; day += 1) {
  for (let k = 0; k < 12; k += 1) {
    const iso = rnd(2) === 1
    const clock = `${pad(day)}${iso ? 'T' : ' '}${pad(rnd(24))}:${pad(rnd(60))}:${pad(rnd(60))}`
    addMovement(`2026-10-${clock}${iso ? '.000Z' : ''}`)
  }
}
for (const stamp of ['2026-10-03 16:59:59', '2026-10-03 17:00:00', '2026-10-04T16:59:59.000Z', '2026-10-04T17:00:00.000Z', '2026-10-05 00:00:00', '2026-10-05 23:59:59']) addMovement(stamp)
for (let k = 0; k < 5; k += 1) addMovement(null)
for (let k = 0; k < 6; k += 1) addMovement(`2026-10-0${1 + k} 05:00:00`, { type: null }) // no movement type: the In summary counts them, the In view does not
for (let k = 0; k < 3; k += 1) addMovement(null, { type: null })

const FILTERS = [
  '', 'startDate=2026-10-03&endDate=2026-10-08', 'startDate=2026-10-04', 'endDate=2026-10-04', 'startDate=2026-10-05&endDate=2026-10-05',
  'startDate=2026-10-02&endDate=2026-10-09&startTime=08:00&endTime=18:30', 'branchId=1', 'branchId=2&startDate=2026-10-02&endDate=2026-10-11', 'productId=2',
  'productId=3&branchId=1&startDate=2026-10-01&endDate=2026-10-12', 'search=Serum', 'search=8801000000028', 'search=%E1%9E%A0%E1%9F%A0%E1%9F%A1', 'search=Lean&startDate=2026-10-02&endDate=2026-10-05',
  'search=serum&branchId=2', 'supplierId=1', 'supplierId=2', 'supplierId=2&branchId=1&startDate=2026-10-01&endDate=2026-10-12', 'supplierId=1&search=Lean', 'movementId=5', 'movementId=99999',
  'startDate=2030-01-01&endDate=2030-01-02', 'search=zzzznothing',
]
const JOINED = new Set(['search=Serum', 'search=8801000000028', 'search=%E1%9E%A0%E1%9F%A0%E1%9F%A1', 'search=Lean&startDate=2026-10-02&endDate=2026-10-05', 'search=serum&branchId=2', 'supplierId=1', 'supplierId=2',
  'supplierId=2&branchId=1&startDate=2026-10-01&endDate=2026-10-12', 'supplierId=1&search=Lean', 'search=zzzznothing'])
const STATES = [[null, 'unset'], [[], 'stored, none on'], [['ledger_summary_lean'], 'lean'], [['ledger_keyset'], 'keyset'], [['ledger_keyset', 'ledger_summary_lean'], 'keyset + lean']]
const failures = []
let passed = 0
const check = async (name, fn) => { try { await fn(); passed += 1; console.log('PASS', name) } catch (error) { failures.push(name); console.log('FAIL', name, '\n    ', String(error.message).split('\n').join('\n     ')) } }

async function answers(tail) {
  const out = {}
  for (const [names, label] of STATES) { setSwitches(names); out[label] = [await get(`pageSize=7&page=1&${tail}`), await get(`pageSize=7&page=2&${tail}`)] }
  return out
}
// the kernel's own old statements, run directly
const oldTotals = (tail, view) => {
  const p = new URLSearchParams(tail)
  const q = kernel.buildStockLedgerQuery({ view, productId: Number(p.get('productId')) || 0, branchId: Number(p.get('branchId')) || 0, startDate: p.get('startDate') || '', endDate: p.get('endDate') || '',
    startTime: p.get('startTime') || '', endTime: p.get('endTime') || '', search: p.get('search') || '', supplierId: Number(p.get('supplierId')) || 0, movementId: Number(p.get('movementId')) || 0 })
  const s = h.raw.db.prepare(q.summarySql).get(q.params)
  return { q, total: h.raw.db.prepare(q.countSql).get(q.params).total, summary: { inCount: Number(s.in_count || 0), outCount: Number(s.out_count || 0), inQty: Number(s.in_qty || 0), outQty: Number(s.out_qty || 0), total: Number(s.total || 0) } }
}

async function main() {
  await check('the fixture holds the cases that break a wrong derivation', () => {
    const q = (sql) => h.raw.db.prepare(sql).get()
    assert.ok(q('SELECT COUNT(*) n FROM inventory_movements').n > 150)
    assert.equal(q('SELECT COUNT(*) n FROM inventory_movements WHERE movement_type IS NULL').n, 9)
    assert.equal(q('SELECT COUNT(*) n FROM inventory_movements WHERE created_at IS NULL').n, 8)
    assert.ok(q("SELECT COUNT(*) n FROM inventory_movements WHERE created_at LIKE '%T%'").n > 20 && q("SELECT COUNT(*) n FROM inventory_movements WHERE created_at LIKE '% %'").n > 20)
  })

  for (const view of ['all', 'in', 'out']) {
    for (const filter of FILTERS) {
      const tail = `${filter}${filter ? '&' : ''}view=${view}`
      await check(`parity ${view} | ${filter || 'no filter'}: every switch state answers the old statements' numbers`, async () => {
        const a = await answers(tail)
        const old = oldTotals(tail, view)
        const off = a.unset[0]
        assert.equal(off.total, old.total, 'OFF total is the old COUNT')
        assert.deepEqual(off.summary, old.summary, 'OFF summary is the old summary')
        assert.equal(off.totalPages, Math.max(1, Math.ceil(old.total / 7)))
        for (const [, label] of STATES) {
          assert.deepEqual(strip(a[label][0]), off, `page 1 under ${label}`)
          assert.deepEqual(strip(a[label][1]).items, a.unset[1].items, `page 2 under ${label}`)
        }
        assert.deepEqual(a['stored, none on'], a.unset, 'a stored-but-off switch is the unset path')
      })
    }
  }

  await check('the lean statement joins products / batches only when a filter reads them (query plan), and reads the same set when it does', () => {
    for (const filter of FILTERS) {
      const { q } = oldTotals(filter, 'all')
      const joined = /LEFT JOIN/.test(q.leanSummarySql)
      assert.equal(joined, JOINED.has(filter), `${filter || 'none'}: joined=${joined}`)
      assert.equal(/LEFT JOIN/.test(q.summarySql), true, 'the old summary always joins')
      const plan = h.raw.db.prepare(`EXPLAIN QUERY PLAN ${q.leanSummarySql}`).all(q.params).map((r) => r.detail).join(' | ')
      assert.equal(/SEARCH [pb] USING|SCAN [pb]\b/.test(plan), joined, `${filter || 'none'}: ${plan}`)
    }
  })

  await check('the fixture separates a wrong derivation: counting NULL types as In, or reading the Out figure for the In view, gives another total', () => {
    const { q, total } = oldTotals('', 'in')
    const row = h.raw.db.prepare(q.leanSummarySql).get(q.params)
    assert.equal(kernel.ledgerLeanTotals(row, 'in').total, total)
    assert.notEqual(kernel.ledgerLeanTotals({ ...row, typed: row.total }, 'in').total, total)
    assert.notEqual(kernel.ledgerLeanTotals(row, 'out').total, total)
  })

  // staleness: nothing is cached; after every kind of writer the lean answer is the OFF answer, and the watched figure moved where the writer moves it
  const WRITERS = [
    ['insert a movement', "INSERT INTO inventory_movements (id, product_id, product_name, branch_id, movement_type, quantity, batch_id, created_at) VALUES (9001, 1, 'Lean Serum', 1, 'sale', 2, 1, '2026-10-06 04:00:00')"],
    ['delete a movement (undo)', 'DELETE FROM inventory_movements WHERE id = 9001'],
    ['insert a NULL-typed movement', "INSERT INTO inventory_movements (id, product_id, product_name, branch_id, movement_type, quantity, batch_id, created_at) VALUES (9002, 2, 'Lean Cream', 2, NULL, 3, 2, '2026-10-06 05:00:00')"],
    ['change the type', "UPDATE inventory_movements SET movement_type = 'add' WHERE id = 9002"],
    ['change the quantity', 'UPDATE inventory_movements SET quantity = 40 WHERE id = 9002'],
    ['change the branch', 'UPDATE inventory_movements SET branch_id = 1 WHERE id = 9002'],
    ['change the date', "UPDATE inventory_movements SET created_at = '2026-10-20 05:00:00' WHERE id = 9002"],
    ['rename the product (search by name)', "UPDATE inventory_movements SET product_name = 'Lean Serum Renamed' WHERE product_id = 2"],
    ['change a barcode (search by code)', "UPDATE products SET barcode = '7770000000001' WHERE id = 3"],
    ['change a batch supplier (supplier filter)', 'UPDATE product_batches SET supplier_id = 1 WHERE id = 3'],
    ['change a batch supplier name (name-only attribution)', "UPDATE product_batches SET supplier_name = 'Alpha Supply' WHERE id = 2"],
    ['merge: move movements to another product', 'UPDATE inventory_movements SET product_id = 1 WHERE product_id = 3'],
    ['delete every movement of a day (count apply / reset)', "DELETE FROM inventory_movements WHERE created_at LIKE '2026-10-02%'"],
  ]
  const WATCH = ['view=all', 'view=in', 'view=out', 'view=all&branchId=1', 'view=in&startDate=2026-10-05&endDate=2026-10-07', 'view=all&search=Serum', 'view=out&search=7770000000001', 'view=all&supplierId=1', 'view=in&supplierId=2&search=Lean']
  const read = async (names) => { setSwitches(names); const out = []; for (const tail of WATCH) out.push(await get(`pageSize=5&page=1&${tail}`)); return out }
  let previous = await read(['ledger_summary_lean'])
  for (const [name, sql] of WRITERS) {
    await check(`staleness after: ${name}`, async () => {
      permit(sql)
      const lean = await read(['ledger_summary_lean'])
      const leanKeyset = await read(['ledger_keyset', 'ledger_summary_lean'])
      const off = await read(null)
      assert.deepEqual(lean, off, 'lean = OFF straight after the write')
      assert.deepEqual(leanKeyset.map(strip), off, 'lean + keyset = OFF')
      const oldCounts = WATCH.map((tail) => oldTotals(tail.replace(/view=\w+&?/, ''), new URLSearchParams(tail).get('view')).total)
      assert.deepEqual(lean.map((b) => b.total), oldCounts, 'and equal to the old COUNT statement')
      assert.notDeepEqual(lean.map((b) => [b.total, b.summary]), previous.map((b) => [b.total, b.summary]), 'the writer moved a watched figure, so equality is not two stale copies')
      previous = lean
    })
  }

  // the switch must DO something: capture the SQL each state runs
  const sqlRun = async (names, tail) => {
    const seen = []
    const real = h.raw.prepare.bind(h.raw)
    h.raw.prepare = (sql) => { seen.push(String(sql)); return real(sql) }
    try { setSwitches(names); await get(tail) } finally { h.raw.prepare = real }
    return seen
  }
  const summaryOf = (seen) => seen.filter((s) => /SUM\(CASE WHEN m\.movement_type/.test(s))
  const countOf = (seen) => seen.filter((s) => /^\s*SELECT COUNT\(\*\) AS total\s+FROM inventory_movements m/.test(s))
  await check('the switch changes the SQL that runs: ON uses the lean summary (no products / batches join) and no separate COUNT; OFF and a stored-off switch use the old statements', async () => {
    for (const tail of ['pageSize=7&page=1', 'pageSize=7&page=1&view=in&startDate=2026-10-02&endDate=2026-10-10', 'pageSize=7&page=1&view=out&branchId=1']) {
      for (const [names, label] of [[['ledger_summary_lean'], 'lean'], [['ledger_keyset', 'ledger_summary_lean'], 'keyset + lean']]) {
        const seen = await sqlRun(names, tail)
        const sums = summaryOf(seen)
        assert.equal(sums.length, 1, `${label} ${tail}: one summary statement`)
        assert.match(sums[0], /COUNT\(m\.movement_type\) AS typed/, `${label} ${tail}: the lean statement`)
        assert.doesNotMatch(sums[0], /LEFT JOIN/, `${label} ${tail}: no join`)
        assert.equal(countOf(seen).length, 0, `${label} ${tail}: no separate COUNT`)
      }
      for (const [names, label] of [[null, 'unset'], [[], 'stored off'], [['ledger_keyset'], 'keyset only']]) {
        const seen = await sqlRun(names, tail)
        const sums = summaryOf(seen)
        assert.equal(sums.length, 1)
        assert.doesNotMatch(sums[0], /typed/, `${label} ${tail}: the old statement`)
        assert.match(sums[0], /LEFT JOIN products p/, `${label} ${tail}: the old summary joins`)
        if (tail.includes('view=') && !(names && names.includes('ledger_keyset'))) assert.equal(countOf(seen).length, 1, `${label} ${tail}: the old COUNT runs`)
      }
    }
    // a search needs the joins: the lean statement keeps them
    const seen = await sqlRun(['ledger_summary_lean'], 'pageSize=7&page=1&search=Serum')
    assert.match(summaryOf(seen)[0], /LEFT JOIN products p/)
    assert.match(summaryOf(seen)[0], /AS typed/)
  })

  await check('key order of the ON answers: the old order, and next_cursor last with ledger_keyset', async () => {
    const order = ['items', 'total', 'page', 'pageSize', 'totalPages', 'view', 'summary']
    setSwitches(['ledger_summary_lean'])
    assert.deepEqual(Object.keys(await get('pageSize=9&page=2&view=in')), order)
    setSwitches(['ledger_keyset', 'ledger_summary_lean'])
    assert.deepEqual(Object.keys(await get('pageSize=9&page=1&view=in')), [...order, 'next_cursor'])
    setSwitches(['ledger_keyset'])
    assert.deepEqual(Object.keys(await get('pageSize=9&page=1&view=in')), [...order, 'next_cursor'])
  })

  await check('OFF path: stored-off, unset and on-then-removed answer the same bytes, in the old key order', async () => {
    const tail = 'pageSize=9&page=2&view=in&branchId=1&startDate=2026-10-02&endDate=2026-10-10'
    setSwitches(null); const unset = JSON.stringify(await get(tail))
    setSwitches([]); const stored = JSON.stringify(await get(tail))
    setSwitches(['ledger_summary_lean']); await get(tail); setSwitches(null); const removed = JSON.stringify(await get(tail))
    assert.equal(stored, unset); assert.equal(removed, unset)
    assert.deepEqual(Object.keys(JSON.parse(unset)), ['items', 'total', 'page', 'pageSize', 'totalPages', 'view', 'summary'])
  })

  console.log(`\n${failures.length ? 'RED' : 'GREEN'} stock ledger summary lean native: ${passed}/${passed + failures.length} checks hold`)
  process.exit(failures.length ? 1 : 0)
}
main().catch((error) => { console.error(error); process.exit(1) })

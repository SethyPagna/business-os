'use strict'
// B1 (16 Nov 2026, round-2 review): merges above about 10 folded lots were refused with 409 merge_case_exceeds_safe_limit because the fold
// wrote 7 statements per lot and read 4 per lot (limits: the lane's 100-statement bound and the 80-statement dependent-read bound), while
// production merges 30 and 77 lots. The fold and its undo are SET-based now: one statement per kind, one JSON parameter each, so the count
// is the same for 1 lot and for 77.
//
// This test drives the REAL products route (POST /possible-duplicates/merge) and the REAL action-history undo at D1's expression depth, for
//   A  n discarded lots on ONE date the keeper lacks   (one created lot, n - 1 folds into it)
//   B  n discarded lots on the keeper's OWN date        (n folds into one kept lot: weighted cost, earliest expiry)
//   C  n discarded lots on n dates, each with a kept lot (n folds into n kept lots: the widest fold)
// for n = 1, 10, 30 and 77, on TWO branches, with single-lot sale/return lines and allocations on every fifth lot, and asserts
//   - 200, and exact stock conservation per branch (shelf and lot ledger) and per kept lot (an independent oracle in this file);
//   - the quantity-weighted 4-place cost ($0 and unknown left out) and the earliest expiry of each kept lot;
//   - every folded lot inactive and marked, every line and allocation re-pointed;
//   - the statement counts against the limits (printed as COUNTS lines), each statement under 100 bindings and the depth budget;
//   - the second apply is refused and writes nothing; undo is 200 and restores EVERY table exactly (not the product row cost, which undo
//     re-derives); a second undo is refused and writes nothing.
// Run (from cloudflare/): node scripts/test-merge-fold-set-based-native.cjs
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
const K = 1
const D = 2
const D1_EXPR_DEPTH = 100
const DEPTH_BUDGET = 70
const WRITE_LIMIT = 100
const READ_LIMIT = 80
let passed = 0
let failed = 0
async function check(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`) }
}
const plain = (rows) => (Array.isArray(rows) ? rows.map((row) => ({ ...row })) : rows == null ? rows : { ...rows })

function fixtureWrite(h, run) {
  h.raw.db.exec("BEGIN; INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
  try {
    run()
    h.raw.db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'; COMMIT")
  } catch (error) { h.raw.db.exec('ROLLBACK'); throw error }
}

// The smallest expression depth at which `sql` still parses, or null above the limit.
function parseDepth(db, sql) {
  const saved = db.limits.exprDepth
  try {
    for (let depth = 10; depth <= D1_EXPR_DEPTH; depth += 2) {
      db.limits.exprDepth = depth
      try { db.prepare(sql); return depth } catch (error) { if (!/Expression tree is too large/.test(String(error))) return depth }
    }
    return null
  } finally { db.limits.exprDepth = saved }
}

// ---- the world ---------------------------------------------------------------------------------------------------------
// Two branches. Discarded lot i (0-based, id 2000 + i, batch_number i + 1): stock (i % 5) + 1 at branch 1 and, on every other lot,
// (i % 3) + 1 at branch 2. Cost 1 + (i % 7) / 4, except i % 11 = 5 which is $0 and i % 13 = 7 which has no cost (both left out of the mean).
// Expiry: none when i % 4 = 0, otherwise a padded or unpadded 2027 date (the earliest wins as an ISO date, whatever the spelling).
const dateOf = (i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)
const costOf = (i) => (i % 11 === 5 ? 0 : i % 13 === 7 ? null : 1 + (i % 7) / 4)
const expiryOf = (i) => (i % 4 === 0 ? null : `2027-${(i % 9) + 1}-${(i % 27) + 1}`)
const iso = (value) => { if (value == null) return null; const [y, m, d] = String(value).split('-'); return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` }
const stockOf = (i) => ({ 1: (i % 5) + 1, ...(i % 2 === 0 ? { 2: (i % 3) + 1 } : {}) })
const total = (stock) => Object.values(stock).reduce((sum, q) => sum + q, 0)

function world(kind, n) {
  const h = createProductsRouteHarness({ user: ADMIN })
  assert.equal(h.raw.db.limits.exprDepth, D1_EXPR_DEPTH, 'the harness must parse at D1 depth')
  const keeperLots = [] // { id, date, cost, expiry, stock }
  const dupLots = []
  fixtureWrite(h, () => {
    const db = h.raw.db
    db.exec(`INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1),(2,'Warehouse',1,0);
      INSERT INTO products(id,name,barcode,is_active,stock_quantity,cost_price_usd,purchase_price_usd,selling_price_usd,wholesale_price_usd)
        VALUES(${K},'Twin Serum','777',1,0,2,2,10,8),(${D},'Twin Serum','777',1,0,2,2,10,8);`)
    const lot = db.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,lot_code,received_at,expiry_date,unit_cost_usd,
      is_active,received_quantity,received_cost_usd,received_branch_id,received_branch_name) VALUES(?,?,?,?,?,?,?,?,1,?,?,1,'Shop')`)
    const lotStock = db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)')
    const shelf = { [K]: {}, [D]: {} }
    const addShelf = (product, stock) => { for (const [b, q] of Object.entries(stock)) shelf[product][b] = (shelf[product][b] || 0) + q }
    // One kept lot on the case's date(s). Branch 1 only, so undo must delete the branch-2 row the fold created.
    const keeper = (id, date, stock) => {
      keeperLots.push({ id, date, cost: 2, expiry: '2027-06-15', stock })
      lot.run(id, K, `K-${id}`, keeperLots.length, `KL-${id}`, date, '2027-06-15', 2, total(stock), 2 * total(stock))
      for (const [b, q] of Object.entries(stock)) lotStock.run(id, Number(b), q)
      addShelf(K, stock)
    }
    if (kind === 'B') keeper(1001, '2026-09-01', { 1: 3 })
    for (let i = 0; i < n; i++) {
      const date = kind === 'C' ? dateOf(i) : '2026-09-01'
      if (kind === 'C') keeper(1000 + i, date, { 1: (i % 4) + 1 })
      const stock = stockOf(i)
      dupLots.push({ id: 2000 + i, i, date, cost: costOf(i), expiry: expiryOf(i), stock })
      lot.run(2000 + i, D, `D-${i}`, i + 1, `DL-${i}`, date, expiryOf(i), costOf(i), total(stock), 0)
      for (const [b, q] of Object.entries(stock)) lotStock.run(2000 + i, Number(b), q)
      addShelf(D, stock)
    }
    const shelfRow = db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)')
    for (const product of [K, D]) {
      for (const [b, q] of Object.entries(shelf[product])) shelfRow.run(product, Number(b), q)
      db.prepare('UPDATE products SET stock_quantity=? WHERE id=?').run(total(shelf[product]), product)
    }
    // History on every fifth lot: a sale line that names the lot in its own batch_id (single-lot line) plus an allocation on it, and a
    // return of one unit with its own line batch and allocation. Sale 9000 holds them all.
    db.exec("INSERT INTO sales(id,receipt_number) VALUES(9000,'S-9000'); INSERT INTO returns(id,return_number,sale_id) VALUES(9300,'RET-9300',9000);")
    for (let i = 0; i < n; i += 5) {
      db.prepare("INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,batch_id) VALUES(?,9000,?,'Twin Serum',1,?)").run(9100 + i, D, 2000 + i)
      db.prepare('INSERT INTO sale_item_batch_allocations(id,sale_item_id,batch_id,branch_id,quantity,released_quantity) VALUES(?,?,?,1,1,0)').run(9200 + i, 9100 + i, 2000 + i)
      db.prepare("INSERT INTO return_items(id,return_id,product_id,product_name,quantity,batch_id) VALUES(?,9300,?,'Twin Serum',1,?)").run(9400 + i, D, 2000 + i)
      db.prepare('INSERT INTO return_item_batch_allocations(id,return_item_id,sale_item_id,batch_id,branch_id,quantity) VALUES(?,?,?,?,1,1)').run(9500 + i, 9400 + i, 9100 + i, 2000 + i)
    }
  })
  return { h, keeperLots, dupLots }
}

const LOT_COLUMNS = 'merge_deactivated_at IS NOT NULL AS merge_marked,id,variant_product_id,batch_key,batch_number,lot_code,received_at,expiry_date,unit_cost_usd,is_active,supplier_id,supplier_name,payment_status,credit_due_date,received_quantity,received_cost_usd,received_branch_id'
const lots = (h) => plain(h.raw.prepare(`SELECT ${LOT_COLUMNS} FROM product_batches ORDER BY id`).all())
const lotStockOf = (h) => {
  const out = {}
  for (const row of h.raw.prepare('SELECT batch_id,branch_id,quantity FROM branch_batch_stock WHERE quantity<>0 ORDER BY batch_id,branch_id').all()) (out[row.batch_id] ??= {})[row.branch_id] = row.quantity
  return out
}
// Everything undo must put back (the product rows' cost is re-derived by undo, so it is left out; stock_quantity and activity are in).
function state(h) {
  const q = (sql) => plain(h.raw.prepare(sql).all())
  return JSON.stringify({
    lots: lots(h),
    lotStock: lotStockOf(h),
    branchStock: q('SELECT product_id,branch_id,quantity FROM branch_stock ORDER BY product_id,branch_id'),
    products: q('SELECT id,is_active,stock_quantity FROM products ORDER BY id'),
    saleAllocations: q('SELECT id,sale_item_id,batch_id,branch_id,quantity,released_quantity FROM sale_item_batch_allocations ORDER BY id'),
    returnAllocations: q('SELECT id,return_item_id,sale_item_id,batch_id,branch_id,quantity FROM return_item_batch_allocations ORDER BY id'),
    saleItems: q('SELECT id,product_id,batch_id FROM sale_items ORDER BY id'),
    returnItems: q('SELECT id,product_id,batch_id FROM return_items ORDER BY id'),
  })
}

// The quantity-weighted cost at 4 places (half up), $0 and unknown left out, in exact integer arithmetic; the kept lot's own value when none counts.
function weightedCost(parts, own) {
  const real = parts.filter((p) => p.cost != null && Number(p.cost) > 0)
  if (!real.length) return own
  let num = 0n
  let den = 0n
  for (const p of real) { num += BigInt(Math.round(Number(p.cost) * 1e4)) * BigInt(p.q); den += BigInt(p.q) }
  if (den === 0n) return own
  return Number((num * 2n + den) / (2n * den)) / 1e4
}
const earliest = (values, own) => {
  const present = values.map(iso).filter(Boolean).sort()
  return present.length ? present[0] : own
}

const merge = (h) => h.request('POST', '/possible-duplicates/merge', { keepId: K, mergeId: D, stock: 'merge' })
async function undoLast(h) {
  const history = h.raw.prepare("SELECT id,scope FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.merge' ORDER BY id DESC LIMIT 1").get()
  assert.ok(history, 'the merge recorded an undoable action')
  const app = h.load('routes/actionHistory.ts').default
  const env = { DB: h.raw }
  const ctx = { waitUntil() {}, passThroughOnException() {} }
  const listed = await app.request(`http://local/?scope=${encodeURIComponent(history.scope)}`, {}, env, ctx)
  assert.equal(listed.status, 200)
  const current = (await listed.json()).items.find((row) => row.id === history.id)
  assert.ok(current, 'the history row is visible')
  const response = await app.request(`http://local/${history.id}/undo`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ require_applied: true, expected_generation: current.undo_payload.generation }),
  }, env, ctx)
  return { status: response.status, json: await response.json().catch(() => null) }
}

// Records every D1 batch the route sends, so the statement and read counts are measured, not estimated.
function recordBatches(h) {
  const batches = []
  const rawBatch = h.raw.batch.bind(h.raw)
  h.raw.batch = (items) => { batches.push(items.map((item) => ({ sql: item.sql, params: item.params }))); return rawBatch(items) }
  return batches
}
const isDependentLotRead = (batch) => batch.some((s) => /FROM branch_batch_stock WHERE batch_id IN \(SELECT value FROM json_each\(@ids\)\)/.test(s.sql))
function measure(h, batches) {
  const writes = batches.filter((batch) => !isDependentLotRead(batch) && batch.some((s) => /^\s*(INSERT|UPDATE|DELETE)/i.test(s.sql)))
  const write = writes.reduce((a, b) => (b.length > a.length ? b : a), [])
  const read = batches.find(isDependentLotRead) || []
  // Every statement under D1's 100 bindings and within the expression-depth budget.
  let worst = 0
  for (const s of [...write, ...read]) {
    assert.ok(Object.keys(s.params || {}).length <= 100, `a statement binds over 100 parameters: ${s.sql.slice(0, 120)}`)
  }
  for (const sql of new Set([...write, ...read].map((s) => s.sql))) {
    const depth = parseDepth(h.raw.db, sql)
    assert.notEqual(depth, null, `a statement exceeds D1's expression depth: ${sql.slice(0, 160)}`)
    worst = Math.max(worst, depth)
  }
  assert.ok(worst <= DEPTH_BUDGET, `deepest statement needs depth ${worst} (budget ${DEPTH_BUDGET})`)
  return { write: write.length, read: read.length, depth: worst }
}

const counts = new Map()
async function scenario(kind, n) {
  const { h, keeperLots, dupLots } = world(kind, n)
  const prior = state(h)
  const shelfBefore = plain(h.raw.prepare('SELECT product_id,branch_id,quantity FROM branch_stock ORDER BY product_id,branch_id').all())
  const ledgerBefore = lotStockOf(h)
  const batches = recordBatches(h)
  const res = await merge(h)
  assert.equal(res.status, 200, `${kind}${n}: ${JSON.stringify(res.json)}`)
  const m = measure(h, batches)
  assert.ok(m.write <= WRITE_LIMIT, `${kind}${n}: ${m.write} write statements against the limit ${WRITE_LIMIT}`)
  assert.ok(m.read <= READ_LIMIT, `${kind}${n}: ${m.read} dependent reads against the limit ${READ_LIMIT}`)
  counts.set(`${kind}${n}`, m)

  // Conservation: the shelf per branch is the sum of both products' shelves before; the lot ledger per branch is the sum of every lot before.
  const shelfAfter = plain(h.raw.prepare('SELECT product_id,branch_id,quantity FROM branch_stock WHERE quantity<>0 ORDER BY product_id,branch_id').all())
  for (const branch of [1, 2]) {
    const before = shelfBefore.filter((r) => r.branch_id === branch).reduce((s, r) => s + r.quantity, 0)
    assert.equal(shelfAfter.filter((r) => r.product_id === K && r.branch_id === branch).reduce((s, r) => s + r.quantity, 0), before, `${kind}${n}: branch ${branch} shelf conserved`)
    assert.equal(shelfAfter.filter((r) => r.product_id === D).length, 0, `${kind}${n}: the discarded shelf is empty`)
    const ledger = (stockMap) => Object.values(stockMap).reduce((s, byBranch) => s + (byBranch[branch] || 0), 0)
    assert.equal(ledger(lotStockOf(h)), ledger(ledgerBefore), `${kind}${n}: branch ${branch} lot ledger conserved`)
  }

  // Each kept lot's stock, cost and expiry against the oracle.
  const after = lotStockOf(h)
  const lotById = new Map(lots(h).map((row) => [row.id, row]))
  const groups = kind === 'A' ? [{ target: 2000, own: dupLots[0], added: dupLots.slice(1), created: true }]
    : kind === 'B' ? [{ target: 1001, own: keeperLots[0], added: dupLots }]
      : dupLots.map((d, i) => ({ target: 1000 + i, own: keeperLots[i], added: [d] }))
  for (const g of groups) {
    const members = [g.own, ...g.added]
    const expectStock = {}
    for (const lotRow of members) for (const [b, q] of Object.entries(lotRow.stock)) expectStock[b] = (expectStock[b] || 0) + q
    assert.deepEqual(after[g.target] || {}, expectStock, `${kind}${n}: kept lot ${g.target} stock`)
    const row = lotById.get(g.target)
    assert.equal(row.is_active, 1)
    assert.equal(row.variant_product_id, K)
    assert.equal(row.merge_marked, 0, 'a kept or created lot is never marked')
    const cost = weightedCost(members.map((lotRow) => ({ cost: lotRow.cost, q: total(lotRow.stock) })), g.own.cost)
    assert.equal(row.unit_cost_usd, cost, `${kind}${n}: kept lot ${g.target} weighted cost`)
    assert.equal(row.expiry_date, earliest(members.map((lotRow) => lotRow.expiry), g.own.expiry), `${kind}${n}: kept lot ${g.target} earliest expiry`)
    for (const d of g.added) {
      const dupRow = lotById.get(d.id)
      assert.deepEqual([dupRow.is_active, dupRow.merge_marked, dupRow.variant_product_id], [0, 1, D], `${kind}${n}: folded lot ${d.id} is inactive, marked, and stays on the discarded record`)
      assert.deepEqual(after[d.id] || {}, {}, `${kind}${n}: folded lot ${d.id} holds nothing`)
    }
  }
  if (kind === 'A') {
    assert.equal(lotById.get(2000).variant_product_id, K, 'the first lot of the date is the one created on the keeper')
    assert.equal(h.raw.prepare('SELECT COUNT(*) n FROM product_batches WHERE variant_product_id=? AND is_active=1').get([K]).n, 1, 'exactly one active lot for the date')
  }
  // Lines and allocations follow their lot (a created lot keeps its own id; a folded one points at the target).
  const targetOf = new Map(groups.flatMap((g) => g.added.map((d) => [d.id, g.target])))
  for (let i = 0; i < n; i += 5) {
    const expected = targetOf.get(2000 + i) ?? 2000 + i
    const get = (sql, id) => h.raw.prepare(sql).get([id]).batch_id
    assert.equal(get('SELECT batch_id FROM sale_items WHERE id=?', 9100 + i), expected, `${kind}${n}: sale line ${9100 + i}`)
    assert.equal(get('SELECT batch_id FROM sale_item_batch_allocations WHERE id=?', 9200 + i), expected, `${kind}${n}: sale allocation ${9200 + i}`)
    assert.equal(get('SELECT batch_id FROM return_items WHERE id=?', 9400 + i), expected, `${kind}${n}: return line ${9400 + i}`)
    assert.equal(get('SELECT batch_id FROM return_item_batch_allocations WHERE id=?', 9500 + i), expected, `${kind}${n}: return allocation ${9500 + i}`)
  }

  // Double apply: the discarded product is inactive now, so the same merge is refused and writes nothing.
  const merged = state(h)
  const again = await merge(h)
  assert.notEqual(again.status, 200, `${kind}${n}: the second apply must be refused`)
  assert.equal(state(h), merged, `${kind}${n}: the second apply wrote nothing`)

  // Undo is exact, measured, and a second undo is refused without writing.
  batches.length = 0
  const undone = await undoLast(h)
  assert.equal(undone.status, 200, `${kind}${n}: ${JSON.stringify(undone.json)}`)
  assert.equal(state(h), prior, `${kind}${n}: undo restores every table exactly`)
  const undoWrite = batches.filter((batch) => batch.some((s) => /^\s*(INSERT|UPDATE|DELETE)/i.test(s.sql))).reduce((max, batch) => Math.max(max, batch.length), 0)
  assert.ok(undoWrite <= WRITE_LIMIT, `${kind}${n}: undo is ${undoWrite} statements against the limit ${WRITE_LIMIT}`)
  const undoStatements = batches.flat().filter((s) => /json_each\(@rows\)|json_each\(@ids\)/.test(s.sql))
  let undoDepth = 0
  for (const sql of new Set(undoStatements.map((s) => s.sql))) {
    const depth = parseDepth(h.raw.db, sql)
    assert.notEqual(depth, null, `${kind}${n}: an undo statement exceeds D1's expression depth: ${sql.slice(0, 160)}`)
    undoDepth = Math.max(undoDepth, depth)
  }
  assert.ok(undoDepth <= DEPTH_BUDGET, `${kind}${n}: deepest undo statement needs depth ${undoDepth}`)
  m.undo = undoWrite
  const restored = state(h)
  const second = await undoLast(h)
  assert.notEqual(second.status, 200, `${kind}${n}: a second undo must be refused`)
  assert.equal(state(h), restored, `${kind}${n}: the second undo wrote nothing`)
  // And the reversed merge can be applied again (redo by a fresh merge): the same figures, so nothing was left behind.
  const remerge = await merge(h)
  assert.equal(remerge.status, 200, `${kind}${n}: ${JSON.stringify(remerge.json)}`)
  assert.equal(JSON.stringify(lotStockOf(h)), JSON.stringify(after), `${kind}${n}: merging again after undo reaches the same stock`)
}

async function main() {
  for (const kind of ['A', 'B', 'C']) {
    const label = { A: 'one date the keeper lacks', B: "the keeper's own date", C: 'n dates, each with a kept lot' }[kind]
    for (const n of [1, 10, 30, 77]) {
      await check(`${n} lots, ${label}: merge 200, exact stock, weighted cost, earliest expiry, lines re-pointed, double apply refused, undo exact`, () => scenario(kind, n))
    }
  }

  await check('the statement count does not grow with the lot count (the old fold wrote 7 per lot and read 4 per lot)', () => {
    for (const kind of ['A', 'B', 'C']) {
      const small = counts.get(`${kind}10`)
      const large = counts.get(`${kind}77`)
      assert.ok(small && large, 'the scenarios ran')
      assert.equal(large.write, small.write, `${kind}: 77 lots write ${large.write} statements, 10 lots ${small.write}`)
      assert.equal(large.read, small.read, `${kind}: the dependent reads are the same for 10 and 77 lots`)
      assert.ok(large.write <= 45, `${kind}: about 39 statements for any size, got ${large.write}`)
    }
  })

  console.log('COUNTS (statements the merge sends in its write batch / dependent reads / statements of the undo batch / deepest parse depth); limits 100 / 80:')
  for (const [name, m] of [...counts]) console.log(`COUNTS ${name.padEnd(4)} write=${String(m.write).padStart(3)} reads=${m.read} undo=${m.undo} depth=${m.depth}`)

  console.log(`${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
}
main().catch((error) => { console.error(error); process.exitCode = 1 })

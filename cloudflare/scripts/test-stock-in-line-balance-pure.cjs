// U-records (owner, 25 Sep 2026): opening a stock-in session line showed no
// before/after. GET /api/products/stock-in-session-lines returned the line's
// folded current figures and nothing about the stock it moved.
//
// This pins, against the REAL migration chain in node:sqlite:
//   1. loadMovementStockBalances gives a received line the stock before ->
//      after that the Stock Changes ledger shows for the SAME movement --
//      hand-computed too, so a shared wrong answer cannot pass -- and its
//      set-based window agrees with the ledger's correlated expression for
//      EVERY movement of a history with same-second ties and out types;
//   1b. speed: it is ONE statement for 50 lines and for 2000 (a counting
//      fake D1), and its plan range-seeks the product/created_at index
//      instead of scanning inventory_movements;
//   2. the session line carries its AS-RECEIVED quantity and cost beside the
//      edit-folded current ones, so an edited line reads "received -> now";
//   3. the route wires both, with a null fallback (never a guessed number);
//   4. the acquisition-cost projection strips the as-received costs for a
//      user without cost-view access and keeps the quantities.
//
// Run: node scripts/test-stock-in-line-balance-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const src = path.join(__dirname, '..', 'src')
const modules = new Map()
function load(filename) {
  if (modules.has(filename)) return modules.get(filename).exports
  const mod = { exports: {} }
  modules.set(filename, mod)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  }).outputText
  new Function('require', 'module', 'exports', output)(
    (name) => (name.startsWith('.') ? load(path.resolve(path.dirname(filename), `${name}.ts`)) : require(name)),
    mod, mod.exports,
  )
  return mod.exports
}

let checks = 0
function ok(cond, label) { assert.ok(cond, label); checks += 1; console.log(`PASS ${label}`) }

const ledger = load(path.join(src, 'lib', 'stockLedgerQuery.ts'))
const sessions = load(path.join(src, 'lib', 'stockInSessionsQuery.ts'))
const costs = load(path.join(src, 'lib', 'acquisitionCostAccess.ts'))

const db = openDb(loadAll())
// Product 1's history. Stock is set to what the rows imply (10-3+5-2+2 = 12),
// so every derived balance is exact:
//   #1 add 10   0 -> 10    (another receipt)
//   #2 sale 3  10 -> 7
//   #3 add 5    7 -> 12    <- the session line under test (session 300)
//   #4 sale 2  12 -> 10
//   #5 +2      10 -> 12    an N6 edit of #3 (5 -> 7 units, cost 4 -> 6)
// Product 2 has one receipt in the same session and no later movement.
db.exec(`
  INSERT INTO users (id,username,name,password) VALUES (7,'james','James','x');
  INSERT INTO branches (id,name,is_active) VALUES (1,'Shop',1);
  INSERT INTO products (id,name,barcode,unit,stock_quantity,is_active) VALUES
    (1,'Cream','1001','pcs',12,1),
    (2,'Serum','1002','pcs',4,1);
  INSERT INTO product_batches (id,variant_product_id,batch_key,lot_code,received_at,is_active,unit_cost_usd,received_cost_usd,updated_at) VALUES
    (1,1,'260903','260903','2026-09-03',1,6,42,'2026-09-05 03:00:00'),
    (2,2,'260903','260903','2026-09-03',1,3,12,'2026-09-03 03:00:00');
  INSERT INTO inventory_movements (id,product_id,product_name,branch_id,branch_name,movement_type,quantity,unit_cost_usd,total_cost_usd,reference_id,user_id,user_name,created_at,batch_id) VALUES
    (1,1,'Cream',1,'Shop','add',10,4,40,200,7,'James','2026-09-01 03:00:00',1),
    (2,1,'Cream',1,'Shop','sale',3,NULL,NULL,900,7,'James','2026-09-02 03:00:00',NULL),
    (3,1,'Cream',1,'Shop','add',5,4,20,300,7,'James','2026-09-03 03:00:00',1),
    (6,2,'Serum',1,'Shop','add',4,3,12,300,7,'James','2026-09-03 03:00:01',2),
    (4,1,'Cream',1,'Shop','sale',2,NULL,NULL,901,7,'James','2026-09-04 03:00:00',NULL),
    (5,1,'Cream',1,'Shop','add',2,6,22,'stock-in-edit:3:op1:1',7,'James','2026-09-05 03:00:00',1);
`)

// ---- 1. the balance, and parity with the ledger ----------------------------
// lib/db.ts's D1Compat shape (prepare(sql).all(params)) over the harness db.
const asD1 = (sqlDb) => ({ prepare: (sql) => ({ all: async (params) => sqlDb.prepare(sql).bind(params || {}).all() }) })

async function main() {
const got = await ledger.loadMovementStockBalances(asD1(db), [3, 6])
ok(got.get(3).before_qty === 7 && got.get(3).after_qty === 12, 'the received line reads stock 7 -> 12 (hand-computed)')
ok(got.get(6).before_qty === 0 && got.get(6).after_qty === 4, 'the second line reads 0 -> 4')

const q = ledger.buildStockLedgerQuery({})
const ledgerRows = ledger.attachBeforeQty(db.prepare(q.rowsSql).bind({ ...q.params, limit: 50, offset: 0 }).all())
for (const id of [3, 6]) {
  const row = ledgerRows.find((candidate) => candidate.id === id)
  assert.deepEqual([got.get(id).before_qty, got.get(id).after_qty], [row.before_qty, row.after_qty], `movement ${id}: session line and ledger agree`)
}
ok(true, 'a session line and the Stock Changes ledger give the same movement the same before -> after')

// ---- 1a. window == correlated, on a history built to separate them -------
// Product 3: same-second ties (the id breaks them), out types, a receipt in
// the middle. A window ordered by created_at alone, or with the default
// RANGE frame (which counts the row itself and its ties), answers
// differently here -- the negative controls below prove it.
const parity = openDb(loadAll())
parity.exec(`
  INSERT INTO products (id,name,barcode,unit,stock_quantity,is_active) VALUES (3,'Toner','1003','pcs',9,1), (4,'Mask','1004','pcs',1,1);
  INSERT INTO inventory_movements (id,product_id,product_name,movement_type,quantity,created_at) VALUES
    (10,3,'Toner','add',6,'2026-09-01 03:00:00'),
    (11,3,'Toner','sale',1,'2026-09-02 03:00:00'),
    (12,3,'Toner','add',4,'2026-09-02 03:00:00'),
    (13,3,'Toner','damage_out',2,'2026-09-02 03:00:00'),
    (14,3,'Toner','transfer_in',3,'2026-09-03 03:00:00'),
    (15,3,'Toner','supplier_return',1,'2026-09-04 03:00:00'),
    (16,4,'Mask','add',1,'2026-09-02 03:00:00');
`)
const truth = new Map(ledger.attachBeforeQty(parity.prepare(`
  SELECT m.id, ${ledger.movementSignedQuantitySql('m')} AS signed_quantity, ${ledger.movementStockAfterSql('m', 'p')} AS after_qty
  FROM inventory_movements m LEFT JOIN products p ON p.id = m.product_id`).bind({}).all()).map((row) => [row.id, row]))
const allIds = [...truth.keys()]
const windowed = await ledger.loadMovementStockBalances(asD1(parity), allIds)
for (const id of allIds) {
  assert.deepEqual([windowed.get(id).before_qty, windowed.get(id).after_qty], [truth.get(id).before_qty, Number(truth.get(id).after_qty)], `movement ${id}: window agrees with the ledger's correlated walk`)
}
// hand-computed: stock 9; newer than #12 are #13 (-2), #14 (+3), #15 (-1) -> after 9 - 0 = 9, before 5
ok(windowed.get(12).before_qty === 5 && windowed.get(12).after_qty === 9, 'the tied receipt #12 reads 5 -> 9 (hand-computed)')
ok(windowed.size === allIds.length, `the set-based balances agree with the correlated ledger expression for all ${allIds.length} movements`)
for (const [label, broken] of [
  // (created_at alone is not a usable control: SQLite then happens to walk
  // the index's id DESC order, so it agrees by accident -- which is exactly
  // why the id tiebreak is written out rather than left to the planner.)
  ['the reversed id tiebreak', ledger.MOVEMENT_STOCK_BALANCES_SQL.replace('ORDER BY mn.created_at DESC, mn.id DESC', 'ORDER BY mn.created_at DESC, mn.id ASC')],
  ['the default RANGE frame', ledger.MOVEMENT_STOCK_BALANCES_SQL.replace('ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING', '')],
]) {
  assert.notEqual(broken, ledger.MOVEMENT_STOCK_BALANCES_SQL, `${label}: mutation applied`)
  const rows = parity.prepare(broken).bind({ movementIds: JSON.stringify(allIds) }).all()
  ok(rows.some((row) => Number(row.after_qty) !== Number(truth.get(row.id).after_qty)), `negative control: ${label} disagrees with the ledger on this fixture`)
}

// ---- 1b. speed: one statement, whatever the line count ------------------
for (const lineCount of [50, 2000]) {
  let prepares = 0
  let alls = 0
  const counting = { prepare: (sql) => { prepares += 1; return { all: async (params) => { alls += 1; return parity.prepare(sql).bind(params || {}).all() } } } }
  const ids = Array.from({ length: lineCount }, (_, index) => (index < allIds.length ? allIds[index] : 100000 + index))
  const found = await ledger.loadMovementStockBalances(counting, ids)
  ok(prepares === 1 && alls === 1 && found.size === allIds.length, `${lineCount} lines cost ${prepares} prepare / ${alls} all -- one statement, not one per line`)
}
const plan = parity.prepare(`EXPLAIN QUERY PLAN ${ledger.MOVEMENT_STOCK_BALANCES_SQL}`).bind({ movementIds: '[10,16]' }).all().map((row) => row.detail)
console.log(`  plan:\n    ${plan.join('\n    ')}`)
ok(plan.some((detail) => detail.includes('SEARCH mn USING INDEX idx_inventory_movements_product_created_pg (product_id=? AND created_at>?)')), 'each touched product is a range seek on idx_inventory_movements_product_created_pg')
ok(!plan.some((detail) => /^SCAN (mn|m|inventory_movements)$/.test(detail)), 'no full scan of inventory_movements')

// ---- 2. as received vs now -------------------------------------------------
const locator = sessions.parseStockInSessionKey('session:300')
const lines = db.prepare(sessions.stockInSessionLinesSql(locator)).bind(sessions.stockInSessionLineParams(locator)).all()
const cream = lines.find((row) => row.id === 3)
ok(cream && cream.received_quantity === 5 && cream.quantity === 7, 'the edited line carries received 5 beside current 7')
ok(cream.received_unit_cost_usd === 4 && cream.unit_cost_usd === 6, 'and its received unit cost 4 beside current 6')
ok(cream.received_total_cost_usd === 20 && cream.total_cost_usd === 42, 'and its received total 20 beside current 42')
const serum = lines.find((row) => row.id === 6)
ok(serum.received_quantity === serum.quantity && serum.received_unit_cost_usd === serum.unit_cost_usd, 'an unedited line reads the same in both')
ok(lines.length === 2, 'the edit row is folded into its root line, never listed as a line of its own')

// ---- 3. the route wires it -------------------------------------------------
const route = fs.readFileSync(path.join(src, 'routes', 'products.ts'), 'utf8')
const handler = route.slice(route.indexOf("app.get('/stock-in-session-lines'"), route.indexOf("app.get('/stock-ledger'"))
ok(/loadMovementStockBalances\(db, /.test(handler), 'the session-lines handler computes balances through the shared set-based helper')
ok(!/movementStockAfterSql|buildInClause\('movement'/.test(handler), 'and no longer runs a correlated walk or a per-chunk fan-out for them')
ok(/before_qty: balance \? balance\.before_qty : null/.test(handler) && /after_qty: balance \? balance\.after_qty : null/.test(handler), 'a line without a derivable balance gets null, not a number')
ok(/app\.use\('\*', acquisitionCostResponses\)/.test(route), 'products routes still project acquisition costs out of every response')

// ---- 4. cost visibility ----------------------------------------------------
const staff = { id: 8, username: 'staff', role_code: 'manager', permissions: JSON.stringify({ products: true, inventory: true }), role_permissions: '{}' }
const viewer = { ...staff, permissions: JSON.stringify({ products: true, inventory: true, product_cost_view: true }) }
const wire = { rows: [{ ...cream, before_qty: 7, after_qty: 12 }] }
const hidden = costs.projectAcquisitionCosts(wire, staff).rows[0]
ok(!('received_unit_cost_usd' in hidden) && !('received_total_cost_usd' in hidden) && !('unit_cost_usd' in hidden), 'without cost-view access the as-received costs are stripped')
ok(hidden.received_quantity === 5 && hidden.before_qty === 7 && hidden.after_qty === 12, 'the quantities and the stock balance stay visible')
const shown = costs.projectAcquisitionCosts(wire, viewer).rows[0]
ok(shown.received_unit_cost_usd === 4, 'a cost viewer still sees them')

console.log(`\n${checks} stock-in line balance checks passed`)
}
main().catch((error) => { console.error(error); process.exit(1) })

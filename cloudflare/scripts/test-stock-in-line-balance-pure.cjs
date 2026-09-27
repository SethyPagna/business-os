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
//   1d. a transfer between branches leaves the TOTAL unchanged on both legs
//       and on its reversal, a transfer onto another product row still moves
//       each total, a late-synced ISO-stamped sale is walked by its instant
//       (not its raw string), and a missing branch_stock row gives a null
//       branch pair -- each with a negative control that reproduces the
//       pre-fix walk and fails -- and the ledger's correlated walk agrees;
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
const got = (await ledger.loadMovementStockBalances(asD1(db), [3, 6])).balances
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
const windowed = (await ledger.loadMovementStockBalances(asD1(parity), allIds)).balances
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
  ['the reversed id tiebreak', ledger.MOVEMENT_STOCK_BALANCES_SQL.replace('ORDER BY instant DESC, event_id DESC', 'ORDER BY instant DESC, event_id ASC')],
  ['the default RANGE frame', ledger.MOVEMENT_STOCK_BALANCES_SQL.replace('GROUPS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING', '')],
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
  const { balances: found } = await ledger.loadMovementStockBalances(counting, ids)
  ok(prepares === 1 && alls === 1 && found.size === allIds.length, `${lineCount} lines cost ${prepares} prepare / ${alls} all -- one statement, not one per line`)
}
const plan = parity.prepare(`EXPLAIN QUERY PLAN ${ledger.MOVEMENT_STOCK_BALANCES_SQL}`).bind({ movementIds: '[10,16]' }).all().map((row) => row.detail)
console.log(`  plan:\n    ${plan.join('\n    ')}`)
ok(plan.some((detail) => detail.includes('SEARCH mn USING INDEX idx_inventory_movements_product_created_pg (product_id=? AND created_at>?)')), 'each touched product is a range seek on idx_inventory_movements_product_created_pg')
ok(!plan.some((detail) => /^SCAN (mn|m|inventory_movements)$/.test(detail)), 'no full scan of inventory_movements')
ok(plan.some((detail) => /SEARCH bs USING (COVERING )?INDEX idx_branch_stock_product_branch_unique/.test(detail)), 'the branch starting point is a unique-index lookup on branch_stock')

// ---- 1c. owner, 26 Sep: the branch pair AND the total pair ---------------
// A fixture where the two differ on every row, so a total shown as the
// branch (or the reverse) fails. Product 20 (current: Shop 7, Warehouse 10,
// total 17):
//   #30 add 8  @Warehouse 09-01   W 0 -> 8    total  0 -> 8
//   #31 add 10 @Shop      09-02   S 0 -> 10   total  8 -> 18
//   #32 sale 3 @Shop      09-03   S 10 -> 7   total 18 -> 15   <- the owner's example
//   #34 add 2  @Warehouse 09-04   W 8 -> 10   total 15 -> 17
// Product 21: #40 @Shop is followed by #41 with NO branch -- the branch walk
// cannot pass through it, so #40's branch pair is null, never a guess.
const branched = openDb(loadAll())
branched.exec(`
  INSERT INTO branches (id,name,is_active) VALUES (1,'Shop',1), (2,'Warehouse',1), (3,'Closed',0);
  INSERT INTO products (id,name,barcode,unit,stock_quantity,is_active) VALUES (20,'Balm','2020','pcs',17,1), (21,'Oil','2021','pcs',6,1);
  INSERT INTO branch_stock (product_id,branch_id,quantity) VALUES (20,1,7), (20,2,10), (21,1,5);
  INSERT INTO inventory_movements (id,product_id,product_name,branch_id,movement_type,quantity,created_at) VALUES
    (30,20,'Balm',2,'add',8,'2026-09-01 03:00:00'),
    (31,20,'Balm',1,'add',10,'2026-09-02 03:00:00'),
    (32,20,'Balm',1,'sale',3,'2026-09-03 03:00:00'),
    (34,20,'Balm',2,'add',2,'2026-09-04 03:00:00'),
    (40,21,'Oil',1,'add',5,'2026-09-01 03:00:00'),
    (41,21,'Oil',NULL,'add',1,'2026-09-02 03:00:00');
`)
const pairs = (b) => [b.branch_before_qty, b.branch_after_qty, b.before_qty, b.after_qty]
const both = await ledger.loadMovementStockBalances(asD1(branched), [30, 31, 32, 34, 40, 41])
ok(JSON.stringify(pairs(both.balances.get(32))) === JSON.stringify([10, 7, 18, 15]), 'the Shop sale reads Shop 10 -> 7 and Total 18 -> 15 (hand-computed)')
ok(JSON.stringify(pairs(both.balances.get(31))) === JSON.stringify([0, 10, 8, 18]), 'the Shop receipt reads Shop 0 -> 10, Total 8 -> 18')
ok(JSON.stringify(pairs(both.balances.get(30))) === JSON.stringify([0, 8, 0, 8]), 'the first Warehouse receipt walks back past the later Warehouse add: W 0 -> 8')
ok(JSON.stringify(pairs(both.balances.get(34))) === JSON.stringify([8, 10, 15, 17]), 'the later Warehouse receipt reads W 8 -> 10, Total 15 -> 17')
ok(pairs(both.balances.get(40)).slice(0, 2).every((value) => value === null) && both.balances.get(40).after_qty === 5, 'a newer unbranched movement makes the branch pair null; the total still reads')
ok(both.balances.get(41).branch_after_qty === null, 'a movement with no branch has no branch pair')
ok(both.activeBranchCount === 2, 'the active-branch count comes from data (2 active, 1 inactive)')
const brokenBranch = ledger.MOVEMENT_STOCK_BALANCES_SQL.replace('PARTITION BY product_id, branch_id', 'PARTITION BY product_id')
assert.notEqual(brokenBranch, ledger.MOVEMENT_STOCK_BALANCES_SQL)
const brokenRow = branched.prepare(brokenBranch).bind({ movementIds: '[32]' }).all()[0]
ok(Number(brokenRow.branch_after_qty) !== 7, 'negative control: a branch walk that is not partitioned by branch reads the wrong Shop balance here')
const fields = ledger.movementBalanceFields(both.balances.get(32))
ok(fields.before_qty === 18 && fields.after_qty === 15 && fields.total_before_qty === 18 && fields.total_after_qty === 15 && fields.branch_before_qty === 10 && fields.branch_after_qty === 7, 'the wire shape keeps before_qty/after_qty as the TOTAL and adds both named pairs')
ok(Object.values(ledger.movementBalanceFields(undefined)).every((value) => value === null), 'no balance -> every field null')
branched.exec(`UPDATE branches SET is_active = 0 WHERE id = 2`)
ok((await ledger.loadMovementStockBalances(asD1(branched), [32])).activeBranchCount === 1, 'after a merge leaves one active branch, the count says 1')

// ---- 1d. transfers, mixed timestamp formats, a missing branch row --------
// Refuter, 26 Sep. Shop retires into Warehouse through official transfers,
// so these rows are about to be written for every product.
//
// Product 50 (current: Shop 8, Warehouse 8, total 16). #64 is a sale synced
// late: its id is higher, and its ISO stamp '2026-09-02T02:00:00.000Z' sorts
// AFTER '2026-09-02 03:00:00' as a raw string ('T' > ' '), although it
// happened an hour BEFORE the transfer. #65/#66 reverse the transfer (what
// an undo writes); both legs of each transfer share one timestamp.
//   #60 add 10        @Shop  09-01 03:00  S  0 -> 10   total  0 -> 10
//   #61 add 8         @Ware  09-01T04:00Z W  0 -> 8    total 10 -> 18
//   #64 sale 2        @Shop  09-02T02:00Z S 10 -> 8    total 18 -> 16
//   #62 transfer_out 3 @Shop 09-02 03:00  S  8 -> 5    total 16 -> 16
//   #63 transfer_in 3  @Ware 09-02 03:00  W  8 -> 11   total 16 -> 16
//   #65 transfer_out 3 @Ware 09-03 03:00  W 11 -> 8    total 16 -> 16  (reversal)
//   #66 transfer_in 3  @Shop 09-03 03:00  S  5 -> 8    total 16 -> 16  (reversal)
// Products 51 -> 52: a transfer that lands on ANOTHER product row ("Added to
// existing product", transferOperation.ts) really moves each product's total.
// Product 53: its Shop row has no branch_stock row -- no branch pair.
const moved = openDb(loadAll())
moved.exec(`
  INSERT INTO branches (id,name,is_active) VALUES (1,'Shop',1), (2,'Warehouse',1);
  INSERT INTO products (id,name,barcode,unit,stock_quantity,is_active) VALUES
    (50,'Soap','5050','pcs',16,1), (51,'Gel','5051','pcs',7,1), (52,'Gel B','5052','pcs',3,1), (53,'Wax','5053','pcs',4,1);
  INSERT INTO branch_stock (product_id,branch_id,quantity) VALUES (50,1,8), (50,2,8), (51,1,7), (52,2,3);
  INSERT INTO inventory_movements (id,product_id,product_name,branch_id,movement_type,quantity,created_at) VALUES
    (60,50,'Soap',1,'add',10,'2026-09-01 03:00:00'),
    (61,50,'Soap',2,'add',8,'2026-09-01T04:00:00.000Z'),
    (62,50,'Soap',1,'transfer_out',3,'2026-09-02 03:00:00'),
    (63,50,'Soap',2,'transfer_in',3,'2026-09-02 03:00:00'),
    (64,50,'Soap',1,'sale',2,'2026-09-02T02:00:00.000Z'),
    (65,50,'Soap',2,'transfer_out',3,'2026-09-03 03:00:00'),
    (66,50,'Soap',1,'transfer_in',3,'2026-09-03 03:00:00'),
    (70,51,'Gel',1,'add',10,'2026-09-01 03:00:00'),
    (71,51,'Gel',1,'transfer_out',3,'2026-09-02 03:00:00'),
    (72,52,'Gel B',2,'transfer_in',3,'2026-09-02 03:00:00'),
    (80,53,'Wax',1,'add',4,'2026-09-01 03:00:00');
`)
const movedIds = [60, 61, 62, 63, 64, 65, 66, 70, 71, 72, 80]
const movedBalances = (await ledger.loadMovementStockBalances(asD1(moved), movedIds)).balances
const expected = {
  60: [0, 10, 0, 10], 61: [0, 8, 10, 18], 64: [10, 8, 18, 16],
  62: [8, 5, 16, 16], 63: [8, 11, 16, 16], 65: [11, 8, 16, 16], 66: [5, 8, 16, 16],
  70: [0, 10, 0, 10], 71: [10, 7, 10, 7], 72: [0, 3, 0, 3],
  80: [null, null, 0, 4],
}
for (const [id, want] of Object.entries(expected)) {
  assert.deepEqual(pairs(movedBalances.get(Number(id))), want, `movement ${id}: branch and total pairs (hand-computed)`)
}
ok(true, 'a Shop -> Warehouse transfer reads Total 16 -> 16 on BOTH legs, while each branch moves (hand-computed)')
ok([65, 66].every((id) => movedBalances.get(id).before_qty === 16 && movedBalances.get(id).after_qty === 16), 'the reversal (undo) legs also leave the total unchanged')
ok(movedBalances.get(71).after_qty === 7 && movedBalances.get(72).after_qty === 3, 'a transfer into ANOTHER product row still moves each product\'s own total')
ok(JSON.stringify(pairs(movedBalances.get(64))) === JSON.stringify([10, 8, 18, 16]), 'the late-synced ISO sale orders by its instant, not its raw string: Shop 10 -> 8')
ok(movedBalances.get(80).branch_before_qty === null && movedBalances.get(80).branch_after_qty === null && movedBalances.get(80).after_qty === 4, 'no branch_stock row -> the branch pair is null, never a guessed 0; the total still reads')
// The Stock Changes ledger (correlated walk + its own total delta) gives the
// same total for every one of these, so the ledger row and the float agree.
const movedLedger = new Map(ledger.attachBeforeQty(moved.prepare(ledger.buildStockLedgerQuery({}).rowsSql).bind({ limit: 100, offset: 0 }).all()).map((row) => [row.id, row]))
for (const id of movedIds) {
  const row = movedLedger.get(id)
  assert.deepEqual([row.before_qty, Number(row.after_qty)], [movedBalances.get(id).before_qty, movedBalances.get(id).after_qty], `movement ${id}: ledger row and float agree`)
}
ok(true, `the Stock Changes ledger rows agree with the float on all ${movedIds.length} transfer / mixed-format movements`)
// ---- 1e. the ledger LIST is in the walk's order (refuter, 26 Sep) ----------
// Newest first by instant, then id -- so on each product every row's
// "before" is the next older row's "after". Raw created_at put the ISO sale
// #64 (02:00Z) above the 03:00 transfer, breaking the chain. The expected
// order is hand-derived from the fixture's instants.
const ledgerPage = (filters, limit, offset) => moved.prepare(ledger.buildStockLedgerQuery(filters).rowsSql)
  .bind({ ...ledger.buildStockLedgerQuery(filters).params, limit, offset }).all().map((row) => row.id)
const byInstant = [66, 65, 72, 71, 63, 62, 64, 61, 80, 70, 60]
assert.deepEqual(ledgerPage({}, 100, 0), byInstant, 'the ledger lists by instant, then id')
ok(true, 'the Stock Changes list is ordered by instant, not by the raw created_at string (the ISO sale #64 sits below the 03:00 transfer)')
const productRows = attach => attach.filter((row) => row.product_id === 50)
const chain = productRows(ledger.attachBeforeQty(moved.prepare(ledger.buildStockLedgerQuery({}).rowsSql).bind({ limit: 100, offset: 0 }).all()))
ok(chain.length === 7 && chain.every((row, index) => index === chain.length - 1 || Number(row.before_qty) === Number(chain[index + 1].after_qty)),
  `each row's before is the next older row's after, all the way down (${chain.map((row) => `#${row.id} ${row.before_qty}->${row.after_qty}`).join(', ')})`)
// Paging must give the same order: every page size, every offset, with and
// without filters (the page is found through its raw dates, then re-sorted).
for (const filters of [{}, { productId: 50 }, { view: 'out' }, { branchId: 1 }]) {
  const whole = ledgerPage(filters, 100, 0)
  for (let size = 1; size <= 4; size += 1) {
    const paged = []
    for (let offset = 0; offset < whole.length + size; offset += size) paged.push(...ledgerPage(filters, size, offset))
    assert.deepEqual(paged, whole, `${JSON.stringify(filters)} page size ${size}`)
  }
}
ok(true, 'pages of every size, filtered or not, concatenate to exactly the whole ordered list')
{
  // the pre-fix order: the raw string (one page holds all 11 rows here)
  const rawOrder = ledger.buildStockLedgerQuery({}).rowsSql.replace('ORDER BY pg.instant DESC, m.id DESC', 'ORDER BY m.created_at DESC, m.id DESC')
  assert.notEqual(rawOrder, ledger.buildStockLedgerQuery({}).rowsSql)
  const rows = moved.prepare(rawOrder).bind({ limit: 100, offset: 0 }).all().map((row) => row.id)
  ok(JSON.stringify(rows) !== JSON.stringify(byInstant), 'negative control: ordering by the raw string lists this fixture differently')
}
const listPlan = moved.prepare(`EXPLAIN QUERY PLAN ${ledger.buildStockLedgerQuery({}).rowsSql}`).bind({ limit: 50, offset: 0 }).all().map((row) => row.detail)
console.log(`  ledger list plan (no filter):\n    ${listPlan.join('\n    ')}`)
ok(listPlan.some((detail) => detail === 'SCAN m USING INDEX idx_inventory_movements_created_pg' || detail === 'SCAN m USING COVERING INDEX idx_inventory_movements_created_pg'), 'the raw page is an ordered walk of idx_inventory_movements_created_pg (LIMIT stops it early)')
ok(listPlan.some((detail) => /^SEARCH m USING (COVERING )?INDEX idx_inventory_movements_created_pg \(created_at>\? AND created_at<\?\)$/.test(detail)), 'the page is a range seek over its own dates')
ok(listPlan.some((detail) => /^SEARCH m USING (COVERING )?INDEX idx_inventory_movements_created_pg \(created_at>\?\)$/.test(detail)), 'the rows ahead of the page are a range count')
ok(!listPlan.some((detail) => /^SCAN (m|mn|inventory_movements)$/.test(detail)), 'no full table scan of inventory_movements')
const productPlan = moved.prepare(`EXPLAIN QUERY PLAN ${ledger.buildStockLedgerQuery({ productId: 50 }).rowsSql}`).bind({ productId: 50, limit: 50, offset: 0 }).all().map((row) => row.detail)
console.log(`  ledger list plan (productId):\n    ${productPlan.join('\n    ')}`)
ok(productPlan.filter((detail) => /^SEARCH m USING (COVERING )?INDEX idx_inventory_movements_product_created_pg \(product_id=\?/.test(detail)).length >= 3
  && productPlan.includes('SEARCH m USING INDEX idx_inventory_movements_product_created_pg (product_id=? AND created_at>? AND created_at<?)'), 'filtered by product, every step seeks idx_inventory_movements_product_created_pg, the page over its own dates')

const ledgerPlan = moved.prepare(`EXPLAIN QUERY PLAN ${ledger.buildStockLedgerQuery({}).rowsSql}`).bind({ limit: 100, offset: 0 }).all().map((row) => row.detail)
ok(ledgerPlan.filter((detail) => detail.includes('SEARCH mn USING INDEX idx_inventory_movements_product_created_pg (product_id=? AND created_at>?)')).length >= 1, 'the ledger\'s correlated walk still range-seeks the product/created_at index')
for (const [label, broken] of [
  // the pre-fix walk: raw created_at strings, every transfer leg its own event
  ['raw created_at ordering', ledger.MOVEMENT_STOCK_BALANCES_SQL.replace(ledger.movementInstantSql('mn') + ' AS instant', 'mn.created_at AS instant')],
  ['a transfer leg walked as its own event', ledger.MOVEMENT_STOCK_BALANCES_SQL
    .replace('CASE WHEN transfer_leg = 1 THEN MIN(id) OVER (PARTITION BY product_id, instant, transfer_leg) ELSE id END AS event_id', 'id AS event_id')
    .replace('CASE WHEN transfer_leg = 1 THEN SUM(signed_quantity) OVER (PARTITION BY product_id, instant, transfer_leg) ELSE signed_quantity END AS total_delta', 'signed_quantity AS total_delta')],
  ['a guessed 0 for a missing branch_stock row', ledger.MOVEMENT_STOCK_BALANCES_SQL.replace('ELSE bs.quantity - COALESCE', 'ELSE COALESCE(bs.quantity, 0) - COALESCE').replace('OR bs.quantity IS NULL ', '')],
]) {
  assert.notEqual(broken, ledger.MOVEMENT_STOCK_BALANCES_SQL, `${label}: mutation applied`)
  const rows = new Map(ledger.attachBeforeQty(moved.prepare(broken).bind({ movementIds: JSON.stringify(movedIds) }).all()).map((row) => [row.id, row]))
  ok(Object.entries(expected).some(([id, want]) => {
    const row = rows.get(Number(id))
    const branchAfter = row.branch_after_qty == null ? null : Number(row.branch_after_qty)
    return JSON.stringify([branchAfter == null ? null : branchAfter - Number(row.signed_quantity), branchAfter, row.before_qty, Number(row.after_qty)]) !== JSON.stringify(want)
  }), `negative control: ${label} reads a wrong balance on this fixture`)
}

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
ok(/\.\.\.movementBalanceFields\(balance\)/.test(handler) && /active_branch_count: activeBranchCount/.test(handler), 'the handler returns both pairs (null when not derivable) and the active-branch count')
const inventoryRoute = fs.readFileSync(path.join(src, 'routes', 'inventory.ts'), 'utf8')
const balanceHandler = inventoryRoute.slice(inventoryRoute.indexOf("app.get('/movements/:id/balance'"), inventoryRoute.indexOf("app.get('/movements/:id/balance'") + 900)
ok(/loadMovementStockBalances\(getDb\(c\.env\), \[id\]\)/.test(balanceHandler) && /\.\.\.movementBalanceFields\(balances\.get\(id\)\), active_branch_count: activeBranchCount/.test(balanceHandler), 'the Movements balance endpoint returns the same two pairs from the same helper')
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

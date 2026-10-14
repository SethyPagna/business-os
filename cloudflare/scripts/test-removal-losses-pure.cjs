// P3-L5 / P3-losses-writeoff. STOCK REMOVED ENTIRELY IS A LOSS, AT COST PRICE.
//
// Owner, Sep 14 2026: "for the losses due to remove stock actions, i want in
// stat a break down of revenue/profit excluding the losses caused by this. and
// including caused by this ... this way i can see and understand both", and
// "if remove directly it also counts toward losses. as cost price no selling
// price means loss."
//
// COST-UNKNOWN RULE, owner 14 Oct 2026: "if cost is 0$ then it is 0 for loss.
// if it is none, it should also be unknown. flag it." A recorded 0 is a real
// $0 loss. A NULL cost is UNKNOWN: counted in removal_loss_unvalued_rows, never
// priced from the catalog, another lot of the product or a same-name product.
//
// This drives the REAL lib/removalLosses.ts -- both its SQL fragment (against
// a real SQLite database shaped like the migration chain) and its arithmetic.
// Every case below is built so the right implementation and an obvious wrong
// one DISAGREE on it; a fixture where every row is a loss would pass under
// "sum every outflow" and prove nothing.
//
// The fixture deliberately contains, in the same window and branch:
//
//   #1  a plain stock-change remove, 3 units, cost snapshot $2.50/u  -> $7.50
//   #2  a SALE of 4 units at the same cost                           -> not a loss
//   #3  a TRANSFER OUT of 5 units                                    -> not a loss
//   #4  a DAMAGE_OUT of 2 units (POS drawing from the damaged lot)   -> not a loss
//   #5  a remove of 10 units that was later REVERTED (#6 references it)
//                                                                    -> not a loss
//   #6  the revert counter-movement itself ('add', reference revert:5)
//   #7  a stock-session UNDO row: type 'remove', quantity NEGATIVE   -> not a loss
//   #8  a dated stock-count import remove (reason-excluded)          -> not a loss
//   #9  a remove with NO movement cost (NULL) but a lot cost of $4.00, 2 u -> $8.00
//  #10  a remove with no cost anywhere (NULL, no lot), 6 units       -> unvalued
//  #11  a remove OUTSIDE the date window                             -> not in range
//  #12  a LEGACY product-delete write_off, 8 units, no cost anywhere (NULL),
//       no reference_id -> COUNTS (write_off is in the loss set) but stays
//       UNVALUED: it is never silently valued at $0.
//
// "Sum every LEDGER_OUT_TYPES row"        would report 7.50+10+12.50+?+... -- fails #2/#3/#4.
// "Ignore reverts"                        would add #5's $25 -- fails case 2.
// "Trust reference_id blindly"            would add #6 -- fails case 2.
// "SUM(total_cost_usd) in SQL"            would subtract #7's negative cost -- fails case 3.
// "Price a missing cost from the catalog" would value #10/#12/#14 at a made-up cost -- fails 1b/1c/3.
// "Treat a recorded $0 as missing"        would price section 10's $0 rows at the catalog -- fails section 10.
// "Silently drop uncostable rows"         would report unvalued_rows 0 -- fails case 5.
//
// A SECOND, isolated fixture (branch 5, section 8 below) drives the two
// write_off writers this lane wired a revert marker for: DISPOSE
// (damagedLotActions.ts) and productDelete.ts's held-lot/sellable-stock
// drain. Kept off branch 2 on purpose so none of the arithmetic above has to
// change to make room for it.
//
// Run (from cloudflare/): node scripts/test-removal-losses-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const Database = require(path.join(root, 'node_modules', 'better-sqlite3'))

function load(file) {
  const filePath = path.join(root, 'src', file)
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const m = { exports: {} }
  new Function('require', 'module', 'exports', output)(require, m, m.exports)
  return m.exports
}

const lib = load(path.join('lib', 'removalLosses.ts'))

let checks = 0
function ok(label) { checks += 1; console.log(`PASS ${label}`) }

// ---------------------------------------------------------------------------
// A real database, columns and defaults copied from the migration chain:
// inventory_movements' cost columns are `DEFAULT 0` (0001) and batch_id was
// added by 0084. The catalog costs below are TRAPS: a wrong implementation
// that prices an unknown from the catalog, another lot or a twin lands on a
// number the right implementation never produces.
// ---------------------------------------------------------------------------
const sql = new Database(':memory:')
sql.exec(`
CREATE TABLE inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER, product_name TEXT, branch_id INTEGER, branch_name TEXT,
  movement_type TEXT, quantity REAL,
  unit_cost_usd REAL DEFAULT 0, unit_cost_khr REAL DEFAULT 0,
  total_cost_usd REAL DEFAULT 0, total_cost_khr REAL DEFAULT 0,
  reason TEXT, reference_id TEXT, user_id INTEGER, user_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, batch_id INTEGER
);
CREATE TABLE product_batches (id INTEGER PRIMARY KEY, variant_product_id INTEGER, unit_cost_usd REAL, is_active INTEGER DEFAULT 1, received_at TEXT);
CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, cost_price_usd REAL DEFAULT 0);

INSERT INTO products(id,name,cost_price_usd) VALUES (1,'Priced product',2.50),(2,'Lot-priced product',NULL),(3,'Costless product',NULL);
-- products.cost_price_usd is REAL DEFAULT 0 (migration 0001): an uncosted
-- product in production can carry a literal 0 as well as NULL. Neither is a
-- source for a removal's cost.
INSERT INTO products(id,name,cost_price_usd) VALUES (4,'Zero-cost-price product',0);
INSERT INTO product_batches(id,variant_product_id,unit_cost_usd) VALUES (77,2,4.00);
-- The catalog / other-lot / same-name-twin traps (branch 3, section 9): each
-- would have priced these removals under the retired fallback chain.
INSERT INTO products(id,name,cost_price_usd) VALUES
  (5,'Tier3 Product',NULL),           -- another lot of THIS product is costed
  (6,'Twin Product',NULL),            -- a same-name twin's lot is costed
  (7,'twin product',NULL),            -- the twin -- same normalized name, differs only by case
  (8,'Bulk deleted product',1.75);    -- priced catalog row, 'delete' movement with no cost of its own
INSERT INTO product_batches(id,variant_product_id,unit_cost_usd,received_at) VALUES
  (80,5,3.25,'2026-09-01 00:00:00'),  -- product 5's OTHER costed lot
  (81,5,NULL,'2026-09-05 00:00:00'),  -- the lot movement #21 actually draws from -- uncosted
  (90,7,5.50,'2026-09-01 00:00:00');  -- product 7 (the twin)'s costed lot
-- Section 10 (branch 4): recorded $0 vs unknown, with a $9 catalog cost beside every one.
INSERT INTO products(id,name,cost_price_usd) VALUES (9,'Catalog nine',9.00);
INSERT INTO product_batches(id,variant_product_id,unit_cost_usd,received_at) VALUES
  (78,9,0,   '2026-09-01 00:00:00'),  -- a lot whose RECORDED cost is $0 (free goods)
  (79,9,NULL,'2026-09-02 00:00:00'),  -- a lot whose cost was never recorded
  (76,9,4.00,'2026-09-03 00:00:00');  -- a costed lot of the same product

-- Local UTC+7 day 2026-09-10 runs 2026-09-09 17:00Z .. 2026-09-10 16:59Z.
INSERT INTO inventory_movements
  (id,product_id,branch_id,movement_type,quantity,unit_cost_usd,total_cost_usd,reason,reference_id,user_id,created_at,batch_id) VALUES
  ( 1,1,2,'remove',        3, 2.50,  7.50,'Spoiled',            NULL, 9,'2026-09-10 03:00:00',NULL),
  ( 2,1,2,'sale',          4, 2.50, 10.00,'Sale 1001',          '1001',9,'2026-09-10 03:10:00',NULL),
  ( 3,1,2,'transfer_out',  5, 2.50, 12.50,'To branch 3',        NULL, 9,'2026-09-10 03:20:00',NULL),
  ( 4,1,2,'damage_out',    2, 2.50,  5.00,'POS damaged sale',   '1002',9,'2026-09-10 03:30:00',NULL),
  ( 5,1,2,'remove',       10, 2.50, 25.00,'Miscounted',         NULL, 9,'2026-09-10 04:00:00',NULL),
  ( 6,1,2,'add',          10, 2.50, 25.00,'Revert of #5',  'revert:5', 9,'2026-09-10 04:05:00',NULL),
  ( 7,1,2,'remove',      -12, 2.50,-30.00,'Stock session 4 undo generation 2','4',9,'2026-09-10 05:00:00',NULL),
  ( 8,1,2,'remove',        7, 0.00,  0.00,'Dated stock count import', NULL,9,'2026-09-10 06:00:00',NULL),
  ( 9,2,2,'remove',        2, NULL, NULL,'Broken, removed entirely', NULL,9,'2026-09-10 07:00:00',77),
  (10,3,2,'remove',        6, NULL, NULL,'No cost anywhere',   NULL, 9,'2026-09-10 08:00:00',NULL),
  (11,1,2,'remove',      100, 2.50,250.00,'Next month',         NULL, 9,'2026-10-02 03:00:00',NULL),
  -- #12: write_off is IN the loss set (REMOVAL_LOSS_MOVEMENT_TYPES). This row
  -- has no reference_id (a legacy/unmarked write_off), so it is presumed never
  -- reverted and COUNTS -- but on product 3, which has no cost anywhere, so it
  -- lands in unvalued_rows, never priced at $0.00.
  (12,3,2,'write_off',     8, NULL, NULL,'Removed product Widget',   NULL,9,'2026-09-10 09:00:00',NULL),
  (13,1,2,'adjustment',   -4, 0.00,  0.00,'Merged duplicate into #1', NULL,9,'2026-09-10 09:30:00',NULL),
  -- #14: no movement cost, no lot, and the product's cost_price_usd sits at the
  -- column's literal 0. That 0 is not a source for THIS movement's cost, and the
  -- movement itself recorded nothing: unknown, exactly like #10.
  (14,4,2,'remove',        3, NULL, NULL,'No cost anywhere, zero-cost product', NULL,9,'2026-09-10 09:45:00',NULL),
  -- ----------------------------------------------------------------------
  -- Branch 5: isolated from every assertion above (readRows() defaults to
  -- branch 2), driving the two write_off writers whose revert marker this
  -- lane wired.
  --
  --  #15 DISPOSE (damagedLotActions.ts planDisposeTagged): reference_id
  --      'damaged_lot:<lotId>' (stockCondition.ts damagedLotReference), own
  --      cost snapshot from the lot -> COUNTS, at its own $18.00.
  --  #16 the SAME shape, but with a hypothetical future revert (#17) --
  --      DISPOSE has NO real undo path today (the ledger's generic revert
  --      refuses anything carrying this marker -- stockRevert.ts -- and
  --      there is no "un-dispose" action), so this pair only proves the
  --      exclusion mechanism is generic, not that this scenario happens yet.
  --  #17 the hypothetical revert counter for #16 ('add', 'revert:damaged_lot:502').
  --  #18 productDelete.ts, a LIVE (never undone) delete's write_off with no
  --      recorded cost -> COUNTS, UNVALUED (the catalog is not a source).
  --  #19 productDelete.ts, a delete's write_off that WAS undone (#20 is its
  --      counter) -> excluded.
  --  #20 the undo counter for #19 ('add', 'revert:product_remove:op-undone:0').
  (15,1,5,'write_off',     3, 6.00, 18.00,'Broken, disposed', 'damaged_lot:501',9,'2026-09-10 10:00:00',NULL),
  (16,1,5,'write_off',     2, 5.00, 10.00,'Broken, disposed', 'damaged_lot:502',9,'2026-09-10 10:10:00',NULL),
  (17,1,5,'add',           2, 5.00, 10.00,'Hypothetical restore of #16', 'revert:damaged_lot:502',9,'2026-09-10 10:11:00',NULL),
  (18,1,5,'write_off',     5, NULL, NULL,'Removed product Gadget', 'product_remove:op-live:0',9,'2026-09-10 10:20:00',NULL),
  (19,1,5,'write_off',     9, NULL, NULL,'Removed product Gizmo',  'product_remove:op-undone:0',9,'2026-09-10 10:30:00',NULL),
  (20,1,5,'add',           9, NULL, NULL,'Undo: Removed product Gizmo', 'revert:product_remove:op-undone:0',9,'2026-09-10 10:31:00',NULL),
  -- ----------------------------------------------------------------------
  -- Branch 3: the retired fallback tiers, now all UNKNOWN, plus the 'delete'
  -- movement type.
  --
  --  #21 draws from batch 81 (product 5's OWN lot, but THAT lot is
  --      uncosted) while product 5's OTHER lot 80 is costed at $3.25. The
  --      other lot is not this lot's cost -> unvalued.
  --  #22 product 6 has no batches and no cost_price_usd; the SAME-NAME twin
  --      (product 7) has a $5.50 lot. Another product's cost is not this
  --      one's -> unvalued.
  --  #23 a LIVE 'delete' row, reference_id 'bulk_delete:job-live', no cost of
  --      its own, on product 8 whose catalog cost is $1.75 -> unvalued.
  --  #24 a 'delete' row that WAS undone (#25 is its counter) -> excluded.
  --  #25 the undo counter for #24.
  (21,5,3,'remove',   2, NULL, NULL,'Tier3 fallback test',              NULL,                    9,'2026-09-10 03:00:00',81),
  (22,6,3,'remove',   4, NULL, NULL,'Tier4 twin fallback test',         NULL,                    9,'2026-09-10 03:10:00',NULL),
  (23,8,3,'delete',   5, NULL, NULL,'Bulk delete of Bulk deleted product','bulk_delete:job-live', 9,'2026-09-10 03:20:00',NULL),
  (24,8,3,'delete',   3, NULL, NULL,'Bulk delete, later undone',        'bulk_delete:job-undone',9,'2026-09-10 03:30:00',NULL),
  (25,8,3,'add',      3, NULL, NULL,'Undo: bulk delete', 'revert:bulk_delete:job-undone',         9,'2026-09-10 03:31:00',NULL),
  -- ----------------------------------------------------------------------
  -- Branch 4: a recorded $0 versus an unknown cost, each with a $9.00
  -- catalog price beside it (product 9).
  --
  --  #26 3 units from lot 78 (recorded $0), movement cost NULL -> $0, KNOWN.
  --      Retired chain: NULLIF(lot,0) fell to the catalog -> $27.
  --  #27 3 units, movement columns left at the DEFAULT 0 (what a writer that
  --      omits them stores), no lot -> a recorded $0, KNOWN. Retired: $27.
  --  #28 3 units from lot 79 (cost never recorded), movement NULL, catalog $9
  --      -> UNKNOWN. Retired: $27.
  --  #29 3 units from lot 76 (recorded $4), movement NULL -> $12 (control:
  --      the removed item's OWN lot cost is a legitimate source).
  --  #30 3 units, no lot, movement unit $2 with the total column left at 0 ->
  --      $6: a positive snapshot beside an unfilled 0 prices the row.
  --  #31 3 units, movement TOTAL $5 and unit NULL -> $5.
  (26,9,4,'remove',   3, NULL, NULL,'Free lot, removed',           NULL,9,'2026-09-10 03:00:00',78),
  (27,9,4,'remove',   3, 0.00, 0.00,'Default-zero writer',         NULL,9,'2026-09-10 03:10:00',NULL),
  (28,9,4,'remove',   3, NULL, NULL,'Unrecorded lot, removed',     NULL,9,'2026-09-10 03:20:00',79),
  (29,9,4,'remove',   3, NULL, NULL,'Costed lot, removed',         NULL,9,'2026-09-10 03:30:00',76),
  (30,9,4,'remove',   3, 2.00, 0.00,'Unit filled, total unfilled', NULL,9,'2026-09-10 03:40:00',NULL),
  (31,9,4,'remove',   3, NULL, 5.00,'Total only',                  NULL,9,'2026-09-10 03:50:00',NULL);
`)

// The business-day clause, byte-copied from lib/businessDateWindow.ts's
// localDateRangeClause so the test exercises the SAME window the sales kernel
// buckets by -- if that helper changes shape, this fixture stops agreeing.
const dayWindow = (col) =>
  `date(datetime(${col}, '+7 hours')) >= @startDate AND ${col} >= date(@startDate, '-1 day')` +
  ` AND date(datetime(${col}, '+7 hours')) <= @endDate AND ${col} < date(@endDate, '+1 day')`

function readRows(params = { startDate: '2026-09-10', endDate: '2026-09-10', branchId: 2 }) {
  const query = `SELECT ${lib.REMOVAL_LOSS_SELECT} ${lib.REMOVAL_LOSS_FROM}
    WHERE ${lib.removalLossMovementWhere('m')} AND ${dayWindow('m.created_at')} AND m.branch_id = @branchId`
  const values = []
  const text = query.replace(/@(\w+)/g, (_, key) => { values.push(params[key] ?? null); return '?' })
  return sql.prepare(text).all(...values)
}

// ---------------------------------------------------------------------------
// 1. The SQL selects the removals and NOTHING else that left the shelf.
// ---------------------------------------------------------------------------
{
  const rows = readRows()
  const ids = rows.map((r) => Number(r.id)).sort((a, b) => a - b)
  assert.deepEqual(ids, [1, 9, 10, 12, 14], `only the real removals are selected, got ${JSON.stringify(ids)}`)
  ok('SQL: sale, transfer_out and damage_out are not losses')
  ok('SQL: a reverted removal (#5) and the revert row itself (#6) are both excluded')
  ok('SQL: a negative-quantity stock-session undo (#7) is excluded')
  ok('SQL: a dated stock-count import removal (#8) is excluded')
  ok('SQL: a removal outside the window (#11) is excluded')
  ok('SQL: a LEGACY product-deletion write_off with no revert marker (#12) COUNTS, presumed live since nothing ever marked it reverted -- but stays unvalued, nothing recorded its cost')
  ok('SQL: a duplicate-merge adjustment (#13) is excluded -- a negative-quantity catalog cleanup, not destroyed goods')

  // The set is ONE constant so an owner ruling moves the boundary in one edit,
  // and the types below are outside it by NAME, not by accident.
  assert.deepEqual([...lib.REMOVAL_LOSS_MOVEMENT_TYPES], ['remove', 'write_off', 'delete'])
  for (const type of ['adjustment', 'damage_out', 'transfer_out', 'sale']) {
    assert.equal(lib.REMOVAL_LOSS_MOVEMENT_TYPES.includes(type), false, `${type} is not a removal loss`)
  }
  // P3-losses-writeoff (Sep 15 2026), owner ruling: "if remove directly it
  // also counts toward losses" applies just as much to disposing a tagged
  // (broken/damaged/...) row and to a product delete that destroys held or
  // sellable stock -- both write 'write_off', and both now carry a revert
  // marker their own undo can exclude by (section 8 below proves it).
  assert.equal(lib.REMOVAL_LOSS_MOVEMENT_TYPES.includes('write_off'), true, 'write_off IS a removal loss now')
}

// ---------------------------------------------------------------------------
// 1a. The valuation source is the removed item's OWN cost and nothing else.
//     Source-shape pins so a catalog / other-lot / twin tier cannot be put back
//     without this test noticing (the behavioural cases are 1b/1c and 9/10).
// ---------------------------------------------------------------------------
{
  assert.doesNotMatch(lib.REMOVAL_LOSS_SELECT, /NULLIF/i, 'no NULLIF(...,0): a recorded $0 must stay $0')
  assert.doesNotMatch(lib.REMOVAL_LOSS_SELECT, /cost_price_usd/, 'the catalog cost is never a source')
  assert.doesNotMatch(lib.REMOVAL_LOSS_SELECT, /product_batches pb[23]/, 'no other-lot or twin-lot lookup')
  assert.doesNotMatch(lib.REMOVAL_LOSS_FROM, /JOIN products/i, 'the catalog row is not even joined')
  assert.match(lib.REMOVAL_LOSS_SELECT, /pb\.unit_cost_usd AS own_lot_unit_cost_usd/, "the removed lot's own cost is selected as-is")
  ok('the SELECT carries only the movement snapshot and its own lot cost: no catalog, other-lot or twin tier, no NULLIF')
}

// ---------------------------------------------------------------------------
// 1b. Valuation happens at READ time from the item's own cost. #9 carries no
//     cost snapshot (NULL) and is priced from its own lot.
// ---------------------------------------------------------------------------
{
  const row = readRows().find((r) => Number(r.id) === 9)
  assert.ok(row, '#9 is selected')
  assert.equal(row.unit_cost_usd, null, 'the movement itself recorded no cost')
  assert.equal(row.total_cost_usd, null)
  assert.equal(Number(row.own_lot_unit_cost_usd), 4, "the removed lot's own cost is read at query time")
  assert.equal(lib.removalRowLossUsd(row), 8, '2 units x the $4.00 lot cost')
  ok("a removal with no cost snapshot is valued from its OWN lot's recorded cost at read time")
}

// ---------------------------------------------------------------------------
// 1c. A catalog cost is NEVER a source. #14's product has a literal 0 catalog
//     cost and #10's none at all; neither movement recorded a cost -> unknown.
// ---------------------------------------------------------------------------
{
  for (const id of [10, 14]) {
    const row = readRows().find((r) => Number(r.id) === id)
    assert.ok(row, `#${id} is selected`)
    assert.equal(row.unit_cost_usd, null)
    assert.equal(row.own_lot_unit_cost_usd, null, 'no lot, so no own cost')
    assert.equal(lib.removalRowLossUsd(row), null, `#${id}: nothing recorded -> unknown, not $0.00`)
  }
  assert.equal(lib.removalRowLossUsd({ quantity: 2, total_cost_usd: null, unit_cost_usd: null, own_lot_unit_cost_usd: null }), null)
  assert.equal(lib.removalRowLossUsd({ quantity: 2, fallback_unit_cost_usd: 9, catalog_cost: 9 }), null,
    'a stale caller still passing a catalog/fallback figure gets nothing from it')
  ok('a removal with no recorded cost anywhere is unknown, counted as unvalued -- never priced at $0.00 and never from the catalog')
}

// ---------------------------------------------------------------------------
// 2. The revert guard is real, not incidental: delete the revert row and #5
//    comes back as a $25 loss. Without this the first case could pass under an
//    implementation that never looked at reverts at all.
// ---------------------------------------------------------------------------
{
  sql.exec('UPDATE inventory_movements SET reference_id = NULL WHERE id = 6')
  const ids = readRows().map((r) => Number(r.id)).sort((a, b) => a - b)
  assert.deepEqual(ids, [1, 5, 9, 10, 12, 14], 'with the revert unlinked, #5 is a loss again')
  const withRevertGone = lib.summarizeRemovalLosses(readRows())
  // #10, #12 and #14 are unvalued so they add $0 to the dollar total -- only
  // the ids list and unvalued_rows count change.
  assert.equal(withRevertGone.removal_loss_usd, 40.5, '7.50 + 25.00 + 8.00, the unvalued rows contribute $0')
  assert.equal(withRevertGone.removal_loss_unvalued_rows, 3, '#10, #12 and #14')
  sql.exec(`UPDATE inventory_movements SET reference_id = 'revert:5' WHERE id = 6`)
  ok('the revert exclusion changes the answer (positive control)')
}

// ---------------------------------------------------------------------------
// 3. Valuation: movement snapshot, then the item's own lot, then unknown.
// ---------------------------------------------------------------------------
{
  const summary = lib.summarizeRemovalLosses(readRows())
  //  #1 = 3 x 2.50 from its own snapshot ($7.50)
  //  #9 = 2 x 4.00 from its OWN lot, because its snapshot is NULL
  // #10 = 6 units, nothing recorded -> unknown
  // #12 = 8 units, nothing recorded -> unknown
  // #14 = 3 units, nothing recorded (the catalog's literal 0 is not a record) -> unknown
  assert.equal(summary.removal_loss_usd, 15.5, '7.50 + 8.00, and #10/#12/#14 add nothing they cannot prove')
  assert.equal(summary.removal_loss_qty, 22, '3 + 2 + 6 + 8 + 3 units left the shelf')
  assert.equal(summary.removal_loss_unvalued_rows, 3, 'all three unknown rows are REPORTED, not dropped silently')
  assert.equal(lib.isRemovalLossComplete(summary), false, 'a total with unknown rows says it is partial')
  assert.equal(lib.isRemovalLossComplete({ removal_loss_unvalued_rows: 0 }), true)
  ok('cost comes from the movement snapshot, then the removed lot, then is declared unknown')
}

// ---------------------------------------------------------------------------
// 4. Valuation order, and a recorded $0 is a real $0.
// ---------------------------------------------------------------------------
{
  const price = (row) => lib.removalRowLossUsd({ quantity: 2, ...row })
  assert.equal(price({ total_cost_usd: 9, unit_cost_usd: 0, own_lot_unit_cost_usd: 4 }), 9, 'total snapshot first')
  assert.equal(price({ total_cost_usd: null, unit_cost_usd: 3, own_lot_unit_cost_usd: 4 }), 6, 'then unit x quantity')
  assert.equal(price({ total_cost_usd: null, unit_cost_usd: null, own_lot_unit_cost_usd: 4 }), 8, 'then the removed lot')
  assert.equal(price({ total_cost_usd: null, unit_cost_usd: null, own_lot_unit_cost_usd: null }), null, 'then unknown')
  assert.equal(price({ total_cost_usd: null, unit_cost_usd: null, own_lot_unit_cost_usd: 0 }), 0, "a lot recorded at $0 is a real $0, not a hole to fill from the catalog")
  assert.equal(price({ total_cost_usd: 0, unit_cost_usd: 0, own_lot_unit_cost_usd: 4 }), 0, 'a recorded 0/0 snapshot is a real $0 and beats the lot')
  assert.equal(price({ total_cost_usd: 0, unit_cost_usd: null, own_lot_unit_cost_usd: 4 }), 0, 'a recorded total of 0 is a real $0')
  assert.equal(price({ total_cost_usd: null, unit_cost_usd: 0, own_lot_unit_cost_usd: 4 }), 0, 'a recorded unit cost of 0 is a real $0')
  assert.equal(price({ total_cost_usd: 0, unit_cost_usd: 2, own_lot_unit_cost_usd: null }), 4, 'a positive unit beside an unfilled total of 0 prices the row')
  assert.equal(price({ total_cost_usd: 5, unit_cost_usd: 0, own_lot_unit_cost_usd: null }), 5, 'a positive total beside an unfilled unit of 0 prices the row')
  assert.equal(price({ total_cost_usd: '', unit_cost_usd: undefined, own_lot_unit_cost_usd: 'x' }), null, 'blank, missing and non-numeric values are unknown')
  assert.equal(lib.removalRowLossUsd({ quantity: 0, total_cost_usd: null }), 0, 'no quantity, no loss')
  ok('valuation order: total > unit x qty > own lot > unknown, and a recorded 0 is $0 at every step')
}

// ---------------------------------------------------------------------------
// 5. The two views sit SIDE BY SIDE, and the "including" one may go negative.
//    The owner asked to see both; clamping the loss view at zero would erase
//    exactly the month they need to see.
// ---------------------------------------------------------------------------
{
  const loss = { removal_loss_usd: 120, removal_loss_qty: 40, removal_loss_unvalued_rows: 0 }
  const out = lib.removalLossTotals(100, 30, loss)
  assert.equal(out.revenue_after_losses_usd, -20)
  assert.equal(out.profit_after_losses_usd, -90, 'profit including the losses is allowed to be negative')
  assert.equal(out.removal_loss_usd, 120)
  assert.equal(out.removal_loss_qty, 40)
  const none = lib.removalLossTotals(100, 30, lib.EMPTY_REMOVAL_LOSS)
  assert.equal(none.revenue_after_losses_usd, 100, 'no losses -> the two views agree exactly')
  assert.equal(none.profit_after_losses_usd, 30)
  assert.deepEqual(Object.keys(out).sort(), ['profit_after_losses_usd', 'removal_loss_qty', 'removal_loss_unvalued_rows', 'removal_loss_usd', 'revenue_after_losses_usd'],
    'the totals block keeps its five gated keys; completeness is read with isRemovalLossComplete so no ungated key leaks')
  ok('profit_after_losses is unclamped and the no-loss case is an identity')
}

// ---------------------------------------------------------------------------
// 6. Bucketing keeps a period's losses with that period's sales.
// ---------------------------------------------------------------------------
{
  const byDay = lib.removalLossesByBucket(
    [
      { quantity: 1, total_cost_usd: 5, created_at: '2026-09-10 03:00:00' },
      { quantity: 1, total_cost_usd: 7, created_at: '2026-09-11 03:00:00' },
      { quantity: 2, total_cost_usd: 4, created_at: '2026-09-10 09:00:00' },
      { quantity: 1, total_cost_usd: null, created_at: '2026-09-10 10:00:00' },
    ],
    (row) => String(row.created_at).slice(0, 10),
  )
  assert.equal(byDay.get('2026-09-10').removal_loss_usd, 9)
  assert.equal(byDay.get('2026-09-10').removal_loss_qty, 4)
  assert.equal(byDay.get('2026-09-10').removal_loss_unvalued_rows, 1, 'the unknown row stays in its own period')
  assert.equal(byDay.get('2026-09-11').removal_loss_usd, 7)
  ok('per-period buckets sum to the range total')
}

// ---------------------------------------------------------------------------
// 7. The duplicated constants must not drift from the modules they mirror.
// ---------------------------------------------------------------------------
{
  const datedSource = fs.readFileSync(path.join(root, 'src', 'lib', 'datedStockCountImport.ts'), 'utf8')
  const match = datedSource.match(/DATED_STOCK_COUNT_REASON\s*=\s*'([^']+)'/)
  assert.ok(match, 'datedStockCountImport.ts still declares DATED_STOCK_COUNT_REASON')
  assert.ok(
    lib.REMOVAL_LOSS_EXCLUDED_REASONS.includes(match[1]),
    `the excluded-reason set must still carry "${match[1]}"`,
  )
  // The loss set is deliberately narrower than the ledger's OUT list. Pin the
  // two types whose inclusion would be a real accounting error.
  const types = [...lib.REMOVAL_LOSS_MOVEMENT_TYPES]
  assert.ok(types.includes('remove'), 'the stock-change remove action is a loss')
  // P3-losses-writeoff (Sep 15 2026): write_off is IN the set now that DISPOSE
  // and productDelete's undo both carry a revert marker (section 8 below).
  assert.ok(types.includes('write_off'), 'a disposed tagged row or a deleted product with drained stock is a loss')
  assert.ok(!types.includes('sale'), 'a sale is never a loss')
  assert.ok(!types.includes('damage_out'), 'damage_out is a DRAW from the damaged lot, i.e. a sale')
  assert.ok(!types.includes('transfer_out'), 'transferred stock is still ours')
  ok('the excluded-reason and movement-type constants agree with their sources')
}

// ---------------------------------------------------------------------------
// 8. write_off, isolated on branch 5 so nothing above has to change: DISPOSE
//    (damagedLotActions.ts) and productDelete.ts both count once live, and
//    both are excluded once their own undo marks them reverted.
// ---------------------------------------------------------------------------
{
  const rows = readRows({ startDate: '2026-09-10', endDate: '2026-09-10', branchId: 5 })
  const ids = rows.map((r) => Number(r.id)).sort((a, b) => a - b)
  assert.deepEqual(ids, [15, 18], `only the live (never-reverted) write_offs are selected, got ${JSON.stringify(ids)}`)
  ok('a disposed tagged lot (#15) counts, at its own cost snapshot')
  ok('a live product-delete write_off (#18) counts -- as UNKNOWN, product 1 has a $2.50 catalog cost that is not its cost')
  ok('a disposed lot with a matching revert counter (#16/#17) is excluded')
  ok('a product-delete write_off with a matching undo counter (#19/#20) is excluded')

  const summary = lib.summarizeRemovalLosses(rows)
  assert.equal(summary.removal_loss_usd, 18, '18.00 (#15, own snapshot); #18 has no recorded cost and is not priced from the catalog')
  assert.equal(summary.removal_loss_qty, 8, '3 + 5 units')
  assert.equal(summary.removal_loss_unvalued_rows, 1, '#18 is flagged')

  // The writer that still omits its cost columns stores the DEFAULT 0/0, which
  // IS a recorded $0 under the owner's rule. Pinned so the day productDelete
  // writes NULL (or the lot cost) the number moves on purpose, not by accident.
  assert.equal(lib.removalRowLossUsd({ quantity: 5, unit_cost_usd: 0, total_cost_usd: 0, own_lot_unit_cost_usd: null }), 0)

  // Positive control: break the marker match (typo the revert's reference) and
  // #16/#19 come back as losses -- proving the exclusion is doing the work,
  // not that these rows were unreachable some other way.
  sql.exec(`UPDATE inventory_movements SET reference_id = 'revert:damaged_lot:WRONG' WHERE id = 17`)
  sql.exec(`UPDATE inventory_movements SET reference_id = 'revert:product_remove:op-undone:WRONG' WHERE id = 20`)
  const withMarkersBroken = readRows({ startDate: '2026-09-10', endDate: '2026-09-10', branchId: 5 })
    .map((r) => Number(r.id)).sort((a, b) => a - b)
  assert.deepEqual(withMarkersBroken, [15, 16, 18, 19], 'with the revert markers broken, #16 and #19 are losses again')
  sql.exec(`UPDATE inventory_movements SET reference_id = 'revert:damaged_lot:502' WHERE id = 17`)
  sql.exec(`UPDATE inventory_movements SET reference_id = 'revert:product_remove:op-undone:0' WHERE id = 20`)
  ok('the reference_id-keyed revert exclusion changes the answer (positive control)')
}

// ---------------------------------------------------------------------------
// 9. The retired fallback tiers, isolated on branch 3. Under the old chain
//    #21 priced at $3.25/u from another lot, #22 at $5.50/u from a same-name
//    twin and #23 at $1.75/u from the catalog. None of those is the removed
//    item's own cost: all three are UNKNOWN now.
// ---------------------------------------------------------------------------
{
  const rows = readRows({ startDate: '2026-09-10', endDate: '2026-09-10', branchId: 3 })
  const ids = rows.map((r) => Number(r.id)).sort((a, b) => a - b)
  assert.deepEqual(ids, [21, 22, 23], `only the live delete + both former-fallback removes are selected, got ${JSON.stringify(ids)}`)
  ok('a bulk-delete "delete" row with a matching undo counter (#24/#25) is excluded, same shape as write_off')

  const other = rows.find((r) => Number(r.id) === 21)
  assert.equal(other.own_lot_unit_cost_usd, null, "the lot it drew from (81) has no recorded cost")
  assert.equal(lib.removalRowLossUsd(other), null, "product 5's OTHER lot (80, $3.25) is not this lot's cost -- was $6.50")
  ok("another lot of the same product no longer prices a removal: unknown")

  const twin = rows.find((r) => Number(r.id) === 22)
  assert.equal(lib.removalRowLossUsd(twin), null, "a same-name twin's lot ($5.50) is another product's cost -- was $22.00")
  ok('a same-name twin product no longer prices a removal: unknown')

  const del = rows.find((r) => Number(r.id) === 23)
  assert.equal(lib.removalRowLossUsd(del), null, "the catalog cost ($1.75) is not a source -- was $8.75")
  ok("a 'delete' movement with no cost of its own is unknown, not priced from the catalog")

  const summary = lib.summarizeRemovalLosses(rows)
  assert.equal(summary.removal_loss_usd, 0, 'nothing here has a recorded cost')
  assert.equal(summary.removal_loss_qty, 11, '2 + 4 + 5 units')
  assert.equal(summary.removal_loss_unvalued_rows, 3, 'all three are flagged, none dropped')
  ok('branch-3 totals: three unknown rows, $0 of known loss, nothing priced from a substitute')

  // Positive control: record the lot's own cost and #21 prices from it,
  // proving the row IS reachable and the unknown above is the data, not a bug.
  sql.exec(`UPDATE product_batches SET unit_cost_usd = 3.25 WHERE id = 81`)
  const withLotCost = readRows({ startDate: '2026-09-10', endDate: '2026-09-10', branchId: 3 }).find((r) => Number(r.id) === 21)
  assert.equal(lib.removalRowLossUsd(withLotCost), 6.5, 'once its own lot has a cost, 2 x $3.25')
  sql.exec(`UPDATE product_batches SET unit_cost_usd = NULL WHERE id = 81`)
  ok('recording the removed lot\'s own cost changes the answer (positive control)')
}

// ---------------------------------------------------------------------------
// 10. A recorded $0 is a real $0; an unrecorded cost is unknown. Branch 4, with
//     a $9.00 catalog price on the product so any substitution shows.
// ---------------------------------------------------------------------------
{
  const rows = readRows({ startDate: '2026-09-10', endDate: '2026-09-10', branchId: 4 })
  const byId = (id) => rows.find((r) => Number(r.id) === id)
  assert.deepEqual(rows.map((r) => Number(r.id)).sort((a, b) => a - b), [26, 27, 28, 29, 30, 31])

  assert.equal(Number(byId(26).own_lot_unit_cost_usd), 0, 'a lot recorded at $0 is selected as 0, not folded into NULL')
  assert.equal(lib.removalRowLossUsd(byId(26)), 0, '3 units from a $0 lot -> loss $0 (the retired chain said $27)')
  assert.equal(lib.removalRowLossUsd(byId(27)), 0, 'a recorded 0/0 snapshot -> loss $0 (the retired chain said $27)')
  assert.equal(lib.removalRowLossUsd(byId(28)), null, 'a lot with no recorded cost -> unknown (the retired chain said $27)')
  assert.equal(lib.removalRowLossUsd(byId(29)), 12, 'control: the removed lot\'s own $4 cost still prices it -> 3 x $4')
  assert.equal(lib.removalRowLossUsd(byId(30)), 6, 'unit $2 beside an unfilled total of 0 -> 3 x $2')
  assert.equal(lib.removalRowLossUsd(byId(31)), 5, 'total $5 beside a NULL unit -> $5')
  ok('recorded $0 -> $0 loss; unrecorded -> unknown; own lot $4 -> $12; partial snapshot pairs price from the positive side')

  const summary = lib.summarizeRemovalLosses(rows)
  assert.equal(summary.removal_loss_usd, 23, '0 + 0 + 12 + 6 + 5, the unknown row adds nothing')
  assert.equal(summary.removal_loss_qty, 18)
  assert.equal(summary.removal_loss_unvalued_rows, 1, 'only #28 is unknown; the two $0 rows are KNOWN and not flagged')
  assert.equal(lib.summarizeRemovalLosses(rows, 4).removal_loss_usd, 23, 'the 4-place bucket variant agrees')
  ok('branch-4 totals: $23 known, exactly one unknown row; the recorded $0 rows are not counted as unknown')

  // Discriminator: a NULLIF(...,0) / "0 means missing" implementation prices
  // #26 and #27 at the $9 catalog and reports a different pair.
  const naive = rows.map((r) => {
    const total = Number(r.total_cost_usd) || 0
    const unit = Number(r.unit_cost_usd) || 0
    const own = Number(r.own_lot_unit_cost_usd) || 0
    return total ? total : unit ? unit * r.quantity : own ? own * r.quantity : 9 * r.quantity
  })
  assert.notEqual(naive.reduce((a, b) => a + b, 0), summary.removal_loss_usd, 'the fixture separates "0 means missing" from "0 is a cost"')
  ok('the fixture distinguishes a recorded $0 from a missing cost (positive control)')
}

console.log(`\nOK - ${checks} checks passed`)

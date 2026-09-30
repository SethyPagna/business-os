// P3-L5 / P3-losses-writeoff. STOCK REMOVED ENTIRELY IS A LOSS, AT COST PRICE.
//
// Owner, Sep 14 2026: "for the losses due to remove stock actions, i want in
// stat a break down of revenue/profit excluding the losses caused by this. and
// including caused by this ... this way i can see and understand both", and
// "if remove directly it also counts toward losses. as cost price no selling
// price means loss."
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
//   #9  a remove with NO movement cost but a lot cost of $4.00, 2 u  -> $8.00
//  #10  a remove with no cost anywhere, 6 units                      -> unvalued
//  #11  a remove OUTSIDE the date window                             -> not in range
//  #12  P3-losses-writeoff (Sep 15 2026): a LEGACY product-delete write_off,
//       8 units, no cost anywhere, no reference_id -> COUNTS now (write_off
//       moved INTO the loss set once its writers' undo carries a revert
//       marker -- see REMOVAL_LOSS_MOVEMENT_TYPES), but stays UNVALUED
//       (product 3 has no cost_price_usd either). This is the fixture that
//       used to pin write_off as excluded outright; it still proves a
//       legacy/unmarked write_off is never silently valued at $0.
//
// "Sum every LEDGER_OUT_TYPES row"        would report 7.50+10+12.50+?+... -- fails #2/#3/#4.
// "Ignore reverts"                        would add #5's $25 -- fails case 2.
// "Trust reference_id blindly"            would add #6 -- fails case 2.
// "SUM(total_cost_usd) in SQL"            would subtract #7's negative cost -- fails case 3.
// "Treat DEFAULT-0 cost as a real $0"     would report #9 as $0 -- fails case 4.
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
// added by 0084. That DEFAULT is the whole reason case 4 exists.
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
-- #14 below: products.cost_price_usd is REAL DEFAULT 0 (migration 0001), so an
-- uncosted product in production carries a literal 0, not NULL -- distinct
-- from product 3's NULL above. Both must be treated as "no cost recorded".
INSERT INTO products(id,name,cost_price_usd) VALUES (4,'Zero-cost-price product',0);
INSERT INTO product_batches(id,variant_product_id,unit_cost_usd) VALUES (77,2,4.00);
-- p5/losses (Sep 15 2026): tiers 3 and 4 of the fallback chain -- the
-- production case (inventory_movements #47026) was a remove whose own lot
-- AND product row were both uncosted while a same-NAME duplicate product
-- carried the real cost. Isolated on branch 3, section 9 below.
INSERT INTO products(id,name,cost_price_usd) VALUES
  (5,'Tier3 Product',NULL),           -- own-product fallback: a DIFFERENT lot of this same product is costed
  (6,'Twin Product',NULL),            -- same-name-twin fallback: this row has no costed lot of its own
  (7,'twin product',NULL),            -- the twin -- same normalized name, differs only by case
  (8,'Bulk deleted product',1.75);    -- priced product, deleted via bulkDeleteEngine's 'delete' movement
INSERT INTO product_batches(id,variant_product_id,unit_cost_usd,received_at) VALUES
  (80,5,3.25,'2026-09-01 00:00:00'),  -- product 5's OWN older costed lot
  (81,5,NULL,'2026-09-05 00:00:00'),  -- the lot movement #21 actually draws from -- uncosted
  (90,7,5.50,'2026-09-01 00:00:00');  -- product 7 (the twin)'s costed lot

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
  ( 9,2,2,'remove',        2, 0.00,  0.00,'Broken, removed entirely', NULL,9,'2026-09-10 07:00:00',77),
  (10,3,2,'remove',        6, 0.00,  0.00,'No cost anywhere',   NULL, 9,'2026-09-10 08:00:00',NULL),
  (11,1,2,'remove',      100, 2.50,250.00,'Next month',         NULL, 9,'2026-10-02 03:00:00',NULL),
  -- #12: P3-losses-writeoff (Sep 15 2026) -- write_off moved INTO the loss
  -- set (REMOVAL_LOSS_MOVEMENT_TYPES) once its writers' undo carries a
  -- revert marker this module can key off (see removalLossMovementWhere's
  -- 5th guard). This row has none (reference_id NULL, a legacy/unmarked
  -- write_off), so it is presumed NEVER reverted and now COUNTS -- but on
  -- product 3, which has no cost_price_usd anywhere, so it lands in
  -- unvalued_rows, never priced at $0.00. Was previously pinned excluded
  -- outright by movement_type alone; that pin is gone, deliberately, by this
  -- ruling -- see section 1 below.
  (12,3,2,'write_off',     8, 0.00,  0.00,'Removed product Widget',   NULL,9,'2026-09-10 09:00:00',NULL),
  (13,1,2,'adjustment',   -4, 0.00,  0.00,'Merged duplicate into #1', NULL,9,'2026-09-10 09:30:00',NULL),
  -- #14: no movement cost snapshot, no batch, and the product's OWN cost_price_usd
  -- sits at the column's real production DEFAULT 0 -- not a genuinely free item,
  -- an uncosted one. Must be unvalued, exactly like #10, never priced at $0.00.
  (14,4,2,'remove',        3, 0.00,  0.00,'No cost anywhere, zero-cost product', NULL,9,'2026-09-10 09:45:00',NULL),
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
  --  #18 productDelete.ts, a LIVE (never undone) delete's write_off ->
  --      COUNTS, valued from product 1's cost_price_usd fallback ($12.50).
  --  #19 productDelete.ts, a delete's write_off that WAS undone (#20 is its
  --      counter) -> excluded.
  --  #20 the undo counter for #19 ('add', 'revert:product_remove:op-undone:0').
  (15,1,5,'write_off',     3, 6.00, 18.00,'Broken, disposed', 'damaged_lot:501',9,'2026-09-10 10:00:00',NULL),
  (16,1,5,'write_off',     2, 5.00, 10.00,'Broken, disposed', 'damaged_lot:502',9,'2026-09-10 10:10:00',NULL),
  (17,1,5,'add',           2, 5.00, 10.00,'Hypothetical restore of #16', 'revert:damaged_lot:502',9,'2026-09-10 10:11:00',NULL),
  (18,1,5,'write_off',     5, 0.00,  0.00,'Removed product Gadget', 'product_remove:op-live:0',9,'2026-09-10 10:20:00',NULL),
  (19,1,5,'write_off',     9, 0.00,  0.00,'Removed product Gizmo',  'product_remove:op-undone:0',9,'2026-09-10 10:30:00',NULL),
  (20,1,5,'add',           9, 0.00,  0.00,'Undo: Removed product Gizmo', 'revert:product_remove:op-undone:0',9,'2026-09-10 10:31:00',NULL),
  -- ----------------------------------------------------------------------
  -- Branch 3: the fallback chain's tiers 3/4, plus bulkDeleteEngine's
  -- 'delete' movement type (p5/losses, Sep 15 2026).
  --
  --  #21 draws from batch 81 (product 5's OWN lot, but THAT lot is
  --      uncosted) while product 5 itself has no cost_price_usd -- must
  --      fall through to batch 80, a DIFFERENT, older, costed lot of the
  --      SAME product -> tier 3, $3.25/u.
  --  #22 product 6 has no batches of its own and no cost_price_usd -- must
  --      fall through to product 7's lot, the SAME-NAME twin ("Twin
  --      Product" vs "twin product") -> tier 4, $5.50/u.
  --  #23 a LIVE bulkDeleteEngine 'delete' row, reference_id
  --      'bulk_delete:job-live' -- COUNTS, priced from product 8's own
  --      cost_price_usd ($1.75).
  --  #24 a bulkDeleteEngine 'delete' row that WAS undone (#25 is its
  --      counter, the same 'revert:' + reference_id shape write_off uses)
  --      -> excluded.
  --  #25 the undo counter for #24.
  (21,5,3,'remove',   2, 0.00, 0.00,'Tier3 fallback test',              NULL,                    9,'2026-09-10 03:00:00',81),
  (22,6,3,'remove',   4, 0.00, 0.00,'Tier4 twin fallback test',         NULL,                    9,'2026-09-10 03:10:00',NULL),
  (23,8,3,'delete',   5, 0.00, 0.00,'Bulk delete of Bulk deleted product','bulk_delete:job-live', 9,'2026-09-10 03:20:00',NULL),
  (24,8,3,'delete',   3, 0.00, 0.00,'Bulk delete, later undone',        'bulk_delete:job-undone',9,'2026-09-10 03:30:00',NULL),
  (25,8,3,'add',      3, 0.00, 0.00,'Undo: bulk delete', 'revert:bulk_delete:job-undone',         9,'2026-09-10 03:31:00',NULL);
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
  ok('SQL: a LEGACY product-deletion write_off with no revert marker (#12) COUNTS now (P3-losses-writeoff), presumed live since nothing ever marked it reverted -- but stays unvalued, product 3 has no cost anywhere')
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
// 1b. Valuation happens at READ time. Several removal writers book no cost
//     columns at all, and inventory_movements.unit_cost_usd is DEFAULT 0 since
//     migration 0001 -- so a stored 0 is ABSENCE, not free goods. #9 is such a
//     row and must be priced from its lot, not counted as $0.00.
// ---------------------------------------------------------------------------
{
  const row = readRows().find((r) => Number(r.id) === 9)
  assert.ok(row, '#9 is selected')
  assert.equal(Number(row.unit_cost_usd), 0, 'the movement itself carries no cost')
  assert.equal(Number(row.total_cost_usd), 0)
  assert.equal(Number(row.fallback_unit_cost_usd), 4, 'the lot price is read at query time')
  assert.equal(lib.removalRowLossUsd(row), 8, '2 units x the $4.00 lot cost -- never zero')
  ok('a cost-column-less removal is valued from its lot at read time, not booked at $0.00')
}

// ---------------------------------------------------------------------------
// 1c. A fallback of exactly 0 -- products.cost_price_usd's REAL production
//     DEFAULT (migration 0001), not a null-shaped absence -- must ALSO be
//     read as "no cost recorded", never as "this item is free". #14 has no
//     batch (so COALESCE falls all the way to products.cost_price_usd) and
//     that column is a literal 0, not NULL.
// ---------------------------------------------------------------------------
{
  const row = readRows().find((r) => Number(r.id) === 14)
  assert.ok(row, '#14 is selected')
  assert.equal(Number(row.unit_cost_usd), 0)
  assert.equal(Number(row.total_cost_usd), 0)
  assert.equal(Number(row.fallback_unit_cost_usd), 0, 'products.cost_price_usd DEFAULT is a literal 0, not NULL')
  assert.equal(lib.removalRowLossUsd(row), null, 'a $0 fallback is absence, not a free item -- must be unvalued, never $0.00')
  assert.equal(lib.removalRowLossUsd({ quantity: 2, total_cost_usd: 0, unit_cost_usd: 0, fallback_unit_cost_usd: 0 }), null,
    'the same guard on a plain object, independent of the SQL round trip')
  ok('a fallback of exactly 0 (the real products.cost_price_usd default) is absence, counted as unvalued -- not priced at $0.00')
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
  // #12 is unvalued (product 3 has no cost anywhere) so it adds $0 to the
  // dollar total -- only the ids list and unvalued_rows count change.
  assert.equal(withRevertGone.removal_loss_usd, 40.5, '7.50 + 25.00 + 8.00, #12 contributes $0')
  assert.equal(withRevertGone.removal_loss_unvalued_rows, 3, '#10, #12 and #14')
  sql.exec(`UPDATE inventory_movements SET reference_id = 'revert:5' WHERE id = 6`)
  ok('the revert exclusion changes the answer (positive control)')
}

// ---------------------------------------------------------------------------
// 3. Valuation: movement snapshot, then lot cost, then unvalued.
// ---------------------------------------------------------------------------
{
  const summary = lib.summarizeRemovalLosses(readRows())
  //  #1 = 3 x 2.50 from its own snapshot ($7.50)
  //  #9 = 2 x 4.00 from the LOT, because its own columns sit at the DEFAULT 0
  // #10 = 6 units that nothing can price (product cost_price_usd is NULL)
  // #12 = 8 units that nothing can price (product 3 has no cost anywhere either)
  // #14 = 3 units that nothing can price (product cost_price_usd is a literal 0)
  assert.equal(summary.removal_loss_usd, 15.5, '7.50 + 8.00, and #10/#12/#14 add nothing they cannot prove')
  assert.equal(summary.removal_loss_qty, 22, '3 + 2 + 6 + 8 + 3 units left the shelf')
  assert.equal(summary.removal_loss_unvalued_rows, 3, 'all three uncostable rows are REPORTED, not dropped silently')
  ok('cost comes from the movement snapshot, then the lot, then is declared unknown')
}

// ---------------------------------------------------------------------------
// 4. A DEFAULT-0 cost column is absence, not "these goods were free".
// ---------------------------------------------------------------------------
{
  assert.equal(lib.removalRowLossUsd({ quantity: 2, total_cost_usd: 0, unit_cost_usd: 0, fallback_unit_cost_usd: 4 }), 8)
  assert.equal(lib.removalRowLossUsd({ quantity: 2, total_cost_usd: 9, unit_cost_usd: 0, fallback_unit_cost_usd: 4 }), 9)
  assert.equal(lib.removalRowLossUsd({ quantity: 2, total_cost_usd: null, unit_cost_usd: 3, fallback_unit_cost_usd: 4 }), 6)
  assert.equal(lib.removalRowLossUsd({ quantity: 2, total_cost_usd: null, unit_cost_usd: null, fallback_unit_cost_usd: null }), null)
  ok('valuation order: total snapshot > unit snapshot > carried cost > unknown')
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
    ],
    (row) => String(row.created_at).slice(0, 10),
  )
  assert.equal(byDay.get('2026-09-10').removal_loss_usd, 9)
  assert.equal(byDay.get('2026-09-10').removal_loss_qty, 3)
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
  ok('a live product-delete write_off (#18) counts, valued from the product fallback')
  ok('a disposed lot with a matching revert counter (#16/#17) is excluded')
  ok('a product-delete write_off with a matching undo counter (#19/#20) is excluded')

  const summary = lib.summarizeRemovalLosses(rows)
  assert.equal(summary.removal_loss_usd, 30.5, "18.00 (#15, own snapshot) + 12.50 (#18, 5 x product 1's $2.50 fallback)")
  assert.equal(summary.removal_loss_qty, 8, '3 + 5 units')
  assert.equal(summary.removal_loss_unvalued_rows, 0)

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
// 9. p5/losses (Sep 15 2026): the fallback chain's tiers 3 and 4, and
//    bulkDeleteEngine's 'delete' movement now counting. Isolated on branch 3.
// ---------------------------------------------------------------------------
{
  const rows = readRows({ startDate: '2026-09-10', endDate: '2026-09-10', branchId: 3 })
  const ids = rows.map((r) => Number(r.id)).sort((a, b) => a - b)
  assert.deepEqual(ids, [21, 22, 23], `only the live delete + both fallback removes are selected, got ${JSON.stringify(ids)}`)
  ok('a bulk-delete "delete" row with a matching undo counter (#24/#25) is excluded, same shape as write_off')

  const tier3 = rows.find((r) => Number(r.id) === 21)
  assert.equal(Number(tier3.fallback_unit_cost_usd), 3.25, "own lot (81) is uncosted and product 5 has no cost_price_usd -- falls to product 5's OTHER costed lot (80)")
  assert.equal(lib.removalRowLossUsd(tier3), 6.5, '2 units x $3.25')
  ok('fallback tier 3: the product\'s own most-recently-received costed lot, a DIFFERENT lot than the one drawn from')

  const tier4 = rows.find((r) => Number(r.id) === 22)
  assert.equal(Number(tier4.fallback_unit_cost_usd), 5.5, "product 6 has no batches and no cost_price_usd -- falls to the SAME-NAME twin product 7's lot")
  assert.equal(lib.removalRowLossUsd(tier4), 22, '4 units x $5.50')
  ok('fallback tier 4: a same-normalized-name twin product\'s most-recently-received costed lot -- the reported production case')

  const bulkDelete = rows.find((r) => Number(r.id) === 23)
  assert.equal(Number(bulkDelete.fallback_unit_cost_usd), 1.75, "product 8's own cost_price_usd")
  assert.equal(lib.removalRowLossUsd(bulkDelete), 8.75, '5 units x $1.75')
  ok("bulkDeleteEngine's 'delete' movement type is now a removal loss, priced the same way as 'remove'/'write_off'")

  const summary = lib.summarizeRemovalLosses(rows)
  assert.equal(summary.removal_loss_usd, 37.25, '6.50 + 22.00 + 8.75')
  assert.equal(summary.removal_loss_qty, 11, '2 + 4 + 5 units')
  assert.equal(summary.removal_loss_unvalued_rows, 0)
  ok('branch-3 totals: both new fallback tiers and the delete movement all price correctly, nothing left unvalued')

  // Positive control: break the twin-name match (park product 7's lot cost)
  // and #22 falls all the way through to unvalued -- proving tier 4 is doing
  // the work, not that #22 was reachable some other way.
  sql.exec(`UPDATE product_batches SET unit_cost_usd = NULL WHERE id = 90`)
  const withTwinGone = readRows({ startDate: '2026-09-10', endDate: '2026-09-10', branchId: 3 }).find((r) => Number(r.id) === 22)
  assert.equal(withTwinGone.fallback_unit_cost_usd, null, 'with the twin\'s lot cost gone, #22 has nothing left to price it from')
  assert.equal(lib.removalRowLossUsd(withTwinGone), null)
  sql.exec(`UPDATE product_batches SET unit_cost_usd = 5.50 WHERE id = 90`)
  ok('the twin-lookup fallback changes the answer (positive control)')
}

console.log(`\nOK - ${checks} checks passed`)

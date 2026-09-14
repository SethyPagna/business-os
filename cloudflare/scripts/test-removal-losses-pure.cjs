// P3-L5. STOCK REMOVED ENTIRELY IS A LOSS, AT COST PRICE.
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
//
// "Sum every LEDGER_OUT_TYPES row"        would report 7.50+10+12.50+?+... -- fails #2/#3/#4.
// "Ignore reverts"                        would add #5's $25 -- fails case 2.
// "Trust reference_id blindly"            would add #6 -- fails case 2.
// "SUM(total_cost_usd) in SQL"            would subtract #7's negative cost -- fails case 3.
// "Treat DEFAULT-0 cost as a real $0"     would report #9 as $0 -- fails case 4.
// "Silently drop uncostable rows"         would report unvalued_rows 0 -- fails case 5.
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
CREATE TABLE product_batches (id INTEGER PRIMARY KEY, variant_product_id INTEGER, unit_cost_usd REAL, is_active INTEGER DEFAULT 1);
CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, cost_price_usd REAL);

INSERT INTO products(id,name,cost_price_usd) VALUES (1,'Priced product',2.50),(2,'Lot-priced product',NULL),(3,'Costless product',NULL);
INSERT INTO product_batches(id,variant_product_id,unit_cost_usd) VALUES (77,2,4.00);

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
  (11,1,2,'remove',      100, 2.50,250.00,'Next month',         NULL, 9,'2026-10-02 03:00:00',NULL);
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
  assert.deepEqual(ids, [1, 9, 10], `only the real removals are selected, got ${JSON.stringify(ids)}`)
  ok('SQL: sale, transfer_out and damage_out are not losses')
  ok('SQL: a reverted removal (#5) and the revert row itself (#6) are both excluded')
  ok('SQL: a negative-quantity stock-session undo (#7) is excluded')
  ok('SQL: a dated stock-count import removal (#8) is excluded')
  ok('SQL: a removal outside the window (#11) is excluded')
}

// ---------------------------------------------------------------------------
// 2. The revert guard is real, not incidental: delete the revert row and #5
//    comes back as a $25 loss. Without this the first case could pass under an
//    implementation that never looked at reverts at all.
// ---------------------------------------------------------------------------
{
  sql.exec('UPDATE inventory_movements SET reference_id = NULL WHERE id = 6')
  const ids = readRows().map((r) => Number(r.id)).sort((a, b) => a - b)
  assert.deepEqual(ids, [1, 5, 9, 10], 'with the revert unlinked, #5 is a loss again')
  const withRevertGone = lib.summarizeRemovalLosses(readRows())
  assert.equal(withRevertGone.removal_loss_usd, 40.5, '7.50 + 25.00 + 8.00')
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
  // #10 = 6 units that nothing can price
  assert.equal(summary.removal_loss_usd, 15.5, '7.50 + 8.00, and #10 adds nothing it cannot prove')
  assert.equal(summary.removal_loss_qty, 11, '3 + 2 + 6 units left the shelf')
  assert.equal(summary.removal_loss_unvalued_rows, 1, 'the uncostable row is REPORTED, not dropped silently')
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
  assert.ok(!types.includes('sale'), 'a sale is never a loss')
  assert.ok(!types.includes('damage_out'), 'damage_out is a DRAW from the damaged lot, i.e. a sale')
  assert.ok(!types.includes('transfer_out'), 'transferred stock is still ours')
  ok('the excluded-reason and movement-type constants agree with their sources')
}

console.log(`\nOK - ${checks} checks passed`)

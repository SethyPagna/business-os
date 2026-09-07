// Audit finding sibling:F14 -- "the Inventory products list styles a NEGATIVE
// profit that the detail pane opened from the same row clamps to 0".
//
// The owner rule (N6) is that a negative revenue/profit figure is a scoping
// defect to root-cause, never something to floor at display, so this exercises
// the CAUSES rather than the symptom. Every case below runs the real SQL that
// routes/inventory.ts builds, against real SQLite, on data where the old
// hand-copied join and lib/productSalesLedger.ts DISAGREE -- each one produced
// a negative revenue (and therefore a negative profit) on base 6e3abfea:
//
// (base profit -> fixed profit, measured by running this fixture against
// `git show 6e3abfea:cloudflare/src/routes/inventory.ts`):
//
//   A  a refund scoped by the RETURN's own date, reversing a sale the window
//      never recognised                                    -85.00 -> 0
//   B  a refund against a CANCELLED sale, whose sale contributed nothing
//      to either side                                      -30.00 -> 0
//   C  a refund subtracted at its CHARGED price out of revenue that is net of
//      the sale's discounts -- the discount removed twice   -50.00 -> 0
//   D  a manual return carrying no sale_id at all, reversing
//      nothing that exists                                 -25.00 -> 0
//   E  a return line written stock_action='restock' with the legacy
//      return_to_stock flag still 0: goods back on the shelf whose cost never
//      came back out of COGS -- the mirror defect            +4.00 -> +12.00
//   H  the SAME defect in UNITS. One sale carrying two sale_items rows for one
//      product at two different branches, all five units returned. The sold
//      side is branch-scoped and the return side cannot be -- a sale-level
//      return names no sale LINE -- so a 5-unit reversal met a 3-unit branch-1
//      sale and ran past what that scope had recognised. Money was capped at
//      what the (sale, product) pair recognised; the unit count was not, so
//      the list could render "Net sold -2" while the pane opened from that row
//      clamped it to 0.                             qty_sold -2.00 -> 0
//   I  the same branch-split sale with a PARTIAL return, which is what shows
//      that a cap is not the fix. Capping is per branch, so the SAME reversal
//      comes off at every branch the sale touched: 3 units at branch 1 and 2
//      at branch 2, two units returned, and branch 1 -- which had nothing come
//      back -- read qty 1 / revenue $10 / profit $6 while the two branch rows
//      summed to more reversal than the sale ever had. The sale-level return
//      is now APPORTIONED across the sale's branch lines (the branch it names
//      first, up to what that branch recognised; the remainder over what the
//      other lines have left), so the branch slices add back up to the
//      unfiltered row instead of each subtracting the whole.
//                                    branch 1: qty 1 / $10 / $6 -> 3 / $30 / $18
//   J  the same partial return with NO branch on the return LINE. Every insert
//      path in routes/returns.ts resolves return_items.branch_id as
//      `item.branch_id || <the request's branch> || null` (:1397, :1921,
//      :1944, :2173, :2335), so a sale-level return routinely lands with the
//      column NULL and only the RETURN row naming a branch. Reading the line
//      alone makes that reversal name nobody and smears it proportionally over
//      a branch that had nothing come back; `COALESCE(ri.branch_id,
//      r.branch_id)` -- the fallback base 6e3abfea carried as returnScope --
//      puts it back where it belongs.
//                        branch 1: qty 1.8 / $18 -> 3 / $30 (base: qty 1 / $10)
//   K  a reversal that names NO branch at all, over a sale whose two branch
//      lines are worth wildly different money: 1 unit at $1 at branch 1 and
//      1 unit at $99 at branch 2, one $50 refund. Splitting the refund by the
//      UNIT share gives each branch $25 -- more than branch 1 ever took --
//      and the per-branch cap then swallows the excess, so the branch rows
//      read $0 and $74 against an unfiltered $50: the slice stopped being a
//      partition. Money is apportioned by each line share of the VALUE (and
//      returned cost by its share of the COST), so it reads $0.50 + $49.50.
//                              branch 1 + branch 2: $74 -> $50 = unfiltered
//   L  a reversal naming a branch that sold none of this product, so the
//      whole of it spreads: 2 units back over a sale of 3 units at branch 1
//      and 2 at branch 2. A proportional split allocates 1.2 units to branch
//      1, and the Inventory list renders Net sold with no formatting at all,
//      so the cell reads "1.8" -- a count of things with a fraction in it.
//      The unit spill is allocated by largest remainder instead, so the whole
//      units stay whole and the two branches still sum to the unfiltered row.
//                                     branch 1 Net sold: 1.8 -> 2 (integer)
//   M  fractional source quantities leave no branch with room for one whole
//      remainder unit: 0.6 at branch 1 and 0.4 at branch 2, with one unit
//      returned. Capacity-aware remainder filling assigns 0.6 + 0.4 instead
//      of rejecting both lines and losing the reversal.
//
// Plus the two positive controls, without which a "nothing is negative any
// more" sweep would be indistinguishable from a broken instrument:
//
//   F  a product genuinely sold BELOW COST still reports its real loss -- the
//      fix must not have become the display floor it replaced;
//   G  an ordinary sale-with-return is arithmetically unchanged.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const { openDb } = require('./harness/d1compat.cjs')

const srcRoot = path.join(__dirname, '..', 'src')

function loadTs(relativePath, exactStubs = {}) {
  const filePath = path.join(srcRoot, relativePath)
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  }).outputText
  const fallback = new Proxy({}, { get: (_t, property) => property === 'default' ? {} : () => undefined })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(exactStubs, request)) return exactStubs[request]
    if (request.startsWith('.')) return fallback
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const loaded = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
      loaded.exports, require, loaded, filePath, path.dirname(filePath),
    )
    return loaded.exports
  } finally {
    Module._load = originalLoad
  }
}

// The REAL kernel, not a re-typed copy of its expressions: if netSaleExpr or
// RESTOCKED_RETURN_LINE ever change, this test moves with them instead of
// certifying a stale transcription.
const businessDateWindow = loadTs('lib/businessDateWindow.ts')
const salesAnalytics = loadTs('lib/salesAnalytics.ts', { './businessDateWindow': businessDateWindow })
const productSalesLedger = loadTs('lib/productSalesLedger.ts', { './salesAnalytics': salesAnalytics })
const inventory = loadTs('routes/inventory.ts', {
  hono: { Hono },
  '../lib/businessDateWindow': businessDateWindow,
  '../lib/productSalesLedger': productSalesLedger,
})
const { attachInventoryProductMetrics } = inventory
assert.equal(typeof attachInventoryProductMetrics, 'function')
assert.equal(typeof productSalesLedger.buildProductSalesLedgerSql, 'function')
assert.equal(typeof salesAnalytics.netSaleExpr, 'function', 'the real kernel loaded, not the stub proxy')

function dbAdapter(d1) {
  return {
    prepare(sql) {
      const statement = d1.prepare(sql)
      return {
        get(params) { return statement.get(params || {}) },
        all(params) { return statement.all(params || {}) },
        run(params) { return statement.run(params || {}) },
      }
    },
    batch(statements) { return d1.batch(statements) },
  }
}

function setupDatabase() {
  const d1 = openDb([])
  d1.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY, name TEXT, name_key TEXT, parent_id INTEGER,
      is_active INTEGER DEFAULT 1, created_at TEXT,
      stock_quantity REAL, purchase_price_usd REAL, cost_price_usd REAL,
      purchase_price_khr REAL, cost_price_khr REAL
    );
    CREATE TABLE branch_stock (product_id INTEGER, branch_id INTEGER, quantity REAL);
    CREATE TABLE sales (
      id INTEGER PRIMARY KEY, branch_id INTEGER, sale_status TEXT, created_at TEXT,
      subtotal_usd REAL, subtotal_khr REAL, discount_usd REAL, discount_khr REAL,
      membership_discount_usd REAL, membership_discount_khr REAL
    );
    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY, sale_id INTEGER, product_id INTEGER, branch_id INTEGER,
      quantity REAL, total_usd REAL, total_khr REAL, cost_price_usd REAL, cost_price_khr REAL
    );
    CREATE TABLE returns (
      id INTEGER PRIMARY KEY, sale_id INTEGER, branch_id INTEGER, status TEXT,
      return_scope TEXT, created_at TEXT
    );
    CREATE TABLE return_items (
      id INTEGER PRIMARY KEY, return_id INTEGER, product_id INTEGER, branch_id INTEGER,
      quantity REAL, total_usd REAL, total_khr REAL, cost_price_usd REAL, cost_price_khr REAL,
      return_to_stock INTEGER, stock_action TEXT
    );
    INSERT INTO products (id, name, name_key, is_active, stock_quantity, purchase_price_usd, cost_price_usd, purchase_price_khr, cost_price_khr) VALUES
      (1,'A: refund of an out-of-window sale','a',1,0,0,0,0,0),
      (2,'B: refund of a cancelled sale','b',1,0,0,0,0,0),
      (3,'C: refund at the charged price','c',1,0,0,0,0,0),
      (4,'D: return with no sale behind it','d',1,0,0,0,0,0),
      (5,'E: restock the legacy flag missed','e',1,0,0,0,0,0),
      (6,'F: genuinely sold below cost','f',1,0,0,0,0,0),
      (7,'G: an ordinary sale and return','g',1,0,0,0,0,0),
      (8,'H: one sale, two branches, all of it returned','h',1,0,0,0,0,0),
      (9,'I: one sale, two branches, a partial return at one of them','i',1,0,0,0,0,0),
      (10,'J: the return line names no branch, the return does','j',1,0,0,0,0,0),
      (11,'K: one sale, two branches worth very different money','k',1,0,0,0,0,0),
      (12,'L: a return naming a branch that sold none of it','l',1,0,0,0,0,0),
      (13,'M: fractional residual capacities','m',1,0,0,0,0,0);
    INSERT INTO branch_stock VALUES (1,1,0),(2,1,0),(3,1,0),(4,1,0),(5,1,0),(6,1,0),(7,1,0),(8,1,0),(8,2,0),(9,1,0),(9,2,0),(10,1,0),(10,2,0),(11,1,0),(11,2,0),(12,1,0),(12,2,0),(13,1,0),(13,2,0);

    -- A: the sale is in AUGUST, the return is inside the September window.
    INSERT INTO sales VALUES (100,1,'completed','2026-08-01 03:00:00',100,400000,0,0,0,0);
    INSERT INTO sale_items VALUES (100,100,1,1,5,100,400000,3,12000);
    INSERT INTO returns VALUES (200,100,1,'completed','customer','2026-09-05 03:00:00');
    INSERT INTO return_items VALUES (200,200,1,1,5,100,400000,3,12000,1,'restock');

    -- B: cancelled sale, refund still recorded against it.
    INSERT INTO sales VALUES (101,1,'cancelled','2026-09-05 03:00:00',50,200000,0,0,0,0);
    INSERT INTO sale_items VALUES (101,101,2,1,1,50,200000,20,80000);
    INSERT INTO returns VALUES (201,101,1,'completed','customer','2026-09-05 04:00:00');
    INSERT INTO return_items VALUES (201,201,2,1,1,50,200000,20,80000,1,'restock');

    -- C: half the sale was discounted away; the refund is the CHARGED price.
    INSERT INTO sales VALUES (102,1,'completed','2026-09-05 03:00:00',100,400000,50,200000,0,0);
    INSERT INTO sale_items VALUES (102,102,3,1,1,100,400000,10,40000);
    INSERT INTO returns VALUES (202,102,1,'completed','customer','2026-09-05 04:00:00');
    INSERT INTO return_items VALUES (202,202,3,1,1,100,400000,10,40000,1,'restock');

    -- D: a manual return with no sale_id at all.
    INSERT INTO returns VALUES (203,NULL,1,'completed','customer','2026-09-05 04:00:00');
    INSERT INTO return_items VALUES (203,203,4,1,1,30,120000,5,20000,1,'restock');

    -- E: stock_action says restock, the legacy boolean still says no.
    INSERT INTO sales VALUES (103,1,'completed','2026-09-05 03:00:00',40,160000,0,0,0,0);
    INSERT INTO sale_items VALUES (103,103,5,1,2,40,160000,8,32000);
    INSERT INTO returns VALUES (204,103,1,'completed','customer','2026-09-05 04:00:00');
    INSERT INTO return_items VALUES (204,204,5,1,1,20,80000,8,32000,0,'restock');

    -- F: sold for $5 what cost $9. A real loss, and it must survive.
    INSERT INTO sales VALUES (104,1,'completed','2026-09-05 03:00:00',5,20000,0,0,0,0);
    INSERT INTO sale_items VALUES (104,104,6,1,1,5,20000,9,36000);

    -- G: two of three units came back, undiscounted, restocked.
    INSERT INTO sales VALUES (105,1,'completed','2026-09-05 03:00:00',30,120000,0,0,0,0);
    INSERT INTO sale_items VALUES (105,105,7,1,3,30,120000,4,16000);
    INSERT INTO returns VALUES (205,105,1,'completed','customer','2026-09-05 04:00:00');
    INSERT INTO return_items VALUES (205,205,7,1,2,20,80000,4,16000,1,'restock');

    -- H: ONE sale, two sale_items rows for one product at two branches
    -- (3 units at branch 1, 2 at branch 2), and one return of all 5 units.
    -- Scoped to branch 1 the sold side sees 3 and the return side sees 5.
    INSERT INTO sales VALUES (106,1,'completed','2026-09-05 03:00:00',50,200000,0,0,0,0);
    INSERT INTO sale_items VALUES (106,106,8,1,3,30,120000,4,16000);
    INSERT INTO sale_items VALUES (107,106,8,2,2,20,80000,4,16000);
    INSERT INTO returns VALUES (206,106,1,'completed','customer','2026-09-05 04:00:00');
    INSERT INTO return_items VALUES (206,206,8,1,5,50,200000,4,16000,1,'restock');

    -- I: the same branch-split sale with a PARTIAL return -- 3 units at
    -- branch 1 and 2 at branch 2, and the customer brings back the two
    -- branch-2 units ($20, restocked). Branch 1 sold three units and none of
    -- them came back, so branch 1 must still read 3 / $30 / profit $18, and
    -- the two branch figures must add back up to the unfiltered row. A cap
    -- alone cannot produce this: capping subtracts the whole 2-unit reversal
    -- at branch 1 as well (qty 1, revenue $10, profit $6) and then the two
    -- branches sum to more reversal than the sale ever had.
    INSERT INTO sales VALUES (108,1,'completed','2026-09-05 03:00:00',50,200000,0,0,0,0);
    INSERT INTO sale_items VALUES (108,108,9,1,3,30,120000,4,16000);
    INSERT INTO sale_items VALUES (109,108,9,2,2,20,80000,4,16000);
    INSERT INTO returns VALUES (207,108,2,'completed','customer','2026-09-05 04:00:00');
    INSERT INTO return_items VALUES (207,207,9,2,2,20,80000,4,16000,1,'restock');

    -- J: case I again, except the return LINE carries no branch at all and
    -- only the RETURN row names branch 2 -- which is what routes/returns.ts
    -- writes whenever the posted item carried none. The answer must be case
    -- I's: branch 1 sold three units, none came back, so it still reads
    -- 3 / $30 / profit $18.
    INSERT INTO sales VALUES (109,1,'completed','2026-09-05 03:00:00',50,200000,0,0,0,0);
    INSERT INTO sale_items VALUES (110,109,10,1,3,30,120000,4,16000);
    INSERT INTO sale_items VALUES (111,109,10,2,2,20,80000,4,16000);
    INSERT INTO returns VALUES (208,109,2,'completed','customer','2026-09-05 04:00:00');
    INSERT INTO return_items VALUES (208,208,10,NULL,2,20,80000,4,16000,1,'restock');

    -- K: the two branch lines of this sale are worth $1 and $99, and neither
    -- the return line nor the return row names a branch, so the whole $50
    -- refund is apportioned. By VALUE that is $0.50 and $49.50; by UNITS it
    -- is $25 each, which is $24 more than branch 1 ever recognised -- the cap
    -- then eats the excess and the two branch rows sum to $74, not $50.
    INSERT INTO sales VALUES (110,1,'completed','2026-09-05 03:00:00',100,400000,0,0,0,0);
    INSERT INTO sale_items VALUES (112,110,11,1,1,1,4000,0.5,2000);
    INSERT INTO sale_items VALUES (113,110,11,2,1,99,396000,0.5,2000);
    INSERT INTO returns VALUES (209,110,NULL,'completed','customer','2026-09-05 04:00:00');
    INSERT INTO return_items VALUES (209,209,11,NULL,1,50,200000,0.5,2000,1,'restock');

    -- L: the return names branch 3, which sold none of this product on this
    -- sale, so its 2 units spread over the 3-and-2 split. Proportionally that
    -- is 1.2 and 0.8 units; by largest remainder it is 1 and 1, and branch 1
    -- reads a whole 2 instead of 1.8.
    INSERT INTO sales VALUES (111,1,'completed','2026-09-05 03:00:00',50,200000,0,0,0,0);
    INSERT INTO sale_items VALUES (114,111,12,1,3,30,120000,4,16000);
    INSERT INTO sale_items VALUES (115,111,12,2,2,20,80000,4,16000);
    INSERT INTO returns VALUES (210,111,3,'completed','customer','2026-09-05 04:00:00');
    INSERT INTO return_items VALUES (210,210,12,3,2,20,80000,4,16000,1,'restock');

    -- M: both residual capacities are below one. A ranked one-unit handout
    -- rejects both lines and drops the return; capacity-aware filling uses
    -- both residuals and still partitions the unfiltered result.
    INSERT INTO sales VALUES (112,1,'completed','2026-09-05 03:00:00',10,40000,0,0,0,0);
    INSERT INTO sale_items VALUES (116,112,13,1,0.6,6,24000,4,16000);
    INSERT INTO sale_items VALUES (117,112,13,2,0.4,4,16000,4,16000);
    INSERT INTO returns VALUES (211,112,3,'completed','customer','2026-09-05 04:00:00');
    INSERT INTO return_items VALUES (211,211,13,3,1,10,40000,4,16000,1,'restock');
  `)
  return d1
}

const round2 = (value) => Math.round(value * 100) / 100

async function main() {
  const db = dbAdapter(setupDatabase())
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((id) => ({ id }))
  await attachInventoryProductMetrics(db, items, {
    branchId: '1', startDate: '2026-09-05', endDate: '2026-09-05',
  })
  const byId = new Map(items.map((item) => [Number(item.id), item]))
  const at = (id) => {
    const row = byId.get(id)
    assert.ok(row, `product ${id} enriched`)
    return {
      qty_sold: round2(Number(row.qty_sold)),
      revenue_usd: round2(Number(row.revenue_usd)),
      revenue_khr: round2(Number(row.revenue_khr)),
      cogs_usd: round2(Number(row.cogs_usd)),
      profit_usd: round2(Number(row.profit_usd)),
    }
  }

  // ---- the five defects, each of which manufactured a negative figure ------
  assert.deepEqual(at(1), { qty_sold: 0, revenue_usd: 0, revenue_khr: 0, cogs_usd: 0, profit_usd: 0 },
    'A: a refund reverses its sale in THAT sale\'s bucket -- an August sale refunded in September takes nothing out of September (base 6e3abfea: revenue -100.00, COGS -15.00, profit -85.00)')
  assert.deepEqual(at(2), { qty_sold: 0, revenue_usd: 0, revenue_khr: 0, cogs_usd: 0, profit_usd: 0 },
    'B: a cancelled sale contributes 0 on BOTH sides, so its refund reverses nothing (was -50.00 / profit -30.00)')
  assert.deepEqual(at(3), { qty_sold: 0, revenue_usd: 0, revenue_khr: 0, cogs_usd: 0, profit_usd: 0 },
    'C: the refund comes off on the same net basis the revenue was measured on, and is capped at it (was -50.00, the sale discount removed twice)')
  assert.deepEqual(at(4), { qty_sold: 0, revenue_usd: 0, revenue_khr: 0, cogs_usd: 0, profit_usd: 0 },
    'D: a return with no sale behind it has nothing in scope to reverse (was -30.00 / profit -25.00)')
  assert.deepEqual(at(5), { qty_sold: 1, revenue_usd: 20, revenue_khr: 80000, cogs_usd: 8, profit_usd: 12 },
    'E: stock_action wins over the legacy return_to_stock flag, so restocked goods leave COGS (COGS was 16, profit understated at 4)')
  assert.deepEqual(at(8), { qty_sold: 0, revenue_usd: 0, revenue_khr: 0, cogs_usd: 0, profit_usd: 0 },
    'H: the sale-level return is apportioned over the sale\'s branch lines, so branch 1 absorbs the 3 units it sold and the remaining 2 land on branch 2 -- Net sold 0, not -2')
  assert.deepEqual(at(9), { qty_sold: 3, revenue_usd: 30, revenue_khr: 120000, cogs_usd: 12, profit_usd: 18 },
    'I: a PARTIAL return of the branch-2 units takes nothing off branch 1, which sold 3 and had none of them come back (cap-only reading: qty 1, revenue 10, profit 6)')

  assert.deepEqual(at(10), { qty_sold: 3, revenue_usd: 30, revenue_khr: 120000, cogs_usd: 12, profit_usd: 18 },
    'J: return_items.branch_id is NULL, so the reversal is named by the branch on the RETURN row -- branch 1 keeps the three units it sold (without the COALESCE fallback: qty 1.8 / $18)')

  assert.deepEqual([at(11).revenue_usd, at(11).revenue_khr, at(11).cogs_usd], [0.5, 2000, 0.25],
    "K: branch 1 recognised $1 of a $100 sale, so it carries $0.50 of a $50 refund -- by VALUE. By units it carried $25, which the cap cut back to $1 and left the two branches summing to $74")

  assert.equal(at(11).qty_sold, 0,
    "K: the single unit that came back is allocated whole, to one branch line or the other -- never half a unit to each")
  assert.deepEqual(at(12), { qty_sold: 2, revenue_usd: 18, revenue_khr: 72000, cogs_usd: 7.2, profit_usd: 10.8 },
    "L: the spill is allocated by largest remainder, so branch 1 reads a whole 2 units (proportionally it would read 1.8). Money stays proportional and is money-formatted")
  assert.equal(at(13).qty_sold, 0,
    'M: fractional residual capacities absorb the whole reversal without losing units')

  // ---- the positive controls ----------------------------------------------
  assert.deepEqual(at(6), { qty_sold: 1, revenue_usd: 5, revenue_khr: 20000, cogs_usd: 9, profit_usd: -4 },
    'F: a product genuinely sold below cost still reports its real loss -- the root-cause fix must not have become a display floor')
  assert.deepEqual(at(7), { qty_sold: 1, revenue_usd: 10, revenue_khr: 40000, cogs_usd: 4, profit_usd: 6 },
    'G: an ordinary sale-with-return is arithmetically unchanged')

  // ---- the invariants, stated over every row -------------------------------
  for (const item of items) {
    const revenue = Number(item.revenue_usd)
    const cogs = Number(item.cogs_usd)
    assert.ok(revenue >= 0, `revenue_usd is non-negative by construction (product ${item.id} = ${revenue})`)
    assert.ok(cogs >= 0, `cogs_usd is non-negative by construction (product ${item.id} = ${cogs})`)
    assert.ok(Number(item.revenue_khr) >= 0, `revenue_khr is non-negative by construction (product ${item.id})`)
    // Net sold is the fourth cell of the same row and the fourth clamp in
    // inventory/ProductDetailModal.tsx (`Math.max(0, p.qty_sold || 0)`), so it
    // carries the same invariant as the money: a reversal cannot take back
    // more units than the same (sale, product) pair recognised in scope.
    assert.ok(Number(item.qty_sold) >= 0, `qty_sold is non-negative by construction (product ${item.id} = ${Number(item.qty_sold)})`)
    // Every sale_items.quantity in this fixture is a whole number, so every
    // Net sold must be one too. The list renders this cell with no
    // formatting, so a proportional split of a reversal put "1.8" -- and,
    // off a less convenient share, 1.7999999999999998 -- into a count.
    if (Number(item.id) !== 13) {
      assert.ok(Number.isInteger(Number(item.qty_sold)), `qty_sold stays whole when every sold quantity is whole (product ${item.id} = ${Number(item.qty_sold)})`)
    }
    // The whole point of the lane: this is inventory/ProductDetailModal.tsx's
    // formula. With both operands non-negative its Math.max() clamps are
    // no-ops, so the list and the pane opened from that very row cannot
    // report different numbers for one product.
    assert.equal(
      round2(Math.max(0, revenue) - Math.max(0, cogs)),
      round2(Number(item.profit_usd)),
      `the list's profit_usd equals the detail pane's Math.max(0, revenue) - Math.max(0, cogs) (product ${item.id})`,
    )
  }

  // ---- the OTHER three call sites actually run ----------------------------
  // attachInventoryProductMetrics above is one of the four surfaces. The other
  // three -- GET /summary's branch-scoped and unfiltered paths, and the
  // GET /stats financial join -- build their SQL from the same builder but no
  // pure test executes them, so a SQL error in those shapes would ship
  // silently. Run each shape against the same fixture and read the columns the
  // routes read, including the gross_* columns only /stats consumes.
  const shapes = [
    ['GET /summary, branch-scoped', { branchScoped: true }, { branchId: 1 }],
    ['GET /summary, unfiltered', {}, {}],
  ]
  for (const [label, options, params] of shapes) {
    const sql = productSalesLedger.buildProductSalesLedgerSql(options)
    const rows = db.prepare(`SELECT * FROM (${sql}) fin ORDER BY fin.product_id`).all(params)
    assert.ok(Array.isArray(rows) && rows.length > 0, `${label}: the ledger SQL executes and returns rows`)
    for (const row of rows) {
      for (const column of ['qty_sold', 'revenue_usd', 'revenue_khr', 'cogs_usd', 'cogs_khr',
        'store_discount_usd', 'membership_discount_usd',
        'gross_revenue_usd', 'gross_revenue_khr', 'gross_cogs_usd', 'gross_cogs_khr']) {
        assert.ok(column in row, `${label}: the route reads ${column}, so the ledger must emit it`)
      }
      assert.ok(Number(row.revenue_usd) >= 0, `${label}: revenue_usd non-negative (product ${row.product_id})`)
      assert.ok(Number(row.cogs_usd) >= 0, `${label}: cogs_usd non-negative (product ${row.product_id})`)
      assert.ok(Number(row.qty_sold) >= 0, `${label}: qty_sold non-negative (product ${row.product_id} = ${Number(row.qty_sold)})`)
      if (Number(row.product_id) !== 13) {
        assert.ok(Number.isInteger(Number(row.qty_sold)), `${label}: qty_sold stays whole (product ${row.product_id} = ${Number(row.qty_sold)})`)
      }
      assert.ok(Number(row.gross_revenue_usd) >= Number(row.revenue_usd),
        `${label}: gross is before the return reversal, so it cannot be below net (product ${row.product_id})`)
    }
  }
  // The branch-scoped shape must actually discriminate. Products 8 and 9 (the
  // two branch-split sales) are the only things sold at branch 2, so that
  // scope must return exactly them -- and branch 3, where nothing was sold,
  // must come back empty. Either half alone would pass on a builder that
  // quietly ignored @branchId.
  const branchScopedSql = productSalesLedger.buildProductSalesLedgerSql({ branchScoped: true })
  const branchTwo = db.prepare(`SELECT * FROM (${branchScopedSql}) fin ORDER BY fin.product_id`).all({ branchId: 2 })
  assert.deepEqual(branchTwo.map((row) => Number(row.product_id)), [8, 9, 10, 11, 12, 13],
    'the branch-scoped shape really filters on @branchId: only cases H through M have a branch-2 sale line')
  const branchTwoById = new Map(branchTwo.map((row) => [Number(row.product_id), row]))
  assert.equal(round2(Number(branchTwoById.get(8).qty_sold)), 0,
    'H at branch 2: the 2 units branch 2 sold are the 2 the branch-1 line could not absorb, so branch 2 nets to 0 (base: -3)')
  assert.deepEqual(
    [round2(Number(branchTwoById.get(9).qty_sold)), round2(Number(branchTwoById.get(9).revenue_usd))],
    [0, 0],
    'I at branch 2: the partial return was recorded at branch 2 and belongs entirely to it -- 2 sold, 2 back, nothing left')
  assert.deepEqual(
    [round2(Number(branchTwoById.get(10).qty_sold)), round2(Number(branchTwoById.get(10).revenue_usd)), round2(Number(branchTwoById.get(10).cogs_usd))],
    [0, 0, 0],
    'J at branch 2: the return names branch 2 through the return row, so the whole reversal lands there -- 2 sold, 2 back, nothing left')
  assert.deepEqual(
    [round2(Number(branchTwoById.get(11).revenue_usd)), round2(Number(branchTwoById.get(11).revenue_khr))],
    [49.5, 198000],
    "K at branch 2: the $99 line carries $49.50 of the $50 refund, so the two branches partition it (unit share: $74 here and $0 at branch 1)")
  assert.equal(round2(Number(branchTwoById.get(12).qty_sold)), 1,
    "L at branch 2: the other whole unit of the reversal lands here (proportionally it would be 1.2), so the two branches still net to the unfiltered 3")
  assert.equal(round2(Number(branchTwoById.get(13).qty_sold)), 0,
    'M at branch 2: its 0.4 residual capacity absorbs the portion branch 1 cannot, so no reversal is lost')
  const branchThree = db.prepare(`SELECT * FROM (${branchScopedSql}) fin`).all({ branchId: 3 })
  assert.equal(branchThree.length, 0, 'a branch with no sale lines returns nothing')

  // THE invariant the apportionment exists to restore, stated over every
  // product rather than the two the fixture was built for: slicing the ledger
  // by branch must partition it, never duplicate or lose a reversal. A cap
  // alone cannot satisfy this -- it subtracts the same reversal once per
  // branch, so the branch rows sum to more than the whole; nor can one share
  // for every column -- splitting a refund by the UNIT share overpays a cheap
  // branch line and the cap eats the excess, which is case K.
  //
  // The invariant holds for every sale whose reversals fit inside the branch
  // lines they name, which is every sale in this fixture and every return the
  // app writes against a sale it recognised. It is deliberately NOT asserted
  // as unconditional: two return groups naming different branches that between
  // them push more onto one line than that line recognised clamp on each side
  // separately. See the ledger header -- an invariant that is false in a
  // shipped comment is worse than no comment.
  const unfilteredSql = productSalesLedger.buildProductSalesLedgerSql({})
  const unfiltered = new Map(db.prepare(`SELECT * FROM (${unfilteredSql}) fin`).all({})
    .map((row) => [Number(row.product_id), row]))
  const branchOneById = new Map(db.prepare(`SELECT * FROM (${branchScopedSql}) fin`).all({ branchId: 1 })
    .map((row) => [Number(row.product_id), row]))
  const columnOf = (row, column) => (row ? Number(row[column]) || 0 : 0)
  for (const productId of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
    for (const column of ['qty_sold', 'revenue_usd', 'revenue_khr', 'cogs_usd', 'cogs_khr']) {
      assert.equal(
        round2(columnOf(branchOneById.get(productId), column) + columnOf(branchTwoById.get(productId), column)),
        round2(columnOf(unfiltered.get(productId), column)),
        `branch 1 + branch 2 = the unfiltered ${column} for product ${productId}: a branch slice partitions the ledger`,
      )
    }
  }

  // ---- one implementation, not five ---------------------------------------
  const inventorySource = fs.readFileSync(path.join(srcRoot, 'routes/inventory.ts'), 'utf8')
  assert.equal((inventorySource.match(/buildProductSalesLedgerSql\(/g) || []).length, 4,
    'all four inventory product financial surfaces go through the one ledger builder')
  assert.doesNotMatch(inventorySource, /return_to_stock = 1/,
    'the restock test is lib/returnsStock.ts\'s rule (RESTOCKED_RETURN_LINE), never a hand-written boolean')
  assert.doesNotMatch(inventorySource, /localDateAtOrAfter\('r\.created_at'\)/,
    'a refund is never scoped by the return\'s own date -- that is what reverses a sale the window never recognised')
  assert.doesNotMatch(inventorySource, /COALESCE\(ret\.refund_usd, 0\)/,
    'no hand-rolled sales-minus-returns arithmetic survives in the route')

  const ledgerSource = fs.readFileSync(path.join(srcRoot, 'lib/productSalesLedger.ts'), 'utf8')
  assert.match(ledgerSource, /JOIN sales s ON s\.id = r\.sale_id/,
    'the return side joins through the sale it reverses')
  assert.doesNotMatch(ledgerSource, /Math\.max\(0, profit/, 'profit is never floored')

  console.log('inventory per-product profit floor (root-cause) tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

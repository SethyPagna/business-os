// Owner (Sep 17, P10-17): "remaining column are only showing 0".
//
// The Remaining column summed `branch_batch_stock` and coalesced the absence
// of a lot ledger to the NUMBER 0, so ~19.9k lots imported from the old
// system -- which populated the product ledger and never the lot ledger --
// claimed "sold out" when the truth is "never tracked at lot level".
//
// A test that only proved NULL comes back for an untracked lot would pass
// just as well against `remaining_quantity = NULL` for every row. So every
// case here is paired with its opposite: a lot that genuinely sold out
// through an allocation, one that sold out through a stamped movement, one
// still holding stock, and a reverted lot with nothing received. Those must
// all keep their honest number.
//
// Run (from cloudflare/): node scripts/test-lot-remaining-untracked-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

let checks = 0
function check(label, cond) {
  assert.ok(cond, `FAIL: ${label}`)
  checks++
  console.log(`  ok  ${label}`)
}

const root = path.join(__dirname, '..')
const src = (rel) => fs.readFileSync(path.join(root, 'src', rel), 'utf8')

// --- 1. The expression itself, taken from the module the routes import -----
const lib = src(path.join('lib', 'lotRemaining.ts'))
const body = lib.slice(lib.indexOf('return `') + 'return `'.length, lib.lastIndexOf('`'))
const remainingSql = (alias, qty) =>
  body.split('${batchAlias}').join(alias).split('${qtyExpr}').join(qty)
check('the shared expression carries no unresolved placeholder',
  !/\$\{/.test(remainingSql('pb', 'bbs.qty')))

// --- 2. Every sibling surface that shows a lot's remaining uses it ---------
// Cross-surface rule: the supplier's purchases, the product detail's lot list
// and the product's per-supplier drill all read the same number.
const contacts = src(path.join('routes', 'contacts.ts'))
const products = src(path.join('routes', 'products.ts'))
check("Contacts' supplier purchases uses the shared expression",
  /\$\{lotRemainingSql\('pb', 'bbs\.remaining_quantity'\)\} AS remaining_quantity/.test(contacts))
check('both product lot surfaces use it too (2 sites)',
  (products.match(/\$\{lotRemainingSql\('pb', 'bbs\.qty'\)\} AS total_qty/g) || []).length === 2)
check('no surface silently coalesces a missing lot ledger to 0 again',
  !/COALESCE\(bbs\.remaining_quantity, 0\) AS remaining_quantity/.test(contacts)
  && !/COALESCE\(bbs\.qty, 0\) AS total_qty/.test(products))

// --- 3. The probes are indexed --------------------------------------------
const migrations = fs
  .readdirSync(path.join(root, 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .map((f) => fs.readFileSync(path.join(root, 'migrations', f), 'utf8'))
  .join('\n')
check('the allocation probe has an index (0180), not a full scan per lot',
  /CREATE INDEX IF NOT EXISTS idx_sale_item_batch_allocations_batch\s+ON sale_item_batch_allocations \(batch_id\)/.test(migrations))
check('the movement probe has its index (0084)',
  /CREATE INDEX IF NOT EXISTS idx_inventory_movements_batch/.test(migrations))

// --- 4. The behaviour, on a real migrated database -------------------------
const db = openDb(loadAll())
const run = (sql, params = {}) => db.prepare(sql).run(params)

run(`INSERT INTO suppliers (id, name) VALUES (7, 'Acme')`)
const lot = (id, received) => run(
  `INSERT INTO product_batches (id, variant_product_id, batch_key, is_active, supplier_id, supplier_name, received_at, received_quantity, received_cost_usd, payment_status)
   VALUES (@id, 200, 'BK' || @id, 1, 7, 'Acme', '2026-02-01', @received, 10.0, 'paid')`,
  { id, received },
)

lot(1, 10) // imported history: received, but the lot ledger never held it
lot(2, 10) // sold out through a recorded sale allocation
lot(3, 10) // sold out, traceable only through a stamped movement
lot(4, 10) // still on the shelf
lot(5, 0)  // a reverted receipt: nothing was ever received

run(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (2, 1, 0)`)
run(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (3, 1, 0)`)
run(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (4, 1, 5)`)
run(`INSERT INTO sale_items (id, sale_id, product_id, quantity, applied_price_usd) VALUES (1, 1, 200, 10, 2.0)`)
run(`INSERT INTO sale_item_batch_allocations (sale_item_id, batch_id, branch_id, quantity) VALUES (1, 2, 1, 10)`)
run(`INSERT INTO inventory_movements (product_id, branch_id, quantity, movement_type, batch_id) VALUES (200, 1, -10, 'sale', 3)`)

const rows = db.prepare(`
  SELECT pb.id, ${remainingSql('pb', 'bbs.qty')} AS remaining
  FROM product_batches pb
  LEFT JOIN (SELECT batch_id, SUM(quantity) AS qty FROM branch_batch_stock GROUP BY batch_id) bbs
    ON bbs.batch_id = pb.id
  WHERE pb.variant_product_id = 200
  ORDER BY pb.id
`).all({})
const remaining = new Map(rows.map((r) => [Number(r.id), r.remaining]))

check('a lot the system never tracked reports nothing, not zero -- the column stops claiming "sold out"',
  remaining.get(1) === null)
check('a lot that genuinely sold out through a sale keeps its honest 0',
  Number(remaining.get(2)) === 0)
check('a lot whose only trace is a stamped movement also keeps its honest 0',
  Number(remaining.get(3)) === 0)
check('a lot still holding stock is untouched', Number(remaining.get(4)) === 5)
check('a reverted receipt (nothing received) stays 0, not unknown',
  Number(remaining.get(5)) === 0)

// The untracked lot is not permanently unknown: the moment it is touched at
// lot level, the number becomes real again and the display follows.
run(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (1, 1, 4)`)
const after = db.prepare(`
  SELECT ${remainingSql('pb', 'bbs.qty')} AS remaining
  FROM product_batches pb
  LEFT JOIN (SELECT batch_id, SUM(quantity) AS qty FROM branch_batch_stock GROUP BY batch_id) bbs
    ON bbs.batch_id = pb.id
  WHERE pb.id = 1
`).get({})
check('once the lot is tracked, its remaining quantity is reported again',
  Number(after.remaining) === 4)

console.log(`\nAll ${checks} checks passed.`)

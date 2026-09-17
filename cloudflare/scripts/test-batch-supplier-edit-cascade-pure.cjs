// Owner (Sep 17): "make sure they are fully linkover when i change or make
// edits."
//
// When a batch that arrived with no supplier is given one -- from the batch
// editor or the stock-in session editor, both of which PATCH /api/batches/:id
// -- every surface that reports that lot's supplier must follow, with no
// second write and no stale snapshot left behind:
//
//   * the supplier's purchases and totals in Contacts
//   * the stock-in session / invoice reads
//   * the stock ledger (stock change history and its movement detail)
//   * the product detail report's per-supplier grouping
//
// This is true only while every one of those readers takes the supplier from
// product_batches LIVE. The day someone denormalises a supplier snapshot onto
// stock_movements or a purchases table, an edit silently stops propagating and
// the two surfaces disagree forever. That is what this test is here to catch:
// it performs the exact UPDATE the route performs and re-runs the readers.
//
// Run (from cloudflare/): node scripts/test-batch-supplier-edit-cascade-pure.cjs

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

const src = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8')

// --- 1. The route writes both columns, in one statement -------------------
const batchesRoute = src(path.join('routes', 'batches.ts'))
check('PATCH /batches/:id accepts supplier_name',
  /if \(bodyExtra\.supplier_name !== undefined\)/.test(batchesRoute))
check('it writes supplier_name and supplier_id together (a name without its link is a half edit)',
  /updates\.push\('supplier_name = @supplier_name', 'supplier_id = @supplier_id'\)/.test(batchesRoute))
check('an empty name clears the column instead of storing blank text',
  /params\.supplier_name = String\(bodyExtra\.supplier_name \|\| ''\)\.trim\(\) \|\| null/.test(batchesRoute))

// --- 2. Every reader reads the supplier live, from product_batches --------
const ledgerQuery = src(path.join('lib', 'stockLedgerQuery.ts'))
const sessionQuery = src(path.join('lib', 'stockInSessionsQuery.ts'))
const contactsRoute = src(path.join('routes', 'contacts.ts'))
check('the stock ledger joins the lot for its supplier',
  /b\.supplier_name AS batch_supplier_name/.test(ledgerQuery))
check('the stock-in session read joins the lot for its supplier',
  /b\.supplier_name AS batch_supplier_name/.test(sessionQuery))
check("Contacts' purchases scope reads product_batches, not a purchases snapshot",
  /FROM product_batches pb\s+WHERE \$\{purchasesWhere\}/.test(contactsRoute))
// No reader may own a supplier column of its own for a lot: that is the shape
// that breaks the cascade. (supplier_invoices is a separate legacy AP document,
// not a lot attribution, so it is excluded by name.)
const migrations = fs
  .readdirSync(path.join(__dirname, '..', 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .map((f) => fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'))
  .join('\n')
check('no migration ever added a lot-supplier snapshot to stock_movements',
  !/ALTER TABLE stock_movements\s+ADD COLUMN[^\n;]*supplier/i.test(migrations))

// --- 3. The cascade itself, on a real migrated database -------------------
const db = openDb(loadAll())
db.prepare(`INSERT INTO suppliers (id, name) VALUES (5, 'Acme')`).run({})
db.prepare(
  `INSERT INTO product_batches (id, variant_product_id, batch_key, is_active, supplier_id, supplier_name, received_at, received_quantity, received_cost_usd, payment_status)
   VALUES (1, 100, 'BK1', 1, NULL, NULL, '2026-02-01', 12, 60.0, 'paid')`,
).run({})
db.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (1, 1, 12)`).run({})

const RESOLVED = `COALESCE(pb.supplier_id, (SELECT s.id FROM suppliers s WHERE lower(trim(s.name)) = lower(trim(pb.supplier_name)) ORDER BY s.id LIMIT 1))`
const KEY = `COALESCE('id:' || (${RESOLVED}), NULLIF('name:' || lower(trim(COALESCE(pb.supplier_name, ''))), 'name:'), 'none')`

const groupKey = () => db.prepare(
  `SELECT ${KEY} AS supplier_key, COUNT(*) AS lots FROM product_batches pb WHERE pb.variant_product_id = 100 GROUP BY supplier_key`,
).all({})
const purchases = () => db.prepare(
  `SELECT COUNT(*) AS batches, COALESCE(SUM(pb.received_cost_usd), 0) AS cost_usd FROM product_batches pb WHERE pb.supplier_id = 5`,
).get({})
const ledgerSupplier = () => db.prepare(
  `SELECT b.supplier_name AS batch_supplier_name FROM product_batches b WHERE b.id = 1`,
).get({})

// Before: the lot is unattributed. It is still VISIBLE -- that is the whole
// point of the 'none' group -- but it belongs to no supplier.
const before = groupKey()
check("before the edit the lot groups under 'none' (visible, unattributed)",
  before.length === 1 && before[0].supplier_key === 'none' && Number(before[0].lots) === 1)
check('before the edit the supplier has no purchases', Number(purchases().batches) === 0)
check('before the edit the ledger shows no supplier for the lot', ledgerSupplier().batch_supplier_name == null)

// The edit, exactly as the route performs it.
db.prepare(`UPDATE product_batches SET supplier_name = @n, supplier_id = @i, updated_at = datetime('now') WHERE id = 1`)
  .run({ n: 'Acme', i: 5 })

const after = groupKey()
check("after the edit the lot groups under 'id:5'",
  after.length === 1 && after[0].supplier_key === 'id:5')
const p = purchases()
check('after the edit the supplier owns the purchase, with its money',
  Number(p.batches) === 1 && Number(p.cost_usd) === 60)
check('after the edit the ledger reports the supplier for the lot',
  ledgerSupplier().batch_supplier_name === 'Acme')

// A name typed without picking a contact still links: the readers resolve an
// exact name match to the supplier row, so the surfaces do not fork.
db.prepare(`UPDATE product_batches SET supplier_name = @n, supplier_id = NULL WHERE id = 1`).run({ n: '  acme ' })
check('a name-only edit whose name matches a supplier still resolves to that supplier',
  groupKey()[0].supplier_key === 'id:5')

// And clearing it puts the lot back in the visible unattributed group rather
// than dropping it out of every report.
db.prepare(`UPDATE product_batches SET supplier_name = NULL, supplier_id = NULL WHERE id = 1`).run({})
check("clearing the supplier returns the lot to the 'none' group, never to nowhere",
  groupKey()[0].supplier_key === 'none')
check('clearing the supplier removes the purchase from the supplier', Number(purchases().batches) === 0)

console.log(`\nAll ${checks} checks passed.`)

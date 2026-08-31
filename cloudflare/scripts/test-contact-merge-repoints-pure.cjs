// Proves that resolving a contact CONFLICT via the /merge endpoint MOVES
// every historical reference from the merged-away record onto the survivor,
// leaving nothing orphaned when the loser row is deleted. The contacts merge
// deletes the loser (unlike the products merge, which soft-deactivates), so a
// reference this handler forgets to repoint is silently lost the moment the
// loser is gone.
//
// Two layers, no app harness (route handlers here are not fetch-tested):
//   (1) MOVEMENT -- build the REAL schema from the full migration chain, seed
//       loser-linked rows in every affected table, run the exact repoint SQL,
//       and assert the survivor now owns them and the loser owns nothing.
//       Because the SQL runs against the real schema, a wrong table/column
//       name (invisible to tsc, since the SQL is a string) fails loudly here.
//   (2) SOURCE GUARD -- assert routes/contacts.ts's merge handler actually
//       contains each repoint, so a later edit cannot quietly drop one and
//       still pass layer (1).
//
// Run (from cloudflare/): node scripts/test-contact-merge-repoints-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const db = openDb(loadAll())
const run = (sql, params) => db.prepare(sql).run(params)
const count = (sql, params) => Number(db.prepare(sql).get(params).n)
const one = (sql, params) => db.prepare(sql).get(params)

// --- The repoint statements, verbatim from routes/contacts.ts's merge handler.
// Each is run below AND asserted present in the route source, so the two can
// never drift apart.
const CUSTOMER_REPOINTS = [
  `UPDATE sales SET customer_id = @keepId WHERE customer_id = @mergeId`,
  `UPDATE returns SET customer_id = @keepId WHERE customer_id = @mergeId`,
  `UPDATE customer_share_submissions SET customer_id = @keepId WHERE customer_id = @mergeId`,
  `UPDATE loyalty_point_adjustments SET customer_id = @keepId WHERE customer_id = @mergeId`,
  `UPDATE portal_accounts SET contact_id = @keepId, updated_at = CURRENT_TIMESTAMP WHERE contact_id = @mergeId`,
  `UPDATE customer_receivables SET customer_id = @keepId, customer_name = @keeperName WHERE customer_id = @mergeId`,
  `UPDATE customer_receivables SET customer_name = @keeperName WHERE customer_id IS NULL AND lower(trim(customer_name)) = @mergedNameLower`,
]
const SUPPLIER_REPOINTS = [
  `UPDATE returns SET supplier_id = @keepId WHERE supplier_id = @mergeId`,
  `UPDATE product_batches SET supplier_id = @keepId, supplier_name = @keeperName WHERE supplier_id = @mergeId`,
  `UPDATE products SET supplier = @keeperName WHERE supplier = @mergedName`,
  `UPDATE product_batches SET supplier_name = @keeperName WHERE supplier_id IS NULL AND lower(trim(supplier_name)) = @mergedNameLower`,
  `UPDATE supplier_invoices SET supplier_id = @keepId, supplier_name = @keeperName WHERE supplier_id = @mergeId`,
  `UPDATE supplier_invoices SET supplier_name = @keeperName WHERE supplier_id IS NULL AND lower(trim(supplier_name)) = @mergedNameLower`,
]
const DELIVERY_REPOINTS = [
  `UPDATE sales SET delivery_contact_id = @keepId WHERE delivery_contact_id = @mergeId`,
]

let failed = 0
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed += 1; console.error(`FAIL ${name}`); console.error(e) }
}

// --------------------------------------------------------------------------
// Seed: keeper + loser for each contact kind, with loser-linked rows in every
// table the merge must move.
// --------------------------------------------------------------------------
run(`INSERT INTO customers (id, name) VALUES (1, 'Keeper Co'), (2, 'Loser Co')`)
run(`INSERT INTO suppliers (id, name) VALUES (11, 'KeepSup'), (22, 'LoseSup')`)
run(`INSERT INTO delivery_contacts (id, name) VALUES (31, 'KeepDrv'), (32, 'LoseDrv')`)
run(`INSERT INTO products (id, name, supplier) VALUES (101, 'P1', 'LoseSup')`)

// Customer-linked
run(`INSERT INTO sales (customer_id) VALUES (2)`)
run(`INSERT INTO returns (customer_id, return_scope) VALUES (2, 'customer')`)
run(`INSERT INTO customer_share_submissions (customer_id) VALUES (2)`)
run(`INSERT INTO loyalty_point_adjustments (customer_id, points) VALUES (2, 10)`)
run(`INSERT INTO portal_accounts (membership_id, name, phone, password_hash, contact_id) VALUES ('M1', 'Loser', '012000000', 'h', 2)`)
run(`INSERT INTO customer_receivables (legacy_id, customer_id, customer_name, invoice_date, status, source_file, source_row) VALUES (1, 2, 'Loser Co', '2026-01-01', 'outstanding', 'ar.csv', 1)`)
run(`INSERT INTO customer_receivables (legacy_id, customer_id, customer_name, invoice_date, status, source_file, source_row) VALUES (2, NULL, 'Loser Co', '2026-01-02', 'outstanding', 'ar.csv', 2)`)

// Supplier-linked
run(`INSERT INTO returns (supplier_id, return_scope) VALUES (22, 'supplier')`)
run(`INSERT INTO product_batches (variant_product_id, batch_key, supplier_id, supplier_name) VALUES (101, 'b-id', 22, 'LoseSup old')`)
run(`INSERT INTO product_batches (variant_product_id, batch_key, supplier_id, supplier_name) VALUES (101, 'b-name', NULL, 'LoseSup')`)
run(`INSERT INTO supplier_invoices (source_branch, legacy_id, supplier_id, supplier_name, invoice_date, status, source_file, source_row) VALUES ('B', 1, 22, 'LoseSup old', '2026-01-01', 'outstanding', 'ap.csv', 1)`)
run(`INSERT INTO supplier_invoices (source_branch, legacy_id, supplier_id, supplier_name, invoice_date, status, source_file, source_row) VALUES ('B', 2, NULL, 'LoseSup', '2026-01-02', 'outstanding', 'ap.csv', 2)`)

// Delivery-linked
run(`INSERT INTO sales (delivery_contact_id) VALUES (32)`)

// --------------------------------------------------------------------------
// Run the repoints exactly as the merge handler does, then delete the losers
// (as the handler does) to prove nothing dangles afterward.
// --------------------------------------------------------------------------
const custParams = { keepId: 1, mergeId: 2, keeperName: 'Keeper Co', mergedName: 'Loser Co', mergedNameLower: 'loser co' }
const supParams = { keepId: 11, mergeId: 22, keeperName: 'KeepSup', mergedName: 'LoseSup', mergedNameLower: 'losesup' }
const delParams = { keepId: 31, mergeId: 32 }
for (const sql of CUSTOMER_REPOINTS) run(sql, custParams)
for (const sql of SUPPLIER_REPOINTS) run(sql, supParams)
for (const sql of DELIVERY_REPOINTS) run(sql, delParams)
run(`DELETE FROM customers WHERE id = 2`)
run(`DELETE FROM suppliers WHERE id = 22`)
run(`DELETE FROM delivery_contacts WHERE id = 32`)

// --------------------------------------------------------------------------
// Layer 1: movement assertions
// --------------------------------------------------------------------------
check('customer merge moves sales/returns/shares/loyalty to the survivor', () => {
  assert.strictEqual(count(`SELECT COUNT(*) n FROM sales WHERE customer_id = 2`), 0, 'sales still on loser')
  assert.strictEqual(count(`SELECT COUNT(*) n FROM sales WHERE customer_id = 1`), 1, 'sale not moved to keeper')
  assert.strictEqual(count(`SELECT COUNT(*) n FROM returns WHERE customer_id = 2`), 0, 'return still on loser')
  assert.strictEqual(count(`SELECT COUNT(*) n FROM returns WHERE customer_id = 1`), 1, 'return not moved to keeper')
  assert.strictEqual(count(`SELECT COUNT(*) n FROM customer_share_submissions WHERE customer_id = 2`), 0)
  assert.strictEqual(count(`SELECT COUNT(*) n FROM customer_share_submissions WHERE customer_id = 1`), 1)
  assert.strictEqual(count(`SELECT COUNT(*) n FROM loyalty_point_adjustments WHERE customer_id = 2`), 0)
  assert.strictEqual(count(`SELECT COUNT(*) n FROM loyalty_point_adjustments WHERE customer_id = 1`), 1)
})

check('customer merge moves the storefront account link (portal_accounts.contact_id)', () => {
  assert.strictEqual(count(`SELECT COUNT(*) n FROM portal_accounts WHERE contact_id = 2`), 0, 'portal account orphaned on deleted customer')
  assert.strictEqual(count(`SELECT COUNT(*) n FROM portal_accounts WHERE contact_id = 1`), 1, 'portal account not repointed to keeper')
})

check('customer merge moves AR ledger rows (id-linked AND null-id by name) onto the survivor', () => {
  assert.strictEqual(count(`SELECT COUNT(*) n FROM customer_receivables WHERE customer_id = 2`), 0, 'AR row still on loser id')
  const idRow = one(`SELECT customer_id, customer_name FROM customer_receivables WHERE legacy_id = 1`)
  assert.strictEqual(Number(idRow.customer_id), 1, 'id-linked AR row not repointed')
  assert.strictEqual(idRow.customer_name, 'Keeper Co', 'id-linked AR name not carried to keeper')
  const nameRow = one(`SELECT customer_id, customer_name FROM customer_receivables WHERE legacy_id = 2`)
  assert.strictEqual(nameRow.customer_id, null, 'null-id AR row should stay null-id')
  assert.strictEqual(nameRow.customer_name, 'Keeper Co', 'null-id AR row not moved by name to keeper')
})

check('supplier merge moves returns/products/batches to the survivor', () => {
  assert.strictEqual(count(`SELECT COUNT(*) n FROM returns WHERE supplier_id = 22`), 0)
  assert.strictEqual(count(`SELECT COUNT(*) n FROM returns WHERE supplier_id = 11`), 1)
  assert.strictEqual(count(`SELECT COUNT(*) n FROM products WHERE supplier = 'LoseSup'`), 0, 'product still on loser supplier name')
  assert.strictEqual(count(`SELECT COUNT(*) n FROM products WHERE supplier = 'KeepSup'`), 1)
  // id-attributed lot
  const idLot = one(`SELECT supplier_id, supplier_name FROM product_batches WHERE batch_key = 'b-id'`)
  assert.strictEqual(Number(idLot.supplier_id), 11, 'id-linked lot not repointed')
  assert.strictEqual(idLot.supplier_name, 'KeepSup', 'id-linked lot name not carried')
  // name-only lot (supplier_id NULL)
  const nameLot = one(`SELECT supplier_id, supplier_name FROM product_batches WHERE batch_key = 'b-name'`)
  assert.strictEqual(nameLot.supplier_id, null)
  assert.strictEqual(nameLot.supplier_name, 'KeepSup', 'name-only lot not moved by name')
})

check('supplier merge moves AP ledger rows (id-linked AND null-id by name) onto the survivor', () => {
  assert.strictEqual(count(`SELECT COUNT(*) n FROM supplier_invoices WHERE supplier_id = 22`), 0)
  const idInv = one(`SELECT supplier_id, supplier_name FROM supplier_invoices WHERE legacy_id = 1`)
  assert.strictEqual(Number(idInv.supplier_id), 11, 'id-linked AP invoice not repointed')
  assert.strictEqual(idInv.supplier_name, 'KeepSup', 'id-linked AP name not carried')
  const nameInv = one(`SELECT supplier_id, supplier_name FROM supplier_invoices WHERE legacy_id = 2`)
  assert.strictEqual(nameInv.supplier_id, null)
  assert.strictEqual(nameInv.supplier_name, 'KeepSup', 'null-id AP invoice not moved by name')
})

check('delivery-contact merge moves the delivery link on sales', () => {
  assert.strictEqual(count(`SELECT COUNT(*) n FROM sales WHERE delivery_contact_id = 32`), 0)
  assert.strictEqual(count(`SELECT COUNT(*) n FROM sales WHERE delivery_contact_id = 31`), 1)
})

// --------------------------------------------------------------------------
// Layer 2: source guard -- the route actually issues each repoint.
// --------------------------------------------------------------------------
check('routes/contacts.ts merge handler contains every repoint statement', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'contacts.ts'), 'utf8')
  const norm = (s) => s.replace(/\s+/g, ' ').trim()
  const flat = norm(source)
  for (const sql of [...CUSTOMER_REPOINTS, ...SUPPLIER_REPOINTS, ...DELIVERY_REPOINTS]) {
    assert.ok(flat.includes(norm(sql)), `merge handler is missing repoint: ${sql}`)
  }
})

if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1) }
console.log('\nAll contact-merge repoint tests passed')

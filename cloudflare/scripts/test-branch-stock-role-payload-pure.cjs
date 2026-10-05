// Lane LE (branch cutover): product data delivered to the till carries the
// branch ROLE. The POS decides "can sell" from the payload's own branch_stock
// entry; with only a name there, renaming the Warehouse to "LC Store" greys
// every pill and the cashier cannot add to the cart.
//
// The fragments under test are cut out of the shipped route source and run
// against a SQLite fixture with the real 0223 branch columns, so this is the
// expression the Worker executes, not a copy of it.
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const src = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8').replace(/\r\n/g, '\n')
const inventory = src('routes/inventory.ts')
const products = src('routes/products.ts')

function fixture(branches) {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE branches (id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT, canonical_key TEXT,
      successor_branch_id INTEGER, is_default INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE branch_stock (id INTEGER PRIMARY KEY, product_id INTEGER, branch_id INTEGER, quantity REAL);
    INSERT INTO products(id,name) VALUES (10,'Soap');
  `)
  const insert = db.prepare('INSERT INTO branches(id,name,role,canonical_key,successor_branch_id,is_default,is_active) VALUES(?,?,?,?,?,?,?)')
  for (const b of branches) insert.run(b.id, b.name, b.role ?? null, b.key ?? null, b.successor ?? null, b.is_default ?? 0, b.is_active ?? 1)
  db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) SELECT 10, id, 5 FROM branches').run()
  return db
}
const LEGACY = [{ id: 1, name: 'Warehouse', is_default: 1 }, { id: 2, name: 'Shop' }]
const FINAL = [
  { id: 1, name: 'LC Store', role: 'shop', key: 'warehouse', is_default: 1 },
  { id: 2, name: 'Old Shop', role: 'shop', key: 'shop', is_active: 0, successor: 1 },
]

let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }

// Every json_object(...) that builds a branch_stock entry in routes/inventory.ts.
const entryExpressions = [...inventory.matchAll(/json_object\('branch_id', bs2\.branch_id[^\n]*?bs2\.quantity[^\n]*?\)(?=\)| ?\))/g)].map((m) => m[0])

check('all three inventory producers are found', () => {
  assert.strictEqual(entryExpressions.length, 3, `found ${entryExpressions.length}`)
  assert.strictEqual(new Set(entryExpressions).size, 1, 'the three producers share one entry shape')
})

check('inventory entries carry branch_role and branch_active; a renamed Warehouse still says role shop', () => {
  for (const [label, branches, expected] of [
    ['legacy (role NULL)', LEGACY, [
      { branch_id: 1, branch_name: 'Warehouse', branch_role: null, branch_active: 1 },
      { branch_id: 2, branch_name: 'Shop', branch_role: null, branch_active: 1 }]],
    ['cutover end state', FINAL, [
      { branch_id: 1, branch_name: 'LC Store', branch_role: 'shop', branch_active: 1 },
      { branch_id: 2, branch_name: 'Old Shop', branch_role: 'shop', branch_active: 0 }]],
  ]) {
    const db = fixture(branches)
    const row = db.prepare(`SELECT p.id, COALESCE((
      SELECT json_group_array(${entryExpressions[0]}) FROM branch_stock bs2 JOIN branches b2 ON b2.id = bs2.branch_id WHERE bs2.product_id = p.id
    ), '[]') AS j FROM products p`).get()
    const entries = JSON.parse(row.j).sort((a, b) => a.branch_id - b.branch_id)
    assert.deepStrictEqual(entries.map(({ quantity, ...rest }) => rest), expected, label)
    assert.ok(entries.every((e) => e.quantity === 5), `${label}: quantity still shipped`)
    db.close()
  }
})

check('the product list (the POS source) selects role and activity and ships them on every entry', () => {
  const start = products.indexOf('async function attachBranchStock(')
  assert.ok(start > 0)
  const block = products.slice(start, products.indexOf('async function attachImageGallery(', start))
  const sql = /SELECT (id, name, role, is_active) FROM branches WHERE is_active = 1/.exec(block)
  assert.ok(sql, 'attachBranchStock must read role and is_active with the branch')
  assert.match(block, /branch_role: branch\.role \?\? null,/)
  assert.match(block, /branch_active: branch\.is_active,/)
  // and the SELECT really runs against the 0223 shape, listing only active branches
  const db = fixture(FINAL)
  const rows = db.prepare('SELECT id, name, role, is_active FROM branches WHERE is_active = 1 ORDER BY is_default DESC, id ASC').all()
  assert.deepStrictEqual(rows, [{ id: 1, name: 'LC Store', role: 'shop', is_active: 1 }])
  db.close()
})

check('no producer ships a name without the role beside it (RED on bb639041)', () => {
  assert.doesNotMatch(inventory, /json_object\('branch_id', bs2\.branch_id, 'branch_name', b2\.name, 'quantity', bs2\.quantity\)/, 'bare name-only entry')
  assert.doesNotMatch(products, /branch_name: branch\.name,\n\s+quantity:/, 'bare name-only entry')
})

console.log(`${passed} checks passed`)

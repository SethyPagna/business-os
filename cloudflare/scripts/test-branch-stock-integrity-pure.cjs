// Regression guard for /api/branches/stock-integrity.
// Valid stock can live in ANY branch. Integrity repair may reconcile the
// denormalized products.stock_quantity total and place legacy stock that has
// no branch row at all, but it must never consolidate existing branch stock
// into the default branch.
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')

const sqlite = new Database(':memory:')
sqlite.exec(`
  CREATE TABLE branches (id INTEGER PRIMARY KEY, name TEXT NOT NULL, is_default INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1);
  CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, stock_quantity REAL DEFAULT 0, is_active INTEGER DEFAULT 1, updated_at TEXT);
  CREATE TABLE branch_stock (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, branch_id INTEGER NOT NULL, quantity REAL DEFAULT 0 CHECK(quantity >= 0), UNIQUE(product_id, branch_id));
  INSERT INTO branches(id,name,is_default,is_active) VALUES (1,'Main',1,1),(2,'Warehouse',0,1);
  -- Correct multi-branch allocation: this MUST NOT be called misplaced.
  INSERT INTO products(id,name,stock_quantity,is_active) VALUES (10,'Correct multi-branch',7,1);
  INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES (10,1,3),(10,2,4);
  -- Wrong denormalized catalog total; branch allocation itself is correct.
  INSERT INTO products(id,name,stock_quantity,is_active) VALUES (20,'Wrong total',99,1);
  INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES (20,1,2),(20,2,5);
  -- Legacy quantity with no branch assignment: preserve it by assigning Main.
  INSERT INTO products(id,name,stock_quantity,is_active) VALUES (30,'Legacy unassigned',6,1);
`)

const ISSUE_SQL = `
  SELECT p.id AS product_id, p.name AS product_name,
         COALESCE(p.stock_quantity, 0) AS stored_quantity,
         COALESCE(SUM(bs.quantity), 0) AS branch_quantity,
         COUNT(bs.id) AS branch_rows
  FROM products p
  LEFT JOIN branch_stock bs ON bs.product_id = p.id
  WHERE p.is_active = 1
  GROUP BY p.id, p.name, p.stock_quantity
  HAVING (COUNT(bs.id) = 0 AND ABS(COALESCE(p.stock_quantity, 0)) > 0.000001)
      OR (COUNT(bs.id) > 0 AND ABS(COALESCE(p.stock_quantity, 0) - COALESCE(SUM(bs.quantity), 0)) > 0.000001)
  ORDER BY p.name COLLATE NOCASE ASC, p.id ASC`

const issues = sqlite.prepare(ISSUE_SQL).all()
assert.deepStrictEqual(issues.map((r) => Number(r.product_id)).sort((a,b) => a-b), [20, 30], 'only objective inconsistencies are reported')
assert.ok(!issues.some((r) => Number(r.product_id) === 10), 'valid Warehouse stock is never an integrity issue')

// Model the two set-based writes used by the route, scoped to the confirmed
// issue IDs. Existing branch rows are not modified.
sqlite.prepare(`
  INSERT INTO branch_stock(product_id, branch_id, quantity)
  SELECT p.id, @branchId, MAX(0, COALESCE(p.stock_quantity,0))
  FROM products p
  WHERE p.id IN (30) AND p.is_active=1
    AND ABS(COALESCE(p.stock_quantity,0)) > 0.000001
    AND NOT EXISTS (SELECT 1 FROM branch_stock bs WHERE bs.product_id=p.id)
  ON CONFLICT(product_id,branch_id) DO NOTHING`).run({ branchId: 1 })
sqlite.exec(`
  UPDATE products
  SET stock_quantity=(SELECT COALESCE(SUM(bs.quantity),0) FROM branch_stock bs WHERE bs.product_id=products.id)
  WHERE id IN (20,30) AND is_active=1
    AND EXISTS (SELECT 1 FROM branch_stock bs WHERE bs.product_id=products.id)
    AND ABS(COALESCE(stock_quantity,0) - (SELECT COALESCE(SUM(bs.quantity),0) FROM branch_stock bs WHERE bs.product_id=products.id)) > 0.000001`)

assert.strictEqual(sqlite.prepare('SELECT stock_quantity FROM products WHERE id=20').get().stock_quantity, 7, 'catalog total reconciles to 2+5')
assert.strictEqual(sqlite.prepare('SELECT quantity FROM branch_stock WHERE product_id=20 AND branch_id=1').get().quantity, 2, 'Main allocation is unchanged')
assert.strictEqual(sqlite.prepare('SELECT quantity FROM branch_stock WHERE product_id=20 AND branch_id=2').get().quantity, 5, 'Warehouse allocation is unchanged')
assert.strictEqual(sqlite.prepare('SELECT stock_quantity FROM products WHERE id=10').get().stock_quantity, 7, 'already-correct product stays untouched')
assert.strictEqual(sqlite.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=2').get().quantity, 4, 'valid non-default stock is preserved')
assert.strictEqual(sqlite.prepare('SELECT quantity FROM branch_stock WHERE product_id=30 AND branch_id=1').get().quantity, 6, 'legacy unassigned stock quantity is preserved')
assert.strictEqual(sqlite.prepare(ISSUE_SQL).all().length, 0, 'repair resolves the modeled integrity issues')

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'branches.ts'), 'utf8')
const integrityBlock = routeSource.slice(routeSource.indexOf("app.get('/stock-integrity'"), routeSource.indexOf('// NOTE: a GET /transfers/list'))
assert.ok(/SUM\(bs\.quantity\)/.test(integrityBlock), 'integrity reads the all-branch authoritative sum')
assert.ok(/missing_branch_stock/.test(routeSource) && /total_mismatch/.test(routeSource), 'both objective issue types are explicit')
assert.ok(/chunkForBinding\(issues\.map/.test(integrityBlock), 'repair is scoped to confirmed issue IDs')
assert.ok(!/bs\.branch_id\s*!=\s*@defaultBranchId/.test(integrityBlock), 'non-default placement is not classified as an error')
assert.ok(!/UPDATE branch_stock SET quantity = 0/.test(integrityBlock), 'repair never clears a branch allocation')
assert.ok(!/DO UPDATE SET quantity = quantity \+ excluded\.quantity/.test(integrityBlock), 'repair never consolidates stock into Main')
console.log('PASS branch stock integrity preserves valid multi-branch allocations and repairs only objective inconsistencies')

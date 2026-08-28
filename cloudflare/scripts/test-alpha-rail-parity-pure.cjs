// The A-Z rail must agree with the grid underneath it, and the storefront's
// rail must agree with admin's.
//
// Two independent bugs made it disagree:
//
//   1. buildPortalCatalog's rail filtered on `is_active = 1` instead of the
//      portal's visibleFilter, so it counted products the merchant had chosen
//      to hide. The rail then CHANGED the moment a shopper searched, because
//      the search path already applied the filter correctly -- letters and
//      counts shifted for no reason the shopper could see.
//
//   2. Every rail counted ROWS via COUNT(*), but a name group is ONE product
//      everywhere else in this app: one card on the storefront, one row in
//      admin, one unit of pagination. A group of 5 rows added 5 to its
//      letter, so the rail promised more products than the grid could render.
//
// Runs against real SQLite with the real migrations, because name_key is
// maintained by a trigger (migration 0010) -- a hand-built fixture would test
// this file's idea of grouping rather than the database's.
//
// Run: node scripts/test-alpha-rail-parity-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const cloudflareRoot = path.join(__dirname, '..')
const MIGRATION_SQLS = loadAll()

let passed = 0
const tests = []
const check = (name, fn) => tests.push({ name, fn })

// The exact expression all three rails now use.
const GROUP_COUNT = `COUNT(DISTINCT COALESCE(NULLIF(p.name_key, ''), CAST(p.id AS TEXT)))`

async function seed(db) {
  // "Rose Serum" is a 3-row name group (different barcodes/prices, so under
  // the identity rule they are child rows of ONE product).
  // "Rain Cream" is a single standalone.
  // "Amber Oil" is out of stock, which the hide-out-of-stock setting removes.
  const rows = [
    { name: 'Rose Serum', barcode: '111', price: 10, qty: 5, active: 1 },
    { name: 'Rose Serum', barcode: '222', price: 12, qty: 5, active: 1 },
    { name: 'Rose Serum', barcode: '333', price: 14, qty: 5, active: 1 },
    { name: 'Rain Cream', barcode: '444', price: 20, qty: 3, active: 1 },
    { name: 'Amber Oil', barcode: '555', price: 30, qty: 0, active: 1 },
    { name: 'Retired Balm', barcode: '666', price: 9, qty: 4, active: 0 },
  ]
  for (const row of rows) {
    await db.prepare(`
      INSERT INTO products (name, barcode, selling_price_usd, stock_quantity, is_active, out_of_stock_threshold)
      VALUES (@name, @barcode, @price, @qty, @active, 0)
    `).run(row)
  }
}

check('a name group counts as ONE product in the rail, not once per row', async () => {
  const db = openDb(MIGRATION_SQLS)
  await seed(db)
  const rows = await db.prepare(`
    SELECT upper(substr(trim(p.name), 1, 1)) AS value, ${GROUP_COUNT} AS count
    FROM products p
    WHERE p.is_active = 1 AND trim(COALESCE(p.name, '')) <> ''
    GROUP BY value ORDER BY value ASC
  `).all({})
  const byLetter = Object.fromEntries(rows.map((r) => [r.value, Number(r.count)]))
  // Rose Serum (3 rows -> 1) + Rain Cream (1) + Retired Balm is inactive.
  assert.equal(byLetter.R, 2, `R should count 2 products (one grouped, one standalone), got ${byLetter.R}`)
  assert.equal(byLetter.A, 1, 'Amber Oil is one product')

  const rowCounted = await db.prepare(`
    SELECT COUNT(*) AS n FROM products p WHERE p.is_active = 1 AND upper(substr(trim(p.name),1,1)) = 'R'
  `).get({})
  assert.equal(Number(rowCounted.n), 4, 'sanity: there really are 4 R rows')
  assert.notEqual(byLetter.R, Number(rowCounted.n), 'the whole point: group count differs from row count')
})

check('the rail honours the hide-out-of-stock setting, so it cannot promise unreachable products', async () => {
  const db = openDb(MIGRATION_SQLS)
  await seed(db)
  // What visibleFilter reduces to when the merchant hides out-of-stock.
  const visible = `p.is_active = 1 AND COALESCE(p.stock_quantity, 0) > COALESCE(p.out_of_stock_threshold, 0)`
  const rows = await db.prepare(`
    SELECT upper(substr(trim(p.name), 1, 1)) AS value, ${GROUP_COUNT} AS count
    FROM products p
    WHERE ${visible} AND trim(COALESCE(p.name, '')) <> ''
    GROUP BY value ORDER BY value ASC
  `).all({})
  const letters = rows.map((r) => r.value)
  assert.ok(!letters.includes('A'), 'Amber Oil is out of stock and hidden, so A must not appear at all')
  assert.ok(letters.includes('R'), 'R still has in-stock products')
})

check('an inactive product never appears in the rail', async () => {
  const db = openDb(MIGRATION_SQLS)
  await seed(db)
  const rows = await db.prepare(`
    SELECT upper(substr(trim(p.name), 1, 1)) AS value, ${GROUP_COUNT} AS count
    FROM products p WHERE p.is_active = 1 AND trim(COALESCE(p.name, '')) <> ''
    GROUP BY value
  `).all({})
  const total = rows.reduce((sum, r) => sum + Number(r.count), 0)
  assert.equal(total, 3, 'Rose Serum group + Rain Cream + Amber Oil = 3; the inactive balm is excluded')
})

check('a blank-named row cannot create an empty letter bucket', async () => {
  const db = openDb(MIGRATION_SQLS)
  await seed(db)
  await db.prepare(`INSERT INTO products (name, is_active) VALUES ('   ', 1)`).run({})
  const rows = await db.prepare(`
    SELECT upper(substr(trim(p.name), 1, 1)) AS value, ${GROUP_COUNT} AS count
    FROM products p WHERE p.is_active = 1 AND trim(COALESCE(p.name, '')) <> ''
    GROUP BY value
  `).all({})
  assert.ok(rows.every((r) => String(r.value || '').trim() !== ''), 'no blank letter bucket')
})

// ---- all three rails must use the same expression ----
check('storefront and admin rails count identically -- both by name group', async () => {
  const portal = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'portal.ts'), 'utf8')
  const products = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'products.ts'), 'utf8')
  const expr = /COUNT\(DISTINCT COALESCE\(NULLIF\(p\.name_key, ''\), CAST\(p\.id AS TEXT\)\)\)/g
  assert.equal((portal.match(expr) || []).length, 2, 'both portal rails (bootstrap + search) must count by name group')
  assert.equal((products.match(expr) || []).length, 1, 'the admin rail must count by name group')
})

check('the storefront bootstrap rail applies the visibility filter, not a bare is_active', async () => {
  const portal = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'portal.ts'), 'utf8')
  const railBlock = portal.slice(portal.indexOf('const initials = await db.prepare'))
  // G4 (Part 399): the portal rail indexes BRANDS now -- the visibility
  // rule is unchanged, the letter source moved from p.name to p.brand
  // (blank brands are excluded from the rail; they render under the
  // trailing "Other Brands" grid section instead).
  assert.ok(
    /WHERE \$\{visibleFilter\} AND trim\(COALESCE\(p\.brand, ''\)\) <> ''/.test(railBlock),
    'the bootstrap rail must use visibleFilter so it matches what the grid renders',
  )
  assert.ok(
    !/WHERE is_active = 1 AND trim\(COALESCE\(name/.test(portal),
    'the old bare is_active rail must be gone',
  )
})

async function main() {
  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log('PASS', name)
      passed++
    } catch (e) {
      console.log('FAIL', name, '-', e.message)
      process.exitCode = 1
    }
  }
  console.log(`\n${passed} check(s) passed.`)
  if (process.exitCode) console.log('SOME CHECKS FAILED')
}

void main()

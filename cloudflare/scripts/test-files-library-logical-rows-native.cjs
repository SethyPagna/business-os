'use strict'
// Pins routes/files.ts LOGICAL_LIBRARY_CTE (the library built from file_assets outward) against the definition it replaced, row for row, on the real migration chain:
//   - the old definition is written out below (the base commit); the new one is READ FROM THE SOURCE, not copied;
//   - fixtures: an asset shared by two active products, a duplicate product name, a gallery-only asset, an inactive-only asset, an unreferenced asset, the cover AND a gallery
//     image of one product, an asset in two galleries, a case-different path, an empty path, a product with an empty image_path, an inactive product beside an active one;
//   - parity: the full logical set in order, every page, the count, the search filter and the media-type filter, old == new;
//   - EXPLAIN: each reference is a seek on idx_products_image_path / idx_product_images_image_path, and no is_active = ? seek (idx_products_active_grouped_pg) is chosen;
//   - the unary + is pinned in the text; a NOT EXISTS that forgets the gallery arm changes the rows (mutant).
// Run (from cloudflare/): node scripts/test-files-library-logical-rows-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src', 'routes', 'files.ts'), 'utf8')
const match = /const LOGICAL_LIBRARY_CTE = `([^`]*)`/.exec(source)
assert.ok(match, 'LOGICAL_LIBRARY_CTE found in routes/files.ts')
const NEW_CTE = match[1].split(String.fromCharCode(13)).join('')
const OLD_CTE = `
  WITH product_refs AS (
    SELECT image_path AS public_path, id AS product_id, name AS product_name
    FROM products
    WHERE is_active = 1 AND image_path IS NOT NULL AND image_path != ''
    UNION
    SELECT pi.image_path AS public_path, p.id AS product_id, p.name AS product_name
    FROM product_images pi
    JOIN products p ON p.id = pi.product_id AND p.is_active = 1
    WHERE pi.image_path IS NOT NULL AND pi.image_path != ''
  ),
  logical_assets AS (
    SELECT fa.*, refs.product_id AS reference_product_id, refs.product_name AS reference_product_name
    FROM file_assets fa
    LEFT JOIN product_refs refs ON refs.public_path = fa.public_path
  )
`

const db = new DatabaseSync(':memory:')
const dir = path.join(root, 'migrations')
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(dir, f), 'utf8'))

const asset = (id, name, publicPath, media = 'image') => db.prepare('INSERT INTO file_assets (id, original_name, stored_name, public_path, media_type) VALUES (?,?,?,?,?)').run(id, name, `s${id}`, publicPath, media)
const paths = []
for (let i = 1; i <= 14; i += 1) { paths.push(`/uploads/f${i}.png`); asset(i, `File ${i}`, `/uploads/f${i}.png`, i % 5 === 0 ? 'video' : 'image') }
asset(15, 'Upper', '/uploads/F1.png')
asset(16, 'Empty path', '')
asset(17, 'Fox shared', '/uploads/fox.png')
const products = []
seedStockFixture(db, () => {
  const add = (id, name, image, active) => { db.prepare('INSERT INTO products (id, name, image_path, is_active) VALUES (?,?,?,?)').run(id, name, image, active); products.push(id) }
  add(1, 'Serum', '/uploads/f1.png', 1)            // cover of f1
  add(2, 'Serum', '/uploads/f2.png', 1)            // a duplicate NAME, another product
  add(3, 'Cream', '/uploads/f1.png', 1)            // f1 shared by two active products
  add(4, 'Gallery only', null, 1)                   // gallery refs below
  add(5, 'Inactive', '/uploads/f6.png', 0)          // inactive-only asset f6
  add(6, 'Both', '/uploads/f7.png', 1)              // cover AND gallery of f7
  add(7, 'Blank image', '', 1)                      // empty image_path never matches the empty-path asset
  add(8, 'Active twin', '/uploads/f8.png', 1)
  add(9, 'Inactive twin', '/uploads/f8.png', 0)     // an inactive product beside an active one on f8
  add(10, 'Fox', '/uploads/fox.png', 1)
  add(11, 'Fox', '/uploads/fox.png', 1)             // the same name AND path on two products
})
const gallery = (productId, image) => db.prepare('INSERT INTO product_images (product_id, image_path) VALUES (?,?)').run(productId, image)
gallery(4, '/uploads/f3.png'); gallery(4, '/uploads/f4.png'); gallery(6, '/uploads/f7.png'); gallery(1, '/uploads/f9.png'); gallery(2, '/uploads/f9.png')
gallery(5, '/uploads/f10.png')   // gallery of an INACTIVE product only
gallery(4, '')                    // an empty gallery path
// bulk: enough active products for the planner to prefer a bad is_active seek when the unary + is missing
seedStockFixture(db, () => { for (let i = 0; i < 1500; i += 1) db.prepare('INSERT INTO products (id, name, image_path, is_active) VALUES (?,?,?,1)').run(1000 + i, `Bulk ${i % 300}`, i % 2 ? `/uploads/bulk${i}.png` : null) })
for (let i = 0; i < 1500; i += 1) asset(1000 + i, `Bulk file ${i}`, `/uploads/bulk${i}.png`)
db.exec('ANALYZE')
// f11..f14 and F1 (case-different) stay unreferenced; f6 is inactive-only; f10 is inactive-gallery-only

const ORDER = 'ORDER BY id DESC, reference_product_name COLLATE NOCASE ASC, reference_product_id ASC'
const COLS = 'id, reference_product_id, reference_product_name'
const rows = (cte, where, params, limit, offset) => db.prepare(`${cte} SELECT ${COLS} FROM logical_assets ${where} ${ORDER} LIMIT ${limit} OFFSET ${offset}`).all(...params).map((r) => ({ ...r }))
const count = (cte, where, params) => db.prepare(`${cte} SELECT COUNT(*) AS count FROM logical_assets ${where}`).get(...params).count
const plan = (cte, where) => db.prepare(`EXPLAIN QUERY PLAN ${cte} SELECT ${COLS} FROM logical_assets ${where} ${ORDER} LIMIT 24 OFFSET 0`).all().map((r) => r.detail).join('\n')

let passed = 0
const check = (name, body) => { body(); passed += 1; console.log(`PASS ${name}`) }
const SEARCH = "WHERE (lower(original_name) LIKE ? OR lower(COALESCE(reference_product_name, '')) LIKE ?)"
const shapes = [
  ['all', '', []],
  ['search serum', SEARCH, ['%serum%', '%serum%']],
  ['search fox', SEARCH, ['%fox%', '%fox%']],
  ['search file 1', SEARCH, ['%file 1%', '%file 1%']],
  ['search nothing', SEARCH, ['%zzz%', '%zzz%']],
  ['video', 'WHERE media_type = ?', ['video']],
  ['image', 'WHERE media_type = ?', ['image']],
]

check('fixture control: the logical set has shared, duplicate-named, gallery-only and unreferenced rows', () => {
  const all = rows(OLD_CTE, '', [], 10000, 0)
  const byAsset = (id) => all.filter((r) => r.id === id).map((r) => r.reference_product_id)
  assert.deepEqual(byAsset(1).sort(), [1, 3], 'shared by two active products')
  assert.deepEqual(byAsset(17).sort(), [10, 11], 'same name on two products stays two rows')
  assert.deepEqual(byAsset(7), [6], 'cover and gallery of one product is one row')
  assert.deepEqual(byAsset(9).sort(), [1, 2], 'two galleries')
  assert.deepEqual(byAsset(6), [null], 'inactive-only is unreferenced')
  assert.deepEqual(byAsset(10), [null], 'a gallery of an inactive product is unreferenced')
  assert.deepEqual(byAsset(8), [8], 'only the active twin counts')
  assert.deepEqual(byAsset(16), [null], 'an empty path is unreferenced')
  assert.deepEqual(byAsset(15), [null], 'a case-different path does not match')
})

for (const [label, where, params] of shapes) {
  check(`parity (${label}): count and every page, old == new`, () => {
    assert.equal(count(NEW_CTE, where, params), count(OLD_CTE, where, params))
    const total = count(OLD_CTE, where, params)
    for (const size of [1, 3, 24, 100]) {
      for (let offset = 0; offset < Math.max(total, 1); offset += size) assert.deepEqual(rows(NEW_CTE, where, params, size, offset), rows(OLD_CTE, where, params, size, offset), `${label} size ${size} offset ${offset}`)
    }
  })
}

check('every column of the library row is identical, not only the key columns', () => {
  const all = (cte) => db.prepare(`${cte} SELECT * FROM logical_assets ${ORDER}`).all().map((r) => ({ ...r }))
  assert.deepEqual(all(NEW_CTE), all(OLD_CTE))
})

check('EXPLAIN: references are seeks on the image_path indexes and no is_active seek drives the library', () => {
  const p = plan(NEW_CTE, '')
  assert.match(p, /idx_products_image_path/)
  assert.match(p, /idx_product_images_image_path/)
  assert.doesNotMatch(p, /idx_products_active_grouped_pg \(is_active=\?\)/, p)
})

check('the unary + on every p.is_active is pinned in the text (the planner trap needs production statistics, which a fixture cannot reproduce)', () => {
  const uses = NEW_CTE.split('p.is_active').length - 1
  const guarded = NEW_CTE.split('+p.is_active').length - 1
  assert.equal(uses, 4)
  assert.equal(guarded, uses, 'a bare p.is_active lets the planner seek (is_active = ?) once per asset: 15M rows a page on production')
  const mutant = NEW_CTE.split('+p.is_active').join('p.is_active')
  assert.deepEqual(rows(mutant, '', [], 10000, 0), rows(OLD_CTE, '', [], 10000, 0), 'the mutant keeps the rows: only the text pin and the production plan can catch it')
})

check('MUTANT: an unreferenced arm that forgets the gallery references returns extra rows', () => {
  const mutant = NEW_CTE.replace(/\n      AND NOT EXISTS \(SELECT 1 FROM product_images[^\n]*\)\n/, '\n')
  assert.notEqual(mutant, NEW_CTE)
  assert.notDeepEqual(rows(mutant, '', [], 10000, 0), rows(OLD_CTE, '', [], 10000, 0))
})

console.log(`${passed} passed`)

// I-6: POST /api/products/wire-images must leave an audit trail that says who
// wired which products, and what each product showed before, so a wrong bulk
// match can be traced and put back.
//
// The handler replaced every matched cover and gallery and wrote no audit row;
// the preview's currentImagePath/currentGallery lived only in the client's
// response, so a REPLACED photo could not be restored from server data. Its
// inverse, POST /unwire-images, was already audited.
//
// Drives the REAL route and the REAL lib/audit.ts, so the rows asserted here
// are the rows audit_logs actually holds.
//
// Run (from cloudflare/): node scripts/test-wire-images-audit-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

const h = createProductsRouteHarness()
const { raw } = h

let passed = 0
let failed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL ${name} -- ${error.message}`)
  }
}

function reset() {
  raw.exec(`DELETE FROM audit_logs; DELETE FROM product_images; DELETE FROM products; DELETE FROM file_assets;
    DELETE FROM user_sessions; DELETE FROM users;`)
  raw.exec("INSERT INTO users (id, username, name, password, permissions, is_active) VALUES (1, 'tester', 'Test User', 'x', '{}', 1)")
}

const insertAsset = (id, name, publicPath) => raw.prepare(
  "INSERT INTO file_assets (id, original_name, stored_name, public_path, media_type) VALUES (@id, @name, @name, @path, 'image')",
).run({ id, name, path: publicPath })

function gallery(productId) {
  return raw.prepare('SELECT image_path FROM product_images WHERE product_id = @id ORDER BY sort_order ASC, id ASC')
    .all({ id: productId }).map((row) => row.image_path)
}

function snapshot(productId) {
  const row = raw.prepare('SELECT image_path FROM products WHERE id = @id').get({ id: productId })
  return { cover: row.image_path ?? null, gallery: gallery(productId) }
}

function wireRows() {
  return raw.prepare("SELECT * FROM audit_logs WHERE action = 'wire_images' ORDER BY id ASC").all()
    .map((row) => ({ ...row, detailsObj: JSON.parse(row.details) }))
}

async function wireAll() {
  const preview = await h.request('POST', '/wire-images/preview', {})
  assert.equal(preview.status, 200, JSON.stringify(preview.json))
  const applied = await h.request('POST', '/wire-images', { changes: preview.json.changes })
  assert.equal(applied.status, 200, JSON.stringify(applied.json))
  return { preview: preview.json, applied: applied.json }
}

function seedReplaceAndFresh() {
  reset()
  raw.exec(`INSERT INTO products (id, name, is_active, stock_quantity, image_path) VALUES
    (1, 'Rose Serum', 1, 0, '/uploads/old-rose.jpg'),
    (2, 'Chanel No 5', 1, 0, NULL),
    (3, 'Lip Balm', 1, 0, '/uploads/lip.jpg')`)
  raw.exec(`INSERT INTO product_images (product_id, image_path, sort_order) VALUES
    (1, '/uploads/old-rose.jpg', 0), (1, '/uploads/old-rose-b.jpg', 1),
    (3, '/uploads/lip.jpg', 0)`)
  insertAsset(11, 'Rose Serum_1.jpg', '/uploads/rose-1.jpg')
  insertAsset(12, 'Rose Serum_2.jpg', '/uploads/rose-2.jpg')
  insertAsset(13, 'Chanel No 5.jpg', '/uploads/chanel-5.jpg')
}

async function main() {
  await check('one wire_images audit row names the actor, every product, what it showed before and what it shows now', async () => {
    seedReplaceAndFresh()
    await wireAll()
    const rows = wireRows()
    assert.equal(rows.length, 1, `expected one wire_images row, got ${rows.length}`)
    const [row] = rows
    assert.equal(row.entity, 'product')
    assert.equal(row.user_id, 1)
    assert.equal(row.user_name, 'tester')
    assert.equal(row.detailsObj.productCount, 2)
    const byId = new Map(row.detailsObj.products.map((entry) => [entry.id, entry]))
    assert.deepEqual([...byId.keys()].sort(), [1, 2], 'only the wired products; Lip Balm had no match and was not touched')
    assert.deepEqual(byId.get(1), {
      id: 1,
      previousImagePath: '/uploads/old-rose.jpg',
      previousGallery: ['/uploads/old-rose.jpg', '/uploads/old-rose-b.jpg'],
      imagePaths: ['/uploads/rose-1.jpg', '/uploads/rose-2.jpg'],
    })
    assert.deepEqual(byId.get(2), { id: 2, previousImagePath: null, previousGallery: [], imagePaths: ['/uploads/chanel-5.jpg'] })
  })

  await check('the recorded previous values restore a REPLACED product exactly', async () => {
    seedReplaceAndFresh()
    const before = snapshot(1)
    await wireAll()
    assert.notDeepEqual(snapshot(1), before, 'the wire really replaced Rose Serum')
    const entry = wireRows()[0].detailsObj.products.find((item) => item.id === 1)
    raw.prepare('UPDATE products SET image_path = @path WHERE id = 1').run({ path: entry.previousImagePath })
    raw.exec('DELETE FROM product_images WHERE product_id = 1')
    entry.previousGallery.forEach((imagePath, index) => raw.prepare(
      'INSERT INTO product_images (product_id, image_path, sort_order) VALUES (1, @path, @order)',
    ).run({ path: imagePath, order: index }))
    assert.deepEqual(snapshot(1), before)
  })

  await check('a call that wires nothing writes no audit row', async () => {
    seedReplaceAndFresh()
    const empty = await h.request('POST', '/wire-images', { changes: [] })
    assert.equal(empty.status, 200)
    const invalid = await h.request('POST', '/wire-images', { changes: [{ productId: 'x', imagePaths: ['/uploads/rose-1.jpg'] }, { productId: 1, imagePaths: [] }] })
    assert.equal(invalid.status, 200)
    assert.equal(invalid.json.updated, 0)
    assert.equal(wireRows().length, 0)
  })

  await check('a catalog-wide wire is recorded in bounded rows that together name every product', async () => {
    reset()
    const TOTAL = 250
    for (let n = 1; n <= TOTAL; n += 1) {
      raw.prepare('INSERT INTO products (id, name, is_active, stock_quantity, image_path) VALUES (@id, @name, 1, 0, @old)')
        .run({ id: n, name: `Bulk Product ${n}`, old: `/uploads/old-${n}.jpg` })
      insertAsset(1000 + n, `Bulk Product ${n}.jpg`, `/uploads/bulk-${n}.jpg`)
    }
    const { applied } = await wireAll()
    assert.equal(applied.updated, TOTAL)
    const rows = wireRows()
    assert.ok(rows.length > 1, `${TOTAL} products must not ride in one unbounded row (got ${rows.length})`)
    const operation = rows[0].detailsObj.operation
    assert.ok(typeof operation === 'string' && operation.length >= 8, 'rows of one call share an operation id')
    const ids = []
    rows.forEach((row, index) => {
      const details = row.detailsObj
      assert.ok(details.products.length <= 100, `row ${index + 1} carries ${details.products.length} products`)
      assert.ok(row.details.length < 64 * 1024, `row ${index + 1} is ${row.details.length} bytes`)
      assert.equal(details.operation, operation)
      assert.equal(details.part, index + 1)
      assert.equal(details.parts, rows.length)
      assert.equal(details.productCount, TOTAL)
      for (const entry of details.products) {
        assert.equal(entry.previousImagePath, `/uploads/old-${entry.id}.jpg`)
        ids.push(entry.id)
      }
    })
    assert.equal(new Set(ids).size, TOTAL, 'every wired product is recorded exactly once')
    assert.equal(ids.length, TOTAL)
  })

  await check('unwire keeps its own audit row (the sibling this mirrors)', async () => {
    seedReplaceAndFresh()
    await wireAll()
    const res = await h.request('POST', '/unwire-images', { productIds: [1] })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    const rows = raw.prepare("SELECT details FROM audit_logs WHERE action = 'unwire_images'").all()
    assert.equal(rows.length, 1)
    assert.equal(JSON.parse(rows[0].details).productCount, 1)
  })

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

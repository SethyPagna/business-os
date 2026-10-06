// PROD-PERM (loophole review 6 Oct 2026, N6 / N8 and the sweep behind them): four Products writes checked the section
// grant (or the section tier) alone, so a role with the matching action switch OFF still reached them:
//   N6  POST /bulk-price-adjust         ignored "Edit product"      (reprices every product, no undo)
//   N8  POST /variant                   ignored "Add variant" and "Add product" (creates a product row)
//       POST /bulk-delete-jobs/:id/cancel  ignored "Bulk delete"    (stops an administrator's running delete)
//       POST|PUT|PATCH|DELETE /categories and /units  ignored "Manage brands, categories, units"
// Real routes/products.ts and routes/lookups.ts, the REAL permission kernel (roles are plain grant maps, the
// action override is read exactly as production reads it) and the full migration chain in SQLite.
// Every denied case asserts the write did NOT happen; every permitted case asserts it DID, so a gate that
// refuses everyone cannot pass.
//
// Run (from cloudflare/): node scripts/test-products-write-action-permissions-native.cjs
'use strict'
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

const role = (grants) => ({ id: 21, username: 'staff', name: 'Staff', role_code: 'staff', role_permissions: JSON.stringify(grants), permissions: '{}' })
const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) {
    failed += 1
    console.log(`FAIL ${name}\n${error && error.stack ? error.stack : error}`)
  }
}

// Loading routes/products.ts costs ~12s of TypeScript transpiling, so ONE harness is built and every case resets the
// rows it reads and swaps the signed-in user.
let shared = null
function fixture(user) {
  if (!shared) {
    shared = createProductsRouteHarness({ user })
    const real = shared.load('lib/permissions.ts')
    shared.setActionTier((...args) => real.getActionTier(...args))
  }
  const h = shared
  h.setUser(user)
  h.raw.db.exec(`
    DELETE FROM bulk_delete_jobs; DELETE FROM audit_logs; DELETE FROM products; DELETE FROM categories; DELETE FROM units; DELETE FROM branches;
    INSERT INTO branches(id, name, is_default, is_active) VALUES(1, 'Shop', 1, 1);
    INSERT INTO products(id, name, barcode, cost_price_usd, selling_price_usd, stock_quantity, is_active) VALUES
      (1, 'Gloss One', '8850000000011', 2, 5, 0, 1),
      (2, 'Serum Other', '8850000000033', 4, 9, 0, 1);
    INSERT INTO bulk_delete_jobs(id, entity_type, status, reason, ids_json, total_count) VALUES('job-1', 'products', 'processing', 'x', '[1]', 1);
  `)
  return h
}
const prices = (h) => h.raw.prepare('SELECT id, selling_price_usd FROM products ORDER BY id').all([])
const productCount = (h) => Number(h.raw.prepare('SELECT COUNT(*) AS n FROM products').get([]).n)
const cancelFlag = (h) => Number(h.raw.prepare("SELECT cancel_requested AS v FROM bulk_delete_jobs WHERE id = 'job-1'").get([]).v)
const lookupCount = (h, table) => Number(h.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get([]).n)

const FULL = { products: true }
const ADJUST = { direction: 'increase', amount: 1, fields: ['selling_price_usd'] }
const CTX = { waitUntil() {}, passThroughOnException() {} }

function lookupCaller(h) {
  const lookups = h.load('routes/lookups.ts').default
  return (method, path, body) => lookups.request(`http://local${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { DB: h.raw }, CTX)
}

async function main() {
  // ---- N6: bulk price adjust -------------------------------------------------------------------
  await check('N6: Products Full with Edit product OFF cannot reprice the catalog (preview and apply)', async () => {
    const h = fixture(role({ ...FULL, 'products:edit': false }))
    const preview = await h.request('POST', '/bulk-price-adjust', { ...ADJUST, preview: true })
    assert.equal(preview.status, 403)
    const apply = await h.request('POST', '/bulk-price-adjust', ADJUST)
    assert.equal(apply.status, 403)
    assert.deepEqual(prices(h).map((row) => Number(row.selling_price_usd)), [5, 9], 'no price moved')
    assert.equal(Number(h.raw.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity_id = 'bulk-price-adjust'").get([]).n), 0)
  })
  await check('N6: Products Full with Edit product on still reprices; so does an administrator', async () => {
    for (const user of [role(FULL), role({ ...FULL, 'products:edit': true }), ADMIN]) {
      const h = fixture(user)
      const response = await h.request('POST', '/bulk-price-adjust', ADJUST)
      assert.equal(response.status, 200, JSON.stringify(response.json))
      assert.equal(response.json.success, true)
      assert.deepEqual(prices(h).map((row) => Number(row.selling_price_usd)), [6, 10])
    }
  })
  await check('N6: Review Required Products and a role without Products stay refused', async () => {
    for (const grants of [{ products: 'review' }, {}]) {
      const h = fixture(role(grants))
      const response = await h.request('POST', '/bulk-price-adjust', ADJUST)
      assert.equal(response.status, 403)
      assert.deepEqual(prices(h).map((row) => Number(row.selling_price_usd)), [5, 9])
    }
  })

  // ---- N8: add variant -------------------------------------------------------------------------
  const variantBody = { name: 'Gloss One Rose', barcode: '8850000000099', selling_price_usd: 5 }
  await check('N8: Add variant OFF, or Add product OFF, cannot create a product through /variant', async () => {
    const roles = [
      { ...FULL, 'products:variant': false },
      { ...FULL, 'products:add': false },
      { ...FULL, 'products:variant': false, 'products:add': false },
      { products: 'review' },
      {},
    ]
    for (const grants of roles) {
      const h = fixture(role(grants))
      const before = productCount(h)
      const response = await h.request('POST', '/variant', variantBody)
      assert.equal(response.status, 403, `${JSON.stringify(grants)} -> ${response.status}`)
      assert.equal(productCount(h), before, `${JSON.stringify(grants)} created a row`)
    }
  })
  await check('N8: Products Full with both switches on, and an administrator, still create the variant', async () => {
    for (const user of [role(FULL), role({ ...FULL, 'products:variant': true, 'products:add': true }), ADMIN]) {
      const h = fixture(user)
      const before = productCount(h)
      const response = await h.request('POST', '/variant', variantBody)
      assert.equal(response.status, 200, JSON.stringify(response.json))
      assert.equal(response.json.success, true)
      assert.equal(productCount(h), before + 1)
      assert.equal(h.raw.prepare('SELECT name FROM products WHERE id = ?').get([response.json.id]).name, 'Gloss One Rose')
    }
  })

  // ---- sweep: cancel a bulk delete -------------------------------------------------------------
  await check('sweep: Bulk delete OFF cannot cancel a bulk delete job; Bulk delete on can', async () => {
    for (const grants of [{ ...FULL, 'products:bulk_delete': false }, { products: 'review' }, {}]) {
      const h = fixture(role(grants))
      const response = await h.request('POST', '/bulk-delete-jobs/job-1/cancel')
      assert.equal(response.status, 403, JSON.stringify(grants))
      assert.equal(cancelFlag(h), 0, 'the job was left running')
    }
    for (const user of [role(FULL), ADMIN]) {
      const h = fixture(user)
      const response = await h.request('POST', '/bulk-delete-jobs/job-1/cancel')
      assert.equal(response.status, 200, JSON.stringify(response.json))
      assert.equal(cancelFlag(h), 1)
    }
  })

  if (failed) { console.log(`${failed} FAILED`); process.exit(1) }
  console.log('products write action permissions OK')
}
main().catch((error) => { console.error(error); process.exit(1) })

// POST /api/products/variant inserts a product row and seeds its opening
// stock, so the role editor's "Add variant" and "Add product" switches must
// both hold on the Worker, not only on screen (SCAN2 BP-7).
//
// Drives the REAL routes/products.ts over a migrated in-memory database with
// the REAL permission kernel (lib/permissions.ts), role and user overrides
// merged exactly as a session carries them.
//
// Run (from cloudflare/): node scripts/test-variant-add-permission-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

function loadPermissionKernel() {
  const file = path.join(__dirname, '..', 'src', 'lib', 'permissions.ts')
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', output)(require, mod, mod.exports)
  return mod.exports
}

// lib/productWrites.ts insertRow binds D1-style positional values
// (`.bind(a, b, c)`); the shared shim keeps only the first argument.
function acceptPositionalBinds(raw) {
  const prepare = raw.prepare.bind(raw)
  raw.prepare = (sql) => {
    const statement = prepare(sql)
    const bind = statement.bind.bind(statement)
    statement.bind = (...values) => bind(values.length === 1 && values[0] && typeof values[0] === 'object' ? values[0] : values)
    return statement
  }
}

const permissions = loadPermissionKernel()
const h = createProductsRouteHarness()
acceptPositionalBinds(h.raw)
h.setActionTier(permissions.getActionTier)
h.raw.exec("INSERT OR IGNORE INTO branches (id, name, is_active, is_default) VALUES (1, 'Warehouse', 1, 1), (2, 'Shop', 1, 0)")

const staff = (role, overrides = {}) => ({
  id: 17, username: 'employee', name: 'Employee', role_code: 'employee',
  role_permissions: JSON.stringify(role), permissions: JSON.stringify(overrides),
})
const owner = {
  id: 1, username: 'owner', name: 'Owner', role_code: 'admin',
  role_permissions: '{}', permissions: JSON.stringify({ 'products:add': false, 'products:variant': false }),
}

const productCount = () => Number(h.raw.prepare('SELECT COUNT(*) AS n FROM products').get().n)
const stockRowCount = () => Number(h.raw.prepare('SELECT COUNT(*) AS n FROM branch_stock').get().n)

let passed = 0
let serial = 0
async function variantAs(session) {
  h.setUser(session)
  serial += 1
  const before = { products: productCount(), stock: stockRowCount() }
  const response = await h.request('POST', '/variant', { name: `Variant ${serial}`, parent_id: null, stock_quantity: 4, branch_id: 1 })
  return { response, created: productCount() - before.products, stockRows: stockRowCount() - before.stock }
}

async function allows(label, session) {
  const { response, created, stockRows } = await variantAs(session)
  assert.equal(response.status, 200, `${label}: POST /variant must succeed, got ${response.status} ${JSON.stringify(response.json)}`)
  assert.equal(created, 1, `${label}: exactly one product row is created`)
  assert.ok(stockRows > 0, `${label}: opening stock is seeded`)
  passed += 1
  console.log(`PASS ${label} -> 200`)
}

async function refuses(label, session) {
  const { response, created, stockRows } = await variantAs(session)
  assert.equal(response.status, 403, `${label}: POST /variant must refuse, got ${response.status}`)
  assert.equal(created, 0, `${label}: no product row is created`)
  assert.equal(stockRows, 0, `${label}: no opening stock is seeded`)
  passed += 1
  console.log(`PASS ${label} -> 403`)
}

;(async () => {
  await allows('products Full', staff({ products: true }))
  await allows('administrator with both switches off (admins are never narrowed)', owner)
  await allows('a user-level true restores a role-level "Add product" off', staff({ products: true, 'products:add': false }, { 'products:add': true }))
  await refuses('products Full with "Add variant" off', staff({ products: true, 'products:variant': false }))
  await refuses('products Full with "Add product" off', staff({ products: true, 'products:add': false }))
  await refuses('products Full with "Add product" off on the user only', staff({ products: true }, { 'products:add': false }))
  await refuses('products Review Required (variant blocks review)', staff({ products: 'review' }))
  await refuses('no products grant', staff({}))
  await refuses('image-only products role', staff({ products_image_only: true }))

  // Sibling: plain create keeps its own switch and ignores the variant one.
  h.setUser(staff({ products: true, 'products:variant': false }))
  const plainCreate = await h.request('POST', '/', { name: 'Plain create with variant off', stock_quantity: 0 })
  assert.equal(plainCreate.status, 200, `POST / with only "Add variant" off must still create, got ${plainCreate.status}`)
  h.setUser(staff({ products: true, 'products:add': false }))
  assert.equal((await h.request('POST', '/', { name: 'Plain create with add off' })).status, 403)
  passed += 2
  console.log('PASS POST / follows "Add product" and ignores "Add variant"')

  console.log(`\n${passed} checks passed`)
})().catch((error) => { console.error(error); process.exitCode = 1 })

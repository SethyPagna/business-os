'use strict'
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

const role = grants => ({ id: 31, username: 'staff', name: 'Staff', role_code: 'staff', role_permissions: JSON.stringify(grants), permissions: '{}' })
const admin = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }

const READS = [
  ['stock ledger', '/stock-ledger?pageSize=2'],
  ['stock ledger balance', '/stock-ledger/1/balance'],
  ['stock-in sessions', '/stock-in-sessions'],
  ['stock-in session lines', '/stock-in-session-lines?key=receipt-1'],
  ['product detail report', '/1/detail-report'],
  ['product sales detail', '/1/sales-detail?mode=day&period=2026-10-13'],
  ['product supplier purchases', '/1/supplier-purchases?supplierKey=supplier-1'],
  ['auto-merge log', '/auto-merges/1'],
]

let h
let failed = 0
function fixture(user) {
  if (!h) {
    h = createProductsRouteHarness({ user })
    const real = h.load('lib/permissions.ts')
    h.setActionTier((...args) => real.getActionTier(...args))
    h.raw.db.exec(`INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1);
      INSERT INTO products(id,name,barcode,selling_price_usd,stock_quantity,is_active) VALUES(1,'Gloss','8850000000011',5,0,1);
      INSERT INTO inventory_movements(id,product_id,product_name,branch_id,branch_name,movement_type,quantity,created_at) VALUES(1,1,'Gloss',1,'Shop','adjustment',3,'2026-10-13 09:00:00');`)
  }
  h.setUser(user)
  return h
}

async function statuses(user) {
  fixture(user)
  const out = {}
  for (const [name, path] of READS) out[name] = (await h.request('GET', path)).status
  return out
}

async function check(name, fn) {
  try { await fn(); console.log('PASS ' + name) } catch (error) { failed++; console.error('FAIL ' + name, error.message) }
}

const expectRefused = (seen, who) => {
  for (const [name] of READS) assert.equal(seen[name], 403, `${who}: ${name} answered ${seen[name]}`)
}
const expectServed = (seen, who) => {
  for (const [name] of READS) assert.notEqual(seen[name], 403, `${who}: ${name} was refused`)
  for (const name of ['stock ledger', 'stock-in sessions', 'product detail report', 'product sales detail']) {
    assert.equal(seen[name], 200, `${who}: ${name} answered ${seen[name]}`)
  }
}

async function main() {
  await check('Employee shape (Full Products, history Off, Inventory Partial) is refused on every history read', async () => {
    expectRefused(await statuses(role({ products: true, 'products:history': false, inventory: 'review' })), 'employee')
  })
  await check('history Off is refused with Inventory Full too', async () => {
    expectRefused(await statuses(role({ products: true, 'products:history': false, inventory: true })), 'inventory full')
  })
  await check('history Off is refused at Products Partial with and without Inventory', async () => {
    expectRefused(await statuses(role({ products: 'review', 'products:history': false })), 'partial, no inventory')
    expectRefused(await statuses(role({ products: 'review', 'products:history': false, inventory: 'review' })), 'partial + inventory')
  })
  await check('history On is served: Employee shape with the switch restored', async () => {
    expectServed(await statuses(role({ products: true, inventory: 'review' })), 'employee, history on')
  })
  await check('history On is served at Products Partial and Full', async () => {
    expectServed(await statuses(role({ products: 'review' })), 'partial')
    expectServed(await statuses(role({ products: true })), 'full')
  })
  await check('an Inventory-only role (no Products section) is still served', async () => {
    expectServed(await statuses(role({ inventory: 'review' })), 'inventory partial only')
    expectServed(await statuses(role({ inventory: true })), 'inventory full only')
  })
  await check('Products view revoked is still refused without Inventory, served with Inventory view', async () => {
    expectRefused(await statuses(role({ products: true, 'products:view': false })), 'no products view, no inventory')
    expectServed(await statuses(role({ products: true, 'products:view': false, inventory: 'review' })), 'no products view, inventory')
  })
  await check('no Products or Inventory grant is refused', async () => {
    expectRefused(await statuses(role({ pos: true })), 'pos only')
  })
  await check('an administrator is served', async () => {
    expectServed(await statuses(admin), 'admin')
  })
  if (failed) throw new Error(failed + ' history read checks failed')
  console.log('products history read gate PASS')
}

main().catch(error => { console.error(error); process.exitCode = 1 })

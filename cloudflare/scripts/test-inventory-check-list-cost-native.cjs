// Cost on the wired Inventory Check list (owner redesign, 17 Nov 2026): the list keeps the cost keys for a viewer who may see acquisition costs and drops them for everyone else.
//   admin /list   keeps cost_price_usd / cost_price_khr / cost_needs_review / purchase_price_* / cost_review_key, and says projected:false (the rows are Products' own)
//   employee /list  drops every one of them, even with the retired inventory_check_show_cost key set (that key is no longer consulted)
//   overlay       carries no cost for anyone
//   fields.cost   is the shared rule canViewAcquisitionCosts (lib/acquisitionCostAccess.ts), for a viewer who may view Inventory Check
// Mutants (a planted source edit in the loaded module) must be caught: cost cut for everyone again, cost kept for everyone.
// Run: node scripts/test-inventory-check-list-cost-native.cjs
const assert = require('node:assert/strict')
const { createInvApp } = require('./harness/inv-app.cjs')

let checks = 0
function check(label, cond, detail) { if (!cond && detail) console.log(typeof detail === 'function' ? detail() : detail); assert.ok(cond, `FAIL: ${label}`); checks++; console.log(`  ok  ${label}`) }

const MOUNT = { '/api/products': 'routes/products.ts', '/api/inventory-checks': 'routes/inventoryChecks.ts' }
function seed(raw, seedStockFixture) {
  seedStockFixture(raw.db, () => {
    for (let id = 100; id <= 102; id++) {
      raw.prepare(`INSERT INTO products(id,name,sku,barcode,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,brand,category,is_active,created_at,updated_at)
        VALUES(?,?,?,?,?,9.5,38000,4,16000,'Brand','Cat',1,?,'2026-09-01 00:00:00')`).run([id, `Product ${id}`, `SKU${id}`, `88500000${id}`, 10, `2026-09-${String(id - 90).padStart(2, '0')} 00:00:00`])
      raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,10)').run([id])
    }
  })
}
const COST = ['cost_price_usd', 'cost_price_khr', 'cost_needs_review', 'purchase_price_usd', 'purchase_price_khr', 'cost_review_key']
const itemsOf = (r) => (r.json && r.json.items) || []
const make = (sourceEdits = {}) => { const app = createInvApp({ mount: MOUNT, seed, sourceEdits }); app.setSwitch('ic_wired', 'on'); app.setSwitch('ic_fix_stock', 'on'); return app }

;(async () => {
  const app = make(), U = app.users
  app.setUser(U.admin); app.clearCaches()
  const admin = await app.get('/api/inventory-checks/list?branchId=1')
  check("admin /list keeps the cost keys (4 USD) and says the rows are Products' own (projected:false)", itemsOf(admin).length > 0 && itemsOf(admin).every((row) => row.cost_price_usd === 4 && 'cost_price_khr' in row) && admin.json.projected === false, () => JSON.stringify(itemsOf(admin)[0]))
  app.setUser(U.checker); app.clearCaches()
  const employee = await app.get('/api/inventory-checks/list?branchId=1')
  check('an employee /list drops every cost key (even with the retired inventory_check_show_cost set)', itemsOf(employee).length > 0 && itemsOf(employee).every((row) => COST.every((key) => !(key in row))) && !/cost_price|purchase_price/.test(JSON.stringify(employee.json)))
  app.setUser(U.stockOnly); app.clearCaches()
  const stockOnly = await app.get('/api/inventory-checks/list?branchId=1')
  check('a viewer with stock but no cost gets no cost either', itemsOf(stockOnly).length > 0 && !/cost_price|purchase_price/.test(JSON.stringify(stockOnly.json)))
  for (const viewer of ['admin', 'checker']) {
    app.setUser(U[viewer]); app.clearCaches()
    const o = await app.get('/api/inventory-checks/overlay?branchId=1&ids=100,101,102')
    check(`the overlay carries no cost for ${viewer}`, o.status === 200 && !/cost_price|purchase_price|cost_review/.test(JSON.stringify(o.json)))
  }
  const access = app.load('lib/inventoryCheckAccess.ts').getInventoryCheckAccess
  check('fields.cost is the shared acquisition-cost rule: admin yes, an employee with show_cost no, a viewer without Inventory Check no', access(U.admin).fields.cost === true && access(U.checker).fields.cost === false && access(U.none).fields.cost === false)

  const run = async (name, edits, probe) => {
    const mutant = make(edits)
    let caught = false
    try { caught = await probe(mutant) } catch { caught = true }
    check(`mutant "${name}" is caught`, caught === true)
  }
  const LIST = 'lib/inventoryCheckList.ts'
  await run('cost cut for everyone again', { [LIST]: [['if (!access.fields.cost) for (const key of COST_KEYS) delete out[key]', 'for (const key of COST_KEYS) delete out[key]']] }, async (m) => {
    m.setUser(m.users.admin); const r = await m.get('/api/inventory-checks/list?branchId=1'); return !itemsOf(r).every((row) => row.cost_price_usd === 4)
  })
  await run('cost kept for everyone', { [LIST]: [['if (!access.fields.cost) for (const key of COST_KEYS) delete out[key]', '']] }, async (m) => {
    m.setUser(m.users.checker); const r = await m.get('/api/inventory-checks/list?branchId=1'); return /cost_price/.test(JSON.stringify(r.json))
  })
  console.log(`PASS test-inventory-check-list-cost-native (${checks} checks)`)
  process.exit(0)
})().catch((error) => { console.error(error); process.exit(1) })

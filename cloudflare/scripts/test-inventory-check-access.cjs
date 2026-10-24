const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { transformSync } = require('esbuild')
const root = path.resolve(__dirname, '../..')
const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file).exports
  const module = { exports: {} }
  cache.set(file, module)
  const code = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  new Function('require', 'module', 'exports', code)(id => {
    if (!id.startsWith('.')) return require(id)
    const target = path.resolve(path.dirname(file), id)
    return load(target.endsWith('.ts') ? target : `${target}.ts`)
  }, module, module.exports)
  return module.exports
}
const worker = load(path.join(root, 'cloudflare/src/lib/inventoryCheckAccess.ts'))
const client = load(path.join(root, 'frontend/src/utils/inventoryCheckAccess.ts'))
const presets = load(path.join(root, 'frontend/src/components/users/rolePresetDefaults.ts'))
const user = (role = {}, own = {}, role_code = 'employee') => ({ role_code, role_permissions: JSON.stringify(role), permissions: JSON.stringify(own) })
let checks = 0
const check = (name, run) => { run(); checks++; console.log(`PASS ${name}`) }
check('dedicated checks grants preserve denials and do not grant physical writes or hidden fields', () => {
  for (const role of [{ inventory_checks: true }, { inventory_checks: false, inventory: true }, { inventory_checks: true, 'inventory_checks:view': false }, { inventory_checks: true, 'inventory_checks:check': false }, { inventory_checks: 'review' }]) {
    const actor = user(role)
    assert.deepEqual(worker.getInventoryCheckAccess(actor), client.getInventoryCheckAccess(actor))
  }
  const access = worker.getInventoryCheckAccess(user({ inventory_checks: true }))
  assert.ok(access.canView && access.canCheck)
  assert.ok(Object.values(access.fields).every(value => value === false))
  assert.equal(worker.getInventoryCheckAccess(user({ inventory_checks: false, inventory: true })).canView, false)
  const permissions = load(path.join(root, 'cloudflare/src/lib/permissions.ts'))
  for (const action of ['adjust', 'transfer', 'stock_count', 'import']) assert.equal(permissions.getActionTier(user({ inventory_checks: true }), 'inventory', action), 'none')
  const projected = worker.projectInventoryCheckProduct({ id: 7, name: 'Stock evidence', checkable: false, quantity: null, damaged_quantity: 4, stock_diagnostics: 'cache_mismatch', recorded_cache_quantity: 99 }, access)
  assert.deepEqual(projected, { id: 7, name: 'Stock evidence', checkable: false })
  const visible = worker.getInventoryCheckAccess(user({ inventory_checks: true, inventory_check_show_stock: true }))
  assert.deepEqual(worker.projectInventoryCheckProduct({ id: 7, quantity: null, stock_diagnostics: 'cache_mismatch' }, visible), { id: 7, quantity: null, stock_diagnostics: 'cache_mismatch' })
})

check('actual role presets and permission maps agree between Worker and client', () => {
  for (const preset of presets.ROLE_PRESETS) {
    const actor = user(preset.permissions, {}, preset.key === 'admin' ? 'admin' : 'employee')
    assert.deepEqual(worker.getInventoryCheckAccess(actor), client.getInventoryCheckAccess(actor), preset.key)
  }
  let cells = 0
  for (const tier of [undefined, false, true, 'review', 'view', 'junk']) {
    for (const roleField of [undefined, true, false, 'false', null]) {
      for (const ownField of [undefined, true, false, 'true', null]) {
        for (const field of worker.INVENTORY_CHECK_FIELDS) {
          for (const roleCode of ['employee', 'admin']) {
            const role = { inventory: tier, contacts: 'review', 'contacts:view': false, 'contacts:add': false, 'contacts:edit': false, product_cost_view: true }
            const own = {}
            if (roleField !== undefined) role[`inventory_check_show_${field}`] = roleField
            if (ownField !== undefined) own[`inventory_check_show_${field}`] = ownField
            const actor = user(role, own, roleCode)
            assert.deepEqual(worker.getInventoryCheckAccess(actor), client.getInventoryCheckAccess(actor), JSON.stringify({ role, own, roleCode }))
            cells++
          }
        }
      }
    }
  }
  assert.equal(cells, 2700)
})
check('page/action authority, explicit false and independent aggregate grants', () => {
  for (const actor of [null, {}, user({ product_cost_view: true, inventory_check_show_cost: true }), { username: 'admin' }]) {
    const access = worker.getInventoryCheckAccess(actor)
    assert.equal(access.canView, false)
    assert.equal(access.canCheck, false)
    assert.ok(Object.values(access.fields).every(value => value === false))
  }
  const full = worker.getInventoryCheckAccess(user({ inventory_checks: true, inventory_check_show_sales: true, inventory_check_show_customers: true }))
  for (const inventory of [true, 'review']) assert.equal(worker.getInventoryCheckAccess(user({ inventory })).canView, false, 'Inventory Full or Review no longer opens counting')
  assert.ok(full.canView && full.canCheck && full.fields.sales && full.fields.customers)
  assert.equal(full.fields.cost, false)
  assert.equal(full.canViewCustomerDetails, false)
  const actor = user({ inventory_checks: true, inventory_check_show_stock: true }, { inventory_check_show_stock: false, 'inventory_checks:check': false })
  assert.equal(worker.getInventoryCheckAccess(actor).fields.stock, false)
  assert.equal(worker.getInventoryCheckAccess(actor).canCheck, false)
  assert.equal(worker.getInventoryCheckAccess(user({ inventory_checks: true, 'inventory_checks:view': false })).canView, false)
  assert.equal(worker.getInventoryCheckAccess(user({ inventory_checks: true, inventory_check_show_cost: true, product_cost_view: true })).fields.cost, true)
})
const product = {
  id: 4, name: 'Example', image_path: '/image.webp', unit: 'piece', parent_id: 2, is_group: 0,
  selling_price_usd: 8, selling_price_khr: 32000, wholesale_price_usd: 7, barcode: '123', sku: 'secret-sku',
  category: 'A', categories: 'A||B', brand: 'B', brands: 'B||C', stock_quantity: 12, display_quantity: 10,
  low_stock_threshold: 3, out_of_stock_threshold: 0, stock_state: 'in_stock', received_at: '2026-10-01', batch_count: 2,
  qty_sold: 8, customer_count: 5, cost_price_usd: 3, purchase_price_khr: 12000, stock_value_usd: 30,
  revenue_usd: 64, profit_usd: 40, customer_name: 'Private', customer_phone: 'Private', account_id: 17,
  branch_stock_json: '[{"quantity":12}]', audit: { cost: 3 }, arbitrary: { secrets: [1] },
}
check('whitelist projection drops nested/account/PII and ungranted derived fields without mutating source', () => {
  const actor = user({ inventory_checks: true, inventory_check_show_price: true })
  const output = worker.projectInventoryCheckProduct(product, worker.getInventoryCheckAccess(actor))
  assert.deepEqual(output, { id: 4, name: 'Example', image_path: '/image.webp', unit: 'piece', parent_id: 2, is_group: 0, selling_price_usd: 8, selling_price_khr: 32000, wholesale_price_usd: 7 })
  assert.equal(product.cost_price_usd, 3)
  assert.equal(product.audit.cost, 3)
  assert.deepEqual(worker.projectInventoryCheckProduct(product, worker.getInventoryCheckAccess(null)), {})
  const all = worker.projectInventoryCheckProduct(product, worker.getInventoryCheckAccess(user({}, {}, 'admin')))
  for (const key of ['audit', 'arbitrary', 'account_id', 'branch_stock_json', 'customer_name', 'customer_phone', 'revenue_usd', 'profit_usd']) assert.equal(key in all, false, key)
  assert.equal(all.cost_price_usd, 3)
  assert.equal(all.stock_value_usd, 30)
  assert.equal(all.qty_sold, 8)
  assert.equal(all.customer_count, 5)
  const partialStockValue = worker.projectInventoryCheckProduct(product, worker.getInventoryCheckAccess(user({ inventory_checks: true, inventory_check_show_cost: true, product_cost_view: true })))
  assert.equal('stock_value_usd' in partialStockValue, false, 'stock value requires both stock and cost')
  assert.deepEqual(worker.projectInventoryCheckProduct({ id: 4, name: { cost: 3 }, image_path: ['private'], stock_quantity: Infinity }, worker.getInventoryCheckAccess(user({}, {}, 'admin'))), { id: 4 })
})
check('next expiry is projected for the received field only', () => {
  const row = { id: 4, name: 'Example', next_expiry_date: '2027-03-01' }
  const project = permissions => worker.projectInventoryCheckProduct(row, worker.getInventoryCheckAccess(user({ inventory_checks: true, ...permissions })))
  assert.equal(project({ inventory_check_show_received: true }).next_expiry_date, '2027-03-01')
  for (const permissions of [{}, { inventory_check_show_stock: true }, { inventory_check_show_received: false }]) assert.equal(Object.hasOwn(project(permissions), 'next_expiry_date'), false, JSON.stringify(permissions))
})
check('hidden field sort/filter inference is refused, including barcode search', () => {
  const access = worker.getInventoryCheckAccess(user({ inventory_checks: true }))
  for (const [key, value] of [['stockState', 'low_stock'], ['brand', 'B'], ['category', 'A'], ['barcode', '123'], ['barcode', 'all'], ['sortBy', 'stock'], ['sortBy', 'qty_sold'], ['sortBy', 'customer_count'], ['sortBy', 'received_date'], ['sortBy', 'price'], ['sortBy', 'cost'], ['searchFields', 'barcode']]) {
    assert.throws(() => worker.validateInventoryCheckQuery({ [key]: value }, access), error => error.status === 403 && error.code === 'inventory_check_field_hidden', `${key}=${value}`)
  }
  const query = worker.validateInventoryCheckQuery({ q: '123', branchId: '1', stockState: 'all', sortBy: 'name', sortDirection: 'desc', startDate: '2026-10-01', endDate: '2026-10-19' }, access)
  assert.equal(query.query, '123')
  assert.equal(query.searchFields, 'name')
  assert.equal(query.sortDirection, 'desc')
  assert.equal(query.startDate, '2026-10-01')
  assert.equal(query.branchId, '1')
  assert.equal('q' in query, false)
})
check('allowlisted query contract cannot fall back to unknown derived sorting', () => {
  const access = worker.getInventoryCheckAccess(user({}, {}, 'admin'))
  for (const sortBy of ['name', 'stock', 'qty_sold', 'customer_count', 'received_date', 'price', 'cost']) assert.equal(worker.validateInventoryCheckQuery({ sortBy }, access).sortBy, sortBy)
  for (const query of [{ sortBy: 'profit_usd' }, { sortBy: 'name DESC; DROP TABLE products' }, { sortDirection: 'sideways' }, { customer_name: 'Private' }, { page: { secret: 1 } }, { q: 'one', search: 'two' }]) {
    assert.throws(() => worker.validateInventoryCheckQuery(query, access), error => error.status === 400)
  }
  assert.throws(() => worker.validateInventoryCheckQuery({}, worker.getInventoryCheckAccess(null)), error => error.status === 403 && error.code === 'inventory_check_view_required')
  assert.equal(worker.validateInventoryCheckQuery({ barcode: '123' }, access).barcode, '123')
})
console.log(`PASS ${checks} Inventory check access groups; 2700 Worker/frontend parity cells`)

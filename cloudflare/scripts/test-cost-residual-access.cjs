const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const root = path.resolve(__dirname, '../src')
let user, opens = 0
const modules = new Map()
function load(file) {
  if (modules.has(file)) return modules.get(file).exports
  const mod = { exports: {} }; modules.set(file, mod)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  new Function('require', 'module', 'exports', code)(name => {
    if (name === '../lib/auth') return { requireAuth: async (c, next) => { c.set('user', user); return next() } }
    if (name === '../lib/db' || name === './db') return { ...load(path.join(root, 'lib/db.ts')), getDb: () => { opens++; throw new Error('D1 tripwire') } }
    if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'))
    return require(name)
  }, mod, mod.exports)
  return mod.exports
}
const { recordedReturnCosts, fillOmittedReturnCosts } = load(path.join(root, 'lib/returnCostAccess.ts'))
const { projectAcquisitionCosts } = load(path.join(root, 'lib/acquisitionCostAccess.ts'))
const actor = permissions => ({ id: 7, username: 'employee', role_code: 'manager', permissions: JSON.stringify({ products: true, inventory: true, sales: true, backup: true, backup_restore: true, ...permissions }) })
const rows = [{ id: 10, product_id: 1, cost_price_usd: 7, cost_price_khr: null }, { id: 11, product_id: 1, cost_price_usd: 8, cost_price_khr: null }]
assert.deepEqual(recordedReturnCosts({ sale_item_id: 10, product_id: 1, cost_price_usd: 0 }, rows, 'sale'), { cost_price_usd: 7, cost_price_khr: null })
assert.throws(() => recordedReturnCosts({ product_id: 1 }, rows, 'sale'), /different recorded costs/)
assert.throws(() => recordedReturnCosts({ product_id: 2 }, rows, 'sale'), /unavailable/)
assert.deepEqual(recordedReturnCosts({ product_id: 1 }, [{ id: 1, cost_price_usd: null, cost_price_khr: null }], 'catalog'), { cost_price_usd: null, cost_price_khr: null })
// These merges run independently of visibility/entry grants: admin and blind
// editor omissions retain economics just like ordinary cashiers.
for (const source of ['sale', 'return', 'catalog']) {
  const sourceRows = [{ id: source === 'catalog' ? 1 : 10, sale_item_id: 10, product_id: 1, cost_price_usd: 7, cost_price_khr: null }]
  const item = { product_id: 1, ...(source === 'catalog' ? {} : { sale_item_id: 10 }) }
  assert.deepEqual(fillOmittedReturnCosts(item, sourceRows, source), { cost_price_usd: 7, cost_price_khr: null })
  assert.deepEqual(fillOmittedReturnCosts({ ...item, cost_price_usd: 0 }, sourceRows, source), { cost_price_usd: 0, cost_price_khr: null })
  assert.deepEqual(fillOmittedReturnCosts({ ...item, cost_price_usd: null }, sourceRows, source), { cost_price_usd: null, cost_price_khr: null })
  assert.deepEqual(fillOmittedReturnCosts({ ...item, unit_cost_khr: 28000 }, sourceRows, source), { cost_price_usd: 7, cost_price_khr: 28000 })
}
assert.deepEqual(projectAcquisitionCosts({ return_scope: 'supplier', total_refund_usd: 7, items: [{ applied_price_usd: 7, quantity: 1 }] }, actor({})), { return_scope: 'supplier', items: [{ quantity: 1 }] })
assert.deepEqual(projectAcquisitionCosts({ actual_cost_usd: 3, delivery_actual_cost_usd: 3, cost_price_usd: 7 }, actor({})), { actual_cost_usd: 3, delivery_actual_cost_usd: 3 })
const app = new Hono()
app.onError((e, c) => c.json({ error: e.message }, e.message === 'D1 tripwire' ? 598 : 599))
app.route('/imports', load(path.join(root, 'routes/importJobs.ts')).default)
app.route('/backups', load(path.join(root, 'routes/backups.ts')).default)
app.route('/returns', load(path.join(root, 'routes/returns.ts')).default)
async function post(url, body) { return app.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, {}) }
async function main() {
  user = actor({ returns: true, product_cost_edit: true })
  opens = 0
  const supplier = await post('/returns/supplier', { items: [{ product_id: 1, quantity: 1 }] })
  assert.equal(supplier.status, 403)
  assert.equal((await supplier.json()).code, 'product_cost_view_required')
  assert.equal(opens, 0)
  for (const grant of [{}, { product_cost_view: true }, { product_cost_edit: true }, { all: true }]) {
    user = actor(grant)
    for (const type of ['products', 'inventory', 'sales', 'stock_actions']) {
      opens = 0
      const response = await post('/imports', { type })
      if (!grant.product_cost_edit && !grant.all) {
        assert.equal(response.status, 403); assert.equal((await response.json()).code, 'product_cost_edit_required'); assert.equal(opens, 0)
      } else { assert.notEqual(response.status, 403, `${type} explicit edit/admin permitted`) }
    }
    for (const type of ['export-folder', 'export-cloudflare', 'import-folder']) {
      opens = 0
      const response = await post('/backups', { type })
      const permitted = grant.all || (type === 'import-folder' ? grant.product_cost_edit : grant.product_cost_view)
      if (!permitted) { assert.equal(response.status, 403); assert.equal((await response.json()).code, type === 'import-folder' ? 'product_cost_edit_required' : 'product_cost_view_required'); assert.equal(opens, 0) }
      else assert.notEqual(response.status, 403, `${type} explicit grant/admin permitted`)
    }
  }
  console.log('PASS residual cost permission matrix: defaults, independent view/edit, imports, backups, canonical return costs, supplier aliases, delivery distinction')
}
main().catch(e => { console.error(e); process.exitCode = 1 })

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const { DatabaseSync } = require('node:sqlite')
const controlDb = new DatabaseSync(':memory:')
controlDb.limits.exprDepth = 100
controlDb.limits.variableNumber = 100
controlDb.exec('CREATE TABLE system_flags (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)')
let maintenanceReads = 0
let controlPrepares = 0, denyControlAccess = false
const env = { DB: { prepare(sql) {
  controlPrepares++
  if (denyControlAccess) throw new Error('Control DB tripwire')
  assert.equal(sql, 'SELECT value FROM system_flags WHERE key = ?')
  const statement = controlDb.prepare(sql)
  return { bind(key) { return { async first() { maintenanceReads++; return statement.get(key) ?? null } } } }
} } }
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
async function post(url, body) { return app.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env) }
async function main() {
  user = actor({ returns: true, product_cost_edit: true })
  opens = 0
  const supplier = await post('/returns/supplier', { items: [{ product_id: 1, quantity: 1 }] })
  assert.equal(supplier.status, 403)
  assert.equal((await supplier.json()).code, 'product_cost_view_required', 'owner, 17 Nov 2026: edit alone passes the entry check and stops at the view check (supplier compensation is cost data)')
  assert.equal(opens, 0)
  user = actor({ returns: true })
  assert.equal((await (await post('/returns/supplier', { items: [{ product_id: 1, quantity: 1 }] })).json()).code, 'product_cost_edit_required', 'no grant: stops at the first (entry) check')
  user = actor({ returns: true, product_cost_view: true, product_cost_edit: true })
  opens = 0
  assert.notEqual((await post('/returns/supplier', { items: [{ product_id: 1, quantity: 1 }] })).status, 403, 'both grants pass the supplier return cost gates')
  for (const grant of [{}, { product_cost_view: true }, { product_cost_edit: true }, { product_cost_view: true, product_cost_edit: true }, { all: true }]) {
    user = actor(grant)
    for (const type of ['products', 'inventory', 'sales', 'stock_actions']) {
      opens = 0
      const response = await post('/imports', { type })
      const text = await response.text()
      let code; try { code = JSON.parse(text).code } catch { code = undefined }
      // 17 Nov 2026: an import WRITE needs View and Edit product costs (as the role editor states), or an administrator. Edit alone is refused for the missing View.
      if (!grant.all && !grant.product_cost_edit) {
        assert.equal(response.status, 403); assert.equal(code, 'product_cost_edit_required'); assert.equal(opens, 0)
      } else if (!grant.all && !grant.product_cost_view) {
        assert.equal(response.status, 403, `${type}: Edit without View cannot write an import`); assert.equal(code, 'product_cost_view_required'); assert.equal(opens, 0)
      } else { assert.notEqual(code, 'product_cost_edit_required', `${type}: View and Edit (or an administrator) pass the cost gate`); assert.notEqual(code, 'product_cost_view_required', `${type}: View and Edit (or an administrator) pass the cost gate`) }
    }
    for (const type of ['export-folder', 'export-cloudflare', 'import-folder']) {
      opens = 0
      const permitted = grant.all // administrator only whatever the cost grants say (owner, 17 Nov 2026)
      controlPrepares = 0
      denyControlAccess = !permitted
      const response = await post('/backups', { type })
      if (!permitted) { assert.equal(response.status, 403); assert.equal((await response.json()).code, 'admin_required'); assert.equal(opens, 0) }
      else assert.notEqual(response.status, 403, `${type} explicit grant/admin permitted`)
      assert.equal(controlPrepares, permitted ? 1 : 0)
    }
  }
  assert.equal(maintenanceReads, 3, "only the admin grant opens a backup control now")
  // the apply-time re-check of the authorising user holds the same rule (View and Edit), not Edit alone
  assert.match(fs.readFileSync(path.join(root, 'lib/importEngine.ts'), 'utf8'), /isAcquisitionCostImport\(job\.type\) && !\(canEditAcquisitionCosts\(actor\) && canViewAcquisitionCosts\(actor\)\)/)
  assert.equal(controlDb.prepare('SELECT COUNT(*) AS n FROM system_flags').get().n, 0)
  controlDb.prepare('INSERT INTO system_flags (key, value) VALUES (?, ?)').run('maintenance', '{')
  user = actor({ all: true })
  opens = 0
  const held = await post('/backups', { type: 'export-folder' })
  assert.equal(held.status, 503)
  assert.equal((await held.json()).code, 'maintenance_active')
  assert.equal(opens, 0)
  assert.equal(maintenanceReads, 4)
  for (const grant of [{ backup: false, product_cost_view: true }, { backup_restore: false, product_cost_edit: true }]) {
    user = actor(grant)
    opens = 0
    controlPrepares = 0
    denyControlAccess = true
    const denied = await post('/backups', { type: grant.backup === false ? 'export-folder' : 'import-folder', sourceDir: 'fixture', dryRun: true })
    assert.equal(denied.status, 403)
    assert.equal(opens, 0)
    assert.equal(controlPrepares, 0)
  }
  user = actor({ backup_restore: false })
  assert.equal((await post('/backups/maintenance/clear', { force: true })).status, 403)
  assert.equal(controlPrepares, 0)
  denyControlAccess = false
  user = actor({ all: true })
  const cutover = JSON.stringify({ mode: 'branch-cutover', operationId: crypto.randomUUID(), token: crypto.randomUUID(), actorId: 1,
    organizationId: '1', controlIncarnation: crypto.randomUUID(), beginRequestId: 'fixture_begin', intentDigest: 'a'.repeat(64) })
  for (const value of ['{', cutover]) {
    controlDb.prepare('UPDATE system_flags SET value=? WHERE key=?').run(value, 'maintenance')
    for (const body of [{ type: 'export-folder' }, { type: 'export-cloudflare' }, {},
      { type: 'import-folder', sourceDir: 'fixture', dryRun: true }, { type: 'import-folder', sourceDir: 'fixture' }]) {
      controlPrepares = 0
      opens = 0
      const response = await post('/backups', body)
      assert.equal(response.status, 503)
      assert.equal((await response.json()).code, 'maintenance_active')
      assert.equal(controlPrepares, 1)
      assert.equal(opens, 0)
      assert.equal(controlDb.prepare('SELECT value FROM system_flags WHERE key=?').get('maintenance').value, value)
    }
  }
  console.log('PASS residual cost permission matrix: defaults, independent view/edit, imports, backups, canonical return costs, supplier aliases, delivery distinction')
}
main().catch(e => { console.error(e); process.exitCode = 1 })

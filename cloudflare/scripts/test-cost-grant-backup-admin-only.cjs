// Owner ruling, 17 Nov 2026: cost and profit follow the editable product_cost_view / product_cost_edit grants, but backups, restore and
// Drive sync stay ADMIN ONLY whatever those grants say. A backup holds every cost, so a cost-grant holder must not be able to download,
// restore or authorise sync. This drives the REAL route modules (backups.ts, compat.ts) with a D1 tripwire: a refusal must come before any
// database read, and an administrator must get past the gate (the tripwire then fires).
// Run (from cloudflare/scripts): node test-cost-grant-backup-admin-only.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const root = path.resolve(__dirname, '../src')
const modules = new Map()
let user, dbOpens = 0
function load(file) {
  if (modules.has(file)) return modules.get(file).exports
  const mod = { exports: {} }; modules.set(file, mod)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  new Function('require', 'module', 'exports', code)(name => {
    if (name === '../lib/auth') return { ...load(path.join(root, 'lib/auth.ts')), requireAuth: async (c, next) => { c.set('user', user); return next() } }
    if (name === '../lib/db' || name === './db') return { ...load(path.join(root, 'lib/db.ts')), getDb: () => { dbOpens++; throw new Error('D1 tripwire') } }
    if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name.endsWith('.ts') ? name : name + '.ts'))
    return require(name)
  }, mod, mod.exports)
  return mod.exports
}
const actor = (role_code, permissions = {}) => ({ id: 7, username: 'ops', role_code, permissions: JSON.stringify(permissions), role_permissions: '{}', is_active: 1 })
const BACKUP_KEYS = { backup: true, backup_restore: true, drive_credentials: true, settings: true }
const holder = actor('manager', { ...BACKUP_KEYS, product_cost_view: true, product_cost_edit: true })
const viewOnly = actor('manager', { ...BACKUP_KEYS, product_cost_view: true })
const editOnly = actor('manager', { ...BACKUP_KEYS, product_cost_edit: true })
const noGrant = actor('manager', { ...BACKUP_KEYS })
const admin = actor('admin', {})
const adminFalse = actor('admin', { product_cost_view: false, product_cost_edit: false })

const app = new Hono()
app.onError((error, c) => error.message === 'D1 tripwire' ? c.json({ reached: true }, 598) : c.json({ error: String(error.message) }, 500))
app.route('/api/backups', load(path.join(root, 'routes/backups.ts')).default)
app.route('/api', load(path.join(root, 'routes/compat.ts')).default)
async function call(url, who, body) {
  user = who; dbOpens = 0
  return app.request(`http://test${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }, {})
}

const ROUTES = [
  ['export (cloudflare)', '/api/backups', { type: 'export-cloudflare' }],
  ['export (folder)', '/api/backups', { type: 'export-folder' }],
  ['restore (import-folder)', '/api/backups', { type: 'import-folder', sourceDir: 'backups/cloudflare/none' }],
  ['Drive sync push', '/api/system/drive-sync/jobs', {}],
  ['Drive restore stage', '/api/system/drive-sync/restore-stage/jobs', { manifestId: 'x' }],
]

async function main() {
  const { canViewAcquisitionCosts, canEditAcquisitionCosts } = load(path.join(root, 'lib/acquisitionCostAccess.ts'))
  const { canAuthorizeDriveSync } = load(path.join(root, 'lib/driveSyncAuthority.ts'))
  // CONTROL: the holders really do hold the cost grants, so a refusal below is the backup gate and not a missing grant.
  assert.equal(canViewAcquisitionCosts(holder) && canEditAcquisitionCosts(holder), true)
  assert.equal(canViewAcquisitionCosts(viewOnly), true)
  assert.equal(canEditAcquisitionCosts(editOnly), true)
  assert.equal(canViewAcquisitionCosts(noGrant), false)
  for (const [label, url, body] of ROUTES) {
    for (const [who, name] of [[holder, 'view+edit cost grants'], [viewOnly, 'view grant'], [editOnly, 'edit grant'], [noGrant, 'no grant']]) {
      const res = await call(url, who, body)
      assert.equal(res.status, 403, `${label}: a non-admin with ${name} is refused even holding the backup keys (got ${res.status})`)
      assert.equal(dbOpens, 0, `${label}: ${name} is refused before any database read`)
    }
    for (const [who, name] of [[admin, 'administrator'], [adminFalse, 'administrator with the cost grants stored false']]) {
      const res = await call(url, who, body)
      assert.notEqual(res.status, 403, `${label}: the ${name} passes the gate (got ${res.status})`)
    }
  }
  // Drive authorisation: the same rule in the one shared function the OAuth start, preferences and run-time re-check all call.
  assert.equal(canAuthorizeDriveSync(holder), false, 'backup + both cost grants does not authorise Drive sync')
  assert.equal(canAuthorizeDriveSync(actor('manager', { backup: true, product_cost_view: true })), false)
  assert.equal(canAuthorizeDriveSync(actor('admin', { backup: true })), true)
  assert.equal(canAuthorizeDriveSync(actor('manager', { backup: true, settings: true })), false, 'backup alone, not an administrator, is refused')
  console.log('PASS backup export, restore and Drive sync stay administrator only with the cost grants held')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })

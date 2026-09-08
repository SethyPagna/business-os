// Dedicated contact financial-history authority: pure permission truth plus
// route-order locks that ensure a denied request cannot reach a database read.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const os = require('node:os')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const permissionsSource = fs.readFileSync(path.join(root, 'src', 'lib', 'permissions.ts'), 'utf8')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contact-financial-permission-'))
const input = path.join(tmp, 'permissions.ts')
fs.writeFileSync(input, permissionsSource)
execFileSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '--module', 'commonjs', '--target', 'es2020', '--outDir', tmp, input], { stdio: 'inherit' })
const permissionHelpers = require(path.join(tmp, 'permissions.js'))
const { getActionTier } = permissionHelpers

const employee = { username: 'employee', role_code: 'employee', role_permissions: JSON.stringify({ sales: true, contacts: 'review', 'contacts:financial_history': false }), permissions: '{}' }
const manager = { username: 'manager', role_code: 'manager', role_permissions: JSON.stringify({ sales: true, contacts: true }), permissions: '{}' }
const narrowedManager = { ...manager, permissions: JSON.stringify({ 'contacts:financial_history': false }) }
const admin = { username: 'admin', role_code: 'admin', role_permissions: '{}', permissions: '{}' }
assert.equal(getActionTier(employee, 'contacts', 'financial_history'), 'none')
assert.equal(getActionTier(manager, 'contacts', 'financial_history'), 'full')
assert.equal(getActionTier(narrowedManager, 'contacts', 'financial_history'), 'none')
assert.equal(getActionTier(admin, 'contacts', 'financial_history'), 'full')

const contacts = fs.readFileSync(path.join(root, 'src', 'routes', 'contacts.ts'), 'utf8')
const sales = fs.readFileSync(path.join(root, 'src', 'routes', 'sales.ts'), 'utf8')
const slice = (source, marker, nextMarker) => {
  const start = source.indexOf(marker)
  assert.ok(start >= 0, `missing route ${marker}`)
  const end = source.indexOf(nextMarker, start + marker.length)
  return source.slice(start, end >= 0 ? end : undefined)
}
const ar = slice(contacts, "app.get('/customers/reports/ar-invoices'", '\napp.')
const delivery = slice(sales, "app.get('/delivery-contact-report'", '\napp.')
const customer = slice(sales, "app.get('/customer-report'", '\napp.')
for (const [name, route] of [['AR', ar], ['delivery report', delivery], ['customer report', customer]]) {
  assert.match(route, /getActionTier\(c\.get\('user'\), 'contacts', 'financial_history'\) !== 'full'/, `${name} must require the dedicated action`)
  const guard = route.indexOf("getActionTier(c.get('user'), 'contacts', 'financial_history')")
  const firstDb = route.search(/getDb\(|getCustomerSalesTotals\(|getDeliveryContactTotals\(/)
  assert.ok(firstDb < 0 || guard < firstDb, `${name} must refuse before its first database/report read`)
  assert.doesNotMatch(route, /canReadSales\([^)]*\)\s*&&|hasPermission\([^,]+, 'contacts'\)/, `${name} must not let a Sales grant bypass contact privacy`)
}

function load(file, dependencies = {}) {
  const filename = path.join(root, 'src', file)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText
  const module = { exports: {} }
  new Function('require', 'exports', 'module', output)(name => {
    if (name in dependencies) return dependencies[name]
    if (name.startsWith('.')) return {}
    return require(name)
  }, module.exports, module)
  return module.exports
}

let dbReads = 0
const forbiddenDb = {
  prepare() {
    dbReads += 1
    throw new Error('denied financial-history request reached the database')
  },
}
const routeDependencies = {
  '../lib/auth': {
    requireAuth: async (c, next) => {
      c.set('user', employee)
      return next()
    },
  },
  '../lib/db': { getDb: () => forbiddenDb },
  '../lib/permissions': permissionHelpers,
}
const contactsApp = load('routes/contacts.ts', routeDependencies).default
const salesApp = load('routes/sales.ts', routeDependencies).default

async function assertDeniedBeforeRead(app, pathname) {
  dbReads = 0
  const response = await app.request(pathname, {}, {})
  assert.equal(response.status, 403, pathname)
  assert.equal(dbReads, 0, `${pathname} must not read D1 when financial-history access is denied`)
}

Promise.all([
  assertDeniedBeforeRead(contactsApp, '/customers/reports/ar-invoices'),
  assertDeniedBeforeRead(salesApp, '/customer-report?customer_id=1'),
  assertDeniedBeforeRead(salesApp, '/delivery-contact-report?delivery_contact_id=1'),
]).then(() => {
  console.log('PASS real Contacts and Sales report routes refuse before D1 reads')
}).catch(error => {
  console.error(error)
  process.exitCode = 1
})

console.log('PASS contact financial-history permission is independent, explicit-deny aware, admin-safe, and checked before route reads')

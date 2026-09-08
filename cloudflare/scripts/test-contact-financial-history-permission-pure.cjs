// Dedicated contact financial-history authority: pure permission truth plus
// route-order locks that ensure a denied request cannot reach a database read.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const os = require('node:os')

const root = path.join(__dirname, '..')
const permissionsSource = fs.readFileSync(path.join(root, 'src', 'lib', 'permissions.ts'), 'utf8')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contact-financial-permission-'))
const input = path.join(tmp, 'permissions.ts')
fs.writeFileSync(input, permissionsSource)
execFileSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '--module', 'commonjs', '--target', 'es2020', '--outDir', tmp, input], { stdio: 'inherit' })
const { getActionTier } = require(path.join(tmp, 'permissions.js'))

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

console.log('PASS contact financial-history permission is independent, explicit-deny aware, admin-safe, and checked before route reads')

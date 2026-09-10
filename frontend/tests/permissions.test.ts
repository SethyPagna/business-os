import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { parsePermissionMap, normalizePermissionState, saleAmendmentWindowAllows, effectivePermissions, isAdminControlUser } from '../src/utils/permissions.ts'

assert.deepEqual(parsePermissionMap('{"products":true,"inventory":false}'), {
  products: true,
  inventory: false,
})

const objectPermissions = { products: true, sales: true }
assert.equal(parsePermissionMap(objectPermissions), objectPermissions)

assert.deepEqual(parsePermissionMap('not-json'), {})
assert.deepEqual(parsePermissionMap(null), {})
assert.deepEqual(parsePermissionMap(['products']), {})
assert.deepEqual(parsePermissionMap('["products"]'), {})

console.log('PASS permission parsing accepts string and object payloads')

for (const value of [{ sales: 'view', settings: 'view', fees: 'review', 'sales:status': false }, '{"sales":"view","settings":"view","fees":"review","sales:status":false}']) {
  assert.deepEqual(normalizePermissionState(value), { sales: 'view', settings: 'view', fees: 'review', 'sales:status': false })
}
assert.deepEqual(normalizePermissionState({ sales: 'full', fees: 'view', settings: 'review', all: 'true', users: 1, pos: true }), { sales: false, fees: false, settings: false, all: false, users: false, pos: true })
const now = Date.parse('2026-09-11T12:00:00Z')
assert.equal(saleAmendmentWindowAllows(0, 'invalid', false, now), true)
assert.equal(saleAmendmentWindowAllows(120, '2026-09-11 10:00:00', false, now), true)
assert.equal(saleAmendmentWindowAllows(120, '2026-09-11 09:59:59', false, now), false)
assert.equal(saleAmendmentWindowAllows(120, 'invalid', false, now), false)
assert.equal(saleAmendmentWindowAllows(120, 'invalid', true, now), true)
console.log('PASS persisted view tiers remain view; malformed grants fail closed; optional amendment window matches UTC boundary')

function workerModule(relative: string, names?: string[], dependencies: Record<string, unknown> = {}): any {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8')
  const ast = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true)
  const selected = names ? ast.statements.filter(node => {
    if (ts.isFunctionDeclaration(node)) return !!node.name && names.includes(node.name.text)
    if (ts.isVariableStatement(node)) return node.declarationList.declarations.some(item => names.includes(item.name.getText(ast)))
    return false
  }).map(node => node.getText(ast)).join('\n') : source
  const compiled = ts.transpileModule(selected, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} }
  new Function('exports', ...Object.keys(dependencies), compiled)(module.exports, ...Object.values(dependencies))
  return module.exports
}
const workerPermissions = workerModule('../../cloudflare/src/lib/permissions.ts')
const workerStatus = workerModule('../../cloudflare/src/lib/salesStatus.ts')
const workerAmendments = workerModule('../../cloudflare/src/lib/saleAmendments.ts', [
  'DEFAULT_AMENDMENT_WINDOW_MINUTES', 'SALE_STATUSES_ACCEPTING_AMENDMENTS',
  'resolveAmendmentWindowMinutes', 'parseSqliteTimestampMs', 'guardSaleAmendment', 'formatWindow',
], { RETURN_STATUSES: workerStatus.RETURN_STATUSES })
const salesSource = readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8')
const adminExpression = salesSource.slice(salesSource.indexOf('const isAdmin = ') + 'const isAdmin = '.length, salesSource.indexOf('  const cleanFallback')).trim()
const frontendAdmin = new Function('user', 'isAdminControlUser', `return (${adminExpression})`)
const roles = [
  { role: { all: true }, user: {} },
  { role: { sales: true, 'sales:amend': true }, user: {} },
  { role: { sales: true, 'sales:amend': false }, user: {} },
  { role: { all: true, sales: true }, user: { all: false } },
  { role: { sales: 'view' }, user: {} },
]
for (const permissions of roles) {
  const user = { username: 'custom-manager', role_code: 'shop-manager', role_permissions: JSON.stringify(permissions.role), permissions: JSON.stringify(permissions.user) }
  const authority = effectivePermissions(user)
  const admin = frontendAdmin(user, isAdminControlUser)
  assert.equal(admin, workerPermissions.isAdminControlUser(user), 'role-only administrator authority matches the Worker')
  for (const minutes of [0, 120]) for (const createdAt of ['2026-09-11 09:59:59', '2026-09-11 10:00:00', 'invalid']) {
    const frontendAllowed = authority.can('sales', 'amend')
      && saleAmendmentWindowAllows(minutes, createdAt, admin, now)
    const workerAllowed = workerPermissions.getActionTier(user, 'sales', 'amend') === 'full'
      && workerAmendments.guardSaleAmendment({ saleStatus: 'completed', hasRecordedReturns: false, saleCreatedAt: createdAt, windowMinutes: workerAmendments.resolveAmendmentWindowMinutes(minutes), isAdmin: workerPermissions.isAdminControlUser(user), nowMs: now }).ok
    assert.equal(frontendAllowed, workerAllowed, `role/user/window parity: ${JSON.stringify({ permissions, minutes, createdAt })}`)
  }
}
console.log('PASS production Sales administrator expression and Worker amendment gates agree for custom role-only managers, overrides and zero/positive windows')

for (const raw of ['false', 'true', 1, -1, [], {}, 'review', 'view', null]) {
  const user = { role_permissions: { all: true, products: true }, permissions: { all: raw, products: raw } }
  const authority = effectivePermissions(user)
  assert.equal(authority.isAdmin, false, `malformed all ${JSON.stringify(raw)} must revoke a role grant`)
  assert.equal(authority.getPermissionTier('products'), raw === 'review' ? 'review' : 'none')
}
for (const products of [false, 'review', true] as const) for (const blocked of [false, true]) {
  const user = { role_permissions: { all: true }, permissions: { all: false, products, 'products:add': !blocked } }
  const authority = effectivePermissions(user)
  assert.equal(authority.isAdmin, false)
  assert.equal(authority.can('products', 'add'), products !== false && !blocked)
  assert.equal(authority.getPermissionTier('products'), products === true ? 'full' : products === 'review' ? 'review' : 'none')
}
for (const identity of [{ username: ' ADMIN ' }, { role_code: ' AdMiN ' }, { role_permissions: { all: true } }]) {
  const actor = { ...identity, permissions: { products: false, 'products:add': false } }
  assert.equal(effectivePermissions(actor).can('products', 'add'), true, 'administrator bypasses narrowing')
}
for (const sales of [false, 'view', true] as const) {
  const authority = effectivePermissions({ permissions: { sales, 'sales:status': true } })
  assert.equal(authority.can('sales', 'view'), sales !== false)
  assert.equal(authority.can('sales', 'status'), sales === true, 'override cannot widen the selected tier')
}
assert.equal(effectivePermissions(null).can('products', 'add'), false)
assert.equal(effectivePermissions({ permissions: { settings: true } }).hasPermission(' BUSINESS_IDENTITY '), true)
console.log('PASS strict effective-user/admin/action matrix, override precedence and reserved identities')

const absent = Symbol('absent')
const overrides = [absent, false, true, 'false', 'true', 0, 1, [], {}, null, 'review', 'view']
let overrideCases = 0
for (const roleValue of overrides) for (const userValue of overrides) {
  const role = { sales: true, ...(roleValue === absent ? {} : { 'sales:status': roleValue }) }
  const personal = userValue === absent ? {} : { 'sales:status': userValue }
  const effective = userValue === absent ? roleValue : userValue
  for (const encode of [false, true]) {
    const actor = {
      role_permissions: encode ? JSON.stringify(role) : role,
      permissions: encode ? JSON.stringify(personal) : personal,
    }
    const authority = effectivePermissions(actor)
    const workerActor = { role_permissions: JSON.stringify(role), permissions: JSON.stringify(personal) }
    assert.equal(authority.can('sales', 'status'), effective !== false, 'only the effective explicit false blocks')
    assert.equal(authority.can('sales', 'status'), workerPermissions.getActionTier(workerActor, 'sales', 'status') === 'full', 'raw role/user action semantics match Worker')
    assert.equal(authority.merged['sales:status'], effective === true || effective === false ? effective : undefined)
    // A no-op action value cannot widen a denied or read-only section.
    for (const sales of [false, 'false', 1, 'view']) {
      assert.equal(effectivePermissions({ ...actor, permissions: { ...personal, sales } }).can('sales', 'status'), false)
    }
    assert.equal(effectivePermissions({ ...actor, username: ' ADMIN ' }).can('sales', 'status'), true)
    overrideCases++
  }
}
console.log(`PASS ${overrideCases} role/user action-override cases match Worker; junk is no opinion, section grants stay strict, admin bypasses`)

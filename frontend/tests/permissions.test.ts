import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { parsePermissionMap, normalizePermissionState, saleAmendmentWindowAllows, getPermissionTierFromMap } from '../src/utils/permissions.ts'
import { actionAllowed, isActionOverriddenOff } from '../src/utils/permissionActions.ts'

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
const frontendAdmin = new Function('user', 'getPermissionTier', `return (${adminExpression})`)
const roles = [
  { role: { all: true }, user: {} },
  { role: { sales: true, 'sales:amend': true }, user: {} },
  { role: { sales: true, 'sales:amend': false }, user: {} },
  { role: { all: true, sales: true }, user: { all: false } },
  { role: { sales: 'view' }, user: {} },
]
for (const permissions of roles) {
  const user = { username: 'custom-manager', role_code: 'shop-manager', role_permissions: JSON.stringify(permissions.role), permissions: JSON.stringify(permissions.user) }
  const merged = { ...parsePermissionMap(user.role_permissions), ...parsePermissionMap(user.permissions) }
  const tier = (key: string) => getPermissionTierFromMap(merged, key, merged.all === true)
  const admin = frontendAdmin(user, tier)
  assert.equal(admin, workerPermissions.isAdminControlUser(user), 'role-only administrator authority matches the Worker')
  for (const minutes of [0, 120]) for (const createdAt of ['2026-09-11 09:59:59', '2026-09-11 10:00:00', 'invalid']) {
    const frontendAllowed = actionAllowed('sales', 'amend', tier('sales'), () => false, (section, action) => isActionOverriddenOff(merged, section, action))
      && saleAmendmentWindowAllows(minutes, createdAt, admin, now)
    const workerAllowed = workerPermissions.getActionTier(user, 'sales', 'amend') === 'full'
      && workerAmendments.guardSaleAmendment({ saleStatus: 'completed', hasRecordedReturns: false, saleCreatedAt: createdAt, windowMinutes: workerAmendments.resolveAmendmentWindowMinutes(minutes), isAdmin: workerPermissions.isAdminControlUser(user), nowMs: now }).ok
    assert.equal(frontendAllowed, workerAllowed, `role/user/window parity: ${JSON.stringify({ permissions, minutes, createdAt })}`)
  }
}
console.log('PASS production Sales administrator expression and Worker amendment gates agree for custom role-only managers, overrides and zero/positive windows')

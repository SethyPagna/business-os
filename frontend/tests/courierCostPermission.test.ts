import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { actionsForKey, outcomeAt } from '../src/utils/permissionActions.ts'
import { effectivePermissions } from '../src/utils/permissions.ts'
import { ROLE_PRESETS } from '../src/components/users/rolePresetDefaults.ts'
import { RETIRED_PERMISSION_KEYS, resetRolePermissions } from '../src/components/users/roleDefaultsReset.ts'
import { DEFAULT_ROLE_PERMISSIONS } from '../../cloudflare/src/lib/roleDefaults.ts'

// Owner, 14 Oct 2026: the courier's actual cost is one switch, sales:view_courier_cost. It is on for every role that
// holds Sales (an absent key means on, so no stored role needs a migration), the role editor row turns it off, and the
// Worker answers every response through the same name. cloudflare/scripts/test-courier-cost-permission-parity-pure.cjs
// runs both sides over every stored shape; this file pins the editor half where the frontend suite can see it.
const courierRow = actionsForKey('sales').find((action) => action.key === 'view_courier_cost')
assert.ok(courierRow, 'the Sales table has the courier-cost row')
assert.equal(outcomeAt(courierRow, 'view'), 'allow', 'the View tier reads it, as the Worker does')
assert.equal(outcomeAt(courierRow, 'full'), 'allow')
assert.equal(outcomeAt(courierRow, 'none'), 'block')

const staff = (map: Record<string, unknown>) => effectivePermissions({ role_code: 'employee', role_permissions: JSON.stringify(map) })
assert.equal(staff({ sales: true }).can('sales', 'view_courier_cost'), true, 'on by default')
assert.equal(staff({ sales: 'view' }).can('sales', 'view_courier_cost'), true)
assert.equal(staff({ sales: true, 'sales:view_courier_cost': false }).can('sales', 'view_courier_cost'), false, 'the editor row switches it off')
assert.equal(staff({ 'sales:view_courier_cost': true }).can('sales', 'view_courier_cost'), false, 'an override never grants past a missing Sales tier')
assert.equal(staff({ sales: true, 'sales:amend': false }).can('sales', 'view_courier_cost'), true, 'amending is a separate right')
assert.equal(effectivePermissions({ role_code: 'admin', role_permissions: JSON.stringify({ 'sales:view_courier_cost': false }) }).can('sales', 'view_courier_cost'), true, 'an administrator is never narrowed')

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
assert.equal(en[courierRow.tKey], courierRow.label, 'the English pack carries the row label')
assert.ok(km[courierRow.tKey]?.trim() && km[courierRow.tKey] !== en[courierRow.tKey], 'the Khmer pack carries a translated label')

assert.match(readFileSync(new URL('../../cloudflare/src/lib/courierCostAccess.ts', import.meta.url), 'utf8'),
  /getActionTier\(user, 'sales', 'view_courier_cost'\) !== 'none'/, 'the Worker gate reads the same sales action')

// Owner, 16 Nov 2026: "Courier cost: visible to staff and admin ... show in permissions, done as given permission to staff." The row is drawn (above), the
// Manager and Employee defaults STORE the grant as true on both sides (preset = Worker seed), a reset to defaults writes it back (it is not a retired grant),
// and product cost and profit stay admin only (canViewAcquisitionCosts is not touched by the courier grant).
for (const code of ['manager', 'employee'] as const) {
  assert.strictEqual(DEFAULT_ROLE_PERMISSIONS[code]['sales:view_courier_cost'], true, `${code} seed stores the grant`)
  assert.strictEqual(ROLE_PRESETS.find((preset) => preset.key === code)?.permissions['sales:view_courier_cost'], true, `${code} preset stores the grant`)
  assert.equal(staff(DEFAULT_ROLE_PERMISSIONS[code] as Record<string, unknown>).can('sales', 'view_courier_cost'), true, `${code} reads the courier cost by default`)
}
assert.equal(Object.hasOwn(ROLE_PRESETS.find((preset) => preset.key === 'product_viewer')?.permissions ?? {}, 'sales:view_courier_cost'), false, 'the Product Viewer (no Sales) holds none')
assert.equal(RETIRED_PERMISSION_KEYS.includes('sales:view_courier_cost'), false, 'the courier grant is a drawn switch, not a retired one')
assert.equal(resetRolePermissions({ sales: true, 'sales:view_courier_cost': false }, DEFAULT_ROLE_PERMISSIONS.employee)['sales:view_courier_cost'], true, 'a reset to defaults brings the grant back')
// DISCRIMINATING: staff with the grant off read nothing while the same account with it on reads it; product cost is the same for both.
const grantOn = staff({ sales: true, 'sales:view_courier_cost': true, product_cost_view: true })
const grantOff = staff({ sales: true, 'sales:view_courier_cost': false, product_cost_view: true })
assert.equal(grantOn.can('sales', 'view_courier_cost'), true)
assert.equal(grantOff.can('sales', 'view_courier_cost'), false)

const lf = (text: string): string => text.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
const gate = lf(readFileSync(new URL('../../cloudflare/src/lib/courierCostAccess.ts', import.meta.url), 'utf8'))
assert.ok(gate.includes("export function canViewCourierCost(user: PermissionUser): boolean {" + String.fromCharCode(10) + "  return isAdminControlUser(user) || getActionTier(user, 'sales', 'view_courier_cost') !== 'none'" + String.fromCharCode(10) + "}"), 'the gate is the production rule')
const dashboard = lf(readFileSync(new URL('../src/components/dashboard/Dashboard.tsx', import.meta.url), 'utf8'))
assert.ok(dashboard.includes("const aCourierCostShown = typeof analytics?.totals?.delivery_actual_cost_usd === 'number'"), 'the Dashboard shows the courier figure whenever the Worker sent it (it sends it to the holders)')
assert.ok(!dashboard.includes('aCourierCostShown = aSeesCost'), 'and does not require product cost access for it')
assert.ok(dashboard.includes('const aHasProfit = aSeesCost && typeof'), 'profit still requires administrator cost access')

console.log('courierCostPermission tests passed')

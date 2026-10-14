import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { actionsForKey, outcomeAt } from '../src/utils/permissionActions.ts'
import { effectivePermissions } from '../src/utils/permissions.ts'

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

console.log('courierCostPermission tests passed')

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { actionsForKey } from '../src/utils/permissionActions.ts'

// Owner, 15 Nov 2026: the courier's actual cost is ADMIN ONLY, like every other cost. It used to be one switch,
// sales:view_courier_cost (owner, 14 Oct 2026), on for every role that held Sales. The role editor row is retired, because a
// switch that grants a non-admin nothing would only mislead; the Worker keeps the stored key readable as holdsCourierCostGrant,
// the way back. cloudflare/scripts/test-courier-cost-permission-parity-pure.cjs runs the Worker side over every stored shape;
// this file pins the editor half where the frontend suite can see it.
assert.equal(actionsForKey('sales').find((action) => action.key === 'view_courier_cost'), undefined, 'the Sales table no longer offers a courier-cost row')

const gate = readFileSync(new URL('../../cloudflare/src/lib/courierCostAccess.ts', import.meta.url), 'utf8')
assert.match(gate, /export function canViewCourierCost\(user: PermissionUser\): boolean \{\s*return isAdminControlUser\(user\)\s*\}/, 'the Worker gate is administrator only')
assert.match(gate, /export function holdsCourierCostGrant[\s\S]*getActionTier\(user, 'sales', 'view_courier_cost'\) !== 'none'/, 'the retired per-role switch stays readable as the way back')

console.log('courierCostPermission tests passed')

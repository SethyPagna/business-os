import assert from 'node:assert/strict'
import { parsePermissionMap, normalizePermissionState, saleAmendmentWindowAllows } from '../src/utils/permissions.ts'

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

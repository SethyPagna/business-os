import assert from 'node:assert/strict'
import {
  filterCashierOptions,
  isCashierOwnerVisible,
  resolveCashierVisibilityMode,
  resolveExactCashierFilter,
} from '../src/utils/cashierVisibility.ts'

const viewer = { id: 1, isAdministrator: false }
const administrator = { id: 9, isAdministrator: true }
const options = [
  { id: 1, label: 'Me', isAdministrator: false },
  { id: 2, label: 'Staff', isAdministrator: false },
  { id: 3, label: 'Administrator', isAdministrator: true },
  { id: null, label: 'Unresolved', isAdministrator: false },
  { id: 'not-an-id', label: 'Malformed', isAdministrator: false },
]

for (const rawMode of [undefined, null, '', '   ']) {
  assert.equal(resolveCashierVisibilityMode(rawMode, viewer), 'all')
}
assert.equal(resolveCashierVisibilityMode(' STAFF ', viewer), 'staff')
assert.equal(resolveCashierVisibilityMode('unknown', viewer), 'self')
assert.equal(resolveCashierVisibilityMode('self', administrator), 'all')

assert.equal(isCashierOwnerVisible('self', viewer, { id: 1 }), true)
assert.equal(isCashierOwnerVisible('self', viewer, { id: 2, isAdministrator: false }), false)
assert.equal(isCashierOwnerVisible('staff', viewer, { id: 2, isAdministrator: false }), true)
assert.equal(isCashierOwnerVisible('staff', viewer, { id: 3, isAdministrator: true }), false)
assert.equal(isCashierOwnerVisible('staff', viewer, { id: 4 }), false)
assert.equal(isCashierOwnerVisible('staff', viewer, null), false)
assert.equal(isCashierOwnerVisible('all', viewer, { id: 4 }), true)
assert.equal(isCashierOwnerVisible('all', viewer, null), true)
assert.equal(isCashierOwnerVisible('self', administrator, null), true)
assert.equal(isCashierOwnerVisible('invalid', viewer, { id: 2, isAdministrator: false }), false)

assert.deepEqual(filterCashierOptions(options, 'self', viewer).map((option) => option.id), [1])
assert.deepEqual(filterCashierOptions(options, 'staff', viewer).map((option) => option.id), [1, 2])
assert.deepEqual(filterCashierOptions(options, 'all', viewer).map((option) => option.id), [1, 2, 3])
assert.deepEqual(
  filterCashierOptions(options, 'self', administrator).map((option) => option.id),
  [1, 2, 3],
)

assert.deepEqual(resolveExactCashierFilter(2, options, 'staff', viewer), { allowed: true, ownerId: 2 })
assert.deepEqual(resolveExactCashierFilter('0002', options, 'staff', viewer), { allowed: true, ownerId: 2 })
assert.deepEqual(resolveExactCashierFilter(3, options, 'staff', viewer), { allowed: false })
assert.deepEqual(resolveExactCashierFilter(2, options, 'self', viewer), { allowed: false })
assert.deepEqual(resolveExactCashierFilter(3, options, 'all', viewer), { allowed: true, ownerId: 3 })
assert.deepEqual(resolveExactCashierFilter(999, options, 'all', viewer), { allowed: false })
assert.deepEqual(resolveExactCashierFilter(null, options, 'all', viewer), { allowed: false })
assert.deepEqual(resolveExactCashierFilter('not-an-id', options, 'all', viewer), { allowed: false })

console.log('cashier visibility frontend helper tests passed')

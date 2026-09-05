import assert from 'node:assert/strict'
import {
  filterCashierOptions,
  resolveCashierVisibilityMode,
  resolveExactCashierFilter,
} from '../src/utils/cashierVisibility.ts'

const viewer = { id: 1, isAdministrator: false }
const options = [
  { id: 1, label: 'Me', isAdministrator: false },
  { id: 2, label: 'Staff', isAdministrator: false },
  { id: 3, label: 'Administrator', isAdministrator: true },
  { id: null, label: 'Unresolved', isAdministrator: false },
]

assert.equal(resolveCashierVisibilityMode(undefined, viewer), 'all')
assert.equal(resolveCashierVisibilityMode('', viewer), 'all')
assert.equal(resolveCashierVisibilityMode('unknown', viewer), 'self')
assert.equal(resolveCashierVisibilityMode('self', { id: 9, isAdministrator: true }), 'all')

assert.deepEqual(filterCashierOptions(options, 'self', viewer).map((option) => option.id), [1])
assert.deepEqual(filterCashierOptions(options, 'staff', viewer).map((option) => option.id), [1, 2])
assert.deepEqual(filterCashierOptions(options, 'all', viewer).map((option) => option.id), [1, 2, 3, null])
assert.deepEqual(
  filterCashierOptions(options, 'self', { id: 9, isAdministrator: true }).map((option) => option.id),
  [1, 2, 3, null],
)

assert.deepEqual(resolveExactCashierFilter(2, options, 'staff', viewer), { allowed: true, ownerId: 2 })
assert.deepEqual(resolveExactCashierFilter(3, options, 'staff', viewer), { allowed: false })
assert.deepEqual(resolveExactCashierFilter(2, options, 'self', viewer), { allowed: false })
assert.deepEqual(resolveExactCashierFilter(null, options, 'all', viewer), { allowed: false })

console.log('cashier visibility frontend helper tests passed')

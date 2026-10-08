import assert from 'node:assert/strict'
import { branchStockLinesWorthShowing, branchHistoryLabel, labelInactiveChoices, showsBranchHistoryFilter } from '../src/utils/branchScope.ts'
import { buildProductBranchSummaryLabel } from '../src/components/products/helpers/productDisplayHelpers.ts'
import { buildProductFilterSections } from '../src/components/products/helpers/productMenuHelpers.ts'

const current = { branch_id: 1, branch_name: 'Current Shop', branch_active: 1, quantity: 12 }
const retired = { branch_id: 2, branch_name: 'Old Shop', branch_active: 0, quantity: 0 }
assert.deepEqual(branchStockLinesWorthShowing([current, retired]), [current], 'sole active branch details remain; empty retired stock adds no line')
assert.deepEqual(branchStockLinesWorthShowing([{ ...current, quantity: 0 }]), [{ ...current, quantity: 0 }], 'sole active zero stock still shows its branch')
assert.deepEqual(branchStockLinesWorthShowing([current, { ...retired, quantity: 3 }]), [current, { ...retired, quantity: 3 }], 'retired stock continues explaining the total')
const names = new Map([['1', 'Current Shop'], ['2', 'Old Shop']])
assert.equal(buildProductBranchSummaryLabel({ branch_stock: [current, retired] }, names), 'Current Shop: 12')
assert.equal(buildProductBranchSummaryLabel({ branch_stock: [current, retired] }, names, 1), 'Current Shop: 12', 'compact visible limit still retains sole branch')
assert.equal(showsBranchHistoryFilter([{ id: 1 }, { id: 2 }]), true, 'inactive history remains selectable')
assert.equal(branchHistoryLabel({ name: 'Old Shop', is_active: 0 }, 'Inactive'), 'Old Shop (Inactive)')
assert.equal(labelInactiveChoices([{ value: '1', label: 'Current Shop' }, { value: '2', label: 'Old Shop' }], [{ value: '1' }], 'Inactive')[1].disabled, true, 'retired branch cannot receive stock')
let selected = ''
const sections = buildProductFilterSections({ branches: [{ id: 1, name: 'Current Shop' }], filters: { branchFilter: 'all' }, setBranchFilter: value => { selected = value } })
const branchSection = sections.find(section => section.id === 'branch')
assert.ok(branchSection, 'fallback product filter retains sole branch')
const soleOption = branchSection.options?.find(option => option && option.id === 'branch-1')
assert.ok(soleOption)
soleOption.onClick?.()
assert.equal(selected, '1', 'single branch filter still selects its actual ID')
console.log('PASS sole active branch, zero stock, retired stock/history and receiving permission boundaries')

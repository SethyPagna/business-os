import assert from 'node:assert/strict'
import {
  SELECTED_CONFLICT_MAX_CASES,
  chooseSelectedConflictKeeper,
  createSelectedConflictRequestCoordinator,
  partitionSelectedConflictClusters,
  preserveSelectedConflictChoices,
  selectedConflictCaseKey,
  selectedConflictCanContinueAutomatically,
  selectedConflictChoicesComplete,
  selectedConflictEligibility,
  selectedConflictOutcomeIsUnknown,
  selectedConflictRequiresManualResume,
  type ProductConflictCluster,
  type ProductConflictProduct,
} from '../src/utils/selectedConflictMerge.ts'

const product = (id: number, overrides: Partial<ProductConflictProduct> = {}): ProductConflictProduct => ({
  id,
  name: 'Case Water',
  barcode: '012345000065',
  cost_price_usd: 5,
  cost_price_khr: 20_000,
  selling_price_usd: 7,
  selling_price_khr: 28_000,
  wholesale_price_usd: 6,
  wholesale_price_khr: 24_000,
  stock_quantity: 0,
  image_path: null,
  is_active: 1,
  is_group: 0,
  ...overrides,
})

const cluster = (value: string, left = product(1), right = product(2)): ProductConflictCluster => ({
  type: 'barcode',
  value,
  severity: 'same_barcode',
  products: [left, right],
})

assert.equal(selectedConflictEligibility(cluster('012345000065')).eligible, true)
assert.equal(selectedConflictCaseKey({ type: 'name', value: '  Case   WATER ' }), 'name:case water', 'case keys use the same normalized cluster identity the Worker validates')
assert.deepEqual(
  selectedConflictEligibility(cluster('pair', product(5, { barcode: '001234565' }), product(4, { barcode: '01234565' }))),
  { eligible: true, keeper: product(4, { barcode: '01234565' }), discarded: product(5, { barcode: '001234565' }) },
  'the cleaner equivalent barcode survives even when it has less stock or a lower-priority input position',
)
assert.equal(selectedConflictEligibility(cluster('pair', product(1, { name: 'Case Water' }), product(2, { name: 'Case Soda' }))).eligible, false)
assert.equal(selectedConflictEligibility(cluster('pair', product(1), product(2, { barcode: '999' }))).eligible, false)
assert.equal(selectedConflictEligibility(cluster('pair', product(1), product(2, { is_active: 0 }))).eligible, false)
assert.equal(selectedConflictEligibility(cluster('pair', product(1), product(2, { group_id: 20 }))).eligible, false)
assert.equal(selectedConflictEligibility(cluster('pair', product(1), product(2, { cost_price_usd: Number.NaN }))).eligible, false)
assert.equal(selectedConflictEligibility(cluster('pair', product(1), product(2, { selling_price_usd: -1 }))).eligible, false)
assert.equal(selectedConflictEligibility({ ...cluster('pair'), products: [product(1), product(2), product(3)] }).eligible, false)

assert.deepEqual(
  chooseSelectedConflictKeeper([product(2, { stock_quantity: 2 }), product(1, { stock_quantity: 8 })]).map((row) => row.id),
  [1, 2],
  'stock breaks ties for otherwise identical rows',
)
assert.deepEqual(
  chooseSelectedConflictKeeper([product(4), product(3)]).map((row) => row.id),
  [3, 4],
  'id is the final deterministic tie-break',
)

const many = Array.from({ length: SELECTED_CONFLICT_MAX_CASES + 2 }, (_, index) => cluster(`case-${index}`, product(index * 2 + 1), product(index * 2 + 2)))
const partition = partitionSelectedConflictClusters(many)
assert.equal(partition.cases.length, SELECTED_CONFLICT_MAX_CASES)
assert.equal(partition.skipped.length, 2)
assert.ok(partition.skipped.every((row) => row.code === 'selection_limit_exceeded'))

const previewCases = [
  { case_key: 'a', keep_id: 1, merge_id: 2, needs_stock_choice: true },
  { case_key: 'b', keep_id: 3, merge_id: 4, needs_stock_choice: false },
]
assert.equal(selectedConflictChoicesComplete(previewCases, {}), false)
assert.equal(selectedConflictChoicesComplete(previewCases, { a: 'write_off' }), true)
assert.equal(selectedConflictChoicesComplete([{ ...previewCases[0], blocked: { code: 'blocked' } }], {}), false, 'a selection with no actionable cases cannot confirm')
assert.equal(selectedConflictChoicesComplete([previewCases[0], { ...previewCases[1], blocked: { code: 'blocked' } }], { a: 'write_off' }), false, 'one blocked case stops the complete reviewed manifest')
assert.deepEqual(preserveSelectedConflictChoices(previewCases, previewCases, { a: 'merge' }), { a: 'merge' })
assert.deepEqual(preserveSelectedConflictChoices(previewCases, [{ ...previewCases[0], merge_id: 9 }], { a: 'merge' }), {}, 'a changed manifest cannot retain a prior stock decision')

assert.equal(selectedConflictCanContinueAutomatically({ interruptionCode: 'merge_budget_reached', madeProgress: true, maxAdditionalRequests: 2 }), true)
assert.equal(selectedConflictCanContinueAutomatically({ interruptionCode: 'merge_budget_reached', madeProgress: false, maxAdditionalRequests: 2 }), false)
assert.equal(selectedConflictCanContinueAutomatically({ interruptionCode: 'merge_infrastructure_interrupted', madeProgress: true, maxAdditionalRequests: 2 }), false)
assert.equal(selectedConflictRequiresManualResume({ interruptionCode: 'merge_infrastructure_interrupted' }), true)
assert.equal(selectedConflictRequiresManualResume({ interruptionCode: 'merge_history_pending' }), true)
assert.equal(selectedConflictRequiresManualResume({ interruptionCode: 'merge_history_unavailable' }), true)
assert.equal(selectedConflictRequiresManualResume({ interruptionCode: 'merge_state_conflict' }), true)
assert.equal(selectedConflictRequiresManualResume({ interruptionCode: 'merge_budget_reached' }), false)
assert.equal(selectedConflictOutcomeIsUnknown(Object.assign(new Error('conflict'), { status: 409 })), false)
assert.equal(selectedConflictOutcomeIsUnknown(Object.assign(new Error('overload'), { status: 503 })), true)
assert.equal(selectedConflictOutcomeIsUnknown(new TypeError('Failed to fetch')), true)

const coordinator = createSelectedConflictRequestCoordinator()
const first = coordinator.begin()
const second = coordinator.begin()
assert.equal(first.signal.aborted, true)
assert.equal(first.isCurrent(), false)
assert.equal(first.finish(), false)
assert.equal(second.isCurrent(), true)
coordinator.cancel()
assert.equal(second.signal.aborted, true)
assert.equal(second.finish(), false)

console.log('PASS selected conflict merge eligibility, decisions, continuation, and stale-request ownership')

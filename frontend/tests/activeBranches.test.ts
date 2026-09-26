// U-branch: which branches a new write may name, before and after the
// Shop/Warehouse consolidation (Warehouse id 1 renamed Store with role shop;
// Shop id 2 retired with successor 1).
//
// Discriminating cases:
//   * the Worker reports is_active as 0/1 -- `is_active !== false` (the old
//     FeeForm filter) keeps a retired row, so the fixture uses 0, not false;
//   * the renamed Store must SELL (role), which a name-only rule refuses;
//   * the retired Shop must NOT sell even though its name is still 'Shop';
//   * before the merge every answer is exactly the pre-change one.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  activeBranches,
  activeSellingBranches,
  canTransferBetweenActiveBranches,
} from '../src/utils/activeBranches.ts'
import * as selector from '../src/utils/activeBranches.ts'
import { branchIdCanSell, rememberBranchRows, resetBranchDirectory } from '../src/utils/branchDirectory.ts'
import { branchRuleErrorKey, localizeBranchRuleError } from '../src/api/branchRuleErrors.ts'

const before = [
  { id: 1, name: 'Warehouse', is_active: 1, is_default: 0 },
  { id: 2, name: 'Shop', is_active: 1, is_default: 1 },
]
const after = [
  { id: 1, name: 'Store', role: 'shop', is_active: 1, is_default: 1, successor_branch_id: null },
  { id: 2, name: 'Shop', role: 'shop', is_active: 0, is_default: 0, successor_branch_id: 1 },
]

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

check('before the merge: both branches offered, Shop sells, transfers available', () => {
  assert.deepEqual(activeBranches(before).map((b) => b.id), [1, 2])
  assert.deepEqual(activeSellingBranches(before).map((b) => b.id), [2])
  assert.equal(selector.isSingleBranchMode(before), false)
  assert.equal(canTransferBetweenActiveBranches(before), true)
  assert.equal(selector.soleActiveBranch(before), null)
})

check('after the merge: only Store is offered, it sells by role, pickers collapse, transfers disappear', () => {
  assert.deepEqual(activeBranches(after).map((b) => b.id), [1])
  assert.deepEqual(activeSellingBranches(after).map((b) => b.id), [1], 'Store sells by its role; retired Shop never')
  assert.equal(selector.isSingleBranchMode(after), true)
  assert.equal(canTransferBetweenActiveBranches(after), false)
  assert.equal(selector.soleActiveBranch(after)?.id, 1)
  // The old FeeForm filter, kept here as the counterexample it was.
  assert.equal(after.filter((row) => (row.is_active as unknown) !== false).length, 2)
})

check('is_active spellings: 0/"0"/false/"false" are retired, missing/1/true are active', () => {
  for (const value of [0, '0', false, 'false']) assert.equal(selector.isActiveBranch({ id: 9, is_active: value as never }), false, String(value))
  for (const value of [1, '1', true, null, undefined]) assert.equal(selector.isActiveBranch({ id: 9, is_active: value as never }), true, String(value))
  assert.equal(selector.isActiveBranch(null), false)
})

check('effectiveBranchRow follows the successor for history and refuses a dead end', () => {
  assert.equal(selector.effectiveBranchRow(after, 2)?.id, 1)
  assert.equal(selector.effectiveBranchRow(after, 1)?.id, 1)
  assert.equal(selector.effectiveBranchRow(after, 99), null)
  const cycle = [
    { id: 3, name: 'A', is_active: 0, successor_branch_id: 4 },
    { id: 4, name: 'B', is_active: 0, successor_branch_id: 3 },
  ]
  assert.equal(selector.effectiveBranchRow(cycle, 3), null, 'a successor cycle ends, it never loops')
})

check('branch directory: name rule before any read; row role after; unknown ids refused once loaded', () => {
  resetBranchDirectory()
  assert.equal(branchIdCanSell(2, 'Shop'), true)
  assert.equal(branchIdCanSell(1, 'Store'), false, 'no read yet: the name rule')
  rememberBranchRows(before)
  assert.equal(branchIdCanSell(2, 'Shop'), true)
  assert.equal(branchIdCanSell(1, 'Warehouse'), false)
  rememberBranchRows(after)
  assert.equal(branchIdCanSell(1, 'Store'), true, 'the renamed Store sells by role')
  assert.equal(branchIdCanSell(2, 'Shop'), false, 'the retired Shop no longer takes sales')
  assert.equal(branchIdCanSell(7, 'Shop'), false, 'an id the read did not include is refused')
  rememberBranchRows([])
  assert.equal(branchIdCanSell(1, 'Store'), true, 'an empty read (cold offline mirror) keeps the last answer')
  resetBranchDirectory()
})

check('Worker refusal codes localize, and match the Worker constants', () => {
  const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
  const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
  const worker = readFileSync(new URL('../../cloudflare/src/lib/branchSuccession.ts', import.meta.url), 'utf8')
  const constant = (name: string) => new RegExp(`export const ${name} = '([^']+)'`).exec(worker)?.[1]
  assert.equal(constant('BRANCH_INACTIVE_CODE'), 'branch_inactive')
  assert.equal(constant('BRANCH_RETIRED_SET_CODE'), 'branch_retired_set_refused')
  assert.equal(constant('BRANCH_INACTIVE_ERROR'), en.branch_inactive_refresh, 'the pack sentence is the Worker sentence')
  const t = (key: string) => km[key]
  assert.equal(branchRuleErrorKey({ code: 'branch_inactive', error: 'Shop has moved into Store. Refresh the app and choose Store.' }), 'branch_inactive_refresh')
  assert.equal(localizeBranchRuleError({ code: 'branch_retired_set_refused', error: 'x' }, t), km.branch_retired_set_refused)
  assert.equal(localizeBranchRuleError({ error: en.branch_inactive_refresh }, t), km.branch_inactive_refresh, 'an older Worker without a code still localizes')
  for (const key of ['branch_inactive_refresh', 'branch_retired_set_refused']) {
    assert.ok(km[key] && km[key] !== en[key], `${key} must be translated`)
  }
})

console.log(`\n${passed} activeBranches checks passed`)

// Lane LE (branch cutover): the branch UI collapses to one branch from DATA.
//
// While two branches are active every surface offers both; once only one is
// active (the cutover end state) the same code hides the picker, the transfer
// entry point and the pair. Nothing here reads a flag: the rows decide.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { activeBranchRows, hasMultipleActiveBranches, hasTransferPair, soleActiveBranch } from '../src/utils/branchCollapse.ts'
import { branchCanBeTransferSource, branchCanTransferBetween } from '../src/utils/branchRoles.ts'

let failed = 0
function runTest(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}
const src = (...parts: string[]) => fs.readFileSync(new URL(`../src/${parts.join('/')}`, import.meta.url), 'utf8')

type Row = { id: number; name: string; role: string | null; is_active: number }
const LEGACY: Row[] = [
  { id: 1, name: 'Warehouse', role: null, is_active: 1 },
  { id: 2, name: 'Shop', role: null, is_active: 1 },
]
const BACKFILLED: Row[] = [
  { id: 1, name: 'Warehouse', role: 'warehouse', is_active: 1 },
  { id: 2, name: 'Shop', role: 'shop', is_active: 1 },
]
const FINAL: Row[] = [
  { id: 1, name: 'LC Store', role: 'shop', is_active: 1 },
  { id: 2, name: 'Old Shop', role: 'shop', is_active: 0 },
]

runTest('two active branches (legacy NULL roles or backfilled): both offered, a transfer pair exists', () => {
  for (const rows of [LEGACY, BACKFILLED]) {
    assert.equal(activeBranchRows(rows).length, 2)
    assert.equal(hasMultipleActiveBranches(rows), true)
    assert.equal(soleActiveBranch(rows), null)
    assert.equal(hasTransferPair(rows), true)
    assert.equal(branchCanTransferBetween(rows[0], rows[1]), true)
  }
})

runTest('one active branch (cutover end state): collapses to LC Store, no picker, no transfer pair', () => {
  assert.deepEqual(activeBranchRows(FINAL).map((row) => row.id), [1])
  assert.equal(hasMultipleActiveBranches(FINAL), false)
  assert.equal(soleActiveBranch(FINAL)?.name, 'LC Store')
  assert.equal(hasTransferPair(FINAL), false)
  // the retired row is still a shop-role branch, but is not a candidate for anything new
  assert.equal(hasTransferPair(FINAL.map((row) => ({ ...row, is_active: 1 }))), false, 'two shop-role branches are not a pair either')
})

runTest('the collapse follows the data both ways with no flag: reactivating a branch brings the picker back', () => {
  const rows = FINAL.map((row) => ({ ...row }))
  assert.equal(hasMultipleActiveBranches(rows), false)
  rows[1].is_active = 1
  assert.equal(hasMultipleActiveBranches(rows), true)
  assert.equal(soleActiveBranch(rows), null)
})

runTest('degenerate inputs never throw and never invent a branch', () => {
  for (const bad of [null, undefined, [], [null], 'x' as never]) {
    assert.equal(hasMultipleActiveBranches(bad as never), false)
    assert.equal(hasTransferPair(bad as never), false)
    assert.equal(soleActiveBranch(bad as never), null)
  }
  assert.deepEqual(activeBranchRows([{ name: 'No flag' }]).length, 1, 'a row that does not say is active, like COALESCE(is_active,1)')
})

runTest('a renamed pair keeps its transfer identity by role, not by name', () => {
  const renamed = [
    { id: 1, name: 'Main Store', role: 'warehouse', is_active: 1 },
    { id: 2, name: 'Front Counter', role: 'shop', is_active: 1 },
  ]
  assert.equal(hasTransferPair(renamed), true)
  assert.equal(branchCanBeTransferSource(renamed[0]), true)
  assert.equal(branchCanTransferBetween(renamed[0], renamed[1]), true)
  assert.equal(branchCanTransferBetween(renamed[0].name, renamed[1].name), false, 'names alone cannot see the role')
})

runTest('the transfer surfaces ask the collapse helpers, and the modal explains instead of offering', () => {
  const modal = src('components', 'branches', 'TransferModal.tsx')
  assert.match(modal, /hasTransferPair\(branches\)/)
  assert.match(modal, /soleActiveBranch\(branches\)/)
  assert.match(modal, /t\('transfer_single_branch'\)/)
  assert.doesNotMatch(modal, /branchRoleFromName/, 'no name-derived role in the modal')
  const inventory = src('components', 'inventory', 'Inventory.tsx')
  assert.match(inventory, /transferPairAvailable = useMemo\(\(\) => hasTransferPair\(branches\), \[branches\]\)/)
  assert.match(inventory, /onTransfer=\{canTransferStock && transferPairAvailable \? openTransfer : undefined\}/)
  const hub = src('components', 'branches', 'Branches.tsx')
  assert.match(hub, /role: branch\.role \?\? null/, 'the hub hands the transfer modal the role with each branch')
  for (const lang of ['en', 'km']) {
    const pack = JSON.parse(src('lang', `${lang}.json`)) as Record<string, string>
    assert.ok(pack.transfer_single_branch && pack.transfer_single_branch.length > 10, `${lang} pack has transfer_single_branch`)
  }
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
console.log('branchCollapse tests passed')

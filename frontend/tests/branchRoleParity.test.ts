// The two canonical branches are decided in two places -- once for the UI
// (src/utils/branchRoles.ts) and once for the Worker
// (cloudflare/src/lib/branchRoles.ts) -- because neither package imports the
// other. Two copies of a rule is exactly how a UI that greys the warehouse
// out ends up in front of a server that happily accepts it, so this test is
// the thing that keeps them one rule.
//
// It compares BEHAVIOUR across the cases that actually separate the two
// branch roles, not just the file bytes: a copy that drifted in whitespace
// is harmless, a copy that answers differently for '  WAREHOUSE ' is the
// bug. The byte comparison is kept as a second, cheaper signal.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  branchCanBeTransferDestination,
  branchCanBeTransferSource,
  branchCanSell,
  branchRoleFromName,
} from '../src/utils/branchRoles.ts'

let failed = 0
const runTest = (name: string, fn: () => void): void => {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// The Worker copy, evaluated for real. Both files are plain functions with
// no imports, so stripping the type annotations is enough to run one.
const workerSource = read('../../cloudflare/src/lib/branchRoles.ts')
const asRunnable = workerSource
  .replace(/export type BranchRole[^\n]*\n/, '')
  .replace(/: BranchRole/g, '')
  .replace(/\(name: unknown\)/g, '(name)')
  .replace(/: boolean/g, '')
  .replace(/export function/g, 'function')
const worker = new Function(`${asRunnable}
return { branchRoleFromName, branchCanSell, branchCanBeTransferSource, branchCanBeTransferDestination }`)() as {
  branchRoleFromName: (name: unknown) => string
  branchCanSell: (name: unknown) => boolean
  branchCanBeTransferSource: (name: unknown) => boolean
  branchCanBeTransferDestination: (name: unknown) => boolean
}

// Every shape a branch name arrives in: the two canonical names, the casing
// and padding a hand-typed one carries, a third branch a bigger deployment
// might have, and the empty/absent values a joined row can produce.
const NAMES: unknown[] = [
  'shop', 'Shop', 'SHOP', '  shop  ', 'shopfront', 'the shop',
  'warehouse', 'Warehouse', '  WAREHOUSE ', 'warehouse 2', 'Warehouses',
  'Depot', 'Kiosk', '', '   ', null, undefined, 0, 12,
]

runTest('both packages answer identically for every branch-name shape', () => {
  for (const name of NAMES) {
    const label = JSON.stringify(name)
    assert.equal(worker.branchRoleFromName(name), branchRoleFromName(name), `role ${label}`)
    assert.equal(worker.branchCanSell(name), branchCanSell(name), `canSell ${label}`)
    assert.equal(worker.branchCanBeTransferSource(name), branchCanBeTransferSource(name), `source ${label}`)
    assert.equal(worker.branchCanBeTransferDestination(name), branchCanBeTransferDestination(name), `destination ${label}`)
  }
})

runTest('the rule itself: only the warehouse is refused a sale', () => {
  assert.equal(branchRoleFromName('  WAREHOUSE '), 'warehouse')
  assert.equal(branchCanSell('  WAREHOUSE '), false)
  assert.equal(branchCanSell('Shop'), true)
  // An unrecognised name is not evidence of a stock-only branch: refusing it
  // would break every deployment that calls its shop something else.
  assert.equal(branchCanSell('Depot'), true)
  assert.equal(branchCanSell(null), true)
})

runTest('the rule itself: stock moves warehouse -> shop', () => {
  assert.equal(branchCanBeTransferSource('Warehouse'), true)
  assert.equal(branchCanBeTransferSource('Shop'), false, 'the shop never sends stock away')
  assert.equal(branchCanBeTransferDestination('Shop'), true)
  assert.equal(branchCanBeTransferDestination('Warehouse'), false, 'the warehouse never receives a transfer')
  assert.equal(branchCanBeTransferSource('Depot'), true)
  assert.equal(branchCanBeTransferDestination('Depot'), true)
})

runTest('nothing keys on is_default, or on any column other than the name', () => {
  // is_default only says which branch a blank picker preselects. Both copies
  // must be a pure function OF THE NAME -- no other field may appear.
  for (const source of [workerSource, read('../src/utils/branchRoles.ts')]) {
    const code = source.split('export type BranchRole')[1] || ''
    assert.doesNotMatch(code, /is_default/)
    assert.doesNotMatch(code, /\bkind\b/)
    assert.doesNotMatch(code, /\brole_id\b/)
    assert.doesNotMatch(code, /\bid\b/)
  }
})

runTest('the two copies are the same code, not merely the same behaviour today', () => {
  const body = (source: string): string => source.split('export type BranchRole')[1]
  assert.equal(
    body(workerSource),
    body(read('../src/utils/branchRoles.ts')),
    'keep the twin byte-identical below its header comment',
  )
})

runTest('the surfaces that enforce the rule reach it through this helper', () => {
  const transfer = read('../src/components/branches/TransferModal.tsx')
  assert.match(transfer, /from '\.\.\/\.\.\/utils\/branchRoles\.ts'/)
  assert.match(transfer, /disabled: !branchCanBeTransferSource\(branch\.name\)/)
  assert.match(transfer, /disabled: !branchCanBeTransferDestination\(branch\.name\)/)
  const sheetState = read('../src/components/pos/productSheetState.ts')
  assert.match(sheetState, /branchCanSell/)
  const guards = read('../../cloudflare/src/lib/branchRoleGuards.ts')
  assert.match(guards, /from '\.\/branchRoles'/)
})

if (failed) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('branchRoleParity tests passed')

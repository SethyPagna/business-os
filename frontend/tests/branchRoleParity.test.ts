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
  branchCanTransferBetween,
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
  .replace(/\(fromName: unknown, toName: unknown\)/g, '(fromName, toName)')
  .replace(/: boolean/g, '')
  .replace(/export function/g, 'function')
const worker = new Function(`${asRunnable}
return { branchRoleFromName, branchCanSell, branchCanBeTransferSource, branchCanBeTransferDestination, branchCanTransferBetween }`)() as {
  branchRoleFromName: (name: unknown) => string
  branchCanSell: (name: unknown) => boolean
  branchCanBeTransferSource: (name: unknown) => boolean
  branchCanBeTransferDestination: (name: unknown) => boolean
  branchCanTransferBetween: (fromName: unknown, toName: unknown) => boolean
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
  for (const fromName of NAMES) {
    for (const toName of NAMES) {
      assert.equal(
        worker.branchCanTransferBetween(fromName, toName),
        branchCanTransferBetween(fromName, toName),
        `pair ${JSON.stringify(fromName)} -> ${JSON.stringify(toName)}`,
      )
    }
  }
})

runTest('the rule itself: only the exact Shop may sell', () => {
  assert.equal(branchRoleFromName('  WAREHOUSE '), 'warehouse')
  assert.equal(branchCanSell('  WAREHOUSE '), false)
  assert.equal(branchCanSell('Shop'), true)
  assert.equal(branchCanSell('Depot'), false)
  assert.equal(branchCanSell(null), false)
})

runTest('the rule itself: stock moves both ways between opposite canonical roles', () => {
  assert.equal(branchCanBeTransferSource('Warehouse'), true)
  assert.equal(branchCanBeTransferSource('Shop'), true)
  assert.equal(branchCanBeTransferDestination('Shop'), true)
  assert.equal(branchCanBeTransferDestination('Warehouse'), true)
  assert.equal(branchCanTransferBetween('Warehouse', 'Shop'), true)
  assert.equal(branchCanTransferBetween('Shop', 'Warehouse'), true)
  assert.equal(branchCanTransferBetween('Shop', 'Shop'), false, 'same-role endpoints are not a transfer pair')
  assert.equal(branchCanTransferBetween('Warehouse', 'Warehouse'), false, 'same-role endpoints are not a transfer pair')
  assert.equal(branchCanBeTransferSource('Depot'), false)
  assert.equal(branchCanBeTransferDestination('Depot'), false)
  assert.equal(branchCanTransferBetween('Depot', 'Shop'), false)
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
  assert.match(transfer, /!branchCanTransferBetween\(selectedSourceBranch\?\.name, branch\.name\)/)
  assert.match(transfer, /requireCanonicalTransferDirection/)
  const inventory = read('../src/components/inventory/Inventory.tsx')
  assert.match(inventory, /branchCanTransferBetween\(sourceBranch\?\.name, candidate\?\.name\)/)
  assert.match(inventory, /disabled: !branchCanBeTransferSource\(branch\.name\)/)
  assert.match(inventory, /disabled: !branchCanTransferBetween\(selectedSource\?\.name, branch\.name\)/)
  assert.match(inventory, /if \(!branchCanTransferBetween\(fromBranch\.name, toBranch\.name\)\)/)
  assert.doesNotMatch(inventory, /runInventoryTransferIntent\('(?:undo|redo)'/, 'Inventory must never approximate provenance replay with a reverse transfer')
  assert.match(inventory, /transferHistoryRef.current.refreshServerItems\(\)/, 'forward transfers consume the server-owned history')
  const history = read('../src/utils/actionHistory.ts')
  assert.match(history, /payload\?\.applier === 'stock.transfer'[\s\S]*?executeTransferReplay/)
  assert.match(history, /operationId: String\(payload.operation_id \|\| ''\), generation: Number\(payload.generation\)/, 'replay keeps the exact server operation and generation')
  const inventoryModals = read('../src/components/inventory/InventoryStockModals.tsx')
  assert.match(inventoryModals, /destinationBranchOptions = transferDestinationBranchOptions \|\| branchWithPlaceholderOptions \|\| \[\]/)
  assert.match(inventoryModals, /options=\{destinationBranchOptions\}/)
  assert.match(inventoryModals, /onChange=\{changeTransferSource\}/)
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

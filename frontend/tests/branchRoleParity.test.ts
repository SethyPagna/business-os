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
import ts from 'typescript'
import {
  branchCanBeTransferDestination,
  branchCanBeTransferSource,
  branchCanTransferBetween,
  branchCanSell,
  branchRoleFromName,
  branchRole,
  branchIsActive,
  branchCanSellNow,
  branchActiveSuccessorPath,
  resolveActiveSuccessor,
  resolveSellingSuccessor,
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

// The Worker copy, evaluated for real. The file has no imports, so a plain
// TypeScript transpile is enough to run it -- and, unlike stripping the
// annotations by regex, it keeps working when a signature gains generics.
const workerSource = read('../../cloudflare/src/lib/branchRoles.ts')
const workerModule: { exports: Record<string, unknown> } = { exports: {} }
new Function('exports', 'module', ts.transpileModule(workerSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(workerModule.exports, workerModule)
const worker = workerModule.exports as {
  branchRole: (branch: unknown) => string
  branchRoleFromName: (name: unknown) => string
  branchCanSell: (name: unknown) => boolean
  branchCanBeTransferSource: (name: unknown) => boolean
  branchCanBeTransferDestination: (name: unknown) => boolean
  branchCanTransferBetween: (fromName: unknown, toName: unknown) => boolean
  branchIsActive: (branch: unknown) => boolean
  branchCanSellNow: (branch: unknown) => boolean
  branchActiveSuccessorPath: (rows: unknown[], source: unknown) => unknown[] | null
  resolveActiveSuccessor: (rows: unknown[], id: unknown) => unknown
  resolveSellingSuccessor: (rows: unknown[], id: unknown) => unknown
}

// Every shape a branch name arrives in: the two canonical names, the casing
// and padding a hand-typed one carries, a third branch a bigger deployment
// might have, and the empty/absent values a joined row can produce.
const NAMES: unknown[] = [
  'shop', 'Shop', 'SHOP', '  shop  ', 'shopfront', 'the shop',
  'warehouse', 'Warehouse', '  WAREHOUSE ', 'warehouse 2', 'Warehouses',
  'Depot', 'Kiosk', '', '   ', null, undefined, 0, 12,
]

runTest('explicit roles agree across packages and cannot borrow authority from the display name', () => {
  for (const [row, expected] of [
    [{ name: 'LC Store', role: 'shop' }, 'shop'],
    [{ name: 'Shop', role: 'warehouse' }, 'warehouse'],
    [{ name: 'Shop', role: 'invalid' }, 'other'],
    [{ name: 'Shop', role: '' }, 'other'],
    [{ name: 'Shop', role: ['shop'] }, 'other'],
    [{ name: 'Shop', role: { toString: () => 'shop' } }, 'other'],
    [{ name: 'Shop', role: true }, 'other'],
    [{ name: 'Shop', role: null }, 'shop'],
  ] as const) {
    assert.equal(branchRole(row), expected)
    assert.equal(worker.branchRole(row), expected)
    assert.equal(worker.branchCanSell(row), branchCanSell(row))
  }
})

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

runTest('operational roles do not derive authority from default flags or ids', () => {
  for (const source of [workerSource, read('../src/utils/branchRoles.ts')]) {
    const code = source.split('export type BranchRole')[1] || ''
    // The role section (everything before the successor walker) never reads
    // an id or a default flag. The successor walker below it is id-driven by
    // nature, so it is held to the opposite rule: it never reads a role or a
    // name -- which branch a retired id lands on is a data link, not a label.
    const [roleSection, successorSection] = code.split('type SuccessorRow')
    assert.ok(successorSection, 'the successor walker is part of the twin')
    assert.doesNotMatch(roleSection, /is_default/)
    assert.doesNotMatch(roleSection, /\bkind\b/)
    assert.doesNotMatch(roleSection, /\brole_id\b/)
    assert.doesNotMatch(roleSection, /\bid\b(?!\?: unknown)/)
    const walker = successorSection.split('// resolveActiveSuccessor for a SALE')[0]
    assert.doesNotMatch(walker, /\.role\b|\.name\b|'role'|'name'/)
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

// The cutover end state as the directory will hold it: id1 renamed "LC Store"
// (operational role shop), id2 retired as "Old Shop" with id1 as successor.
const LC_STORE = { id: 1, name: 'LC Store', role: 'shop', is_active: 1, successor_branch_id: null }
const OLD_SHOP = { id: 2, name: 'Old Shop', role: 'shop', is_active: 0, successor_branch_id: 1 }
const LEGACY_PAIR = [
  { id: 1, name: 'Warehouse', role: null, is_active: 1, successor_branch_id: null },
  { id: 2, name: 'Shop', role: null, is_active: 1, successor_branch_id: null },
]

runTest('after the rename the role, not the name, decides who sells -- in both packages', () => {
  for (const pkg of [{ canSellNow: branchCanSellNow, active: branchIsActive }, { canSellNow: worker.branchCanSellNow, active: worker.branchIsActive }]) {
    assert.equal(pkg.canSellNow(LC_STORE), true, 'LC Store (role shop) sells')
    assert.equal(pkg.canSellNow(OLD_SHOP), false, 'Old Shop keeps role shop but is retired')
    assert.equal(pkg.active(OLD_SHOP), false)
    assert.equal(pkg.canSellNow({ name: 'LC Store', role: null }), false, 'unbackfilled rename falls back to the name: fail closed')
    assert.equal(pkg.canSellNow({ name: 'Shop', role: null }), true, 'legacy Shop row unchanged')
    assert.equal(pkg.canSellNow({ name: 'Shop' }), true, 'an entry with no is_active field is active')
    assert.equal(pkg.canSellNow({ name: 'Warehouse', role: 'warehouse', is_active: 1 }), false)
    assert.equal(pkg.canSellNow('Shop' as never), false, 'a bare string is not a row')
    assert.equal(pkg.canSellNow(null), false)
  }
})

runTest('while both branches are active every successor answer is the identity', () => {
  for (const pkg of [{ resolve: resolveActiveSuccessor }, { resolve: worker.resolveActiveSuccessor }]) {
    assert.deepEqual(pkg.resolve(LEGACY_PAIR, 2), { effectBranchId: 2, addressedBranchId: 2, viaSuccessor: false })
    assert.deepEqual(pkg.resolve(LEGACY_PAIR, '1'), { effectBranchId: 1, addressedBranchId: 1, viaSuccessor: false })
  }
})

runTest('a retired branch resolves to its active successor; broken chains answer null', () => {
  const rows = [LC_STORE, OLD_SHOP]
  const cases: Array<[string, Array<Record<string, unknown>>, unknown, unknown]> = [
    ['retired -> successor', rows, 2, { effectBranchId: 1, addressedBranchId: 2, viaSuccessor: true }],
    ['active successor is itself', rows, 1, { effectBranchId: 1, addressedBranchId: 1, viaSuccessor: false }],
    ['two hops', [LC_STORE, { id: 2, is_active: 0, successor_branch_id: 3 }, { id: 3, is_active: 0, successor_branch_id: 1 }], 2, { effectBranchId: 1, addressedBranchId: 2, viaSuccessor: true }],
    ['unknown id', rows, 9, null],
    ['non-numeric id', rows, 'abc', null],
    ['zero id', rows, 0, null],
    ['retired without successor', [LC_STORE, { id: 2, is_active: 0, successor_branch_id: null }], 2, null],
    ['cycle', [{ id: 2, is_active: 0, successor_branch_id: 3 }, { id: 3, is_active: 0, successor_branch_id: 2 }], 2, null],
    ['successor inactive and last', [{ id: 2, is_active: 0, successor_branch_id: 1 }, { id: 1, is_active: 0, successor_branch_id: null }], 2, null],
    ['successor missing', [OLD_SHOP], 2, null],
    ['active row naming a successor', [{ id: 1, is_active: 1, successor_branch_id: 2 }, { id: 2, is_active: 1 }], 1, null],
    ['duplicate ids in the read', [LC_STORE, LC_STORE, OLD_SHOP], 2, null],
    ['nine hops', Array.from({ length: 10 }, (_, i) => ({ id: i + 1, is_active: i === 9 ? 1 : 0, successor_branch_id: i === 9 ? null : i + 2 })), 1, null],
  ]
  for (const [label, rowSet, id, expected] of cases) {
    assert.deepEqual(resolveActiveSuccessor(rowSet, id), expected, label)
    assert.deepEqual(worker.resolveActiveSuccessor(rowSet, id), expected, 'worker ' + label)
  }
  assert.deepEqual(branchActiveSuccessorPath(rows, OLD_SHOP)?.map((row) => row.id), [1])
  assert.deepEqual((worker.branchActiveSuccessorPath(rows, OLD_SHOP) as Array<{ id: number }>).map((row) => row.id), [1])
})

runTest('a selling successor must itself be able to sell', () => {
  assert.deepEqual(resolveSellingSuccessor([LC_STORE, OLD_SHOP], 2), { effectBranchId: 1, addressedBranchId: 2, viaSuccessor: true })
  assert.deepEqual(worker.resolveSellingSuccessor([LC_STORE, OLD_SHOP], 2), { effectBranchId: 1, addressedBranchId: 2, viaSuccessor: true })
  const warehouseSuccessor = [{ id: 1, name: 'Warehouse', role: 'warehouse', is_active: 1 }, OLD_SHOP]
  assert.equal(resolveSellingSuccessor(warehouseSuccessor, 2), null)
  assert.equal(worker.resolveSellingSuccessor(warehouseSuccessor, 2), null)
  assert.equal(resolveSellingSuccessor([{ id: 1, name: 'LC Store', role: null, is_active: 1 }, OLD_SHOP], 2), null, 'unbackfilled LC Store cannot sell')
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

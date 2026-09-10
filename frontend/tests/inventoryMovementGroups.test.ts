import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { todayStr } from '../src/utils/dateHelpers.ts'
import { buildMovementGroups, getMovementGroupPage, movementColorClass, movementColorClassForRecord, normalizeMovementTimestamp } from '../src/components/inventory/movementGroups.ts'
import { formatHistoryReference, historyGroupReference } from '../src/utils/historyRowModel.ts'

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('movement dates initialize once to Cambodia Today and exports inherit explicit Clear', () => {
  const source = readFileSync(new URL('../src/components/inventory/Inventory.tsx', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('Inventory.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const initializers: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name)
      && ['movementStartDate', 'movementEndDate'].includes(node.name.elements[0].getText(ast))) {
      initializers.push((node.initializer as ts.CallExpression).arguments[0].getText(ast))
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.deepEqual(initializers, ['todayIsoDate', 'todayIsoDate'])
  const RealDate = Date
  class FixedDate extends RealDate {
    constructor(value?: string | number) { super(value === undefined ? '2026-09-10T17:30:00Z' : value) }
  }
  try {
    globalThis.Date = FixedDate as DateConstructor
    const todayIsoDate = new Function('todayStr', `${source.match(/function todayIsoDate\(\): string \{[\s\S]*?\n\}/)![0].replace(': string', '')}; return todayIsoDate`)(todayStr)
    assert.deepEqual(initializers.map((initializer) => new Function('todayIsoDate', `return (${initializer})()`)(todayIsoDate)), ['2026-09-11', '2026-09-11'])
  } finally { globalThis.Date = RealDate }
  assert.match(source, /setMovementExportRange\(\{ startDate: movementStartDate, endDate: movementEndDate \}\)/)
  assert.match(source, /startDate: movementStartDate \|\| undefined,[\s\S]*?endDate: movementEndDate \|\| undefined/)
  const surface = readFileSync(new URL('../src/components/inventory/InventoryMovementsSurface.tsx', import.meta.url), 'utf8')
  assert.match(surface, /setMovementStartDate\(''\)[\s\S]*?setMovementEndDate\(''\)/)
})

await runTest('transfer in and out rows with same reference become one net-zero group', () => {
  const groups = buildMovementGroups([
    { id: 1, product_id: 10, product_name: 'Serum', movement_type: 'transfer_out', quantity: 4, total_cost_usd: 12, branch_name: 'A', user_name: 'Admin', reference_id: 'transfer_1', created_at: '2026-05-05 10:00:00' },
    { id: 2, product_id: 10, product_name: 'Serum', movement_type: 'transfer_in', quantity: 4, total_cost_usd: 12, branch_name: 'B', user_name: 'Admin', reference_id: 'transfer_1', created_at: '2026-05-05 10:00:01' },
  ])

  assert.equal(groups.length, 1)
  assert.equal(groups[0]?.recordCount, 2)
  assert.equal(groups[0]?.productCount, 1)
  assert.equal(groups[0]?.signedQuantity, 0)
  assert.equal(groups[0]?.signedCostUsd, 0)
  assert.equal(groups[0]?.totalQuantity, 4)
  assert.equal(groups[0]?.totalCostUsd, 12)
  assert.equal(groups[0]?.branchSummary, 'A +1')
})

await runTest('movement timestamp falls back to server created_at when imported date is invalid', () => {
  assert.equal(
    normalizeMovementTimestamp({ movement_date: 'Invalid Date', created_at: '2026-05-05 12:34:56' }),
    '2026-05-05 12:34:56',
  )
})

await runTest('expanded movement groups paginate without changing totals', () => {
  const group = buildMovementGroups(Array.from({ length: 25 }, (_, index) => ({
    id: index + 1,
    product_id: index + 1,
    product_name: `Product ${index + 1}`,
    movement_type: 'csv_import',
    quantity: 1,
    total_cost_usd: 2,
    reason: 'May import',
    reference_id: 'import_5491',
    created_at: '2026-05-05 10:00:00',
  })))[0]

  assert.ok(group)
  const page = getMovementGroupPage(group, { page: 2, pageSize: 10 })
  assert.equal(group?.recordCount, 25)
  assert.equal(group?.totalQuantity, 25)
  assert.equal(page.items.length, 10)
  assert.equal(page.page, 2)
  assert.equal(page.totalPages, 3)
})

// Semantic stock-movement color map (part 152) -- replaces the old
// 13-unrelated-colors scheme with: yellow for return-type movements
// regardless of direction, gray for a zero net delta, otherwise green
// for a net-up movement and red for a net-down one.
await runTest('movementColorClass: return-type movements are yellow regardless of direction', () => {
  const customerReturn = movementColorClass('return', 5) // nets stock up
  const supplierReturn = movementColorClass('supplier_return', -3) // nets stock down
  assert.match(customerReturn, /yellow/)
  assert.match(supplierReturn, /yellow/)
})

await runTest('movementColorClass: zero delta is neutral gray even for a non-return type', () => {
  const noOpSet = movementColorClass('set', 0)
  assert.match(noOpSet, /slate/)
  assert.doesNotMatch(noOpSet, /emerald|rose|yellow/)
})

await runTest('movementColorClass: positive delta is green, negative is red, for ordinary (non-return) types', () => {
  assert.match(movementColorClass('purchase', 8), /emerald/)
  assert.match(movementColorClass('sale', -8), /rose/)
  assert.match(movementColorClass('adjustment', 4), /emerald/)
  assert.match(movementColorClass('write_off', -4), /rose/)
})

await runTest('movementColorClassForRecord: derives the sign from movement_type + absolute quantity, same as a grouped row would', () => {
  // Backend always stores quantity as Math.abs(delta) on the raw record;
  // direction comes from movement_type alone (see routes/inventory.ts).
  const saleRecord = movementColorClassForRecord({ movement_type: 'sale', quantity: 3 })
  const purchaseRecord = movementColorClassForRecord({ movement_type: 'purchase', quantity: 3 })
  const noOpSetRecord = movementColorClassForRecord({ movement_type: 'set', quantity: 0 })
  assert.match(saleRecord, /rose/)
  assert.match(purchaseRecord, /emerald/)
  assert.match(noOpSetRecord, /slate/)
})

// N13: the drill header and the /movements CSV both name the record a GROUP
// belongs to, and both read it off group.items. That only works if the group
// build carries the server's resolved reference_kind / reference_label onto the
// items -- if it dropped them the way it flattens most fields onto the group,
// the export would read undefined and print an empty Receipt column with no
// error anywhere. So the fields are asserted through the real group build.
await runTest('grouped movements keep the resolved reference on their items, and the shared pick reads across the whole group', () => {
  const groups = buildMovementGroups([
    // Same action, one reference: an ambiguous 'return' row whose product is in
    // NEITHER record (left unlabelled server-side) leads the group, and the row
    // that names the receipt follows it.
    { id: 1, movement_type: 'return', reference_id: 77, product_id: 9, quantity: 1, created_at: '2026-09-01 19:31:00', reference_kind: null, reference_label: null },
    { id: 2, movement_type: 'return', reference_id: 77, product_id: 4, quantity: 2, created_at: '2026-09-01 19:31:00', reference_kind: 'return', reference_label: 'RET-20260902-0007' },
  ])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].items.length, 2)
  assert.equal(groups[0].items[1].reference_label, 'RET-20260902-0007', 'the group build must carry the resolved receipt onto the item')
  assert.deepEqual(
    historyGroupReference(groups[0].items),
    { kind: 'return', label: 'RET-20260902-0007' },
    'the shared pick must find the naming row anywhere in the group, not only first',
  )
  assert.equal(
    formatHistoryReference(historyGroupReference(groups[0].items), { sale: 'Sale', return: 'Return' }),
    'Return RET-20260902-0007',
  )
  // A group that names no record stays honest -- no invented receipt.
  const bare = buildMovementGroups([{ id: 3, movement_type: 'add', quantity: 5, created_at: '2026-09-01 08:00:00' }])
  assert.deepEqual(historyGroupReference(bare[0].items), { kind: null, label: '' })
})

if (failed > 0) {
  process.exitCode = 1
}

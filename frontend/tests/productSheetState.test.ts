// Behavioural cover for the product option sheet's derived state.
//
// Every pre-existing test that names ProductDetailSheet.tsx is a regex over
// its source text, so none of them could see that a flat product's Stock read
// 0 while its own branch_stock said 28. These evaluate the derivation instead,
// on data shapes where the old and new implementations disagree.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { branchAllowsSale, deriveProductSheetState, resolveSaleBranch } from '../src/components/pos/productSheetState.ts'
import { BRANCH_RULE_MESSAGE_KEYS, branchRuleMessageKey, localizeBranchRuleError } from '../src/api/branchRuleErrors.ts'
import { branchRoleFromName, branchCanSell, branchCanBeTransferSource, branchCanBeTransferDestination } from '../src/utils/branchRoles.ts'

let failed = 0

async function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const src = (...parts: string[]) => fs.readFileSync(new URL(`../src/${parts.join('/')}`, import.meta.url), 'utf8')

// The two canonical branches as the server ships them on every product row
// (cloudflare/src/routes/products.ts attachBranchStock: one entry per ACTIVE
// branch, 0-filled, with branch_name).
const branchStock = (shop: number, warehouse: number) => ([
  { branch_id: 2, branch_name: 'Shop', quantity: shop },
  { branch_id: 1, branch_name: 'Warehouse', quantity: warehouse },
])

await runTest('branch roles come from the name, never from is_default', () => {
  assert.equal(branchRoleFromName('Warehouse'), 'warehouse')
  assert.equal(branchRoleFromName('  shop '), 'shop')
  assert.equal(branchRoleFromName('Depot'), 'other')
  assert.equal(branchCanSell('Warehouse'), false)
  assert.equal(branchCanSell('Shop'), true)
  // An unrecognised branch is not evidence of a stock-only branch.
  assert.equal(branchCanSell('Kiosk'), true)
  assert.equal(branchCanBeTransferSource('Warehouse'), true)
  assert.equal(branchCanBeTransferSource('Shop'), false)
  assert.equal(branchCanBeTransferDestination('Shop'), true)
  assert.equal(branchCanBeTransferDestination('Warehouse'), false)
})

// SHAPE B from the investigation: a flat, NON-batch-tracked product with real
// branch stock. The old derivation resolved the row out of `variants`, which
// is EMPTY for a flat product, so effectiveVariant was null, displayedStock
// was a hard 0 and all three Add buttons were disabled -- the sale refused on
// a product the shop was holding 28 of.
await runTest('flat non-batch-tracked product reads its stock from branch_stock, not 0', () => {
  const product = { id: 51, name: 'Flat Product', unit: 'pcs', branch_stock: branchStock(28, 0), stock_quantity: 28 }
  const state = deriveProductSheetState({ product, variants: [], groupProduct: false })
  assert.equal(state.displayedStock, 28, 'flat product must read 28, not the old hard 0')
  assert.equal(state.effectiveVariant?.id, 51, 'a flat product resolves to itself')
  assert.equal(state.effectiveBranchId, '2', 'preselects the selling branch')
  assert.equal(state.batchReadyToSell, true)
})

// SHAPE A: the grouped sheet's branch pills. The quantity was computed and
// then thrown away -- the pill printed only the branch name, so the sheet
// showed exactly one number and N nameless branch counts.
await runTest('branch pills carry the resolved row quantity and the group total', () => {
  const rows = [
    { id: 61, name: 'Grouped', barcode: 'A1', branch_stock: branchStock(4, 1) },
    { id: 62, name: 'Grouped', barcode: 'A2', branch_stock: branchStock(8, 6) },
  ]
  const state = deriveProductSheetState({
    product: { id: 61, name: 'Grouped', branch_stock: branchStock(4, 1) },
    variants: rows,
    groupProduct: true,
    selectedVariantId: '62',
  })
  const shop = state.branchOptions.find((option) => option.name === 'Shop')
  const warehouse = state.branchOptions.find((option) => option.name === 'Warehouse')
  assert.equal(shop?.quantity, 8, 'the pill shows the RESOLVED row at that branch (row 62)')
  assert.equal(shop?.groupQuantity, 12, 'the group total stays available beside it')
  assert.equal(warehouse?.quantity, 6)
  assert.equal(warehouse?.groupQuantity, 7)
  assert.equal(state.branchSummary, 'Shop: 8 · Warehouse: 6')
})

// SHAPE D (the "RECON residue" shape): branch_stock says 28 at the shop and
// the lot ledger is empty. The old sheet mixed the two -- it took the number
// from the LOT ledger (0) while a branch line beside it printed 28.
await runTest('branch_stock is the on-hand ledger; an empty lot list does not zero it', () => {
  const product = { id: 71, name: 'Tracked', branch_stock: branchStock(28, 0) }
  const state = deriveProductSheetState({
    product,
    variants: [],
    groupProduct: false,
    trackedBatchProductIds: new Set([71]),
    batches: [],
  })
  assert.equal(state.displayedStock, 28, 'on-hand comes from branch_stock')
  assert.equal(state.isBatchTracked, true)
  assert.equal(state.stockWithoutReceivedDate, true, 'the contradiction is surfaced, not silently rendered as 0')
  // The sale still cannot proceed without a received date -- that gate is
  // about WHICH intake, not about how many units exist.
  assert.equal(state.batchReadyToSell, false)
})

await runTest('picking a received date narrows the number to that lot', () => {
  const product = { id: 72, name: 'Tracked', branch_stock: branchStock(28, 0) }
  const batches = [
    { id: 901, quantity: 5, received_date: '2026-01-02' },
    { id: 902, quantity: 23, received_date: '2026-02-02' },
  ]
  const state = deriveProductSheetState({
    product,
    groupProduct: false,
    trackedBatchProductIds: new Set([72]),
    batches,
    selectedBatchId: 901,
  })
  assert.equal(state.displayedStock, 5)
  assert.equal(state.batchReadyToSell, true)
  assert.equal(state.receivedDateTotal, 28)
  assert.equal(state.receivedDateOptions[0].id, 901, 'earliest received date first')
  assert.equal(state.stockWithoutReceivedDate, false)
})

// N11's second clause. The warehouse is VISIBLE with its quantity, greyed and
// unselectable for everyone including admins, and never preselected.
await runTest('warehouse is shown with its quantity but cannot be picked on a sale surface', () => {
  const product = { id: 81, name: 'Warehouse only', branch_stock: branchStock(0, 40) }
  const state = deriveProductSheetState({ product, groupProduct: false, intent: 'sell', activeBranchId: 1 })
  const warehouse = state.branchOptions.find((option) => option.role === 'warehouse')
  assert.ok(warehouse, 'the warehouse option is still rendered')
  assert.equal(warehouse?.quantity, 40, 'with its quantity')
  assert.equal(warehouse?.selectable, false)
  assert.equal(warehouse?.blockedMessageKey, 'pos_warehouse_not_sellable')
  assert.equal(state.warehouseDisabled, true)
  // activeBranchId asked for the warehouse; a sale surface must not open on it.
  assert.equal(state.effectiveBranchId, '2', 'preselection skips a branch no Add button would accept')
  assert.equal(state.displayedStock, 0, 'the shop holds none of it')
})

await runTest('a selected warehouse branch is refused on sale surfaces and honoured on stock surfaces', () => {
  const product = { id: 82, name: 'Both', branch_stock: branchStock(3, 40) }
  const selling = deriveProductSheetState({ product, intent: 'sell', selectedBranchId: '1' })
  assert.equal(selling.effectiveBranchId, '2')
  assert.equal(selling.displayedStock, 3)

  const stocking = deriveProductSheetState({ product, intent: 'stock', selectedBranchId: '1' })
  assert.equal(stocking.effectiveBranchId, '1')
  assert.equal(stocking.displayedStock, 40)
  assert.equal(stocking.warehouseDisabled, false)
  assert.equal(stocking.branchOptions.every((option) => option.selectable), true)
})

await runTest('a product with no branch_stock at all falls back to the cross-branch number', () => {
  const product = { id: 91, name: 'No branch rows', stock_quantity: 7 }
  const state = deriveProductSheetState({ product, getDisplayStock: (row) => Number(row?.stock_quantity || 0) })
  assert.equal(state.branchOptions.length, 0)
  assert.equal(state.effectiveBranchId, null)
  assert.equal(state.displayedStock, 7)
  assert.equal(state.branchSummary, '')
})

await runTest('grouped rows narrow to the branch that carries them', () => {
  const rows = [
    { id: 101, name: 'G', barcode: 'X', branch_stock: [{ branch_id: 2, branch_name: 'Shop', quantity: 5 }] },
    { id: 102, name: 'G', barcode: 'Y', branch_stock: [{ branch_id: 1, branch_name: 'Warehouse', quantity: 9 }] },
  ]
  const state = deriveProductSheetState({ product: rows[0], variants: rows, groupProduct: true, intent: 'sell' })
  assert.deepEqual(state.candidatePool.map((row) => row.id), [101], 'only the shop row is offered at the shop')
  assert.equal(state.displayedStock, 5)
  const warehouse = state.branchOptions.find((option) => option.role === 'warehouse')
  assert.equal(warehouse?.quantity, 9, 'the warehouse pill still reports what it holds')
  assert.equal(warehouse?.selectable, false)
})

await runTest('the sheet reads its derived state from the pure module, not from inline expressions', () => {
  const sheet = src('components', 'pos', 'ProductDetailSheet.tsx')
  assert.match(sheet, /from '\.\/productSheetState\.ts'/, 'ProductDetailSheet must consume the extracted module')
  assert.doesNotMatch(sheet, /const candidatePool = candidateVariants\.length/, 'the inline duplicate derivation must be gone')
  assert.match(sheet, /t\('batches'\)/, 'the received-date step must read the language pack, not a posCopy literal')
  assert.doesNotMatch(sheet, /Pick a lot \/ batch/, 'the retired "Pick a lot / batch" wording must be gone')
})

// Sibling-surface parity: every picker listed in the owner ask mounts the one
// shared sheet rather than a private option popup of its own.
await runTest('every product picker mounts the shared option sheet', () => {
  // The POS mounts ProductDetailSheet itself -- it IS the sheet. Every other
  // surface reaches that same component through the shared adapter.
  const sites = [
    ['components', 'products', 'forms', 'StockAdjustModal.tsx'],
    ['components', 'inventory', 'FastStockInModal.tsx'],
    ['components', 'branches', 'TransferModal.tsx'],
    ['components', 'sales', 'SaleDetailModal.tsx'],
    ['components', 'returns', 'NewReturnModal.tsx'],
    ['components', 'products', 'CreateProductsSessionModal.tsx'],
  ]
  for (const site of sites) {
    const text = src(...site)
    assert.match(text, /ProductOptionSheet/, `${site.join('/')} must open the shared option sheet`)
  }
  assert.match(src('components', 'pos', 'POS.tsx'), /ProductDetailSheet/)
  // SaleDetailModal has TWO sale-side pickers, and this test used to pass on
  // either one: add-items-to-a-sale kept its own option grid and its own batch
  // list while only Replace reached the shared sheet, which is exactly the
  // "same product, different choices depending on the button" this work exists
  // to end. Both mounts, or neither counts.
  const saleDetail = src('components', 'sales', 'SaleDetailModal.tsx')
  assert.equal(
    (saleDetail.match(/<ProductOptionSheet/g) || []).length,
    2,
    'both the add-items picker and the Replace picker must open the shared sheet',
  )
  assert.match(saleDetail, /onClick=\{\(\) => setAddSheetGroup\(candidate\)\}/, 'a result row opens the sheet, never the line form directly')
  assert.doesNotMatch(saleDetail, /onClick=\{\(\) => setAddPicking\(candidate\)\}/, 'the old straight-to-the-line-form path must be gone')
  // What is left behind is the line FORM (quantity, unit price), which is not
  // a picker -- and it must be seeded with what the sheet already resolved.
  assert.match(saleDetail, /presetBatchId=\{addPicking\.batchId\}/)
  assert.match(saleDetail, /branchId=\{addPicking\.branchId \?\? sale\.branch_id \?\? null\}/)
  // ...and the adapter stays an adapter, not a second implementation.
  assert.match(
    src('components', 'shared', 'ProductOptionSheet.tsx'),
    /from '\.\.\/pos\/ProductDetailSheet\.tsx'/,
    'the shared sheet must BE the POS sheet, not a copy of it',
  )
})

await runTest('the Replace mount forwards its branch and does not offer a date the write discards', () => {
  const saleDetail = src('components', 'sales', 'SaleDetailModal.tsx')
  // sales.ts's line_replaced branch reads replacement.branch_id; without it
  // the swap fell back to the sale's own branch, which is not necessarily the
  // branch whose quantity the operator was reading.
  assert.match(saleDetail, /stageReplacement\(picked as unknown as AddProductCandidate, selection\.branchId\)/)
  assert.match(saleDetail, /branch_id: replacementBranchId/)
  // ...and that same write plans the line with batchId null and draws it by
  // FIFO, so a received date chosen here would be silently ignored.
  assert.match(saleDetail, /hideReceivedDates/, 'the step the write cannot honour must not be offered')
})

// ---------------------------------------------------------------------------
// Which branch a POS cart line resolves to.
//
// POS answered this as `primaryBranchFilterId ?? pickBestBranchId(product)`,
// and neither half knew the warehouse does not sell. Every case below is one
// the old resolution and this one give DIFFERENT answers to.
// ---------------------------------------------------------------------------

// The resolution this replaced, kept here as the positive control: a test
// that only asserts the new answer cannot tell a fix from a fixture that
// happened to agree with the old code. Every case below is one the two
// disagree on, checked as a disagreement rather than described as one.
function legacyPosBranchId(
  product: { branch_stock?: Array<{ branch_id?: number; branch_name?: string; quantity?: number }> },
  primaryBranchFilterId: number | null,
  defaultBranchId: number | null,
): number | null {
  if (primaryBranchFilterId != null) return primaryBranchFilterId
  let bestBranchId: number | null = null
  let bestQuantity = 0
  for (const entry of product?.branch_stock || []) {
    const branchId = Number(entry.branch_id)
    const qty = Number(entry.quantity || 0)
    if (!Number.isFinite(branchId) || qty <= 0) continue
    if (defaultBranchId != null && branchId === defaultBranchId) return branchId
    if (qty > bestQuantity) { bestBranchId = branchId; bestQuantity = qty }
  }
  return bestBranchId || defaultBranchId || null
}

await runTest('POSITIVE CONTROL: the old resolution books every one of these at the warehouse', () => {
  const warehouseOnly = { branch_stock: branchStock(0, 12) }
  const mostlyWarehouse = { branch_stock: branchStock(1, 90) }
  assert.equal(legacyPosBranchId(warehouseOnly, null, null), 1, 'old: warehouse-only stock resolved to the warehouse')
  assert.equal(legacyPosBranchId(mostlyWarehouse, null, null), 1, 'old: the warehouse won on quantity')
  assert.equal(legacyPosBranchId(mostlyWarehouse, null, 1), 1, 'old: is_default handed it the warehouse outright')
  assert.equal(legacyPosBranchId(mostlyWarehouse, 1, null), 1, 'old: the branch filter was taken verbatim')
  // ...and every one of those is a branch the Worker refuses a sale line at.
  assert.equal(branchCanSell('Warehouse'), false)
})

await runTest('a product held only at the warehouse blocks the add instead of booking it there', () => {
  const product = { id: 61, name: 'Waiting on a transfer', branch_stock: branchStock(0, 12), stock_quantity: 12 }
  const decision = resolveSaleBranch(product, { defaultBranchId: null })
  // The old highest-stock loop returned branch 1 here, and the checkout then
  // refused the sale with a 400 the cashier could do nothing about.
  assert.equal(decision.branchId, null)
  assert.equal(decision.blocked, true, 'there IS stock, just not where a sale may be rung')
})

await runTest('filtering the grid to the warehouse blocks the add', () => {
  const product = { id: 62, name: 'Both branches', branch_stock: branchStock(4, 9), stock_quantity: 13 }
  // primaryBranchFilterId used to be taken verbatim.
  assert.deepEqual(resolveSaleBranch(product, { activeBranchFilterId: 1 }), { branchId: null, blocked: true })
  assert.deepEqual(resolveSaleBranch(product, { activeBranchFilterId: 2 }), { branchId: 2, blocked: false })
})

await runTest('the warehouse never wins on quantity, nor by being the default branch', () => {
  const product = { id: 63, name: 'Mostly in the warehouse', branch_stock: branchStock(1, 90), stock_quantity: 91 }
  // Old loop: 90 > 1, so the warehouse won outright.
  assert.deepEqual(resolveSaleBranch(product, {}), { branchId: 2, blocked: false })
  // Old loop: is_default short-circuited before any quantity was compared.
  assert.deepEqual(resolveSaleBranch(product, { defaultBranchId: 1 }), { branchId: 2, blocked: false })
  assert.deepEqual(resolveSaleBranch(product, { defaultBranchId: 2 }), { branchId: 2, blocked: false })
})

await runTest('a branch the payload does not name is left alone', () => {
  const product = { id: 64, name: 'Third branch', branch_stock: [{ branch_id: 7, branch_name: 'Kiosk', quantity: 3 }] }
  assert.equal(branchAllowsSale(product, 7), true, 'an unrecognised name is not evidence of a stock-only branch')
  assert.equal(branchAllowsSale(product, 999), true, 'an id the payload never mentions is not blocked')
  assert.deepEqual(resolveSaleBranch(product, { activeBranchFilterId: 7 }), { branchId: 7, blocked: false })
  // Nothing anywhere is not the same as stock in the wrong place.
  const empty = { id: 65, name: 'Nothing anywhere', branch_stock: branchStock(0, 0) }
  assert.deepEqual(resolveSaleBranch(empty, {}), { branchId: null, blocked: false })
})

// ---------------------------------------------------------------------------
// A host whose write cannot carry a received date.
// ---------------------------------------------------------------------------

await runTest('hiding the received-date step un-gates the pick instead of blocking it forever', () => {
  const product = { id: 71, name: 'Tracked', branch_stock: branchStock(6, 0), stock_quantity: 6 }
  const tracked = new Set([71])
  const asked = deriveProductSheetState({ product, variants: [], groupProduct: false, trackedBatchProductIds: tracked, batches: [] })
  assert.equal(asked.batchSelectionRequired, true)
  assert.equal(asked.batchReadyToSell, false, 'normally the pick waits for a received date')
  const hidden = deriveProductSheetState({
    product, variants: [], groupProduct: false, trackedBatchProductIds: tracked, batches: [], receivedDateStepHidden: true,
  })
  assert.equal(hidden.batchSelectionRequired, false, 'a hidden step is an ABSENT step, not an unanswered one')
  assert.equal(hidden.batchReadyToSell, true)
  assert.equal(hidden.stockWithoutReceivedDate, false)
  assert.equal(hidden.displayedStock, 6, 'on-hand still comes from branch_stock')
})

// ---------------------------------------------------------------------------
// Receiving stock is not selling it.
//
// The pick button was gated on `!inStock || !batchReadyToSell` for every
// host, so the surfaces whose whole purpose is to RAISE a quantity -- fast
// stock-in, "Have already" in the create-products session, the add/set modes
// of the stock adjuster -- refused the product they were opened to receive:
// a product at 0 is the normal state of a delivery arriving, and the sheet
// answered "Out of stock" with the button dead. Reproduced against the real
// component (react-dom/server) at branch_stock (0, 0): the only action button
// rendered was "out_of_stock", disabled.
//
// The two intents must DISAGREE on this one shape, which is why both are
// asserted from one fixture: sell refuses it, stock allows it.
// ---------------------------------------------------------------------------

await runTest('a stock-side pick is allowed at 0 on hand, while the same shape refuses a sale', () => {
  const product = { id: 91, name: 'Arriving', unit: 'pcs', branch_stock: branchStock(0, 0), stock_quantity: 0 }

  const receiving = deriveProductSheetState({ product, variants: [], groupProduct: false, intent: 'stock' })
  assert.equal(receiving.displayedStock, 0)
  assert.equal(receiving.pickAllowed, true, 'stock-in targets products at 0 by definition')
  assert.equal(receiving.pickBlockedReason, null)

  const selling = deriveProductSheetState({ product, variants: [], groupProduct: false, intent: 'sell' })
  assert.equal(selling.pickAllowed, false, 'a sale of nothing stays refused')
  assert.equal(selling.pickBlockedReason, 'out_of_stock', 'and keeps the greyed-out reason the button prints')

  assert.notEqual(receiving.pickAllowed, selling.pickAllowed, 'the two intents must disagree on this shape')
})

await runTest('the stock-side pick still waits for a received date when the host asks one', () => {
  // TransferModal is the one stock-side host that passes trackedBatchProductIds:
  // a transfer moves a specific intake, so the lot question is real there. It
  // is the IN-STOCK question that does not apply to a stock write.
  const product = { id: 92, name: 'Tracked', unit: 'pcs', branch_stock: branchStock(0, 4), stock_quantity: 4 }
  const tracked = new Set([92])
  const unanswered = deriveProductSheetState({
    product, variants: [], groupProduct: false, intent: 'stock', trackedBatchProductIds: tracked, batches: [],
  })
  assert.equal(unanswered.pickAllowed, false)
  assert.equal(unanswered.pickBlockedReason, 'received_date', 'the received-date gate is the only one a stock write keeps')

  const answered = deriveProductSheetState({
    product,
    variants: [],
    groupProduct: false,
    intent: 'stock',
    trackedBatchProductIds: tracked,
    batches: [{ id: 5, quantity: 4, received_date: '2026-09-01' }],
    selectedBatchId: 5,
  })
  assert.equal(answered.pickAllowed, true)

  // A host that asks no lot question -- every other stock mount -- is never gated.
  const untracked = deriveProductSheetState({ product, variants: [], groupProduct: false, intent: 'stock' })
  assert.equal(untracked.pickAllowed, true)
})

await runTest('the pick button reads the derived gate rather than re-deriving in-stock', () => {
  const sheet = src('components', 'pos', 'ProductDetailSheet.tsx')
  const body = sheet.split('const renderPickButton =')[1]?.split('\n\n')[0] ?? ''
  assert.ok(body, 'renderPickButton must still exist')
  assert.ok(body.includes('disabled={!pickAllowed}'), 'the one gate is the derived one')
  assert.ok(
    !body.includes('inStock'),
    'gating the pick on in-stock here is what refused every receiving surface',
  )
  assert.match(sheet, /renderPickButton\(effectiveVariant\)/)
  assert.match(sheet, /renderPickButton\(product\)/)
})

// ---------------------------------------------------------------------------
// The Worker's two refusals, shown from the packs.
// ---------------------------------------------------------------------------

const enPack = JSON.parse(src('lang', 'en.json')) as Record<string, string>
const kmPack = JSON.parse(src('lang', 'km.json')) as Record<string, string>

await runTest('a Worker branch-rule refusal is translated, and nothing else is touched', () => {
  const t = (key: string) => kmPack[key]
  assert.equal(branchRuleMessageKey('Only allow Shop sale. Please transfer to Shop first.'), 'pos_warehouse_not_sellable')
  assert.equal(branchRuleMessageKey('Transfers move stock from Warehouse to Shop.'), 'transfer_source_warehouse_only')
  // The paths that show these wrap the sentence to different depths.
  assert.equal(branchRuleMessageKey('Error: Only allow Shop sale. Please transfer to Shop first.'), 'pos_warehouse_not_sellable')
  assert.equal(branchRuleMessageKey('Insufficient stock in source branch'), null)
  assert.equal(branchRuleMessageKey(''), null)
  assert.equal(branchRuleMessageKey(null), null)
  assert.equal(
    localizeBranchRuleError('Only allow Shop sale. Please transfer to Shop first.', t),
    kmPack.pos_warehouse_not_sellable,
    'a Khmer session must read the Khmer sentence, not the English the server sent',
  )
  assert.equal(localizeBranchRuleError('Transfers move stock from Warehouse to Shop.', t), kmPack.transfer_source_warehouse_only)
  assert.equal(localizeBranchRuleError('Something else entirely', t), 'Something else entirely')
})

await runTest('the mapped sentences are the exact English of the pack keys', () => {
  // If either side drifts, the mapping stops matching and the operator is
  // shown an English sentence in a Khmer session -- silently.
  assert.equal(enPack.pos_warehouse_not_sellable, 'Only allow Shop sale. Please transfer to Shop first.')
  assert.equal(enPack.transfer_source_warehouse_only, 'Transfers move stock from Warehouse to Shop.')
  for (const [english, key] of BRANCH_RULE_MESSAGE_KEYS) {
    assert.equal(enPack[key], english, `${key} must be the sentence the Worker sends`)
    assert.ok(kmPack[key], `${key} must exist in the Khmer pack`)
    assert.notEqual(kmPack[key], enPack[key], `${key} must be translated, not copied`)
  }
})

await runTest('every error path named in the ask maps the refusal to the pack', () => {
  const sites = [
    ['components', 'pos', 'POS.tsx'],
    ['components', 'sales', 'SaleDetailModal.tsx'],
    ['components', 'returns', 'NewReturnModal.tsx'],
    ['components', 'branches', 'TransferModal.tsx'],
    ['components', 'inventory', 'Inventory.tsx'],
  ]
  for (const site of sites) {
    assert.match(
      src(...site),
      /localizeBranchRuleError\(/,
      `${site.join('/')} must show the Worker's branch-rule refusal from the packs`,
    )
  }
})

// ---------------------------------------------------------------------------
// The pack itself: no zombie keys, and the relabelled step's empty state has
// one.
// ---------------------------------------------------------------------------

await runTest('the received-date empty state is a pack key, and label_prices is gone', () => {
  assert.equal(enPack.label_prices, undefined, 'a key nothing references must not sit in the pack')
  assert.equal(kmPack.label_prices, undefined)
  assert.ok(enPack.received_dates_none)
  assert.ok(kmPack.received_dates_none)
  assert.notEqual(kmPack.received_dates_none, enPack.received_dates_none)
  const sheet = src('components', 'pos', 'ProductDetailSheet.tsx')
  assert.match(sheet, /t\('received_dates_none'\)/)
  assert.doesNotMatch(sheet, /posCopy\('No lots available at this branch/, 'the bilingual literal must be retired (the prose above it may still quote the old wording)')
})

await runTest('the non-POS mounts get a language-aware posCopy, not an English identity', () => {
  const adapter = src('components', 'shared', 'ProductOptionSheet.tsx')
  assert.doesNotMatch(
    adapter,
    /posCopy=\{\(english: string\) => english\}/,
    'stubbing posCopy to identity shipped English into a Khmer session on every non-POS surface',
  )
  assert.match(adapter, /=== 'km'/, 'the adapter must resolve the pair from the active language')
})

// ---------------------------------------------------------------------------
// Picked is not dismissed.
// ---------------------------------------------------------------------------

await runTest('confirming a pick does not fire the host discard path', () => {
  const sheet = src('components', 'pos', 'ProductDetailSheet.tsx')
  const body = sheet.split('const confirmPick =')[1]?.split('\n  }')[0] ?? ''
  assert.ok(body.includes('onPick?.('), 'confirmPick must still hand the choice back')
  assert.ok(
    !body.includes('onClose()'),
    'confirmPick calling onClose ran the host DISCARD path on top of its accept path -- '
    + 'CreateProductsSessionModal nulls the picked product in its onClose, so the line form never opened',
  )
  // ...which only works because every host closes its own sheet on the pick.
  const closesItself: Array<[string[], RegExp]> = [
    [['components', 'products', 'forms', 'StockAdjustModal.tsx'], /onPick=\{\(product, selection\) => \{\s*\n\s*setPicking\(null\)/],
    [['components', 'branches', 'TransferModal.tsx'], /setPicking\(null\)\s*\n\s*\}\}/],
    [['components', 'returns', 'NewReturnModal.tsx'], /setReplacementPicking\(null\)\s*\n\s*\}\}/],
    [['components', 'inventory', 'FastStockInModal.tsx'], /closeCandidateOptions\(\)/],
  ]
  for (const [site, pattern] of closesItself) {
    assert.match(src(...site), pattern, `${site.join('/')} must close the sheet from inside its own onPick`)
  }
  // CreateProductsSessionModal closes it by gate rather than by setter: the
  // sheet is mounted only while no product is picked.
  assert.match(
    src('components', 'products', 'CreateProductsSessionModal.tsx'),
    /\{selectedGroup && !selectedProduct \? \(/,
    'the sheet unmounts the moment the pick sets a product, and the line form takes its place',
  )
})

await runTest('a single-choice group opens on the row it offers, not on the family root', () => {
  for (const site of [
    ['components', 'inventory', 'FastStockInModal.tsx'],
    ['components', 'products', 'CreateProductsSessionModal.tsx'],
  ] as string[][]) {
    const text = src(...site)
    assert.doesNotMatch(
      text,
      /product=\{\{\s*\n?\s*\.\.\.\(selectedGroup\.leadProduct \|\| selectedGroup\.items\[0\]\)/,
      `${site.join('/')} must take the lead from the offered rows, not from group.leadProduct`,
    )
    assert.match(text, /\[0\] \|\| selectedGroup\.leadProduct/, `${site.join('/')} must fall back only after choices[0]`)
  }
})

if (failed) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('productSheetState tests passed')

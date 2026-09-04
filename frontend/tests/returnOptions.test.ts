import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  STOCK_ACTION_OPTIONS, normalizeStockAction, stockActionOption,
  returnLineNeedsLotPick, formatBatchDate, describeBatchOption,
} from '../src/components/returns/helpers/returnOptions.ts'
import {
  normalizeReturnReasonList,
  replaceReturnReasonPreset,
  resolveReturnReasonPresets,
  type ReturnReasonPresets,
} from '../src/components/returns/helpers/returnReasonPresets.ts'

let failed = 0

type TestCallback = () => void

function runTest(name: string, fn: TestCallback): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

runTest('K2: normalizeStockAction mirrors the backend kernel exactly', () => {
  assert.equal(normalizeStockAction({ stock_action: 'damaged', return_to_stock: true }), 'damaged')
  assert.equal(normalizeStockAction({ stock_action: 'NONE' }), 'none')
  // the pre-0074 wire shape keeps its exact meaning
  assert.equal(normalizeStockAction({}), 'restock')
  assert.equal(normalizeStockAction({ return_to_stock: false }), 'none')
  assert.equal(normalizeStockAction({ stock_action: 'garbage', return_to_stock: false }), 'none')
})

runTest('K2: the chooser offers exactly the three stock actions', () => {
  assert.deepEqual(STOCK_ACTION_OPTIONS.map((option) => option.value), ['restock', 'damaged', 'none'])
  assert.equal(stockActionOption('damaged').icon, '🟠')
  // unknown input falls back to the no-stock-change option, never a crash
  assert.equal(stockActionOption('mystery' as never).value, 'none')
})

runTest('a returned line needs a lot pick exactly when nothing else can name one', () => {
  // the sale said which lot -> nothing to ask
  assert.equal(returnLineNeedsLotPick({ originalBatchId: 7, pickedBatchId: null, lotOptionCount: 3 }), false)
  // the sale cannot say, but lots exist -> must be answered
  assert.equal(returnLineNeedsLotPick({ originalBatchId: null, pickedBatchId: null, lotOptionCount: 3 }), true)
  // ...and answering it settles the line
  assert.equal(returnLineNeedsLotPick({ originalBatchId: null, pickedBatchId: 12, lotOptionCount: 3 }), false)
  // a product that has never had a lot has nothing to pick: the branch count
  // is the only truthful destination, so this must NOT block a return
  assert.equal(returnLineNeedsLotPick({ originalBatchId: null, pickedBatchId: null, lotOptionCount: 0 }), false)
  // a zero/blank id is not an answer
  assert.equal(returnLineNeedsLotPick({ originalBatchId: 0, pickedBatchId: '', lotOptionCount: 2 }), true)
})

runTest('K2: batch option lines read dd/mm/yyyy and never carry cost', () => {
  // 15 and 31 are both past the 12th, so these pin the ORDER rather than
  // reading the same under either convention.
  assert.equal(formatBatchDate('2026-09-15'), '15/09/2026')
  assert.equal(formatBatchDate(''), '')
  const label = describeBatchOption({ lot_code: '08152026', expiry_date: '2027-01-31', quantity: 6, batch_number: 2 })
  // The lot code stays MMDDYYYY verbatim while the expiry date beside it is
  // day-first: one line carrying both halves of the display/identifier split.
  assert.equal(label, '08152026 · exp 31/01/2027 · 6 in stock')
  assert.equal(describeBatchOption({ lot_code: null, expiry_date: null, quantity: 3, batch_number: 4 }), '#4 · 3 in stock')
  assert.doesNotMatch(label, /cost/i)
})

runTest('return reason presets dedupe fallback and collision merges without parallel values', () => {
  const fallback: ReturnReasonPresets = { customer: ['Damaged', 'Wrong item'], supplier: ['Wrong shipment'] }
  assert.deepEqual(normalizeReturnReasonList([' Damaged ', 'damaged', { label: 'Wrong   item' }, '']), ['Damaged', 'Wrong item'])
  assert.deepEqual(resolveReturnReasonPresets({ configured: false, presets: { customer: ['stale'] } }, fallback), fallback)
  assert.deepEqual(resolveReturnReasonPresets({ configured: true, presets: { customer: [], supplier: [] } }, fallback), { customer: [], supplier: [] })
  assert.deepEqual(
    replaceReturnReasonPreset({ customer: ['Damaged', 'Wrong item'], supplier: [] }, 'customer', 'Damaged', 'Wrong item').customer,
    ['Wrong item'],
  )
})

const newReturnSource = readFileSync(new URL('../src/components/returns/NewReturnModal.tsx', import.meta.url), 'utf8')
const editReturnSource = readFileSync(new URL('../src/components/returns/EditReturnModal.tsx', import.meta.url), 'utf8')
const detailSource = readFileSync(new URL('../src/components/returns/ReturnDetailModal.tsx', import.meta.url), 'utf8')
const backendKernelSource = readFileSync(new URL('../../cloudflare/src/lib/returnsStock.ts', import.meta.url), 'utf8')
const returnReasonManagerSource = readFileSync(new URL('../src/components/returns/ReturnReasonManagerModal.tsx', import.meta.url), 'utf8')
const supplierReturnSource = readFileSync(new URL('../src/components/returns/NewSupplierReturnModal.tsx', import.meta.url), 'utf8')
const expenseLabelManagerSource = readFileSync(new URL('../src/components/fees/ExpenseLabelManagerModal.tsx', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../src/components/utils-settings/Settings.tsx', import.meta.url), 'utf8')
const inventorySource = readFileSync(new URL('../src/components/inventory/Inventory.tsx', import.meta.url), 'utf8')

runTest('reference managers preview exact impact and keep custom return entry available', () => {
  assert.match(returnReasonManagerSource, /getReturnReasonImpact/)
  assert.match(returnReasonManagerSource, /scope: replaceLinked \? 'linked' : 'presets_only'/)
  assert.match(newReturnSource, /useReturnReasonPresets\(t\)/)
  assert.match(editReturnSource, /useReturnReasonPresets\(t\)/)
  assert.match(supplierReturnSource, /list="supplier-return-reason-presets"/)
  assert.match(supplierReturnSource, /Choose a saved reason or type your own/)
  assert.match(expenseLabelManagerSource, /getFeeLabelImpact/)
  assert.match(expenseLabelManagerSource, /replaceFeeLabel/)
  assert.match(settingsSource, /getPaymentMethodImpact/)
  assert.match(settingsSource, /replacePaymentMethod/)
  assert.match(inventorySource, /getInventoryReasonImpact/)
  assert.match(inventorySource, /replaceInventoryReason/)
})

// ── A return is a return; a replacement is a sale ────────────────────────
// The two things the user could see on screen and named as confusing: a
// return asking who pays a price difference, and a lot chooser offering "any
// stock". Both are gone, and this pins them gone -- reintroducing either
// affordance in any of these three files fails here, not in production.
runTest('the price-difference settlement is gone from the returns surface', () => {
  for (const [name, source] of [
    ['NewReturnModal', newReturnSource],
    ['returnOptions', readFileSync(new URL('../src/components/returns/helpers/returnOptions.ts', import.meta.url), 'utf8')],
    ['returnsStock (backend kernel)', backendKernelSource],
  ] as const) {
    assert.doesNotMatch(source, /computeSettlement/, `${name} still computes a settlement`)
    assert.doesNotMatch(source, /settle_difference/, `${name} still references the settle_difference gate`)
    assert.doesNotMatch(source, /customer_owes|shop_refunds/, `${name} still asks who pays the difference`)
    assert.doesNotMatch(source, /uneven_exchange/, `${name} still blocks an uneven exchange`)
    assert.doesNotMatch(source, /settlement_mode:/, `${name} still writes a settlement mode`)
  }
  // the permission action itself is retired, not merely unreachable
  const permissionActionsSource = readFileSync(new URL('../src/utils/permissionActions.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(permissionActionsSource, /settle_difference/)
  // ...and its language keys are gone from BOTH packs
  for (const pack of ['en', 'km']) {
    const lang = JSON.parse(readFileSync(new URL(`../src/lang/${pack}.json`, import.meta.url), 'utf8')) as Record<string, string>
    for (const key of ['any_stock', 'customer_owes', 'shop_refunds', 'settle_difference', 'uneven_exchange_blocked', 'even_exchange_desc', 'perm_act_returns_settle_difference']) {
      assert.equal(Object.hasOwn(lang, key), false, `${pack}.json still carries the retired key ${key}`)
    }
  }
})

runTest('no surface offers "any stock" -- a lot is named or the product has none', () => {
  assert.doesNotMatch(newReturnSource, /any_stock/)
  assert.doesNotMatch(newReturnSource, /Any stock/i)
  // the replacement lot picker's empty option is a prompt, never a choice
  assert.match(newReturnSource, /T\('select_lot', 'Choose a lot…'\)/)
  // and a line with no lot named cannot be submitted or even reviewed
  assert.match(newReturnSource, /const itemsMissingLot = activeItems\.filter\(lineNeedsLot\)/)
  assert.match(newReturnSource, /const replacementsMissingLot = replacements\.filter\(\(line\) => line\.batches\.length > 0 && line\.batch_id == null\)/)
  assert.equal((newReturnSource.match(/if \(itemsMissingLot\.length \|\| replacementsMissingLot\.length\)/g) || []).length, 2,
    'both Review and Confirm must refuse an unnamed lot')
  // the backend refuses the same case rather than trusting the modal
  assert.match(backendKernelSource, /ReturnLotRequiredError/)
  assert.match(backendKernelSource, /requiresLotPick/)
})

runTest('the refund is the ORIGINAL sale line price, resolved on the server', () => {
  assert.match(backendKernelSource, /export function resolveRefundUnitPrice/)
  const routeSource = readFileSync(new URL('../../cloudflare/src/routes/returns.ts', import.meta.url), 'utf8')
  assert.match(routeSource, /const refundPrices = body\.items\.map\(\(item\) => resolveRefundUnitPrice\(/)
  // the header's refund total is derived, never taken from the payload
  assert.match(routeSource, /total_refund_usd: totalRefundUsd,/)
  assert.doesNotMatch(routeSource, /total_refund_usd: body\.total_refund_usd \|\| 0/)
  // and the stored line price is the resolved one, not the posted one
  assert.match(routeSource, /applied_price_usd: refundUnitUsd,/)
})

runTest('a replacement is recorded as an ordinary sale, not a settlement', () => {
  const routeSource = readFileSync(new URL('../../cloudflare/src/routes/returns.ts', import.meta.url), 'utf8')
  // the customer tenders the whole sale...
  assert.match(routeSource, /const customerTenderUsd = replacementSubtotalUsd/)
  // ...on a real payment method, defaulting to a real one
  assert.match(routeSource, /const DEFAULT_REPLACEMENT_PAYMENT_METHOD = 'Cash'/)
  assert.doesNotMatch(routeSource, /'Return Exchange'/)
  // ...and it earns loyalty exactly as any other sale does
  assert.match(routeSource, /0, 1, 'completed', @notes, @items, @search_normalized,/)
  // the modal offers the shop's own methods
  assert.match(newReturnSource, /PAYMENT_METHODS\.map\(\(method\) => \(\{ value: method, label: method \}\)\)/)
  assert.match(newReturnSource, /replacement_payment_method: replacementPaymentMethod,/)
})

runTest('K2: NewReturnModal wires the chooser and Replace', () => {
  // the ONE chooser renders per item and writes stock_action (boolean kept in step)
  assert.match(newReturnSource, /STOCK_ACTION_OPTIONS\.map\(\(option\)/)
  assert.match(newReturnSource, /const updateItemAction = \(idx: number, action: ReturnStockAction\)/)
  assert.match(newReturnSource, /stock_action: action, return_to_stock: action === 'restock'/)
  // Replace: full catalog name/SKU/barcode search, NEVER a scan auto-pick,
  // POS-way lot picker, payload keys. The standing project rule is that a
  // scan only narrows the list -- the operator still chooses the row.
  assert.match(newReturnSource, /searchProducts\(\{ query, page: 1, pageSize: 30 \}\)/)
  assert.doesNotMatch(newReturnSource, /if \(exactBarcode\) pickReplacementRow\(/)
  assert.doesNotMatch(newReturnSource, /normName\(row\.name\) === normName\(name\)/)
  assert.match(newReturnSource, /<ScanSearchButton/)
  assert.match(newReturnSource, /getProductBatches\(productId, branchId, true\)/)
  assert.match(newReturnSource, /replacement_items: replacements\.map/)
  // 5.3: the overlay portals to document.body like the other returns modals
  assert.match(newReturnSource, /return createPortal\(/)
})

runTest('K2: EditReturnModal edits with the same chooser and sends stock_action', () => {
  assert.match(editReturnSource, /normalizeStockAction\(item as/)
  assert.match(editReturnSource, /STOCK_ACTION_OPTIONS\.map\(\(option\)/)
  assert.match(editReturnSource, /stock_action:\s+it\.stock_action \|\| 'restock'/)
})

runTest('K2: ReturnDetailModal shows the per-item action and the replacement lines', () => {
  assert.match(detailSource, /stockActionOption\(normalizeStockAction\(/)
  assert.match(detailSource, /replacement_items/)
  // A return written under the CURRENT model names the sale it created...
  assert.match(detailSource, /replacement_receipt_number/)
  // ...and one written under the OLD exchange model still renders its stored
  // settlement, marked as the history it is. Deleting this read would make
  // every pre-existing exchange return misreport itself as a plain return.
  assert.match(detailSource, /ret\.settlement_mode === 'price_difference'/)
  assert.match(detailSource, /historical_settlement/)
})

runTest('K2/11.9: the POS damage source option is wired end to end', () => {
  const transportSource = readFileSync(new URL('../src/api/damagedLotsTransport.ts', import.meta.url), 'utf8')
  // per-product cache key and NO local fallback -- a failed read must never
  // cache as a definitive "no damaged stock"
  assert.match(transportSource, /batches:damaged:\$\{productId\}/)
  assert.match(transportSource, /raceLocalFallback: false/)

  const sheetSource = readFileSync(new URL('../src/components/pos/ProductDetailSheet.tsx', import.meta.url), 'utf8')
  // damaged lots fetched beside the sellable lots; picking one clears the
  // other (a line has exactly ONE source)
  assert.match(sheetSource, /getDamagedLots\(resolvedProduct\.id, resolvedBranchId\)/)
  assert.match(sheetSource, /setSelectedDamagedLotId\(lot\.id === selectedDamagedLotId \? null : lot\.id\); setSelectedBatchId\(null\)/)
  assert.match(sheetSource, /setSelectedBatchId\(batch\.id\); setSelectedDamagedLotId\(null\)/)
  // a damaged pick satisfies the lot gate and caps the shown stock
  assert.match(sheetSource, /const batchReadyToSell = selectedDamagedLot != null/)
  assert.match(sheetSource, /const displayedStock = selectedDamagedLot/)
  // the selection travels with the add
  assert.match(sheetSource, /onAddToCart\(nextProduct, priceMode, buildBatchSelection\(\), effectiveBranchId, buildDamagedSelection\(\)\)/)
  // the Damage section renders in BOTH flows (group + flat). Counted via
  // the posCopy key (English first arg): the old `>= 4` relied on the
  // posCopy('X', 'X') no-op duplicating the literal per site, which the
  // Khmer translation pass fixed.
  assert.equal((sheetSource.match(/posCopy\('Damage \(from returns\)'/g) || []).length >= 2, true)

  const posSource = readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8')
  // capped by the lot, merges only with the same lot's line, and the
  // checkout sends damaged_lot_id (never a label pretending to be a lot)
  assert.match(posSource, /damagedSelection\?: \{ damagedLotId: number; quantity: number; label: string \}/)
  assert.match(posSource, /cartItem\?\.damaged_lot_id\s*\?\s*\(cartItem\.damaged_available_quantity \?\? 0\)/)
  assert.match(posSource, /damaged_lot_id:\s+i\.damaged_lot_id \|\| null,/)
  assert.match(posSource, /\(active\.cart\[existingIndex\] as CartLineRecord\)\.damaged_lot_id\) existingIndex = -1/)

  const cartItemSource = readFileSync(new URL('../src/components/pos/CartItem.tsx', import.meta.url), 'utf8')
  assert.match(cartItemSource, /item\.damaged_lot_label/)
})

runTest('K2: the frontend mirror cannot drift from the backend kernel silently', () => {
  // same normalization branches...
  for (const pin of ["=== 'none' || explicit === 'restock' || explicit === 'damaged'", "return_to_stock !== false ? 'restock' : 'none'"]) {
    assert.ok(backendKernelSource.includes(pin), `backend kernel lost: ${pin}`)
    const frontendHelper = readFileSync(new URL('../src/components/returns/helpers/returnOptions.ts', import.meta.url), 'utf8')
    assert.ok(frontendHelper.includes(pin), `frontend helper lost: ${pin}`)
  }
  // ...and the same lot rule: neither side may invent an "unspecified lot"
  // destination for a product that has lots.
  const frontendHelper = readFileSync(new URL('../src/components/returns/helpers/returnOptions.ts', import.meta.url), 'utf8')
  assert.match(frontendHelper, /export function returnLineNeedsLotPick/)
  assert.match(backendKernelSource, /requiresLotPick: remaining > 0 && input\.lotTracked/)
})

if (failed > 0) {
  process.exitCode = 1
}

import assert from 'node:assert/strict'
import './returnMoneyV1Flow.test.ts'
import './returnMoneyV1Transport.test.ts'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
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
// The saved stock reasons are managed by StockReasonsManagerModal through this hook.
const stockReasonCatalogSource = readFileSync(new URL('../src/utils/useStockReasonCatalog.ts', import.meta.url), 'utf8')

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
  assert.match(stockReasonCatalogSource, /getInventoryReasonImpact/)
  assert.match(stockReasonCatalogSource, /replaceInventoryReason/)
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
  assert.match(newReturnSource, /T\('select_lot', 'Choose a received date…'\)/)
  // and a line with no lot named cannot be submitted or even reviewed
  assert.match(newReturnSource, /const itemsMissingLot = activeItems\.filter\(lineNeedsLot\)/)
  assert.match(newReturnSource, /const replacementsMissingLot = replacements\.filter\(\(line\) => line\.batches\.length > 0 && line\.batch_id == null\)/)
  assert.equal((newReturnSource.match(/if \(itemsMissingLot\.length \|\| replacementsMissingLot\.length\)/g) || []).length, 2,
    'both Review and Confirm must refuse an unnamed lot')
  // the backend refuses the same case rather than trusting the modal
  assert.match(backendKernelSource, /ReturnLotRequiredError/)
  assert.match(backendKernelSource, /requiresLotPick/)
})

// The refund a return line pays is decided by the REAL server code, run here:
// the two pricing callbacks of routes/returns.ts (`refundPrices` for POST /,
// `editRefundPrices` for PATCH /:id) are lifted out of the route by the
// TypeScript AST and executed against the REAL kernel declarations of
// lib/returnsStock.ts (resolveRefundUnitPrice, matchRefundSaleLine,
// RefundSaleLineError). So this pins what the code DOES -- it survives a
// rewrite of the route's shape, and it fails if either path ever pays the
// client-posted price for a line the sale recorded. A callback that goes
// missing, is assigned twice, or reads a variable not supplied below throws
// here: a loud red, never a silent pass.
type RefundPrice = { unitUsd: number; unitKhr: number }
type RefundLine = (item: Record<string, unknown>) => RefundPrice
type ServerRefundPricing = {
  post: (scope: Record<string, unknown>) => RefundLine
  patch: (scope: Record<string, unknown>) => RefundLine
}

function loadServerRefundPricing(): ServerRefundPricing {
  const routeText = readFileSync(new URL('../../cloudflare/src/routes/returns.ts', import.meta.url), 'utf8')
  const route = ts.createSourceFile('returns.ts', routeText, ts.ScriptTarget.Latest, true)
  const kernel = ts.createSourceFile('returnsStock.ts', backendKernelSource, ts.ScriptTarget.Latest, true)
  const callbacks = new Map<string, string>()
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)
      && (node.left.text === 'refundPrices' || node.left.text === 'editRefundPrices')
      && ts.isCallExpression(node.right) && ts.isPropertyAccessExpression(node.right.expression)
      && node.right.expression.name.text === 'map' && node.right.arguments.length === 1) {
      assert.equal(callbacks.has(node.left.text), false, `routes/returns.ts assigns ${node.left.text} more than once`)
      callbacks.set(node.left.text, node.right.arguments[0].getText(route))
    }
    ts.forEachChild(node, visit)
  }
  visit(route)
  for (const name of ['refundPrices', 'editRefundPrices']) {
    assert.ok(callbacks.has(name), `routes/returns.ts no longer prices lines as ${name} = <lines>.map(...)`)
  }
  const declarations = (file: ts.SourceFile, names: string[]) => file.statements
    .filter((node) => (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && names.includes(node.name?.text || ''))
    .map((node) => node.getText(file).replace(/^export /, ''))
  const kernelCode = declarations(kernel, ['resolveRefundUnitPrice', 'matchRefundSaleLine', 'RefundSaleLineError'])
  assert.equal(kernelCode.length, 3, 'lib/returnsStock.ts lost a refund kernel declaration')
  const helperCode = declarations(route, ['toNumber'])
  assert.equal(helperCode.length, 1, 'routes/returns.ts lost its toNumber helper')
  const program = [...kernelCode, ...helperCode, `return {
    post: ({ v1QuoteBySaleItem, saleMeta, saleItemBatchInfo, soldLines }) => (${callbacks.get('refundPrices')}),
    patch: ({ existing, body, saleItemBatchInfoForEdit, editSalePriceLines }) => (${callbacks.get('editRefundPrices')}),
  }`].join('\n')
  const compiled = ts.transpileModule(program, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(compiled)() as ServerRefundPricing
}

runTest('the refund is the ORIGINAL sale line price, resolved on the server', () => {
  const pricing = loadServerRefundPricing()
  const price = (result: RefundPrice) => [result.unitUsd, result.unitKhr]
  const refused = (run: () => unknown, code: string) =>
    assert.throws(run, (error: { code?: unknown }) => error?.code === code, `expected the server to refuse with ${code}`)
  // One sale: product 1 on line 1 at 10.01 / 40,040; product 2 on lines 2
  // and 3 at two different prices. Every return line posts 999.99.
  const soldLines = [
    { id: 1, product_id: 1, applied_price_usd: 10.01, applied_price_khr: 40040 },
    { id: 2, product_id: 2, applied_price_usd: 4, applied_price_khr: 16000 },
    { id: 3, product_id: 2, applied_price_usd: 4.5, applied_price_khr: 18000 },
  ]
  const saleItemBatchInfo = new Map(soldLines.map((line) => [line.id,
    { batch_id: null, applied_price_usd: line.applied_price_usd, applied_price_khr: line.applied_price_khr }]))
  const posted = { applied_price_usd: 999.99, applied_price_khr: 3999960 }
  const goodwill = { applied_price_usd: 5, applied_price_khr: 20000 }

  // POST /api/returns on a legacy (v0) sale: the recorded line, never the posted price.
  const legacy = pricing.post({ v1QuoteBySaleItem: new Map(), saleMeta: { id: 1 }, saleItemBatchInfo, soldLines })
  assert.deepEqual(price(legacy({ sale_item_id: 1, product_id: 1, ...posted })), [10.01, 40040], 'a sale-item line refunds the recorded price')
  assert.deepEqual(price(legacy({ product_id: 1, ...posted })), [10.01, 40040], 'a product-matched line is capped at the recorded price')
  assert.deepEqual(price(legacy({ product_id: 1, ...goodwill })), [5, 20000], 'a lower goodwill refund is kept')
  assert.deepEqual(price(legacy({ product_id: 1 })), [10.01, 40040], 'an omitted price is the recorded price')
  assert.deepEqual(price(legacy({ sale_item_id: 3, product_id: 2, ...posted })), [4.5, 18000])
  refused(() => legacy({ product_id: 2, ...posted }), 'return_refund_price_ambiguous')
  // A v1 return is priced from its authoritative quote line first.
  const v1 = pricing.post({ v1QuoteBySaleItem: new Map([[1, { applied_price_usd: 9.5, applied_price_khr: 38000 }]]),
    saleMeta: { id: 1 }, saleItemBatchInfo, soldLines })
  assert.deepEqual(price(v1({ sale_item_id: 1, product_id: 1, ...posted })), [9.5, 38000], 'the v1 quote line prices a v1 return')
  // RET-A F6 / N1 (6 Oct 2026): every return has a sale, and the posted price
  // never stands alone -- a line that matches no line of the sale is refused,
  // whatever it posts (POST / refuses a sale-less body before pricing).
  const unlinked = pricing.post({ v1QuoteBySaleItem: new Map(), saleMeta: null, saleItemBatchInfo, soldLines: [] })
  refused(() => unlinked({ sale_item_id: 1, product_id: 1, ...posted }), 'return_refund_sale_line_required')
  refused(() => unlinked({ product_id: 9, applied_price_usd: 7, applied_price_khr: 28000 }), 'return_refund_sale_line_required')
  refused(() => legacy({ product_id: 9, applied_price_usd: 7, applied_price_khr: 28000 }), 'return_refund_sale_line_required')

  // PATCH /api/returns/:id re-prices the edited lines by the same rule.
  const edit = pricing.patch({ existing: { sale_id: 1 }, body: { items: [] }, saleItemBatchInfoForEdit: saleItemBatchInfo, editSalePriceLines: soldLines })
  assert.deepEqual(price(edit({ sale_item_id: 1, product_id: 1, ...posted })), [10.01, 40040], 'an edit never restates what was paid')
  assert.deepEqual(price(edit({ product_id: 1, ...posted })), [10.01, 40040])
  assert.deepEqual(price(edit({ product_id: 1, ...goodwill })), [5, 20000])
  refused(() => edit({ product_id: 2, ...posted }), 'return_refund_price_ambiguous')
  refused(() => edit({ ...posted }), 'return_refund_sale_line_required')
  const editUnlinked = pricing.patch({ existing: { sale_id: null }, body: { items: [] }, saleItemBatchInfoForEdit: saleItemBatchInfo, editSalePriceLines: [] })
  assert.deepEqual(price(editUnlinked({ sale_item_id: 1, ...posted })), [10.01, 40040])
  assert.deepEqual(price(editUnlinked({ applied_price_usd: 7, applied_price_khr: 28000 })), [7, 28000])

  const routeSource = readFileSync(new URL('../../cloudflare/src/routes/returns.ts', import.meta.url), 'utf8')
  assert.match(routeSource, /const totalRefundUsd = customerReturnV1Plan\?\.quote\.total_refund_usd\s*\?\?/, 'v1 refunds use the authoritative net entitlement, not a rounded unit projection')
  // the header's refund total is derived, never taken from the payload
  assert.match(routeSource, /total_refund_usd: totalRefundUsd,/)
  assert.doesNotMatch(routeSource, /total_refund_usd: body\.total_refund_usd \|\| 0/)
  // and the stored line price is the resolved one, not the posted one
  assert.match(routeSource, /applied_price_usd: refundUnitUsd,/)
})

runTest('a replacement is recorded as an ordinary sale, not a settlement', () => {
  const routeSource = readFileSync(new URL('../../cloudflare/src/routes/returns.ts', import.meta.url), 'utf8')
  // the atomic planner tenders the whole sale through the ordinary totals kernel...
  assert.match(routeSource, /rawAmountPaidUsd: subtotalUsd, rawAmountPaidKhr: 0,/)
  assert.match(routeSource, /const paymentDetails = subtotalUsd > 0 \? \[\{ method: replacementPaymentMethod, amount_usd: subtotalUsd, amount_khr: 0 \}\] : \[\]/)
  assert.match(routeSource, /amount_paid_usd: replacementTotals\.amountPaidUsd, amount_paid_khr: replacementTotals\.amountPaidKhr,/)
  // ...on a real payment method, defaulting to a real one
  assert.match(routeSource, /const DEFAULT_REPLACEMENT_PAYMENT_METHOD = 'Cash'/)
  assert.doesNotMatch(routeSource, /'Return Exchange'/)
  // ...and it earns loyalty exactly as any other sale does
  assert.match(routeSource, /loyalty_accrual,sale_status,notes,items,search_normalized/)
  assert.match(routeSource, /0,0,0,0,0,0,1,'completed',@notes,@items,@search_normalized,/)
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
  assert.match(sheetSource, /setSelectedBatchId\(batch\.id\); setSelectedUnlottedProductId\(null\); setSelectedDamagedLotId\(null\)/)
  // A damaged pick satisfies the lot gate and caps the shown stock. Both
  // derivations moved out of this component and into the pure module every
  // picker now shares (components/pos/productSheetState.ts), so they are
  // pinned where they live -- and pinned as reached from here, so the sheet
  // cannot quietly go back to deriving its own.
  const sheetStateSource = readFileSync(new URL('../src/components/pos/productSheetState.ts', import.meta.url), 'utf8')
  assert.match(sheetStateSource, /const batchReadyToSell = selectedDamagedLot != null/)
  assert.match(sheetStateSource, /const displayedStock = selectedDamagedLot/)
  assert.match(sheetSource, /deriveProductSheetState\(/)
  assert.match(sheetSource, /sheetState\.batchReadyToSell/)
  assert.match(sheetSource, /sheetState\.displayedStock/)
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

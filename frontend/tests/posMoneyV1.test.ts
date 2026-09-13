import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildSync, transformSync } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { getCartLineId, isSaleRecorded, quoteSaleCartLines, posV1BasketTotals, posV1Tender, frozenPosPreview, parsePosInternalAmount } from '../src/components/pos/posCore.ts'
import { canonicalSaleReceipt, frozenSaleCheckoutBody, SaleCheckoutRecoveryRequiredError } from '../src/utils/saleMoneyV1.ts'
import { materializeCapturedPricingRow, serializeSaleItemPricing } from '../src/utils/saleItemPricing.ts'
import { normalizePromotionRule } from '../src/utils/promotionRules.ts'
import { capturedSaleLineEdit, capturedSaleRemovalSubtotal } from '../src/utils/saleLineEditor.ts'
import { quoteSaleMutationHeader } from '../src/utils/saleMutationHeaderQuote.ts'
import { compareSaleHeaderQuote } from '../src/utils/saleMutationHeaderQuote.ts'
import { runSaleLineMutation, loadPendingDirectMutation, withSaleLineMutationLock, replaceReviewedSaleLineHeader } from '../src/utils/directMutationRequest.ts'
import { stagedLineFromSheetPick, stagedLinePricingIntent, mergeStagedAddLine } from '../src/components/sales/saleAddLines.ts'
import { nativeChangeAmounts, sumMoney4, multiplyMoney4, sellingPriceCeilCent, sellingPriceDivideCeilCent } from '../src/utils/moneyPrecision.ts'
import { applyManualDiscount } from '../src/components/pos/posCore.ts'

const saved = { id: 17, subtotal_usd: 1.2345, discount_usd: 0, membership_discount_usd: 0, tax_usd: 0, exchange_rate: 4000, amount_paid_usd: 1.23, amount_paid_khr: 0, items: [{ quantity: 1, applied_price_usd: 1.2345, total_usd: 1.2345 }], money_precision_version: 1, calculated_total_usd: 1.2345, rounding_adjustment_usd: -0.0045, total_usd: 1.23, subtotal_khr: 4938, discount_khr: 0, membership_discount_khr: 0, tax_khr: 0, total_khr: 4920, delivery_fee_usd: 0, delivery_fee_khr: 0, change_usd: 0, change_khr: 0 }
const pricingJson = serializeSaleItemPricing({ version: 1, pool_key: 'callback-pool', evaluation_time: '2026-09-13T00:00:00.000Z', exchange_rate: 4000, rules: [], lines: [{ line_key: 'callback-line', source: 'manual', product: { id: 7, selling_price_usd: 1.24 }, selling_price_input_usd: 1.24, manual: { type: 'fixed', value: 0.0055 } }] }, { 'callback-line': 1 }, 'callback-line', { version: 1, lines: [{ line_key: 'callback-line', amount: 1.2345 }], discount_usd: 0, membership_discount_usd: 0, tax_usd: 0 })
Object.assign(saved.items[0], { ...JSON.parse(pricingJson).amounts, product_id: 7, pricing_snapshot_json: pricingJson })
Object.assign(saved.items[0], { manual_discount_type: 'fixed', manual_discount_value: 0.0055, product_discount_usd: 0, product_discount_khr: 0, manual_discount_usd: 0.0055, manual_discount_khr: 22 })
Object.assign(saved.items[0], { price_mode: 'manual', product_discount_type: null, product_discount_label: null })
const original = { client_request_id: 'request-1', money_precision_version: 1, items: [{ quantity: 1, applied_price_usd: 1.2345 }], subtotal_usd: 1.2345, total_usd: 1.23, amount_paid_usd: 1.23, amount_paid_khr: 0, exchange_rate: 4000, sale_status: 'completed' }
const frozen = frozenSaleCheckoutBody('request-1', undefined, () => original)
const capturedPool = { version: 1 as const, pool_key: 'original-pool', evaluation_time: '2026-09-13T00:00:00.000Z', exchange_rate: 4000, rules: [normalizePromotionRule({ id: 1, rule_type: 'quantity_save', min_quantity: 3, save_usd: 1, product_ids: [7], scope_type: 'products', is_active: 1 }, 1)!], lines: [{ line_key: 'original-line', source: 'promotion' as const, product: { id: 7, selling_price_usd: 10 }, selling_price_input_usd: null, manual: { type: 'none' as const, value: 0 } }] }
const capturedRow = materializeCapturedPricingRow({ id: 70, product_id: 7 }, capturedPool, { 'original-line': 3 }, 'original-line', { version: 1, lines: [{ line_key: 'original-line', amount: 29 }], discount_usd: 0, membership_discount_usd: 0, tax_usd: 0 })
const capturedSale = { id: 17, items: [capturedRow], exchange_rate: 4000, subtotal_usd: 29, discount_usd: 0, membership_discount_usd: 0, tax_usd: 0 }
const cart = [{ id: 7, cart_line_id: 'original-line', price_mode: 'promotion', quantity: 3, selling_price_usd: 10, selling_price_khr: 1, applied_price_usd: 9.6667, applied_price_khr: 38666.8 }]
const quotes = quoteSaleCartLines(cart, capturedPool.rules, 4000, capturedPool.evaluation_time)
assert.deepEqual(quotes.get('original-line')!.pricing_quote, { gross_usd: 30, product_discount_usd: 1, manual_discount_usd: 0, total_usd: 29, total_khr: 116000 })
assert.equal(quoteSaleCartLines([{ ...cart[0], manual_discount_type: 'percent', manual_discount_value: 12.3456 }], capturedPool.rules, 4000, capturedPool.evaluation_time).get('original-line')!.total_usd, 25.4198)
const basketInput = { lines: [{ total_usd: 29 }], exchangeRate: 4000, discountType: 'fixed', discountPercent: '', discountUsd: '0.1234', discountKhr: '493.6', membershipUsd: '0.1111', membershipKhr: '444.4', taxPercent: '7', feeUsd: '0.1234', customerPaysFee: true }
const basket = posV1BasketTotals(basketInput)
assert.equal(basket.discUsd, 0.1234, 'USD/KHR aliases never count twice')
assert.equal(basket.calculatedTotalUsd, 30.9025)
assert.equal(basket.totalUsd, 30.9)
assert.equal(basket.rounding.roundingAdjustment4, -0.0025)
assert.equal(posV1BasketTotals({ ...basketInput, discountUsd: '', discountKhr: '20', exchangeRate: 4020 }).discUsd, 0.005)
for (const invalid of ['-0.0000001', 'Infinity', '0x10', 'not money']) assert.throws(() => posV1BasketTotals({ ...basketInput, feeUsd: invalid }))
assert.throws(() => posV1BasketTotals({ ...basketInput, discountUsd: '30' }), 'overdiscount must not silently clamp the sale')
assert.throws(() => posV1BasketTotals({ ...basketInput, lines: [{ total_usd: 0 }], discountUsd: '', discountKhr: '', membershipUsd: '', membershipKhr: '' }), 'zero-base positive tax needs review')
assert.deepEqual(posV1Tender([{ method: 'Cash', usd: '10.075', khr: '20.4' }]), { details: [{ method: 'Cash', amount_usd: 10.08, amount_khr: 20 }], paidUsd: 10.08, paidKhr: 20 })
assert.equal(posV1Tender([{ method: 'Cash', usd: '0.1', khr: '' }, { method: 'ABA', usd: '0.2', khr: '' }]).paidUsd, 0.3)
assert.throws(() => posV1Tender([{ method: 'Cash', usd: '-0.0000001', khr: '' }]))

// Execute the production checkout callback with controlled transport outcomes.
// These are callback/state tests, not source-string presence assertions.
const posSource = fs.readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const tagStart = posSource.indexOf('  const toggleTierTag = '), tagEnd = posSource.indexOf('\n  }\n', tagStart) + 4
let tagged: any
new Function('env', `with(env) { ${transformSync(posSource.slice(tagStart, tagEnd), { loader: 'tsx' }).code}; toggleTierTag('original-line') }`)({
  active: { cart }, moneyVersion: 1, getCartLineId, patchActive: (value: unknown) => { tagged = value },
})
assert.equal(tagged.cart[0].price_mode, 'promotion')
assert.equal(tagged.cart[0].display_price_mode, 'wholesale')
const taggedQuote = quoteSaleCartLines(tagged.cart, capturedPool.rules, 4000, capturedPool.evaluation_time).get('original-line')!
assert.equal(taggedQuote.total_usd, 29)
assert.equal(taggedQuote.pricing_source, 'promotion')
assert.equal(taggedQuote.display_price_mode, 'wholesale')
assert.deepEqual(taggedQuote.pricing_quote, quotes.get('original-line')!.pricing_quote, 'marker toggle must not reprice a captured source')
const priceStart = posSource.indexOf('  const updatePrice = '), priceEnd = posSource.indexOf('\n  }\n', priceStart) + 4
const priceUpdates: any[] = []
const priceCallback = new Function('env', `with(env) { ${transformSync(posSource.slice(priceStart, priceEnd), { loader: 'tsx' }).code}; return updatePrice }`)({
  moneyVersion: 1, parsePosInternalAmount, notify: () => {}, t: (key: string) => key, active: { cart }, getCartLineId,
  exchangeRate: 4000, sellingPriceCeilCent, sellingPriceDivideCeilCent, multiplyMoney4, applyManualDiscount, patchActive: (value: unknown) => priceUpdates.push(value),
})
priceCallback('original-line', 'khr', '4000.01')
assert.equal(priceUpdates[0].cart[0].base_price_usd, 1.01, 'actual KHR input divides exactly then ceilings cents without intermediate4 rounding')
priceCallback('original-line', 'usd', '1.00000000000000001')
assert.equal(priceUpdates[1].cart[0].base_price_usd, 1.01, 'raw typed precision reaches the exact ceil before Number loses it')
priceCallback('original-line', 'usd', '-0.00000001')
assert.equal(priceUpdates.length, 2)
const callbackStart = posSource.indexOf('  const handleCheckout = async')
const callbackEnd = posSource.indexOf('\n  }\n', callbackStart) + 4
assert.ok(callbackStart > 0 && callbackEnd > callbackStart)
const callbackCode = transformSync(posSource.slice(callbackStart, callbackEnd), { loader: 'tsx' }).code
const changeStart = posSource.indexOf('  const totalPaid    =')
const changeEnd = posSource.indexOf('\n\n', posSource.indexOf('  const changeKhr    =', changeStart))
const changeCode = transformSync(posSource.slice(changeStart, changeEnd), { loader: 'tsx' }).code
const nativeChange = new Function('env', `with(env) { ${changeCode}; return {changeUsd,changeKhr} }`)({ active: {}, moneyVersion: 1, paidUsdNum: 1, paidKhrNum: 20, totalUsd: 1, exchangeRate: 4020, changeExchangeRate: 4020, nativeChangeAmounts })
assert.deepEqual(nativeChange, { changeUsd: 0, changeKhr: 20 }, 'actual POS computed denomination boundary must not round through USD4 or through USD cents')
const itemMapStart = posSource.indexOf('items: active.cart.map(i => (')
const itemMapEnd = posSource.indexOf('\n      subtotal_usd:', itemMapStart)
const itemMapCode = posSource.slice(itemMapStart + 'items: '.length, itemMapEnd).trim().replace(/,$/, '')
const sentItems = new Function('active', 'pricedCart', 'getCartLineId', `${transformSync(`const items = ${itemMapCode}`, { loader: 'tsx' }).code}; return items`)({ cart }, { quotes }, getCartLineId)
assert.equal(sentItems[0].total, 29)
assert.equal(sentItems[0].pricing_quote.total_usd, 29, 'actual POS payload mapper uses exact quote, not unit reconstruction')
assert.equal(sentItems[0].client_line_key, 'original-line')
const pendingBody = { money_precision_version: 1, items: sentItems, exchange_rate: 4000, subtotal_usd: 29, subtotal_khr: 116000, discount_usd: 0, discount_khr: 0, membership_discount_usd: 0, membership_discount_khr: 0, tax_usd: 0, tax_khr: 0, delivery_fee_usd: 0, delivery_fee_khr: 0, total_usd: 29, total_khr: 116000 }
const pendingView = frozenPosPreview(pendingBody)
assert.equal(pendingView.totals.totalUsd, 29)
assert.equal(pendingView.lines.get('original-line')!.total_usd, 29)
assert.throws(() => frozenPosPreview({ ...pendingBody, items: [] }))
const basketStart = posSource.indexOf('  const v1Basket = useMemo(')
const basketEnd = posSource.indexOf('  const cartTotals = useMemo(', basketStart)
const pendingBasket = new Function('env', `with(env) { ${transformSync(posSource.slice(basketStart, basketEnd), { loader: 'tsx' }).code}; return v1Basket }`)({
  useMemo: (run: () => unknown) => run(), moneyVersion: 1, active: { checkoutRequestId: 'pending' }, pendingPreview: pendingView,
  pricedCart: { error: new Error('current rules unavailable') }, exchangeRate: 9999, taxRate: 1, settings: { tax_rate: 100 }, SaleCheckoutRecoveryRequiredError,
})
assert.equal(pendingBasket.totals.totalUsd, 29, 'actual pending basket memo never recalculates against current FX/tax/rules')
async function checkoutProbe(options: { body?: Record<string, unknown>; proof?: unknown; lookupError?: boolean; switchActor?: boolean; writeError?: string }) {
  const sent: unknown[] = [], printed: unknown[] = [], notices: string[] = [], closed: unknown[] = []
  let generation = 1
  const env: any = {
    loading: false, checkoutInFlightRef: { current: false }, resolvedActiveId: 'order1',
    active: { checkoutRequestId: 'request-1', checkoutPayload: options.body, cart: [{ intentionallyChanged: true }] },
    checkoutRequestIdsRef: { current: new Map() },
    captureActorReadScope: () => generation, isActorReadScopeCurrent: (scope: number) => scope === generation,
    assertActorSessionDispatchAllowed: (scope: number) => { if (scope !== generation) throw new Error('stale actor') },
    getSaleWriteTransport: async () => { if (options.switchActor) generation++; return { recoverSaleCreateReceipt: async () => { if (options.lookupError) throw new Error('403'); return options.proof ?? { committed: false } } } },
    createPosSale: async (body: unknown) => { sent.push(body); if (options.writeError) throw Object.assign(new Error(options.writeError), { code: options.writeError }); return { id: 17, sale: saved } },
    setOrders: (update: any) => { env.reviewState = update([{ id: 'order1', checkoutRequestId: 'request-1', checkoutPayload: frozen }]) },
    canonicalSaleReceipt, frozenSaleCheckoutBody, SaleCheckoutRecoveryRequiredError, isSaleRecorded,
    withLoaderTimeout: (run: () => unknown) => run(), POS_CHECKOUT_TIMEOUT_MS: 100,
    setLoading: () => {}, setReceiptQueue: (update: any) => printed.push(...update([])), closeOrder: (...args: unknown[]) => closed.push(args),
    loadCatalogData: async () => {}, window: { dispatchEvent: () => {} }, CustomEvent: class {},
    t: (key: string) => key, notify: (message: string) => notices.push(message),
    getErrorMessage: (error: Error) => error.message, localizeBranchRuleError: (error: unknown) => error,
  }
  const callback = new Function('env', `with(env) { ${callbackCode}; return handleCheckout }`)(env)
  await callback()
  return { sent, printed, notices, closed, env }
}
const idOnly = await checkoutProbe({})
assert.equal(idOnly.sent.length, 0); assert.deepEqual(idOnly.notices, ['money_checkout_recovery_required'])
const denied = await checkoutProbe({ body: frozen, lookupError: true })
assert.equal(denied.sent.length, 0); assert.equal(denied.printed.length, 0)
const retried = await checkoutProbe({ body: frozen })
assert.deepEqual(retried.sent, [frozen]); assert.deepEqual(retried.printed, [saved]); assert.deepEqual(retried.closed, [['order1', true]])
const recovered = await checkoutProbe({ proof: { committed: true, response: { id: 17, sale: saved } } })
assert.equal(recovered.sent.length, 0); assert.deepEqual(recovered.printed, [saved])
const switched = await checkoutProbe({ body: frozen, switchActor: true })
assert.equal(switched.sent.length, 0); assert.equal(switched.printed.length, 0); assert.equal(switched.notices.length, 0)
const conflict = await checkoutProbe({ body: frozen, writeError: 'sale_pricing_quote_conflict' })
assert.equal(conflict.sent.length, 1)
assert.equal(conflict.env.reviewState[0].checkoutReviewRequestId, 'request-1')
assert.deepEqual(conflict.env.reviewState[0].checkoutPayload, frozen)
for (const writeError of ['timeout', '403', 'lost acknowledgement']) {
  const unresolved = await checkoutProbe({ body: frozen, writeError })
  assert.equal(unresolved.sent.length, 1)
  assert.equal(unresolved.env.reviewState, undefined, `${writeError} must not enable repricing/retire an uncertain identity`)
}
console.log('PASS actual POS checkout callback: receipt-first recovery, exact retry, canonical print and actor guard')

const detailSource = fs.readFileSync(new URL('../src/components/sales/SaleDetailModal.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
function actualDetailCallback(name: string, env: Record<string, unknown>) {
  const start = detailSource.indexOf(`  const ${name} = `)
  const end = detailSource.indexOf('\n  }\n', start) + 4
  assert.ok(start > 0 && end > start)
  const code = transformSync(detailSource.slice(start, end), { loader: 'tsx' }).code
  return new Function('env', `with(env) { ${code}; return ${name} }`)(env)
}
const edits: any[] = [], editErrors: string[] = []
const editEnv = {
  amendQtyText: '2', amendPriceText: '9.6667', amendDiscountType: null, amendDiscountText: '0',
  items: [capturedRow], sale: capturedSale, capturedSaleLineEdit,
  headerQuote: (subtotal: number) => quoteSaleMutationHeader(capturedSale, subtotal, { tax_enabled: '0', tax_rate: '0' }),
  amendRequestIdRef: { current: '' }, createSettlementRequestId: () => 'edit-request',
  setAmendMutationError: (value: string) => editErrors.push(value), setAmendConfirm: (value: unknown) => edits.push(value),
  translateOr: (key: string) => key, t: (key: string) => key, fmtUSD: (value: number) => value.toFixed(2),
}
actualDetailCallback('stageLineUpdate', editEnv)(70, 3, 9.6667, null, 0, 0, 0.3333, 'Original')
assert.equal(edits.length, 1)
assert.equal(edits[0].request.pricing_quote.total_usd, 20, 'actual edit callback re-evaluates original buy-three threshold at two units')
assert.equal(edits[0].request.quantity, 2)
assert.equal(edits[0].request.expected_header_quote.total_usd, 20, 'review contains the complete new basket payable, not saved payable plus unit delta')
assert.equal(Object.hasOwn(edits[0].request, 'selling_price_input_usd'), false, 'quantity-only edit never treats projected base as a newly typed selling price')
assert.equal(Object.hasOwn(edits[0].request, 'manual_discount_value'), false)
actualDetailCallback('stageLineUpdate', { ...editEnv, amendQtyText: '3' })(70, 3, 9.6667, null, 0, 0, 0.3333, 'Original')
assert.equal(edits.length, 1, 'unchanged edit does not create another request')
actualDetailCallback('stageLineUpdate', { ...editEnv, items: [{ ...capturedRow, pricing_snapshot_json: null }] })(70, 3, 9.6667, null, 0, 0, 0.3333, 'Original')
assert.equal(edits.length, 1, 'legacy unknown pricing cannot be silently upgraded')
assert.equal(editErrors.at(-1), 'money_precision_unavailable')
const replacements: any[] = []
actualDetailCallback('stageReplacement', {
  replaceLineId: 70, items: [capturedRow], toNumber: Number,
  sale: capturedSale, capturedSaleRemovalSubtotal, sumMoney4, headerQuote: editEnv.headerQuote,
  moneyCapability: { assertReady: () => {} }, savedExchangeRate: 4000, stagedLineFromSheetPick, stagedLinePricingIntent,
  setAddQuery: () => {}, setAddCandidates: () => {}, amendRequestIdRef: { current: '' }, createSettlementRequestId: () => 'replace-request',
  setAmendMutationError: (value: string) => editErrors.push(value), setAmendConfirm: (value: unknown) => replacements.push(value),
  translateOr: (key: string) => key, t: (key: string) => key,
})({ id: 8, selling_price_usd: 1.2301, name: 'Replacement', stock_quantity: 10 }, '2')
assert.equal(replacements[0].request.replacement.pricing_quote.total_usd, 3.72)
assert.equal(replacements[0].request.replacement.pricing_source, 'selling')
assert.equal(replacements[0].request.replacement.branch_id, 2)
assert.equal(replacements[0].request.replacement.quantity, 3)
assert.equal(Object.hasOwn(replacements[0].request.replacement, 'selling_price_input_usd'), false)

const staged = stagedLineFromSheetPick({ id: 8, name: 'New', selling_price_usd: 1.2301, stock_quantity: 10 }, { branchId: '2', batch: { batchId: 9, quantity: 10 } }, 1)!
const merged = mergeStagedAddLine([{ ...staged, quantity: 2, sellingPriceInputUsd: '2.3401', unitPriceUsd: 2.35 }], staged)
assert.equal(merged[0].clientLineKey, staged.clientLineKey)
assert.equal(merged[0].sellingPriceInputUsd, '2.3401', 'repeat pick preserves explicit manual price intent')
async function addProbe(result: unknown, stale = false) {
  const calls: any[] = [], cleared: unknown[] = [], errors: string[] = []
  const ref = { current: 'actor:sale' }
  const callback = actualDetailCallback('submitAddItems', {
    executeLineMutation: async (_kind: unknown, body: Record<string, unknown>) => { const { items, notes: _notes, ...review } = body; calls.push([17, items, review]); if (stale) ref.current = 'changed'; return result },
    onAddItems: async (...args: unknown[]) => { calls.push(args); if (stale) ref.current = 'changed'; return result },
    addLines: [staged], addHasStockError: false, detailScope: 'actor:sale', detailScopeRef: ref, detailAliveRef: { current: true },
    setAddSaving: () => {}, moneyCapability: { assertReady: () => {} }, savedExchangeRate: 4000, sale: { id: 17 },
    stagedLinePricingIntent, addRequestIdRef: { current: 'stable-add-request' }, settlementSession: { expectedUpdatedAt: 'before' },
    addReviewedHeader: quoteSaleMutationHeader(capturedSale, 30.24, { tax_enabled: '0', tax_rate: '0' }),
    setAddMutationError: (value: string) => errors.push(value), localizeBranchRuleError: (value: string) => value,
    t: (key: string) => key, translateOr: (key: string) => key, setAddLines: (value: unknown) => cleared.push(value),
    setAddConfirmOpen: () => {}, onClose: () => cleared.push('closed'),
  })
  await callback()
  return { calls, cleared, errors }
}
const added = await addProbe({})
assert.equal(added.calls[0][1][0].pricing_quote.total_usd, 1.24)
assert.equal(added.calls[0][1][0].pricing_quote.total_khr, 4960)
assert.equal(added.calls[0][1][0].batch_id, 9)
assert.equal(added.calls[0][2].client_request_id, 'stable-add-request')
assert.equal(added.calls[0][2].expected_exchange_rate, 4000)
assert.equal(added.calls[0][2].expected_header_quote.total_usd, 30.24)
assert.equal(added.cleared.length, 2)
assert.equal((await addProbe({ mutationError: 'sale_pricing_quote_conflict' })).cleared.length, 0)
assert.equal((await addProbe({}, true)).cleared.length, 0, 'old actor response cannot clear a new actor form')
console.log('PASS actual sale add/edit callbacks: original rule, saved FX, stable intent, no-op and failed/stale draft preservation')

// Execute the actual parent handlers to challenge late actor responses and
// exact conflict forwarding, rather than asserting source spelling.
const salesSource = fs.readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
function actualSalesCallback(name: string, env: Record<string, unknown>) {
  const start = salesSource.indexOf(`  const ${name} = `), end = salesSource.indexOf('\n  }\n', start) + 4
  assert.ok(start > 0 && end > start)
  return new Function('env', `with(env) { ${transformSync(salesSource.slice(start, end), { loader: 'tsx' }).code}; return ${name} }`)(env)
}
for (const name of ['handleAddSaleItems', 'handleAmendSale']) {
  for (const mode of ['success', 'late', 'conflict']) {
    const notifications: unknown[] = [], refreshes: unknown[] = [], scope = { current: 'before' }
    const quote = editEnv.headerQuote(20)
    const response = { subtotalUsd: 20, totalUsd: 20, moneyPrecisionVersion: 1, items: [] }
    const write = async () => { if (mode === 'late') scope.current = 'after'; if (mode === 'conflict') throw { code: 'sale_header_quote_conflict', header_quote: quote, proven_uncommitted: true }; return response }
    const result = await actualSalesCallback(name, {
      statusSecurityRef: scope, aliveRef: { current: true }, canAddSaleItems: true, canAmendSales: true,
      salesRef: { current: [] }, getSalesApi: () => ({ addSaleItems: write, amendSale: write }),
      withLoaderTimeout: (fn: () => unknown) => fn(), SALES_ADD_ITEMS_MUTATION_TIMEOUT_MS: 100,
      notify: (...args: unknown[]) => notifications.push(args), translateOr: (key: string) => key,
      loadSales: async () => refreshes.push('sales'), loadSalesStats: () => refreshes.push('stats'),
      actionHistory: { refreshServerItems: () => refreshes.push('history') },
      window: { dispatchEvent: () => {} }, CustomEvent: class { constructor(..._args: unknown[]) {} },
      getErrorMessage: (_error: unknown, fallback: string) => fallback,
    })(17, name === 'handleAddSaleItems' ? [{ product_id: 7, quantity: 1 }] : { client_request_id: 'fixed' }, { client_request_id: 'fixed' })
    if (mode === 'late') { assert.equal(result, false); assert.equal(notifications.length, 0); assert.equal(refreshes.length, 0) }
    else if (mode === 'conflict') { assert.deepEqual(result.header_quote, quote); assert.equal(result.proven_uncommitted, true); assert.equal(result.code, 'sale_header_quote_conflict'); assert.equal(notifications.length, 0) }
    else { assert.equal(result.committed, true); assert.equal(result.response, response) }
  }
}
console.log('PASS actual Sales add/amend handlers: canonical result, typed header conflict, late security publication blocked')

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_name: string, _options: unknown, action: () => unknown) => action() } } })
try {
  const rows = new Map<string, string>(), sends: unknown[] = [], pending: unknown[] = [], errors: unknown[] = []
  const storage = { get length() { return rows.size }, key: (index: number) => [...rows.keys()][index] ?? null,
    getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value) }, removeItem: (key: string) => { rows.delete(key) } }
  let receipt = { committed: false } as { committed: boolean; response?: Record<string, unknown> }
  const env: Record<string, any> = {
    lineWriteOwnerRef: { current: null }, captureActorReadScope: () => ({}), isActorReadScopeCurrent: () => true,
    detailScope: 'scope', detailScopeRef: { current: 'scope' }, detailAliveRef: { current: true }, authReady: true, user: { id: 7 }, sale: { id: 17 }, lineMutationActor: 'origin-runtime:actor7',
    setLineRecoveryBusy: () => {}, setPendingLineMutation: (value: unknown) => pending.push(value), setLineRecoveryError: (value: unknown) => errors.push(value),
    runSaleLineMutation, getSaleLineReceipt: async () => receipt, window: { localStorage: storage, dispatchEvent: () => {} }, CustomEvent: class {},
    moneyCapability: { assertReady: () => {} }, onAmend: async (_id: unknown, body: unknown) => { sends.push(body); throw new Error('lost acknowledgement') }, onAddItems: undefined,
    t: (key: string) => key, compareSaleHeaderQuote, headerQuote: editEnv.headerQuote, setLineHeaderConflict: () => {}, setLineReviewConfirm: () => {}, setAmendConfirm: () => {}, setAddConfirmOpen: () => {},
  }
  const call = actualDetailCallback('executeLineMutation', env)
  const body = { client_request_id: 'modal-lost', money_precision_version: 1, expected_updated_at: 'before', expected_exchange_rate: 4000, kind: 'line_removed', sale_item_id: 70, expected_header_quote: editEnv.headerQuote(20) }
  await assert.rejects(call('sale-amendment', body))
  assert.equal(sends.length, 1); assert.ok(loadPendingDirectMutation('sale-amendment', env.lineMutationActor, '17', storage))
  await call('sale-amendment', undefined, true)
  assert.equal(sends.length, 1, 'actual modal reopen performs receipt read only')
  receipt = { committed: true, response: { totalUsd: 20 } }
  assert.equal((await call('sale-amendment', undefined, true)).committed, true)
  assert.equal(pending.at(-1), null); assert.equal(rows.size, 0); assert.equal(sends.length, 1)
  let resolveWrite!: (value: unknown) => void
  receipt = { committed: false }
  env.onAmend = async (_id: unknown, payload: unknown) => { sends.push(payload); return await new Promise(resolve => { resolveWrite = resolve }) }
  const first = call('sale-amendment', { ...body, client_request_id: 'double' })
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  assert.equal(await call('sale-amendment', { ...body, client_request_id: 'double' }), false)
  resolveWrite({ committed: true, response: { totalUsd: 20 } })
  await first
  assert.equal(sends.length, 2, 'actual modal duplicate guard dispatches only once')
  let conflict: any, review: any
  env.setLineHeaderConflict = (value: unknown) => { conflict = value }
  env.onAmend = async (_id: unknown, payload: unknown) => { sends.push(payload); return { mutationError: 'review', code: 'sale_header_quote_conflict', proven_uncommitted: true, header_quote: editEnv.headerQuote(21) } }
  await call('sale-amendment', { ...body, client_request_id: 'header-conflict' })
  assert.equal(conflict.quote.total_usd, 21)
  const frozenBeforeReview = loadPendingDirectMutation('sale-amendment', env.lineMutationActor, '17', storage)!.body
  assert.equal(frozenBeforeReview.client_request_id, 'header-conflict', 'receiving a conflict does not automatically replace the request')
  env.lineHeaderConflict = conflict
  env.withSaleLineMutationLock = withSaleLineMutationLock; env.replaceReviewedSaleLineHeader = replaceReviewedSaleLineHeader
  env.createSettlementRequestId = () => 'explicit-review-new'
  env.setLineReviewConfirm = (value: unknown) => { review = value }
  await actualDetailCallback('reviewLineHeader', env)()
  assert.equal(sends.length, 3, 'explicit Review does not submit the new financial request')
  const revised = loadPendingDirectMutation('sale-amendment', env.lineMutationActor, '17', storage)!.body
  assert.equal(revised.client_request_id, 'explicit-review-new'); assert.equal(revised.expected_updated_at, 'before'); assert.equal(revised.sale_item_id, 70)
  assert.equal(review.quote.total_usd, 21)
} finally { if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); else Reflect.deleteProperty(globalThis, 'navigator') }
console.log('PASS actual modal durable executor: lost ack, read-only reopen, receipt release and duplicate-click guard')

const transportSource = fs.readFileSync(new URL('../src/api/salesTransport.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
for (const name of ['addSaleItems', 'amendSale']) {
  const start = transportSource.indexOf(`export async function ${name}(`), end = transportSource.indexOf('\n}\n', start) + 2
  const code = transformSync(transportSource.slice(start, end).replace('export async', 'async'), { loader: 'ts' }).code
  let enrichments = 0
  const sent: unknown[] = []
  const env = {
    structuredClone, withExpectedUpdatedAt: async (_table: unknown, _id: unknown, body: unknown) => { enrichments++; return body },
    getDevicePayload: () => { enrichments++; return { device_id: 'today-device' } },
    route: (_key: unknown, dispatch: () => unknown) => dispatch(), encodeId: String,
    apiFetch: async (_method: unknown, _path: unknown, body: unknown) => { sent.push(body); return {} },
    getLocalDb: async () => ({ table: () => ({ update: async () => {} }) }), saleMoneyResponseFields: () => ({}), getResultTimestamp: () => 'now',
  }
  const call = new Function('env', `with(env) { ${code}; return ${name} }`)(env)
  const request = { money_precision_version: 1, client_request_id: 'stable', expected_updated_at: 'original', expected_exchange_rate: 4000, expected_header_quote: editEnv.headerQuote(20) }
  if (name === 'addSaleItems') { await call(17, [{ product_id: 7, quantity: 2 }], '', request); await call(17, [{ product_id: 7, quantity: 2 }], '', request) }
  else { await call(17, { ...request, kind: 'line_removed', sale_item_id: 70 }); await call(17, { ...request, kind: 'line_removed', sale_item_id: 70 }) }
  assert.equal(enrichments, 0, 'v1 frozen attempt is never enriched from current device/local saved row')
  assert.deepEqual(sent[0], sent[1])
  assert.equal((sent[0] as any).expected_updated_at, 'original')
}
console.log('PASS actual v1 add/amend transport: exact repeated bodies, no device/version enrichment')

// Run the actual explicit Review callback. Only its lazy transport import is
// substituted; the receipt ordering, state guards and durable write are real.
const reviewStart = posSource.indexOf('  const reviewCheckoutPrices = async')
const reviewEnd = posSource.indexOf('\n  }\n', reviewStart) + 4
const reviewCode = transformSync(posSource.slice(reviewStart, reviewEnd).replace("import('../../api/productReadTransport.ts')", 'loadProductTransport()'), { loader: 'tsx' }).code
async function reviewProbe(options: { proof?: unknown; marker?: boolean; denied?: boolean; stale?: boolean } = {}) {
  const initial = { id: 'order1', checkoutRequestId: 'request-1', checkoutPayload: frozen, checkoutReviewRequestId: options.marker === false ? undefined : 'request-1', cart: [{ ...cart[0], batch_id: 9, branch_id: 2, manual_discount_type: 'fixed', manual_discount_value: 0.1234 }] }
  const ordersRef = { current: [initial] }
  const calls: string[] = [], notices: string[] = [], stored = new Map<string, string>()
  let generation = 1
  const env: any = {
    resolvedActiveId: 'order1', ordersRef, loading: false, checkoutInFlightRef: { current: false },
    captureActorReadScope: () => generation, isActorReadScopeCurrent: (scope: number) => scope === generation,
    assertActorSessionDispatchAllowed: (scope: number) => { if (scope !== generation) throw new Error('stale actor') },
    setLoading: () => {}, moneyCapability: { assertReady: () => {} }, canonicalSaleReceipt, SaleCheckoutRecoveryRequiredError,
    getSaleWriteTransport: async () => ({ recoverSaleCreateReceipt: async () => { calls.push('receipt'); return options.proof ?? { committed: false } } }),
    loadProductTransport: async () => ({ getProductsByIds: async () => { calls.push('products'); if (options.denied) throw new Error('403'); if (options.stale) generation++; return { items: [{ id: 7, selling_price_usd: 12 }], promotion_rules: capturedPool.rules } } }),
    quoteSaleCartLines, exchangeRate: 4000, checkoutRequestIdsRef: { current: new Map([['order1', 'request-1']]) },
    posOrdersStorageKey: 'actor-scoped-draft', writePosDraft: (key: string, value: string) => { calls.push('persist'); stored.set(key, value) },
    localStorage: { getItem: (key: string) => stored.get(key) }, sessionStorage: { getItem: (key: string) => stored.get(key) },
    setOrders: (value: unknown) => { calls.push('orders') }, setPromotionRules: () => {}, setPromotionReadVersion: () => {},
    setReceiptQueue: () => calls.push('print'), closeOrder: () => calls.push('close'),
    notify: (message: string) => notices.push(message), getErrorMessage: (error: Error) => error.message, t: (key: string) => key,
  }
  await new Function('env', `with(env) { ${reviewCode}; return reviewCheckoutPrices }`)(env)()
  return { initial, ordersRef, calls, notices }
}
const reviewed = await reviewProbe()
assert.deepEqual(reviewed.calls, ['receipt', 'products', 'persist', 'orders'], 'Review is read-only until local draft persistence; it never submits')
assert.equal(reviewed.ordersRef.current[0].checkoutRequestId, '')
assert.equal(reviewed.ordersRef.current[0].cart[0].batch_id, 9)
assert.equal(reviewed.ordersRef.current[0].cart[0].manual_discount_value, 0.1234)
assert.equal((reviewed.ordersRef.current[0].cart[0] as unknown as { pricing_product: { selling_price_usd: number } }).pricing_product.selling_price_usd, 12)
assert.equal(reviewed.initial.checkoutPayload, frozen)
assert.deepEqual((await reviewProbe({ marker: false })).calls, [], 'unknown outcome has no Review authority')
for (const options of [{ denied: true }, { stale: true }]) {
  const failed = await reviewProbe(options)
  assert.equal(failed.ordersRef.current[0].checkoutPayload, frozen)
  assert.equal(failed.ordersRef.current[0].checkoutRequestId, 'request-1')
  assert.equal(failed.calls.includes('persist'), false)
}
assert.deepEqual((await reviewProbe({ proof: { committed: true, response: { id: 17, sale: saved } } })).calls, ['receipt', 'print', 'close'])
console.log('PASS actual explicit price Review: proof-first, no auto submit, intent preserved, uncertainty/denial/stale actor frozen')

const cartBundle = buildSync({ entryPoints: [fileURLToPath(new URL('../src/components/pos/CartItem.tsx', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react-dom'], write: false })
const cartModule = { exports: {} as any }
new Function('require', 'module', 'exports', cartBundle.outputFiles[0].text)(createRequire(import.meta.url), cartModule, cartModule.exports)
const cartProps = { item: { ...cart[0], quantity: 300, applied_price_usd: 9.9967, applied_price_khr: 39986.8, manual_discount_usd: 0 }, branches: [], moneyPrecisionVersion: 1,
  pricingQuote: { total_usd: 2999, total_khr: 11996000, manual_discount_usd: 0 },
  fmtUSD: (value: number) => `USD${value.toFixed(2)}`, fmtKHR: (value: number) => `KHR${value}`, usdSymbol: '$', khrSymbol: '៛',
  onQtyChange: () => {}, onPriceChange: () => {}, onDiscountChange: () => {}, onBranchChange: () => {}, onToggleTierTag: () => {}, onRemove: () => {}, onShowDetails: () => {} }
const cartHtml = renderToStaticMarkup(React.createElement(cartModule.exports.default, cartProps))
assert.ok(cartHtml.includes('USD2999.00'))
assert.ok(!cartHtml.includes('USD2999.01'), 'actual CartItem must not reconstruct the line from rounded unit×quantity')
assert.ok(cartHtml.includes('KHR11996000'))
const unavailableCart = renderToStaticMarkup(React.createElement(cartModule.exports.default, { ...cartProps, pricingQuote: undefined }))
assert.ok(!unavailableCart.includes('USD2999.01'), 'missing v1 quote is not permission for a per-unit fallback')
console.log('PASS actual CartItem static render: exact line USD/KHR and missing-quote refusal (not browser geometry certification)')
const receiptBundle = buildSync({ entryPoints: [fileURLToPath(new URL('../src/components/receipt/Receipt.tsx', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react-dom', '../../AppContext.tsx', '../../utils/printReceipt'], write: false })
const receiptModule = { exports: {} as any }, requireActual = createRequire(import.meta.url)
new Function('require', 'module', 'exports', receiptBundle.outputFiles[0].text)((path: string) => path.endsWith('AppContext.tsx') ? { useApp: () => ({ fmtUSD: cartProps.fmtUSD, fmtKHR: cartProps.fmtKHR, khrSymbol: '៛', t: (key: string) => key }) } : requireActual(path), receiptModule, receiptModule.exports)
const receiptSale = { ...pendingBody, id: 17, money_precision_version: 1, calculated_total_usd: 29, rounding_adjustment_usd: 0, items: [capturedRow], amount_paid_usd: 29, amount_paid_khr: 0, change_usd: 0, change_khr: 0 }
const receiptHtml = renderToStaticMarkup(React.createElement(receiptModule.exports.default, { sale: receiptSale, settings: {}, onClose: () => {} }))
assert.ok(receiptHtml.includes('USD29.00'))
assert.ok(receiptHtml.includes('KHR116000'))
assert.ok(!receiptHtml.includes('KHR116000.4'), 'actual Receipt uses exact saved line KHR, not rounded unit reconstruction')
assert.throws(() => renderToStaticMarkup(React.createElement(receiptModule.exports.default, { sale: { ...receiptSale, items: [{ ...capturedRow, pricing_snapshot_json: null }] }, settings: {}, onClose: () => {} })))
console.log('PASS actual Receipt static render: captured line totals and missing-proof refusal (not print geometry certification)')

// Execute the production pending-summary render after a reload: the reviewed
// durable quote, not today's recalculation, is what the operator will retry.
const pendingRenderStart = detailSource.lastIndexOf('{(() => {', detailSource.indexOf('// Display the durable reviewed request'))
const pendingRenderEnd = detailSource.indexOf('})()}', pendingRenderStart)
const pendingRenderCode = transformSync(`const render = () => ${detailSource.slice(pendingRenderStart + 1, pendingRenderEnd + 4)};`, { loader: 'tsx' }).code
const durableHeader = quoteSaleMutationHeader(saved, 2.2345, { tax_enabled: 'false', tax_rate: '0' })
const renderPending = (actor: string, quote: unknown) => {
  const env = { React, pendingLineMutation: { actor, body: { expected_header_quote: quote } }, lineMutationActor: 'actor-1', compareSaleHeaderQuote,
    headerQuote: () => quoteSaleMutationHeader(saved, 999, { tax_enabled: 'false', tax_rate: '0' }),
    t: (key: string) => key, fmtUSD: cartProps.fmtUSD, fmtKHR: cartProps.fmtKHR }
  const render = new Function(...Object.keys(env), `${pendingRenderCode}; return render;`)(...Object.values(env))
  return renderToStaticMarkup(render())
}
const pendingSummary = renderPending('actor-1', durableHeader)
assert.ok(pendingSummary.includes('USD2.23'))
assert.ok(!pendingSummary.includes('USD999.00'))
assert.ok(pendingSummary.includes('money_rounding_adjustment'))
assert.equal(renderPending('actor-2', durableHeader), '')
assert.equal(renderPending('actor-1', { total_usd: 999 }), '')
console.log('PASS actual reopened pending-summary render: durable quote, no current repricing, actor and malformed guards')

const identityBinding = { sale_id: 17, sale_item_id: 70, captured_product_id: 7, current_product_id: 20 }
const mergedItem = { ...capturedRow, sale_id: 17, product_id: 20 }
const mergedSale = { ...capturedSale, items: [mergedItem], pricing_identity_bindings: [identityBinding] }
const mergedEdits: any[] = []
actualDetailCallback('stageLineUpdate', { ...editEnv, sale: mergedSale, items: mergedSale.items, setAmendConfirm: (value: unknown) => mergedEdits.push(value) })(70, 3, 9.6667, null, 0, 0, 0.3333, 'Merged')
assert.equal(mergedEdits[0].request.pricing_quote.total_usd, 20, 'merged row uses original captured product7 rule, not product20 catalogue')
assert.equal(Object.hasOwn(mergedEdits[0].request, 'pricing_identity_bindings'), false, 'server lineage evidence is never mutation authority')
assert.equal(mergedItem.pricing_snapshot_json, capturedRow.pricing_snapshot_json)
const mergedReceipt = { ...receiptSale, items: [mergedItem], pricing_identity_bindings: [identityBinding] }
const canonicalMerged = canonicalSaleReceipt(mergedReceipt)
assert.equal(canonicalMerged.total_usd, 29)
;(canonicalMerged.pricing_identity_bindings as any[])[0].current_product_id = 999
assert.equal(identityBinding.current_product_id, 20, 'canonical lineage is detached from the response object')
const mergedHtml = renderToStaticMarkup(React.createElement(receiptModule.exports.default, { sale: mergedReceipt, settings: {}, onClose: () => {} }))
assert.ok(mergedHtml.includes('USD29.00') && mergedHtml.includes('KHR116000'))
for (const bindings of [undefined, [{ ...identityBinding, sale_id: 18 }], [{ ...identityBinding, sale_item_id: 71 }], [{ ...identityBinding, captured_product_id: 8 }], [{ ...identityBinding, current_product_id: 21 }], [identityBinding, identityBinding], [{ ...identityBinding, current_product_id: '20' }]]) {
  assert.throws(() => canonicalSaleReceipt({ ...mergedReceipt, pricing_identity_bindings: bindings }))
  assert.throws(() => capturedSaleLineEdit([mergedItem], { ...mergedSale, pricing_identity_bindings: bindings }, 70, { quantity: 2 }))
}
console.log('PASS merged canonical receipt and actual edit callback: exact row binding, immutable capture, no client authority')

let securityGeneration = 1, closeCount = 0, dispatchCount = 0
const reviewState = { actor: 'actor-1', detail: 'security-1:17', scope: 1, kind: 'sale-amendment', body: { client_request_id: 'original' }, quote: durableHeader }
let resolveReviewed!: (value: unknown) => void
const reviewEnv: any = { detailScope: reviewState.detail, detailScopeRef: { current: reviewState.detail }, detailAliveRef: { current: true },
  captureActorReadScope: () => securityGeneration, isActorReadScopeCurrent: (scope: number) => scope === securityGeneration,
  lineMutationActor: 'actor-1', lineReviewConfirm: reviewState,
  executeLineMutation: async () => { dispatchCount++; return await new Promise(resolve => { resolveReviewed = resolve }) }, onClose: () => { closeCount++ } }
const confirmActual = actualDetailCallback('retryLineMutationAndClose', reviewEnv)
const pendingConfirm = confirmActual('sale-amendment', reviewState.body, reviewState)
await Promise.resolve()
securityGeneration = 2
resolveReviewed({ committed: true })
await pendingConfirm
assert.equal(closeCount, 0, 'late previous-session completion cannot close the new modal')
await confirmActual('sale-amendment', reviewState.body, reviewState)
assert.equal(dispatchCount, 1, 'stale retained dialog handler cannot dispatch the old body')
const renderGuardText = detailSource.slice(detailSource.indexOf('{lineReviewConfirm?.actor'), detailSource.indexOf(' ? <ConfirmDialog', detailSource.indexOf('{lineReviewConfirm?.actor'))).slice(1)
const renderGuard = new Function('lineReviewConfirm', 'lineMutationActor', 'detailScope', 'isActorReadScopeCurrent', `return ${renderGuardText}`)
assert.equal(renderGuard(reviewState, 'actor-1', reviewState.detail, reviewEnv.isActorReadScopeCurrent), false, 'same actor changed session hides review synchronously before effects')
securityGeneration = 1
assert.equal(renderGuard(reviewState, 'actor-2', reviewState.detail, reviewEnv.isActorReadScopeCurrent), false)
assert.equal(renderGuard(reviewState, 'actor-1', 'security-1:18', reviewEnv.isActorReadScopeCurrent), false)
assert.equal(renderGuard(reviewState, 'actor-1', reviewState.detail, reviewEnv.isActorReadScopeCurrent), true)
console.log('PASS actual review render/confirm: synchronous actor/session/sale guard and post-await close fence')

import assert from 'node:assert/strict'
import { canonicalSaleReceipt, saleMoneyResponseFields, frozenSaleCheckoutBody, saleUsesSavedExchangeRate } from '../src/utils/saleMoneyV1.ts'
import { saleLineEditPreview, saleRemovalSubtotal } from '../src/utils/saleLineEditor.ts'
import fs from 'node:fs'
import { transformSync, buildSync } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { quoteSaleMutationHeader } from '../src/utils/saleMutationHeaderQuote.ts'
import { sellingPriceCeilCent, sumMoney4 } from '../src/utils/moneyPrecision.ts'
import { stagedLineFromSheetPick, stagedLinePricingIntent } from '../src/components/sales/saleAddLines.ts'
import { parseDeliveryAmountUsd, deliveryAmountChanged, DELIVERY_AMOUNT_ERROR_KEYS } from '../src/utils/deliveryAmounts.ts'
import { runSaleLineMutation, loadPendingDirectMutation } from '../src/utils/directMutationRequest.ts'

// Historical evidence is not a missing v1 snapshot to retrofit. Both currency
// projections and precision remain as recorded, even when they differ from a
// fresh conversion using the saved rate.
const recordedLine = { id: 70, sale_id: 17, product_id: 7, quantity: 2, base_price_usd: null,
  applied_price_usd: 1.23454, applied_price_khr: 4962.8508, total_usd: 2.46908, total_khr: 9926,
  manual_discount_type: null, manual_discount_value: null, manual_discount_usd: 0,
  cost_price_usd: null, pricing_snapshot_json: null }
const historicalSale = { id: 17, money_precision_version: 0, calculated_total_usd: null, rounding_adjustment_usd: 0,
  subtotal_usd: 2.4691, subtotal_khr: 9926, discount_usd: 0, membership_discount_usd: 0, tax_usd: 0,
  total_usd: 2.47, total_khr: 9926, exchange_rate: 4020, amount_paid_usd: 0, amount_paid_khr: 9926,
  items: [recordedLine] }
const original = JSON.stringify(historicalSale)
const canonical = canonicalSaleReceipt({ sale: historicalSale })
assert.equal(canonical.money_precision_version, 0)
assert.equal(canonical.calculated_total_usd, null)
assert.equal(canonical.rounding_adjustment_usd, 0)
assert.deepEqual(canonical.items, [recordedLine])
assert.equal(JSON.stringify(historicalSale), original)
const unknownSiblingSale = { ...historicalSale, items: [recordedLine, { ...recordedLine, id: 71, applied_price_usd: null, total_usd: null }] }
assert.deepEqual(canonicalSaleReceipt(unknownSiblingSale).items, unknownSiblingSale.items)
for (const invalid of [{ applied_price_usd: -1 }, { applied_price_usd: 'bad' }, { total_usd: -1 }, { total_usd: 'bad' }]) {
  assert.throws(() => canonicalSaleReceipt({ ...historicalSale, items: [{ ...recordedLine, ...invalid }] }))
}
assert.throws(() => saleLineEditPreview(unknownSiblingSale.items, historicalSale, 71, { quantity: 3 }), 'NULL recorded unit is unknown, never a free-price quantity edit')
assert.notEqual(canonical.items, historicalSale.items, 'canonical history is detached, not mutable input authority')
const response = saleMoneyResponseFields({ moneyPrecisionVersion: 0, calculatedTotalUsd: null, roundingAdjustmentUsd: 0, totalUsd: 3.7, items: [recordedLine] })
assert.equal(response.money_precision_version, 0, 'reviewed request1 must not override saved response parent0')
assert.equal(response.calculated_total_usd, null)
const oldPending = { ...historicalSale, client_request_id: 'historical-frozen', sale_status: 'completed' }
assert.deepEqual(frozenSaleCheckoutBody('historical-frozen', oldPending), oldPending, 'legacy exact pending body is never stamped by the new protocol')
const edited = saleLineEditPreview(historicalSale.items, historicalSale, 70, { quantity: 3 })!
assert.equal(edited.pricingBasis, 'recorded')
assert.equal(edited.lineTotalUsd, 3.7036)
assert.equal(edited.subtotalUsd, 3.7036)
assert.equal(edited.appliedPriceUsd, 1.23454, 'quantity-only edit preserves raw recorded unit')
assert.equal(edited.request.money_precision_version, 1, 'request is reviewed protocol only')
assert.equal(Object.hasOwn(edited.request, 'pricing_snapshot_json'), false)
assert.equal(JSON.stringify(historicalSale), original)
const residualHeader = { ...historicalSale, subtotal_usd: 2.46938 }
assert.equal(saleLineEditPreview(historicalSale.items, residualHeader, 70, { quantity: 3 })!.subtotalUsd, 3.7039, 'saved header residual survives exact changed-line delta')
const rawDeltaLine = { ...recordedLine, quantity: 1, applied_price_usd: 9.50005, total_usd: 9.50006 }
assert.equal(saleLineEditPreview([rawDeltaLine], { ...historicalSale, subtotal_usd: 19.00004 }, 70, { quantity: 2 })!.subtotalUsd, 28.5001, 'whole old subtotal minus old raw line plus new line rounds once')
assert.equal(saleRemovalSubtotal([{ ...recordedLine, total_usd: .50006 }], { ...historicalSale, subtotal_usd: 1.00004 }, 70, .50006).subtotalUsd, 1, 'replacement preserves original residual instead of rounding removal before adding')
assert.equal(saleRemovalSubtotal(historicalSale.items, residualHeader, 70).subtotalUsd, .0003)
assert.equal(saleLineEditPreview(historicalSale.items, historicalSale, 70, { quantity: 2 }), null, 'numeric no-op has no new quote/request')
const nullTotalLine = { ...recordedLine, total_usd: null }
const fallback = saleLineEditPreview([nullTotalLine], historicalSale, 70, { quantity: 3 })!
assert.equal(fallback.recordedTotalDerived, true)
assert.ok('expected_recorded_line_total_usd' in fallback.request)
assert.equal(fallback.request.expected_recorded_line_total_usd, 2.4691, 'missing target total requires visible recorded-unit fallback and explicit baseline in reviewed request')
const unrelatedUnknown = { ...recordedLine, id: 71, total_usd: null, applied_price_usd: null }
assert.equal(saleLineEditPreview([recordedLine, unrelatedUnknown], historicalSale, 70, { quantity: 3 })!.subtotalUsd, edited.subtotalUsd, 'unrelated unknown siblings are never repriced')
const editedHistory = { ...historicalSale, subtotal_usd: 3.7036, calculated_total_usd: 3.7036, rounding_adjustment_usd: -.0036, total_usd: 3.7, total_khr: 14874 }
const editedCanonical = canonicalSaleReceipt({ sale: editedHistory })
assert.equal(editedCanonical.money_precision_version, 0)
assert.equal(editedCanonical.calculated_total_usd, 3.7036)
assert.equal(editedCanonical.rounding_adjustment_usd, -.0036)
assert.equal(saleUsesSavedExchangeRate(editedHistory), true)
assert.equal(saleUsesSavedExchangeRate(historicalSale), false)
assert.throws(() => saleUsesSavedExchangeRate({ ...editedHistory, rounding_adjustment_usd: 0 }))
assert.deepEqual(editedCanonical.items, [recordedLine], 'rounding metadata is not authority to retrofit old items or require captured pricing')
for (const invalid of [{ subtotal_usd: 999 }, { total_khr: 999 }, { calculated_total_usd: '3.7036' }, { calculated_total_usd: 3.70361 }, { rounding_adjustment_usd: 0 }, { total_usd: 3.71 }, { calculated_total_usd: null, rounding_adjustment_usd: -.0036 }]) {
  assert.throws(() => canonicalSaleReceipt({ sale: { ...editedHistory, ...invalid } }), 'present historical monetary evidence must satisfy exact raw/adjustment/payable policy')
}

// Run production callbacks with real pricing/header helpers. Only surrounding
// state setters and transport are controlled; no copied financial arithmetic.
const source = fs.readFileSync(new URL('../src/components/sales/SaleDetailModal.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const auditSource = source.split('\n').find(line => line.includes("sub={`${t('money_calculated_total')}"))?.trim()
assert.ok(auditSource)
const auditExpression = transformSync(`const value = ${auditSource.slice(5, -1)}`, { loader: 'tsx' }).code
const renderDetailAudit = new Function('totals', 't', `${auditExpression}; return value`)
assert.equal(renderDetailAudit({ calculatedTotalUsd: 3.7036, roundingAdjustmentUsd: -.0036 }, (key: string) => key), 'money_calculated_total: USD 3.7036 · money_rounding_adjustment: USD -0.0036')
assert.match(renderDetailAudit({ calculatedTotalUsd: 3.6964, roundingAdjustmentUsd: .0036 }, (key: string) => key), /USD \+0\.0036$/)
function callback(name: string, env: Record<string, unknown>) {
  const start = source.indexOf(`  const ${name} = `), end = source.indexOf('\n  }\n', start) + 4
  assert.ok(start > 0 && end > start)
  return new Function('env', `with(env) { ${transformSync(source.slice(start, end), { loader: 'tsx' }).code}; return ${name} }`)(env)
}
const staged: any[] = [], errors: string[] = []
const header = { ...residualHeader, is_delivery: 1, delivery_fee_usd: 0, delivery_fee_paid_by: 'customer' }
const env = {
  sale: header, items: [recordedLine, unrelatedUnknown], amendQtyText: '3', amendPriceText: '1.23454', amendDiscountType: null, amendDiscountText: '0',
  saleLineEditPreview, saleRemovalSubtotal, sellingPriceCeilCent, sumMoney4,
  headerQuote: (subtotal: number, overrides?: any) => quoteSaleMutationHeader(header, subtotal, { tax_enabled: '0', tax_rate: '0' }, overrides),
  setAmendConfirm: (value: unknown) => staged.push(value), setAmendMutationError: (value: string) => errors.push(value),
  amendRequestIdRef: { current: '' }, createSettlementRequestId: () => 'historical-reviewed-id',
  t: (key: string) => key, translateOr: (key: string) => key, fmtUSD: (value: number) => value.toFixed(2),
  // The modal's own payer label, which only picks a pack key; the summary line
  // below is what the confirm dialog shows, so it has to resolve.
  payerLabel: (payer: string) => (payer === 'store' ? 'fee_by_store' : 'fee_by_customer'),
}
callback('stageLineUpdate', env)(70, 2, 1.23454, null, 0, 0, 0, 'Old item')
assert.equal(staged[0].request.pricing_quote.total_usd, 3.7036)
assert.equal(staged[0].request.pricing_quote.total_khr, 14888.472)
assert.equal(staged[0].request.expected_header_quote.subtotal_usd, 3.7039)
assert.equal(staged[0].request.expected_header_quote.exchange_rate, 4020)
assert.match(staged[0].summary, /sale_recorded_pricing/)
assert.equal(Object.hasOwn(staged[0].request, 'selling_price_input_usd'), false)
assert.equal(Object.hasOwn(staged[0].request, 'pricing_snapshot_json'), false)
callback('stageLineUpdate', { ...env, amendQtyText: '2' })(70, 2, 1.23454, null, 0, 0, 0, 'Old item')
assert.equal(staged.length, 1, 'no-op cannot create a new request or reprice history')
callback('stageLineUpdate', { ...env, amendPriceText: '1.2301' })(70, 2, 1.23454, null, 0, 0, 0, 'Old item')
assert.equal(staged.at(-1).request.selling_price_input_usd, 1.24)
assert.equal(staged.at(-1).request.pricing_quote.total_usd, 3.72)
for (const [mode, text] of [['fixed', '0.1234'], ['percent', '33.3333']] as const) {
  callback('stageLineUpdate', { ...env, amendDiscountType: mode, amendDiscountText: text })(70, 2, 1.23454, null, 0, 0, 0, 'Old item')
  assert.equal(staged.at(-1).request.manual_discount_type, mode)
  assert.equal(staged.at(-1).request.manual_discount_value, Number(text))
  assert.equal(Object.hasOwn(staged.at(-1).request, 'selling_price_input_usd'), false)
}
const beforeInvalid = staged.length
callback('stageLineUpdate', { ...env, amendPriceText: '-0.000001' })(70, 2, 1.23454, null, 0, 0, 0, 'Old item')
assert.equal(staged.length, beforeInvalid)
callback('stageLineUpdate', { ...env, items: [nullTotalLine] })(70, 2, 1.23454, null, 0, 0, 0, 'Old item')
assert.equal(staged.at(-1).request.expected_recorded_line_total_usd, 2.4691)
assert.match(staged.at(-1).summary, /sale_recorded_unit_fallback/)
callback('stageRemoval', env)(70, 2, 'Old item')
assert.equal(staged.at(-1).request.expected_header_quote.subtotal_usd, .0003)
callback('stageReplacement', { ...env, replaceLineId: 70, toNumber: Number, savedExchangeRate: 4020,
  moneyCapability: { assertReady: () => {} }, stagedLineFromSheetPick, stagedLinePricingIntent, setAddQuery: () => {}, setAddCandidates: () => {} })({ id: 8, name: 'Replacement', selling_price_usd: 1.2301, stock_quantity: 10 }, '2')
assert.equal(staged.at(-1).request.replacement.pricing_quote.total_usd, 2.48)
assert.equal(staged.at(-1).request.expected_header_quote.subtotal_usd, 2.4803)
assert.equal(staged.at(-1).request.replacement.pricing_quote.total_khr, 9969.6)
const replacementResidualHeader = { ...header, subtotal_usd: 1, total_usd: 1 }
callback('stageReplacement', { ...env, sale: replacementResidualHeader, items: [{ ...recordedLine, quantity: 1, applied_price_usd: 1, total_usd: 1.00005 }],
  replaceLineId: 70, toNumber: Number, savedExchangeRate: 4020,
  headerQuote: (subtotal: number) => quoteSaleMutationHeader(replacementResidualHeader, subtotal, { tax_enabled: '0', tax_rate: '0' }),
  moneyCapability: { assertReady: () => {} }, stagedLineFromSheetPick, stagedLinePricingIntent, setAddQuery: () => {}, setAddCandidates: () => {} })({ id: 8, name: 'Replacement', selling_price_usd: .01, stock_quantity: 10 }, '2')
assert.equal(staged.at(-1).request.expected_header_quote.subtotal_usd, .01, 'actual replacement combines complete expression before refusing a negative intermediate removal or rounding a half tie')
callback('stageDeliveryFeeAmendment', { ...env, feeText: '1.2345', feePayer: 'customer', deliveryPaidByStore: false, parseDeliveryAmountUsd, deliveryAmountChanged, DELIVERY_AMOUNT_ERROR_KEYS })(0)
assert.equal(staged.at(-1).request.delivery_fee_usd, 1.2345)
assert.equal(staged.at(-1).request.expected_header_quote.subtotal_usd, 2.46938, 'fee preview retains raw saved subtotal verbatim; no item sum')
assert.equal(Object.hasOwn(staged.at(-1).request, 'items'), false)

// P10-23: a delivery rung up as free must be correctable to customer-paid
// after the sale. The amount does not move at all here -- only the payer --
// which is precisely the shape the old "already that amount" refusal
// swallowed, so the callback is run for real rather than source-matched.
const freeHeader = { ...header, delivery_fee_usd: 1.5, delivery_fee_paid_by: 'store' }
callback('stageDeliveryFeeAmendment', { ...env, sale: freeHeader, feeText: '1.5', feePayer: 'customer', deliveryPaidByStore: true,
  headerQuote: (subtotal: number, overrides?: any) => quoteSaleMutationHeader(freeHeader, subtotal, { tax_enabled: '0', tax_rate: '0' }, overrides),
  parseDeliveryAmountUsd, deliveryAmountChanged, DELIVERY_AMOUNT_ERROR_KEYS })(1.5)
assert.equal(staged.at(-1).request.delivery_fee_paid_by, 'customer', 'a payer-only correction still stages a request')
assert.equal(staged.at(-1).request.delivery_fee_usd, 1.5, 'and it leaves the amount exactly as recorded')
// The opposite half: nothing moved at all is still refused, which is the
// reason that refusal exists.
const beforeNoop = staged.length
callback('stageDeliveryFeeAmendment', { ...env, sale: freeHeader, feeText: '1.5', feePayer: 'store', deliveryPaidByStore: true,
  parseDeliveryAmountUsd, deliveryAmountChanged, DELIVERY_AMOUNT_ERROR_KEYS })(1.5)
assert.equal(staged.length, beforeNoop, 'an unchanged amount AND an unchanged payer stages nothing')
callback('stageActualDeliveryCostAmendment', { ...env, actualCostText: '0.1234', parseDeliveryAmountUsd, deliveryAmountChanged, DELIVERY_AMOUNT_ERROR_KEYS })(null)
assert.equal(staged.at(-1).request.delivery_actual_cost_usd, .1234)
assert.equal(Object.hasOwn(staged.at(-1).request, 'expected_header_quote'), false, 'cost-only action cannot reprice basket')
const newLine = stagedLineFromSheetPick({ id: 8, name: 'New', selling_price_usd: 1.2301, stock_quantity: 10 }, { branchId: '2', batch: { batchId: 9, quantity: 10 } }, 1)!
for (const result of [{ committed: true }, { mutationError: 'timeout' }, { mutationError: '403' }]) {
  const bodies: any[] = [], cleared: unknown[] = []
  await callback('submitAddItems', { ...env, onAddItems: async () => {}, addLines: [newLine], addHasStockError: false,
    detailScope: 'actor7:sale17', detailScopeRef: { current: 'actor7:sale17' }, detailAliveRef: { current: true }, setAddSaving: () => {},
    moneyCapability: { assertReady: () => {} }, savedExchangeRate: 4020, stagedLinePricingIntent,
    addRequestIdRef: { current: 'history-add' }, settlementSession: { expectedUpdatedAt: 'old-revision' },
    addReviewedHeader: env.headerQuote(sumMoney4([header.subtotal_usd, 1.24])),
    executeLineMutation: async (_kind: unknown, body: unknown) => { bodies.push(body); return result },
    setAddMutationError: () => {}, localizeBranchRuleError: (text: string) => text,
    setAddLines: (value: unknown) => cleared.push(value), setAddConfirmOpen: () => {}, onClose: () => cleared.push('closed'),
  })()
  assert.equal(bodies[0].money_precision_version, 1, 'new intent protocol never changes saved parentversion')
  assert.equal(bodies[0].expected_exchange_rate, 4020)
  assert.equal(bodies[0].expected_header_quote.subtotal_usd, 3.7094)
  assert.equal(bodies[0].items[0].batch_id, 9)
  assert.equal(bodies[0].items[0].pricing_quote.total_khr, 4984.8)
  assert.equal(cleared.length, 'committed' in result ? 2 : 0, 'failed add retains historical form and original request identity')
}
assert.equal(JSON.stringify(historicalSale), original)
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_name: string, _options: unknown, run: () => unknown) => run() } } })
try {
  const rows = new Map<string, string>(), writes: unknown[] = [], events: string[] = []
  const storage = { get length() { return rows.size }, key: (index: number) => [...rows.keys()][index] ?? null,
    getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value) }, removeItem: (key: string) => { rows.delete(key) } }
  let available = true, actorCurrent = true, receipt: any = { committed: false }
  const mutationEnv = { ...env, lineWriteOwnerRef: { current: null }, captureActorReadScope: () => ({}), isActorReadScopeCurrent: () => actorCurrent,
    detailScope: 'actor7:sale17', detailScopeRef: { current: 'actor7:sale17' }, detailAliveRef: { current: true }, authReady: true, user: { id: 7 }, lineMutationActor: 'origin:actor7',
    setLineRecoveryBusy: () => {}, setPendingLineMutation: () => {}, setLineRecoveryError: () => {}, setLineHeaderConflict: () => {}, setLineReviewConfirm: () => {}, setAddConfirmOpen: () => {},
    runSaleLineMutation, getSaleLineReceipt: async () => { events.push('receipt'); return receipt }, window: { localStorage: storage, dispatchEvent: () => {} }, CustomEvent: class {},
    moneyCapability: { assertReady: () => {}, assertFreshReady: async () => { events.push('fresh-schema'); if (!available) throw new Error('schema unavailable') } },
    onAmend: async (_id: unknown, body: unknown) => { events.push('write'); writes.push(body); throw new Error('lost acknowledgement') },
  }
  const execute = callback('executeLineMutation', mutationEnv)
  const body = { ...staged[0].request, client_request_id: 'frozen-history', expected_exchange_rate: 4020, expected_updated_at: 'old-revision' }
  await assert.rejects(execute('sale-amendment', body), /lost acknowledgement/)
  const exact = JSON.stringify(writes[0]), frozenSlot = [...rows.values()][0]
  assert.deepEqual(events, ['fresh-schema', 'write'])
  available = false
  await assert.rejects(execute('sale-amendment'), /schema unavailable/)
  assert.equal(writes.length, 1)
  assert.equal([...rows.values()][0], frozenSlot, 'schema rollback preserves unknown exact request, never discards/reconstructs it')
  assert.deepEqual(events.slice(-2), ['receipt', 'fresh-schema'], 'receipt recovery precedes schema admission')
  await execute('sale-amendment', undefined, true)
  assert.equal(writes.length, 1, 'reopen is read-only even after schema rollback')
  assert.ok(loadPendingDirectMutation('sale-amendment', 'origin:actor7', '17', storage))
  assert.equal(loadPendingDirectMutation('sale-amendment', 'origin:actor8', '17', storage), null)
  available = true
  mutationEnv.moneyCapability.assertFreshReady = async () => { actorCurrent = false }
  await assert.rejects(execute('sale-amendment'), /session changed/)
  assert.equal(writes.length, 1, 'actor change during fresh probe cannot dispatch old body')
  actorCurrent = true; receipt = { committed: true, response: { sale: editedHistory } }
  await execute('sale-amendment', undefined, true)
  assert.equal(rows.size, 0, 'only authoritative committed receipt releases the pending slot')
  assert.equal(JSON.stringify(writes[0]), exact)
} finally {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
  else Reflect.deleteProperty(globalThis, 'navigator')
}
console.log('PASS historical canonical response: null provenance, original USD/KHR evidence and frozen legacy body preserved')
console.log('PASS actual historical edit/remove/replace/delivery callbacks: recorded basis, exact review, saved FX and no-op preservation')
const receiptModule = { exports: {} as any }, requireActual = createRequire(import.meta.url)
const receiptBundle = buildSync({ entryPoints: [fileURLToPath(new URL('../src/components/receipt/Receipt.tsx', import.meta.url))], bundle: true,
  platform: 'node', format: 'cjs', external: ['react', 'react-dom', '../../AppContext.tsx', '../../utils/printReceipt'], write: false })
new Function('require', 'module', 'exports', receiptBundle.outputFiles[0].text)((name: string) => name.endsWith('AppContext.tsx')
  ? { useApp: () => ({ fmtUSD: (value: number) => `USD${value.toFixed(2)}`, fmtKHR: (value: number) => `KHR${value}`, khrSymbol: '៛', t: (key: string) => key }) }
  : requireActual(name), receiptModule, receiptModule.exports)
const renderReceipt = (sale: unknown) => renderToStaticMarkup(React.createElement(receiptModule.exports.default, { sale, settings: {}, onClose: () => {} }))
assert.match(renderReceipt(editedHistory), /money_rounding_down/)
assert.match(renderReceipt(editedHistory), /&lt; USD0\.01/)
assert.doesNotMatch(renderReceipt(editedHistory), /-USD0\.00/)
const upHtml = renderReceipt({ ...editedHistory, calculated_total_usd: 3.6964, rounding_adjustment_usd: .0036, subtotal_usd: 3.6964 })
assert.match(upHtml, /money_rounding_up/)
assert.match(upHtml, /&lt; USD0\.01/)
assert.doesNotMatch(upHtml, /\+USD0\.00/)
const zeroHtml = renderReceipt({ ...editedHistory, calculated_total_usd: 3.7, rounding_adjustment_usd: 0, subtotal_usd: 3.7 })
assert.doesNotMatch(zeroHtml, /money_rounding_(?:up|down|adjustment)/)
for (const adjustment of [-.006, .006]) assert.throws(() => renderReceipt({ ...editedHistory,
  subtotal_usd: 3.7 - adjustment, calculated_total_usd: 3.7 - adjustment, rounding_adjustment_usd: adjustment }),
  'six-mill adjustment cannot be a valid nearest-cent saved snapshot; actual receipt refuses it rather than inventing a payable')
assert.match(renderReceipt(editedHistory), /USD3.70/)
assert.doesNotMatch(renderReceipt(historicalSale), /money_rounding_adjustment/)
const unknownHtml = renderReceipt({ ...historicalSale, items: [{ ...recordedLine, product_name: 'UNKNOWN LINE', applied_price_usd: null, total_usd: null, total_khr: null }] })
const unknownStart = unknownHtml.indexOf('UNKNOWN LINE')
assert.ok(unknownStart > 0)
const unknownRow = unknownHtml.slice(unknownStart, unknownHtml.indexOf('data-receipt-line="true"', unknownStart))
assert.match(unknownRow, /—/)
assert.doesNotMatch(unknownRow, /USD0\.00|KHR0/)
assert.equal((unknownRow.match(/—/g) || []).length, 2, 'unknown unit and total are individually marked, not reconstructed')
const knownDiscountHtml = renderReceipt({ ...historicalSale, subtotal_usd: 18, total_usd: 18, items: [{ ...recordedLine,
  product_name: 'KNOWN DISCOUNT', base_price_usd: 10, applied_price_usd: 9, manual_discount_usd: 1, manual_discount_type: 'fixed', manual_discount_value: 1, total_usd: 18, total_khr: 72360 }] })
const knownStart = knownDiscountHtml.indexOf('KNOWN DISCOUNT')
const knownRow = knownDiscountHtml.slice(knownStart, knownDiscountHtml.indexOf('data-receipt-line="true"', knownStart))
assert.match(knownRow, /USD10\.00[\s\S]*\(-USD1\.00\)[\s\S]*USD18\.00/, 'unknown guards preserve known selling price, adjacent unit saving and charged line total')
assert.equal(JSON.stringify(historicalSale), original)
console.log('PASS actual Receipt static render: historical present rounding visible, untouched NULL metadata stays absent; physical print geometry not certified')

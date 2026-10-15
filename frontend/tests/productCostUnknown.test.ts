// S12 (cost-unknown lane): the product forms and product displays keep an
// unknown cost unknown. Owner rule: a typed $0 stays $0, an empty or cleared
// cost is unknown (null) and never becomes 0, a cost hidden by permission
// stays absent.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import * as writeHelpers from '../src/components/products/helpers/productWriteHelpers.ts'
import { buildProductExportRows } from '../src/components/products/helpers/productExport.ts'
import { buildProductRowDisplayState } from '../src/components/products/helpers/productDisplayHelpers.ts'
import { formatBreakdownFormula, normalizeCostBreakdown } from '../src/utils/costBreakdownFormat.ts'
import * as costBreakdownFormat from '../src/utils/costBreakdownFormat.ts'
import * as costDisplay from '../src/utils/costDisplay.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcRoot = path.join(here, '..', 'src')
const read = (file: string) => fs.readFileSync(path.join(srcRoot, file), 'utf8')
const require = createRequire(import.meta.url)

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const helpers = writeHelpers as unknown as {
  editableCostText: (value: unknown) => string
  costInputToPayload: (raw: unknown) => number | null
  buildProductWritePayload: (snapshot: Record<string, unknown>, user?: Record<string, unknown>) => Record<string, unknown>
  buildProductClearStockAdjustments: (product: Record<string, unknown>) => Array<Record<string, unknown>>
  buildProductBulkPriceAdjustments: (products: Array<Record<string, unknown>>, adjustment: Record<string, unknown>) => Array<{ id: number; updates: Record<string, unknown> }>
  buildProductBulkPricingUpdates: (form: Record<string, unknown>) => Record<string, unknown>
}

function loadTsx(file: string, mocks: Record<string, unknown>): Record<string, any> {
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} as Record<string, any> }
  const mockedRequire = (id: string): unknown => {
    if (id === 'react') return React
    if (id === 'react/jsx-runtime') return require(id)
    for (const [needle, value] of Object.entries(mocks)) if (id.includes(needle)) return value
    throw new Error(`Unexpected dependency: ${id}`)
  }
  new Function('require', 'module', 'exports', code)(mockedRequire, module, module.exports)
  return module.exports
}

const Stub = () => null
const primitives = loadTsx('components/products/shared/primitives.tsx', {
  'lucide-react': { default: Stub },
  publicAssetUrls: { resolvePublicAssetUrl: (value: string) => value },
  imageVariantUrl: { toImageVariantPath: (value: string) => value },
})
const MarginCard = primitives.MarginCard as (props: Record<string, unknown>) => React.ReactElement

function renderMargin(costUsd: number | null, sellingUsd = 10): string {
  return renderToStaticMarkup(React.createElement(MarginCard, { costUsd, sellingUsd, usdSymbol: '$', labels: { unknown: 'Unknown cost' } }))
}

await runTest('a NULL cost loads as an empty input, a recorded $0 as "0"', () => {
  assert.equal(helpers.editableCostText(null), '')
  assert.equal(helpers.editableCostText(undefined), '')
  assert.equal(helpers.editableCostText(''), '')
  assert.equal(helpers.editableCostText(0), '0')
  assert.equal(helpers.editableCostText('0'), '0')
  assert.equal(helpers.editableCostText(2.3457), '2.3457')
  const form = read('components/products/forms/ProductForm.tsx')
  assert.match(form, /cost_price_usd: editableCostText\(initialForm\.cost_price_usd\)/)
  assert.match(form, /cost_price_khr: editableCostText\(initialForm\.cost_price_khr\)/)
})

await runTest('saving an empty cost sends null, a typed 0 sends 0', () => {
  for (const invalid of ['.', '100000000001', '-1']) assert.throws(() => helpers.costInputToPayload(invalid), /Invalid cost input/)
  for (const empty of ['', '   ', null, undefined]) assert.equal(helpers.costInputToPayload(empty), null, `empty ${String(empty)}`)
  assert.equal(helpers.costInputToPayload('0'), 0)
  assert.equal(helpers.costInputToPayload('0.00'), 0)
  assert.equal(helpers.costInputToPayload(0), 0)
  assert.equal(helpers.costInputToPayload('1,234.5'), 1234.5)
  assert.equal(helpers.costInputToPayload('2.34567'), 2.3457, 'four-place internal money')
  const form = read('components/products/forms/ProductForm.tsx')
  assert.match(form, /cost_price_usd: costInputToPayload\(canViewCosts \? form\.cost_price_usd : blindCostInputs\.usd\)/)
  assert.match(form, /cost_price_khr: costInputToPayload\(canViewCosts \? form\.cost_price_khr : blindCostInputs\.khr\)/)
  assert.doesNotMatch(form, /cost_price_usd: normalizeInternalMoney\(parseNumericInput/, 'no 0 default for a cleared cost')
})

await runTest('a new product defaults to an unknown cost, not 0', () => {
  const form = read('components/products/forms/ProductForm.tsx')
  assert.match(form, /cost_price_usd: null,\s+cost_price_khr: null,\s+stock_quantity: 0/)
  assert.equal(helpers.costInputToPayload(editableDefault(null)), null)
  function editableDefault(value: unknown): string { return helpers.editableCostText(value) }
})

await runTest('the cost input says "Unknown" when empty and the review row does not print $0.00', () => {
  const form = read('components/products/forms/ProductForm.tsx')
  assert.match(form, /placeholderUsd=\{tr\('cost_input_unknown_placeholder'/)
  assert.match(form, /costInputPreview\(form\.cost_price_usd\) === null \? tr\('cost_unknown'/)
  assert.match(read('components/products/shared/primitives.tsx'), /placeholder=\{placeholderUsd \|\| '0\.00'\}/)
})

await runTest('variant modal shows the cost field only with product_cost_view or product_cost_edit and sends it only with edit', () => {
  const source = read('components/products/forms/VariantFormModal.tsx')
  assert.match(source, /const canViewCosts = canViewAcquisitionCosts\(user\)/)
  assert.match(source, /const canEditCosts = canEditAcquisitionCosts\(user\)/)
  assert.match(source, /\{canViewCosts \|\| canEditCosts \? <div className="min-w-0">\s+<label htmlFor="variant-form-cost-price"/)
  assert.match(source, /disabled=\{!canEditCosts\}/)
  assert.match(source, /cost_price_usd: canViewCosts \? editableCostText\(parent\.cost_price_usd\) : ''/, 'no parent cost leaks into the form without view')
  assert.match(source, /createProductVariant\(omitUnauthorizedCatalogCosts\(\{/)
  assert.match(source, /snapshot: omitUnauthorizedCatalogCosts\(\{/)
  assert.doesNotMatch(source, /cost_price_usd: editableMoneyValue\(parent\.cost_price_usd \|\| 0\)/, 'an unknown parent cost is not seeded as 0')
  assert.doesNotMatch(source, /cost_price_usd: normalizeInternalMoney\(parseNumericInput/)
})

await runTest('margin card: a recorded $0 cost shows a margin, an unknown cost shows a dash', () => {
  const zero = renderMargin(0)
  assert.match(zero, /\$0\.00/)
  assert.match(zero, /\$10\.00/)
  assert.match(zero, /Margin \(100\.0%\)/)
  const unknown = renderMargin(null)
  assert.match(unknown, />Unknown cost</)
  assert.match(unknown, />—</)
  assert.doesNotMatch(unknown, /%\)/)
  assert.doesNotMatch(unknown, /\$10\.00<\/div><div[^>]*>Margin/, 'unknown cost never shows selling price as the margin')
  assert.doesNotMatch(unknown, /below cost/)
  const real = renderMargin(4)
  assert.match(real, /\$6\.00/)
  assert.match(real, /Margin \(60\.0%\)/)
  assert.match(renderMargin(12), /below cost/)
})

await runTest('product row display state separates a $0 cost from an unknown cost', () => {
  const zero = buildProductRowDisplayState({ selling_price_usd: 10, cost_price_usd: 0 } as never) as Record<string, unknown>
  assert.equal(zero.costKnown, true)
  assert.equal(zero.marginKnown, true)
  assert.equal(zero.marginUsd, 10)
  const unknown = buildProductRowDisplayState({ selling_price_usd: 10, cost_price_usd: null } as never) as Record<string, unknown>
  assert.equal(unknown.costKnown, false)
  assert.equal(unknown.marginKnown, false)
  const hidden = buildProductRowDisplayState({ selling_price_usd: 10 } as never) as Record<string, unknown>
  assert.equal(hidden.costKnown, false, 'a cost hidden by permission is not a known cost')
  const real = buildProductRowDisplayState({ selling_price_usd: 10, cost_price_usd: 4 } as never) as Record<string, unknown>
  assert.equal(real.costKnown, true)
  assert.equal(real.marginUsd, 6)
})

await runTest('detail surfaces: a $0 cost has a margin, a NULL cost reads unknown with a dash margin', () => {
  const modal = read('components/products/surfaces/ProductDetailModal.tsx')
  assert.match(modal, /const costUsdValue = knownCost\(p\.cost_price_usd !== undefined \? p\.cost_price_usd : p\.purchase_price_usd\)/)
  assert.match(modal, /costUsdValue !== null && sellingUsd > 0 \? \(/)
  assert.match(modal, /<CostValue value=\{costUsdValue\}/)
  assert.doesNotMatch(modal, /purchaseUsd/)
  const sheet = read('components/pos/ProductDetailSheet.tsx')
  assert.match(sheet, /<CostValue value=\{product\.cost_price_usd\}/)
  assert.match(sheet, /<CostValue value=\{effectiveVariant\.cost_price_usd\}/)
  assert.doesNotMatch(sheet, /fmtUSD\(asNumber\((product|effectiveVariant)\.cost_price_usd \|\| 0\)\)/)
})

await runTest('export keeps the cost column with an empty cell for NULL, $0.00 for a recorded zero, and no column when hidden', () => {
  const rows = buildProductExportRows([
    { name: 'Unknown', cost_price_usd: null, cost_price_khr: null },
    { name: 'Free', cost_price_usd: 0, cost_price_khr: 0 },
    { name: 'Paid', cost_price_usd: 3, cost_price_khr: 12000 },
  ] as never, { canViewCosts: true })
  assert.equal(rows[0].Cost_Price_USD, '')
  assert.equal(rows[0].Cost_Price_KHR, '')
  assert.ok('Cost_Price_USD' in rows[0] && 'Cost_Price_KHR' in rows[0], 'column present on every row (not ragged)')
  assert.equal(rows[1].Cost_Price_USD, '0.00')
  assert.equal(rows[2].Cost_Price_USD, '3.00')
  assert.deepEqual(Object.keys(rows[0]), Object.keys(rows[2]), 'every row has the same columns')
  const hidden = buildProductExportRows([{ name: 'X', cost_price_usd: 5 }] as never, { canViewCosts: false })[0]
  assert.ok(!('Cost_Price_USD' in hidden))
  const redacted = buildProductExportRows([{ name: 'Redacted' }] as never, { canViewCosts: true })[0]
  assert.ok(!('Cost_Price_USD' in redacted), 'a redacted value is not exported as an empty cell')
})

await runTest('restore payload keeps NULL cost NULL and a recorded $0 as 0', () => {
  const unknown = helpers.buildProductWritePayload({ name: 'A', cost_price_usd: null, cost_price_khr: null, purchase_price_usd: 0, purchase_price_khr: 0 })
  assert.equal(unknown.cost_price_usd, null)
  assert.equal(unknown.cost_price_khr, null)
  const zero = helpers.buildProductWritePayload({ name: 'A', cost_price_usd: 0, cost_price_khr: 0, purchase_price_usd: 5 })
  assert.equal(zero.cost_price_usd, 0, 'a recorded $0 is not replaced by the purchase mirror')
  const known = helpers.buildProductWritePayload({ name: 'A', cost_price_usd: 4.5, cost_price_khr: 18000 })
  assert.equal(known.cost_price_usd, 4.5)
  assert.equal(known.cost_price_khr, 18000)
  const legacy = helpers.buildProductWritePayload({ name: 'A', purchase_price_usd: 7 })
  assert.equal(legacy.cost_price_usd, 7, 'a snapshot with no cost key still reads the purchase column')
  const bare = helpers.buildProductWritePayload({ name: 'A' })
  assert.ok(!('cost_price_usd' in bare), 'no cost key means redacted, not an explicit clear')
})

await runTest('clearing stock does not value the removal at $0 when the cost is unknown', () => {
  const [unknown] = helpers.buildProductClearStockAdjustments({ cost_price_usd: null, purchase_price_usd: 0, cost_price_khr: null, branch_stock: [{ branch_id: 1, quantity: 3 }] })
  assert.equal(unknown.unitCostUsd, null)
  assert.equal(unknown.unitCostKhr, null)
  const [known] = helpers.buildProductClearStockAdjustments({ cost_price_usd: 2.5, purchase_price_usd: 0, branch_stock: [{ branch_id: 1, quantity: 3 }] })
  assert.equal(known.unitCostUsd, 2.5)
  const [free] = helpers.buildProductClearStockAdjustments({ cost_price_usd: 0, purchase_price_usd: 0, branch_stock: [{ branch_id: 1, quantity: 3 }] })
  assert.equal(free.unitCostUsd, 0)
})

function productCallback(name: string, scope: Record<string, unknown>, file = 'components/products/Products.tsx'): (...args: any[]) => Promise<void> {
  const source = ts.createSourceFile('Products.tsx', read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let body = ''
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) body = (ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer).getText(source)
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) body = node.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(body, `actual ${name} callback found`)
  const code = ts.transpileModule(`const callback = ${body}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  return new Function(...Object.keys(scope), `${code};return callback`)(...Object.values(scope))
}

await runTest('nonblank unsupported costs refuse in actual product/variant save callbacks with localized guidance', async () => {
  const access = require('../src/utils/acquisitionCostAccess.ts')
  const guards = require('../src/utils/actionGuards.ts')
  for (const language of ['en', 'km']) for (const invalid of ['.', '100000000001', '-1', 'not money']) {
    const pack = JSON.parse(read(`lang/${language}.json`))
    const messages: string[] = []
    let writes = 0
    const form = { name: 'Existing', barcode: '', cost_price_usd: invalid, cost_price_khr: '' }
    const common = {
      form, canEditCosts: true, canViewCosts: true, blindCostInputs: { usd: '', khr: '' },
      isValidCostInput: (writeHelpers as Record<string, any>).isValidCostInput,
      costInputToPayload: writeHelpers.costInputToPayload, saving: false, saveInFlightRef: { current: false },
      tr: (key: string, fallback: string) => pack[key] || fallback, user: { id: 1, role_code: 'admin' },
      omitUnauthorizedCatalogCosts: access.omitUnauthorizedCatalogCosts,
    }
    const productScope = {
      ...common, imageUploading: false, imageUploadInFlightRef: { current: false }, aliveRef: { current: true },
      currentFormDraftKeyRef: { current: 'A' }, draftKey: 'A', draftScope: null, product: null,
      scopedWorkDraftKey: () => 'A', productFormDraftBaseKey: () => 'A', draftAuthority: { authority: {} },
      isDraftAuthorityCurrent: () => true, setSaveAuthorityWarning: () => {}, refuseWhileAPhotoFailed: () => false,
      alert: (message: string) => messages.push(message), isCreateMode: false, createSessionDuplicate: false,
      createVerdict: { kind: null }, branches: [], onSave: async () => { writes++ },
      canManageImages: false, initialForm: {}, normalizeGallery: () => [], ADMIN_MAX_PRODUCT_GALLERY_IMAGES: 5,
      normalizePriceValue: Number, parseNumericInput: (value: unknown) => Number(value || 0), normalizeInternalMoney: Number,
      showReceivedDate: false, canonicalizePersistedMediaPath: (value: unknown) => value,
      askSaveConfirm: async () => true, flushPendingWorkDraft: () => {}, readWorkDraft: () => null,
      restoredLegacyDraftKeyRef: { current: null }, setSaving: () => {}, clearUnchangedWorkDraft: () => true,
      clearCurrentProductDraft: () => {}, onClose: () => {}, getErrorMessage: (error: Error) => error.message,
      clearAfterSuccessfulProductSave: async (save: () => Promise<void>, clear: () => void, close: () => void) => { await save(); clear(); close() },
    }
    await productCallback('saveForm', productScope, 'components/products/forms/ProductForm.tsx')()
    assert.equal(writes, 0)
    assert.deepEqual(messages, [pack.cost_input_invalid], `product refusal in ${language}`)
    messages.length = 0
    const variantScope = {
      ...common, beginSingleAction: guards.beginSingleAction, finishSingleAction: guards.finishSingleAction,
      setSaving: () => {}, setErr: (message: string) => { if (message) messages.push(message) },
      runVariantMutation: (fn: () => unknown) => fn(), getProductVariantApi: () => ({ createProductVariant: () => { writes++; return { success: true } } }),
      normalizePriceValue: Number, parseNumericInput: (value: unknown) => Number(value || 0),
      notify: () => {}, parent: { name: 'Parent' }, onDone: undefined, extractHistoryResultId: () => 1,
      getErrorMessage: (error: Error) => error.message,
    }
    await productCallback('handleSave', variantScope, 'components/products/forms/VariantFormModal.tsx')()
    assert.equal(writes, 0)
    assert.deepEqual(messages, [pack.cost_input_invalid], `variant refusal in ${language}`)
  }
})

await runTest('cost snapshot restoration preserves precision and omits redacted cost fields', () => {
  for (const cost of [null, 0, 2.3456, 2.345678]) {
    const payload = helpers.buildProductWritePayload({ name: 'Restore', cost_price_usd: cost, cost_price_khr: cost, purchase_price_usd: cost, purchase_price_khr: cost })
    for (const field of ['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr']) assert.equal(payload[field], cost)
  }
  const hidden = helpers.buildProductWritePayload({ name: 'Redacted' })
  for (const field of ['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr']) assert.ok(!(field in hidden), 'an absent cost is not an explicit clear')
})

await runTest('actual Products bulk callbacks show catalog before/after and pin the confirmed cost', async () => {
  for (const mode of ['relative', 'absolute']) for (const [field, own] of [['purchase_price_usd', 'cost_price_usd'], ['purchase_price_khr', 'cost_price_khr']]) {
    const product = { id: 1, name: 'Known', cost_price_usd: 5, cost_price_khr: 5, purchase_price_usd: 0, purchase_price_khr: 99 }
    const pinned = new Map<number, Record<string, unknown>>()
    let confirmation: any, body: any
    const scope = {
      selectedVisibleIds: [1], selectedVisibleCount: 1, bulkActionBusy: false, loadProductWriteHelpers: async () => writeHelpers,
      bulkEditForm: { adjust_selling: false, adjust_cost: true, adjust_currency: field.endsWith('khr') ? 'khr' : 'usd', adjust_amount: 1 },
      canEditCosts: true, canViewCosts: true, user: { id: 1, role_code: 'admin' }, productsById: new Map([[1, product]]),
      notify: () => {}, tr: (key: string, fallback: string) => fallback || key, bulkFieldLabel: (key: string) => key,
      bulkCurrentValue: (_ids: number[], key: string) => (product as Record<string, unknown>)[key],
      askToConfirm: async (value: unknown) => { confirmation = value; return true }, snapshotProductsByIds: () => [product],
      setBulkActionBusy: () => {}, setSelectedIds: () => {}, setBulkEditMode: () => {}, setBulkEditForm: () => {},
      runConcurrentTasks: async (items: any[], fn: (item: any) => Promise<unknown>) => ({ successes: await Promise.all(items.map(async item => ({ item, result: await fn(item) }))), failures: [] }),
      runProductWriteMutation: (fn: () => unknown) => fn(), productApi: { updateProduct: async (_id: number, payload: unknown) => { body = payload; return { success: true } } },
      summarizeProductRun: (result: any) => ({ done: result.successes.length, failed: 0, failedIds: [] }),
      pinnedEditedProductsRef: { current: pinned }, load: async () => {}, actionHistory: { pushAction: () => {} }, restoreProductSnapshots: async () => {}, getErrorMessage: String,
      omitUnauthorizedCatalogCosts: require('../src/utils/acquisitionCostAccess.ts').omitUnauthorizedCatalogCosts,
    }
    await productCallback(mode === 'relative' ? 'runBulkProductPriceAdjustment' : 'runBulkProductUpdates', scope)({ [field]: 6 })
    assert.ok(confirmation.items.some((item: any) => item.value === '5 → 6'), `${mode} ${field} shows actual catalog before-value`)
    assert.equal(body[own], 6)
    assert.equal(pinned.get(1)?.[own], 6, 'confirmed pinned row shows saved catalog cost')
  }
})

await runTest('bulk cost uses the catalog value when the purchase mirror is absent or stale', () => {
  for (const [field, own] of [['purchase_price_usd', 'cost_price_usd'], ['purchase_price_khr', 'cost_price_khr']]) {
    for (const mirror of [undefined, 0, 99]) {
      const product = { id: 101, [own]: 5, ...(mirror === undefined ? {} : { [field]: mirror }) }
      const [change] = helpers.buildProductBulkPriceAdjustments([product], { direction: 'increase', amount: 1, fields: [field] })
      assert.equal(change?.updates[field], 6, `${field} derives from the catalog, not ${String(mirror)}`)
      const payload = writeHelpers.buildProductBulkUpdatePayload(change.updates)
      assert.equal(payload[own], 6)
      assert.ok(!(field in payload), 'bulk UI aliases become canonical cost writes')
    }
  }
})

await runTest('absolute bulk cost payload keeps null, zero and raw decimal validation on canonical fields', () => {
  assert.equal(writeHelpers.buildProductBulkUpdatePayload({ cost_price_usd: null, purchase_price_usd: 5 }).cost_price_usd, null, 'explicit canonical NULL wins over a conflicting legacy alias')
  for (const value of [null, 0, '0', '1.234567', '-0.00004']) {
    const payload = writeHelpers.buildProductBulkUpdatePayload(helpers.buildProductBulkPricingUpdates({ purchase_price_usd: value, purchase_price_khr: value }))
    assert.equal(payload.cost_price_usd, value)
    assert.equal(payload.cost_price_khr, value)
    assert.ok(!('purchase_price_usd' in payload) && !('purchase_price_khr' in payload))
  }
})

await runTest('bulk cost adjust leaves an unknown cost alone and moves a recorded $0', () => {
  const products = [
    { id: 1, purchase_price_usd: 0, cost_price_usd: null },
    { id: 2, purchase_price_usd: 0, cost_price_usd: 0 },
    { id: 3, purchase_price_usd: 5, cost_price_usd: 5 },
    { id: 4, purchase_price_usd: null },
    { id: 5 },
  ]
  const out = helpers.buildProductBulkPriceAdjustments(products, { direction: 'increase', amount: 1, fields: ['purchase_price_usd'] })
  assert.deepEqual(out, [
    { id: 2, updates: { purchase_price_usd: 1 } },
    { id: 3, updates: { purchase_price_usd: 6 } },
  ])
  const skipZero = helpers.buildProductBulkPriceAdjustments(products, { direction: 'increase', amount: 1, fields: ['purchase_price_usd'], skipZeroPriced: true })
  assert.deepEqual(skipZero.map((entry) => entry.id), [2, 3], 'a recorded $0 cost is real, skipZeroPriced does not apply to costs')
  const selling = helpers.buildProductBulkPriceAdjustments([{ id: 9, selling_price_usd: 0, purchase_price_usd: null }], { direction: 'increase', amount: 1, fields: ['selling_price_usd'], skipZeroPriced: true })
  assert.deepEqual(selling, [], 'selling prices keep the not-priced-yet rule')
})

await runTest('bulk "set cost" with an explicit null stays null', () => {
  assert.equal(helpers.buildProductBulkPricingUpdates({ purchase_price_usd: null }).purchase_price_usd, null)
  assert.equal(helpers.buildProductBulkPricingUpdates({ purchase_price_usd: '' }).purchase_price_usd, undefined)
  assert.equal(helpers.buildProductBulkPricingUpdates({ purchase_price_usd: '0' }).purchase_price_usd, '0')
})

await runTest('cost breakdown keeps a null result null instead of 0 and the formula stays empty', () => {
  const normalized = normalizeCostBreakdown({ product_id: 1, inputs: [], mean_usd: null, mean_khr: null, result_usd: null, result_khr: null })!
  assert.equal(normalized.result_usd, null)
  assert.equal(normalized.mean_usd, null)
  assert.equal(normalized.result_khr, null)
  assert.equal(formatBreakdownFormula(normalized), '')
  const zero = normalizeCostBreakdown({ product_id: 1, inputs: [], mean_usd: 0, result_usd: 0 })!
  assert.equal(zero.result_usd, 0, 'a real $0 result stays $0')
  assert.equal(costBreakdownFormat.costExclusionLabelKey('zero', null), 'cost_breakdown_excluded_unknown')
  assert.equal(costBreakdownFormat.costExclusionLabelKey('zero', 0), 'cost_breakdown_excluded_zero')
  assert.equal(costBreakdownFormat.costExclusionLabelKey('zero'), 'cost_breakdown_excluded_zero')
  assert.doesNotMatch(read('utils/costBreakdownFormat.ts'), /Number\(raw\.(mean|result)_(usd|khr)\) \|\| 0/)
})

await runTest('the float shows "Unknown cost" for a NULL catalog result and for a NULL lot', () => {
  const source = read('components/shared/CostCalculationFloat.tsx')
  assert.match(source, /breakdown\.result_usd == null \? unknownLabel : fmtUSD\(breakdown\.result_usd\)/)
  assert.match(source, /input\.cost_usd == null \? unknownLabel : fmtUSD\(input\.cost_usd\)/)
  assert.match(source, /costExclusionLabelKey\(input\.excluded, input\.cost_usd\)/)
})

await runTest('rpt_hint_cogs no longer claims missing snapshots count as 0', () => {
  for (const pack of ['en', 'km']) {
    const text = (JSON.parse(read(`lang/${pack}.json`)) as Record<string, string>).rpt_hint_cogs
    assert.ok(text, pack)
    assert.doesNotMatch(text, /count as 0|រាប់ជា ០/, pack)
  }
  const en = (JSON.parse(read('lang/en.json')) as Record<string, string>).rpt_hint_cogs
  assert.match(en, /unknown/)
  assert.match(en, /partial/)
  assert.ok(costDisplay.knownCost(0) === 0)
})

if (failed > 0) process.exitCode = 1

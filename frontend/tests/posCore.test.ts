import assert from 'node:assert/strict'
import './posNativeChangeIntent.test.ts'
import fs from 'node:fs'
import { buildVariantOptionLabels,
  applyManualDiscount,
  buildPosFilterMeta,
  buildProductsById,
  buildVariantChildrenByParentId,
  buildVisibleProductCards,
  computeCartLineSavings,
  computeExpiryStatus,
  findMatchingCartLineIndex,
  findCheckoutBlocker,
  getCartLineId,
  getVariantChoices,
  getVariantRootProduct,
  isSaleRecorded,
  resolveCartPriceValues,
  batchReceivedInstant,
  sortBatchesForPicker,
} from '../src/components/pos/posCore.ts'

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('grouped products resolve to their parent card and sorted variant list', () => {
  const products = [
    { id: 1, name: 'Root Product', parent_id: null, is_group: 1 },
    { id: 3, name: 'Variant B', parent_id: 1 },
    { id: 2, name: 'Variant A', parent_id: 1 },
  ]
  const productsById = buildProductsById(products)
  const children = buildVariantChildrenByParentId(products)
  const visible = buildVisibleProductCards(products, productsById)

  assert.equal(getVariantRootProduct(products[1], productsById)?.id, 1)
  assert.deepEqual(getVariantChoices(visible[0], children).map((item) => item.name), ['Root Product', 'Variant A', 'Variant B'])
  assert.deepEqual(visible.map((item) => item.id), [1])
})

await runTest('variant children sort by name, then branch, then price, then barcode', () => {
  // Same regression as productGrouping.test.ts's equivalent case, but for
  // POS's own variant-child list (buildVariantChildrenByParentId), which
  // used to sort by name only.
  const products = [
    { id: 1, name: 'Root', parent_id: null, is_group: 1 },
    {
      id: 2, name: 'Same Name', parent_id: 1, selling_price_usd: 10,
      branch_stock: [{ branch_id: 2, branch_name: 'Siem Reap', quantity: 5 }],
    },
    {
      id: 3, name: 'Same Name', parent_id: 1, selling_price_usd: 20,
      branch_stock: [{ branch_id: 1, branch_name: 'Phnom Penh', quantity: 5 }],
    },
  ]
  const children = buildVariantChildrenByParentId(products)
  assert.deepEqual(children.get(1)?.map((item) => item.id), [3, 2], 'Phnom Penh (id 3) should sort before Siem Reap (id 2) despite costing more')
})

await runTest('product lookup ignores invalid ids', () => {
  const productsById = buildProductsById([
    { id: 1, name: 'Valid' },
    { id: 'bad', name: 'Bad' },
    { id: null, name: 'Missing' },
  ])

  assert.equal(productsById.get(1)?.name, 'Valid')
  assert.equal(productsById.has(Number.NaN), false)
  assert.equal(productsById.size, 1)
})

await runTest('same-name standalone products collapse into one POS card with distinct choices', () => {
  const products = [
    { id: 21, name: 'Velvet Tint', parent_id: null, selling_price_usd: 7.5 },
    { id: 22, name: ' Velvet  Tint ', parent_id: null, selling_price_usd: 8.25 },
  ]
  const productsById = buildProductsById(products)
  const visible = buildVisibleProductCards(products, productsById)

  assert.equal(visible.length, 1)
  assert.equal(visible[0].__displayName, 'Velvet Tint')
  assert.deepEqual(getVariantChoices(visible[0]).map((item) => item.id), [22, 21])
})

await runTest('same-name grouped families and standalone items share one POS option card', () => {
  const products = [
    { id: 30, name: 'Glow Serum', is_group: 1 },
    { id: 31, name: 'Glow Serum Large', parent_id: 30, selling_price_usd: 21 },
    { id: 32, name: 'Glow Serum', selling_price_usd: 18 },
  ]
  const productsById = buildProductsById(products)
  const visible = buildVisibleProductCards(products, productsById)

  assert.equal(visible.length, 1)
  assert.equal((visible[0]?.__groupMeta as { groupKind?: string } | undefined)?.groupKind, 'option')
  assert.deepEqual(getVariantChoices(visible[0]).map((item) => item.id), [30, 31, 32])
})

await runTest('group cards still include parent and siblings when only one child matches filters', () => {
  const allProducts = [
    { id: 40, name: 'Glow Cream', is_group: 1, selling_price_usd: 0, stock_quantity: 0 },
    { id: 41, name: 'Glow Cream Small', parent_id: 40, selling_price_usd: 9, stock_quantity: 1 },
    { id: 42, name: 'Glow Cream Large', parent_id: 40, selling_price_usd: 12, stock_quantity: 2 },
  ]
  const productsById = buildProductsById(allProducts)
  const visible = buildVisibleProductCards([allProducts[1]], productsById)

  assert.equal(visible.length, 1)
  assert.deepEqual(getVariantChoices(visible[0]).map((item) => item.id), [40, 42, 41])
})

await runTest('pos filter meta normalizes lists and preserves fallback initials', () => {
  const meta = buildPosFilterMeta(
    {
      brands: ['Glow', null, 'Matte'],
      suppliers: ['North', '', 'South'],
      initials: [{ key: 'g', label: 'G', count: 2 }],
    },
    [{ key: 'f', label: 'F', count: 3 }],
  )

  assert.deepEqual(meta.brands, ['Glow', null, 'Matte'])
  assert.deepEqual(meta.suppliers, ['North', '', 'South'])
  assert.deepEqual(meta.initials, [{ key: 'g', label: 'g', count: 2, type: 'other' }])

  const fallbackOnly = buildPosFilterMeta({}, [{ key: 'f', label: 'F', count: 3 }])
  assert.deepEqual(fallbackOnly.initials, [{ key: 'f', label: 'f', count: 3, type: 'other' }])
})

await runTest('cart line identity includes product, mode, and branch so modes do not merge', () => {
  const cart = [
    { id: 10, price_mode: 'selling', branch_id: 1, cart_line_id: 'selling-line' },
    { id: 10, price_mode: 'special', branch_id: 1, cart_line_id: 'special-line' },
  ]

  assert.equal(findMatchingCartLineIndex(cart, { productId: 10, priceMode: 'selling', branchId: 1 }), 0)
  assert.equal(findMatchingCartLineIndex(cart, { productId: 10, priceMode: 'special', branchId: 1 }), 1)
  assert.equal(getCartLineId({ id: 4, price_mode: 'selling', branch_id: 2 }), '4:selling:2')
})

// This test used to assert that 'special' mode priced off special_price_*.
// The 2026-09-04 ruling deleted that tier -- it was the wholesale price under
// the wrong name -- so the invariant is now the opposite one, and it matters
// for a specific reason: this is a PWA whose till tabs stay open for days, so
// after the deploy a stale tab can still add a line asking for price_mode
// 'special'. The tier must fall through to the SELLING price. The dangerous
// alternative would be pricing off special_price_*, which migration 0111
// zeroed -- that would ring the sale up at $0.
await runTest('the retired VIP/special mode falls through to the selling price, never to zero', () => {
  const stale = resolveCartPriceValues(
    { selling_price_usd: 12, selling_price_khr: 49200, special_price_usd: 10, special_price_khr: 41000 },
    'special',
    4100,
  )
  assert.equal(stale.price_mode, 'selling', 'the VIP tier no longer exists and must not be honored')
  assert.equal(stale.applied_price_usd, 12, 'a stale VIP line charges full price, not the retired tier')
  assert.equal(stale.applied_price_khr, 49200)

  // The realistic post-migration shape: special_price_* zeroed by 0111.
  const zeroed = resolveCartPriceValues(
    { selling_price_usd: 12, selling_price_khr: 49200, special_price_usd: 0, special_price_khr: 0 },
    'special',
    4100,
  )
  assert.equal(zeroed.price_mode, 'selling')
  assert.equal(zeroed.applied_price_usd, 12, 'a zeroed dead column must never become a $0 sale')
})

await runTest('wholesale price mode prefers wholesale prices and falls back to selling prices', () => {
  const wholesale = resolveCartPriceValues(
    { selling_price_usd: 12, selling_price_khr: 49200, wholesale_price_usd: 9, wholesale_price_khr: 36900 },
    'wholesale',
    4100,
  )
  assert.equal(wholesale.price_mode, 'wholesale')
  assert.equal(wholesale.applied_price_usd, 9)
  assert.equal(wholesale.applied_price_khr, 36900)

  // No wholesale price set -> the tier is not honored; falls back to selling.
  const noWholesale = resolveCartPriceValues(
    { selling_price_usd: 12, selling_price_khr: 49200, wholesale_price_usd: 0, wholesale_price_khr: 0 },
    'wholesale',
    4100,
  )
  assert.equal(noWholesale.price_mode, 'selling')
  assert.equal(noWholesale.applied_price_usd, 12)
})

await runTest('promotion price mode applies active product discounts and preserves metadata', () => {
  const promotion = resolveCartPriceValues(
    {
      selling_price_usd: 20,
      selling_price_khr: 82000,
      discount_enabled: 1,
      discount_type: 'percent',
      discount_percent: 10,
      discount_label: 'Launch deal',
    },
    'promotion',
    4100,
  )

  assert.equal(promotion.price_mode, 'promotion')
  assert.equal(promotion.applied_price_usd, 18)
  assert.equal(promotion.applied_price_khr, 73800)
  assert.equal(promotion.product_discount_type, 'percent')
  assert.equal(promotion.product_discount_label, 'Launch deal')
  assert.equal(promotion.product_discount_usd, 2)
})

await runTest('computeCartLineSavings is inactive for plain selling-priced lines', () => {
  const savings = computeCartLineSavings({
    price_mode: 'selling',
    selling_price_usd: 20,
    selling_price_khr: 82000,
    base_price_usd: 20,
    base_price_khr: 82000,
  })
  assert.equal(savings.active, false)
  assert.equal(savings.savings_usd, 0)
})

await runTest('computeCartLineSavings reports was/save figures for a special-priced line', () => {
  const savings = computeCartLineSavings({
    price_mode: 'special',
    selling_price_usd: 20,
    selling_price_khr: 82000,
    base_price_usd: 15,
    base_price_khr: 61500,
  })
  assert.equal(savings.active, true)
  assert.equal(savings.compare_at_usd, 20)
  assert.equal(savings.savings_usd, 5)
  assert.equal(savings.savings_khr, 20500)
  assert.equal(savings.savings_percent, 25)
})

await runTest('computeCartLineSavings reports was/save figures for an active promotion line, falling back to applied_price when base_price is absent', () => {
  const savings = computeCartLineSavings({
    price_mode: 'promotion',
    selling_price_usd: 20,
    selling_price_khr: 82000,
    applied_price_usd: 18,
    applied_price_khr: 73800,
  })
  assert.equal(savings.active, true)
  assert.equal(savings.savings_usd, 2)
  assert.equal(savings.savings_percent, 10)
})

await runTest('computeCartLineSavings stays inactive when the "special" price is not actually lower', () => {
  const savings = computeCartLineSavings({
    price_mode: 'special',
    selling_price_usd: 20,
    selling_price_khr: 82000,
    base_price_usd: 20,
    base_price_khr: 82000,
  })
  assert.equal(savings.active, false)
})

await runTest('computeExpiryStatus classifies expired, expiring-soon, and ok dates against a fixed "today"', () => {
  const today = '2026-08-20'
  assert.equal(computeExpiryStatus(null, 30, today), null)
  assert.equal(computeExpiryStatus(undefined, 30, today), null)

  const expired = computeExpiryStatus('2026-08-10', 30, today)
  assert.equal(expired?.status, 'expired')
  assert.equal(expired?.daysRemaining, -10)

  const expiring = computeExpiryStatus('2026-09-05', 30, today)
  assert.equal(expiring?.status, 'expiring')
  assert.equal(expiring?.daysRemaining, 16)

  const ok = computeExpiryStatus('2027-01-01', 30, today)
  assert.equal(ok?.status, 'ok')

  // Missing/invalid alert_days falls back to the same 30-day default the
  // product form itself defaults to.
  const defaultedWindow = computeExpiryStatus('2026-09-10', undefined, today)
  assert.equal(defaultedWindow?.status, 'expiring')
})

// ---- Z2: the price input is the SELLING/base price; discounts are separate --
await runTest('Z2: a manual discount reduces applied but never the base price', () => {
  // A 10% discount on a $10 line: base stays $10, applied becomes $9, the
  // discount is a separate $1 -- the kernel the cart + updatePrice use.
  const d = applyManualDiscount(10, 41000, 4100, 'percent', 10)
  assert.equal(d.applied_price_usd, 9)
  assert.equal(d.manual_discount_usd, 1)
  assert.equal(d.manual_discount_type, 'percent')
})

await runTest('Z2: editing the price re-applies the SAME discount against the new base', () => {
  // Simulates POS.tsx updatePrice: the cashier changes the selling price
  // from $10 to $20 while a 10% manual discount is set. The discount stays
  // 10% (a separate reduction), so applied tracks the new base -- it does
  // NOT freeze the old discounted price or turn the edit into a fixed cut.
  const before = applyManualDiscount(10, 41000, 4100, 'percent', 10)
  assert.equal(before.applied_price_usd, 9)
  const afterEdit = applyManualDiscount(20, 82000, 4100, before.manual_discount_type, before.manual_discount_value)
  assert.equal(afterEdit.applied_price_usd, 18, 'applied = new base 20 - 10% = 18')
  assert.equal(afterEdit.manual_discount_usd, 2, 'the discount scales with the new base, still separate')
})

await runTest('Z2: no discount means base equals applied (price edit sets the price cleanly)', () => {
  const d = applyManualDiscount(12.5, 51250, 4100, null, 0)
  assert.equal(d.applied_price_usd, 12.5)
  assert.equal(d.manual_discount_usd, 0)
  assert.equal(d.manual_discount_type, null)
})

await runTest('Z2 wiring: the cart input, updatePrice, and receipt are decoupled from the discount', () => {
  const cartItem = fs.readFileSync(new URL('../src/components/pos/CartItem.tsx', import.meta.url), 'utf8')
  // The price inputs read the BASE price, not the (discounted) applied price.
  assert.match(cartItem, /value=\{normalizePriceValue\(\(item\.base_price_usd \?\? item\.applied_price_usd\)/)
  assert.match(cartItem, /value=\{normalizePriceValue\(\(item\.base_price_khr \?\? item\.applied_price_khr\)/)

  const pos = fs.readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8')
  // updatePrice sets the base price and re-applies the manual discount --
  // it must NOT create a fixed discount from the typed price any more.
  assert.match(pos, /base_price_usd: newBaseUsd/)
  assert.match(pos, /applyManualDiscount\(newBaseUsd, newBaseKhr, exchangeRate, item\.manual_discount_type/)
  const updatePriceBody = pos.slice(pos.indexOf('const updatePrice ='), pos.indexOf('const updatePrice =') + 1400)
  assert.doesNotMatch(updatePriceBody, /manual_discount_type: discountUsd > 0 \? 'fixed' : null/)

  const receipt = fs.readFileSync(new URL('../src/components/receipt/Receipt.tsx', import.meta.url), 'utf8')
  // The receipt's per-line list price is base + product-level cut, so the full
  // discount shows (it once printed the charged price_usd). That derivation now
  // lives in utils/receiptLineMath, where a test can EXECUTE it instead of only
  // pattern-matching it, so this asserts the rule in its new home AND that the
  // component still consumes it -- together, what this lock was always after.
  assert.match(receipt, /import \{ receiptDeliveryFigures, receiptLineFigures, receiptLineSavingsUsd \} from '\.\.\/\.\.\/utils\/receiptLineMath'/)
  assert.match(receipt, /const figures = receiptLineFigures\(item, showItemDiscount, exchangeRate\)/)
  const lineMath = fs.readFileSync(new URL('../src/utils/receiptLineMath.ts', import.meta.url), 'utf8')
  assert.match(lineMath, /baseUnitUsd > 0\s*\n\s*\? baseUnitUsd \+ num\(item\.product_discount_usd\)/)
})

// Formerly "POS product cards keep VIP pricing inside the price options".
// After the 2026-09-04 ruling there is exactly ONE alternate tier, so this
// guards two things: the tier still never leaks onto the outside grid (the
// original point of the test), and the tier that IS offered is wholesale.
await runTest('the POS offers wholesale as the only alternate tier, and never on the card face', () => {
  // N19 round 3: the card body moved out of POS.tsx into the shared
  // components/pos/ProductCard.tsx the sale screen mounts too, so the lock
  // follows it -- the outside card face must not show a tier on EITHER
  // surface now, which is more than this test used to cover.
  const card = fs.readFileSync(new URL('../src/components/pos/ProductCard.tsx', import.meta.url), 'utf8')
  const cardStart = card.indexOf('Product cards show only the normal selling price')
  const cardEnd = card.indexOf('Colored qty+unit', cardStart)
  assert.ok(cardStart >= 0 && cardEnd > cardStart, 'the product-card price block should remain identifiable')
  const cardPriceBlock = card.slice(cardStart, cardEnd)
  assert.doesNotMatch(cardPriceBlock, /special_price|wholesale_price/, 'tier labels and values must not appear on the outside POS product card')

  const sheet = fs.readFileSync(new URL('../src/components/pos/ProductDetailSheet.tsx', import.meta.url), 'utf8')
  assert.match(sheet, /closeAfterAdd\(effectiveVariant, 'wholesale'\)/, 'variant wholesale pricing must be a selectable option')
  assert.match(sheet, /closeAfterAdd\(product, 'wholesale'\)/, 'standalone-product wholesale pricing must be a selectable option')
  // The retired tier must be gone from the sheet entirely -- a leftover
  // button would add a line priced off a column 0111 zeroed.
  assert.doesNotMatch(sheet, /closeAfterAdd\([A-Za-z]+, 'special'\)/, 'the VIP tier must no longer be selectable anywhere')
  // Comments are stripped first: the sheet documents WHY the columns went, and
  // a tombstone naming them is the opposite of a leftover read.
  const sheetCode = sheet.replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(sheetCode, /special_price_usd|special_price_khr/, 'the sheet must not read the retired VIP columns')
})

if (failed > 0) {
  process.exitCode = 1
}

// ---------------------------------------------------------------------------
// buildVariantOptionLabels -- how a cashier tells rows in one name group apart
// ---------------------------------------------------------------------------
// Regression guard for a display bug the identity rule made reachable: the
// POS option step used to be hardcoded to "Barcode" and printed
// variant.barcode on every pill, so two rows in one group sharing a barcode
// rendered as two IDENTICAL pills with nothing to choose between them.
//
// 11.9: cost is NOT a cashier-facing field, so the pills disambiguate by
// barcode then SELLING price, never cost. Two rows that differ only by cost
// collapse to a neutral label on purpose -- the batch picker settles which
// lot's COGS a sale draws from, not the cashier reading a cost.
await runTest('buildVariantOptionLabels labels by barcode when barcodes differ', () => {
  const result = buildVariantOptionLabels([
    { id: 1, barcode: 'AAA', selling_price_usd: 5 },
    { id: 2, barcode: 'BBB', selling_price_usd: 5 },
  ] as never)
  assert.equal(result.stepTitle, 'Barcode')
  assert.equal(result.byId.get('1')?.label, 'AAA')
  assert.equal(result.byId.get('2')?.label, 'BBB')
  assert.equal(result.byId.get('1')?.hint, null, 'no hint needed when only barcode varies')
})

await runTest('buildVariantOptionLabels labels by SELLING PRICE when the barcode is shared', () => {
  const result = buildVariantOptionLabels([
    { id: 1, barcode: 'SAME', selling_price_usd: 12 },
    { id: 2, barcode: 'SAME', selling_price_usd: 15.5 },
  ] as never, (v) => `$${v.toFixed(2)}`)
  assert.equal(result.stepTitle, 'Price')
  assert.equal(result.byId.get('1')?.label, '$12.00')
  assert.equal(result.byId.get('2')?.label, '$15.50')
  assert.notEqual(result.byId.get('1')?.label, result.byId.get('2')?.label, 'pills must never be identical')
})

await runTest('buildVariantOptionLabels never labels by cost -- cost is not cashier-facing (11.9)', () => {
  // Same barcode, same selling price, DIFFERENT cost: the cashier must not be
  // shown the cost, so these fall back to a neutral distinct label, not $cost.
  const result = buildVariantOptionLabels([
    { id: 1, barcode: 'SAME', selling_price_usd: 12, cost_price_usd: 5 },
    { id: 2, barcode: 'SAME', selling_price_usd: 12, cost_price_usd: 8 },
  ] as never, (v) => `$${v.toFixed(2)}`)
  assert.equal(result.stepTitle, 'Option', 'a cost-only difference must NOT surface a Cost step')
  assert.ok(!/\$5|\$8/.test(result.byId.get('1')?.label || ''), 'a cost value must never appear on a pill')
  assert.notEqual(result.byId.get('1')?.label, result.byId.get('2')?.label, 'pills must never be identical')
})

await runTest('buildVariantOptionLabels shows barcode plus a selling-price hint when BOTH differ', () => {
  const result = buildVariantOptionLabels([
    { id: 1, barcode: 'AAA', selling_price_usd: 70 },
    { id: 2, barcode: 'BBB', selling_price_usd: 96 },
  ] as never, (v) => `$${v.toFixed(2)}`)
  assert.equal(result.stepTitle, 'Barcode')
  assert.equal(result.byId.get('2')?.label, 'BBB')
  assert.equal(result.byId.get('2')?.hint, '$96.00')
})

await runTest('buildVariantOptionLabels still yields distinct labels when nothing varies', () => {
  const result = buildVariantOptionLabels([
    { id: 7, barcode: '', selling_price_usd: 0 },
    { id: 8, barcode: '', selling_price_usd: 0 },
  ] as never)
  assert.equal(result.stepTitle, 'Option')
  assert.notEqual(
    result.byId.get('7')?.label, result.byId.get('8')?.label,
    'identical rows must still be told apart rather than rendering as silent duplicates',
  )
})

await runTest('buildVariantOptionLabels tolerates empty/invalid input', () => {
  const result = buildVariantOptionLabels([] as never)
  assert.equal(result.byId.size, 0)
  assert.equal(result.stepTitle, 'Option')
})

// ---------------------------------------------------------------------------
// isSaleRecorded -- did the checkout actually record a sale?
// ---------------------------------------------------------------------------
// The create endpoint returns the sale itself ({ id, receiptNumber, ... }) with
// NO top-level `success` on the online path; only the offline queue adds one,
// and real server errors are thrown (rejected), never returned. The old
// `if (result.success)` therefore treated every committed online sale as a
// failure -- the "POS shows an error but the sale still went through" report.
await runTest('isSaleRecorded: an online create response (id, no success flag) counts as recorded', () => {
  assert.equal(isSaleRecorded({ id: 42, receiptNumber: 'RCP-1' } as never), true)
  assert.equal(isSaleRecorded({ id: '42' } as never), true)
})

await runTest('isSaleRecorded: a client_request_id dedupe hit (id + duplicate) counts as recorded', () => {
  assert.equal(isSaleRecorded({ id: 42, receiptNumber: 'RCP-1', duplicate: true } as never), true)
})

await runTest('isSaleRecorded: an offline-queued sale (explicit success, negative local id) counts as recorded', () => {
  assert.equal(isSaleRecorded({ success: true, queued: true, id: -1730000000000 } as never), true)
})

await runTest('isSaleRecorded: an error response is NOT recorded, even if an id rode along', () => {
  assert.equal(isSaleRecorded({ error: 'boom' } as never), false)
  assert.equal(isSaleRecorded({ error: 'boom', id: 42 } as never), false)
})

await runTest('isSaleRecorded: empty / missing / id-less responses are NOT recorded', () => {
  assert.equal(isSaleRecorded(null), false)
  assert.equal(isSaleRecorded(undefined), false)
  assert.equal(isSaleRecorded({} as never), false)
  assert.equal(isSaleRecorded({ id: null } as never), false)
  assert.equal(isSaleRecorded({ id: '' } as never), false)
})

// ---------------------------------------------------------------------------
// findCheckoutBlocker -- hard guardrails that stop a broken sale before submit
// ---------------------------------------------------------------------------
await runTest('findCheckoutBlocker: a normal cart is clear to submit', () => {
  assert.equal(findCheckoutBlocker([{ name: 'A', quantity: 2, applied_price_usd: 5 }], { totalUsd: 10 }), null)
})

await runTest('findCheckoutBlocker: an empty cart is blocked', () => {
  assert.equal(findCheckoutBlocker([], { totalUsd: 0 })?.code, 'empty_cart')
})

await runTest('findCheckoutBlocker: a non-positive or NaN quantity is blocked (with the item name)', () => {
  assert.deepEqual(findCheckoutBlocker([{ name: 'Serum', quantity: 0, applied_price_usd: 5 }], { totalUsd: 0 }), { code: 'invalid_quantity', itemName: 'Serum' })
  assert.equal(findCheckoutBlocker([{ name: 'Serum', quantity: -1, applied_price_usd: 5 }], { totalUsd: 0 })?.code, 'invalid_quantity')
  assert.equal(findCheckoutBlocker([{ name: 'Serum', quantity: Number.NaN, applied_price_usd: 5 }], { totalUsd: 0 })?.code, 'invalid_quantity')
})

await runTest('findCheckoutBlocker: a negative or NaN price is blocked', () => {
  assert.equal(findCheckoutBlocker([{ name: 'Serum', quantity: 1, applied_price_usd: -1 }], { totalUsd: 0 })?.code, 'invalid_price')
  assert.equal(findCheckoutBlocker([{ name: 'Serum', quantity: 1, applied_price_usd: Number.NaN }], { totalUsd: 0 })?.code, 'invalid_price')
})

await runTest('findCheckoutBlocker: a $0 line is ALLOWED (giveaway / fully-discounted promo)', () => {
  assert.equal(findCheckoutBlocker([{ name: 'Freebie', quantity: 1, applied_price_usd: 0 }], { totalUsd: 0 }), null)
})

await runTest('findCheckoutBlocker: a negative or NaN grand total is blocked', () => {
  assert.equal(findCheckoutBlocker([{ name: 'A', quantity: 1, applied_price_usd: 5 }], { totalUsd: -5 })?.code, 'invalid_total')
  assert.equal(findCheckoutBlocker([{ name: 'A', quantity: 1, applied_price_usd: 5 }], { totalUsd: Number.NaN })?.code, 'invalid_total')
})

// ---------------------------------------------------------------------------
// Wiring: POS.tsx must USE the guardrails, not the old raw success flag
// ---------------------------------------------------------------------------
await runTest('POS checkout uses isSaleRecorded and the cart blocker, not `result.success`', () => {
  const pos = fs.readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8')
  assert.match(pos, /if \(isSaleRecorded\(result\)\)/, 'the success branch must gate on isSaleRecorded')
  assert.doesNotMatch(pos, /if \(result\.success\)/, 'the broken raw success check must be gone')
  assert.match(pos, /findCheckoutBlocker\(active\.cart/, 'the pre-submit cart guardrail must be wired in')
})

// ---------------------------------------------------------------------------
// Wiring: the detail sheet must preselect the SAME branch the card badge
// resolved (Part 539 finding: the sheet's own fallback was branchOptions[0],
// alphabetical, so the card said "3 pcs" from the default branch while the
// sheet silently offered/booked a different branch's lots).
// ---------------------------------------------------------------------------
await runTest('ProductDetailSheet preselects the card badge branch, not alphabetical-first', () => {
  const pos = fs.readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8')
  assert.match(
    pos,
    /activeBranchId=\{primaryBranchFilterId \?\? pickBestBranchId\(detailProduct\)\}/,
    'the sheet must be handed the branch the card resolved (filter first, else pickBestBranchId)',
  )
})

// ---------------------------------------------------------------------------
// POS lot picker: one list, in the order a cashier needs it
// ---------------------------------------------------------------------------
const ids = (rows: Array<{ id: number }>) => rows.map((row) => row.id)

// S4-18 (the owner's exact words): "earliest to latest, with available
// first, not split into available/unavailable sections". This is the
// regression guard for the "not split into sections" clause specifically --
// a test that only checked chronological order (the next test below) would
// stay green even if a future edit re-partitioned by availability, since a
// partitioned list can still be internally date-sorted within each half.
// The negative control: reverting the `if (left.available ...)` line back
// above the date check (the 9c282599 shape) turns this red, because it
// re-groups every available lot ahead of every empty one regardless of date.
await runTest('lot order: date dominates -- an old empty lot still lists ahead of a fresh available one', () => {
  const sorted = sortBatchesForPicker([
    { id: 1, received_at: '2026-01-05 08:00:00', quantity: 0 },
    { id: 2, received_at: '2026-06-01 08:00:00', quantity: 4 },
    { id: 3, received_at: '2026-02-01 08:00:00', quantity: 0 },
    { id: 4, received_at: '2026-03-01 08:00:00', quantity: 9 },
  ])
  // Earliest to latest by date alone: 01-05 (empty), 02-01 (empty), 03-01
  // (available), 06-01 (available) -- the two empty lots interleave ahead of
  // both available ones because they were received first. Never grouped.
  assert.deepEqual(ids(sorted), [1, 3, 4, 2])
})

// "Available first" is real, but only as a tie-break where the date can't
// already decide the order -- two lots received at the exact same instant.
await runTest('lot order: available breaks a tie on the exact same received date', () => {
  const sorted = sortBatchesForPicker([
    { id: 1, received_at: '2026-05-01 08:00:00', quantity: 0 },
    { id: 2, received_at: '2026-05-01 08:00:00', quantity: 3 },
  ])
  assert.deepEqual(ids(sorted), [2, 1])
})

await runTest('lot order: within a group it is earliest received date to latest', () => {
  const sorted = sortBatchesForPicker([
    { id: 1, received_at: '2026-08-24 10:00:00', quantity: 2 },
    { id: 2, received_at: '2026-08-24 06:00:00', quantity: 2 },
    { id: 3, received_at: '2025-12-31 23:00:00', quantity: 2 },
  ])
  assert.deepEqual(ids(sorted), [3, 2, 1])
})

await runTest('lot order: a date-only received_at is a real date, not an undated lot', () => {
  assert.equal(batchReceivedInstant({ received_at: '2026-08-24' }), Date.UTC(2026, 7, 24))
  const sorted = sortBatchesForPicker([
    { id: 1, received_at: '2026-09-01 00:00:00', quantity: 1 },
    { id: 2, received_at: '2026-08-24', quantity: 1 },
  ])
  assert.deepEqual(ids(sorted), [2, 1])
})

await runTest('lot order: an MMDDYYYY lot code stands in for a missing received_at', () => {
  assert.equal(batchReceivedInstant({ lot_code: '08242026', received_at: null }), Date.UTC(2026, 7, 24))
  const sorted = sortBatchesForPicker([
    { id: 1, lot_code: '09012026', received_at: null, quantity: 3 },
    { id: 2, lot_code: '08242026', received_at: null, quantity: 3 },
  ])
  assert.deepEqual(ids(sorted), [2, 1])
})

await runTest('lot order: an undated or malformed lot sorts after every dated one, tied by availability', () => {
  // Production holds ~9,900 synthetic `RECON-<productId>` lot codes; they are
  // not dates, so a lot carrying one and nothing else must not sort as if it
  // had been received at epoch 0. An unknown date can't be placed on the
  // timeline, so it can't outrank a lot with a real date either way -- it
  // clusters with the other undated lots at the end, and THERE (an actual
  // tie) availability decides: the still-stocked RECON lot lists ahead of
  // the empty one, not behind it.
  assert.equal(batchReceivedInstant({ lot_code: 'RECON-7321', received_at: null }), null)
  assert.equal(batchReceivedInstant({ lot_code: '13992026', received_at: 'not-a-date' }), null)
  const sorted = sortBatchesForPicker([
    { id: 1, lot_code: 'RECON-7321', received_at: null, quantity: 5 },
    { id: 2, received_at: '2026-05-01 08:00:00', quantity: 0 },
    { id: 3, received_at: '2026-06-01 08:00:00', quantity: 5 },
    { id: 4, lot_code: 'RECON-7322', received_at: '', quantity: 0 },
  ])
  assert.deepEqual(ids(sorted), [2, 3, 1, 4])
})

await runTest('lot order: a RECON lot code with a real received_at still sorts by that date', () => {
  const sorted = sortBatchesForPicker([
    { id: 1, lot_code: 'RECON-7321', received_at: '2026-07-01 08:00:00', quantity: 2 },
    { id: 2, lot_code: 'RECON-7322', received_at: '2026-02-01 08:00:00', quantity: 2 },
  ])
  assert.deepEqual(ids(sorted), [2, 1])
})

await runTest('lot order: undated ties fall back to batch_number, then the incoming FIFO order', () => {
  const sorted = sortBatchesForPicker([
    { id: 1, received_at: null, batch_number: null, quantity: 1 },
    { id: 2, received_at: null, batch_number: 2, quantity: 1 },
    { id: 3, received_at: null, batch_number: 1, quantity: 1 },
  ])
  assert.deepEqual(ids(sorted), [3, 2, 1])
})

await runTest('lot order: the input array is never mutated', () => {
  const input = [
    { id: 1, received_at: '2026-06-01 08:00:00', quantity: 0 },
    { id: 2, received_at: '2026-01-01 08:00:00', quantity: 7 },
  ]
  sortBatchesForPicker(input)
  assert.deepEqual(ids(input), [1, 2])
})

// ---------------------------------------------------------------------------
// Wiring: the POS sheet shows ONE list, not the "#7321 / #7322" row-id pills
// duplicating the lot list underneath.
// ---------------------------------------------------------------------------
await runTest('ProductDetailSheet drops the duplicate row-id option step and orders the lot list', () => {
  const sheet = fs.readFileSync(new URL('../src/components/pos/ProductDetailSheet.tsx', import.meta.url), 'utf8')
  assert.match(sheet, /const mergeRowsIntoLotList = /, 'the merge condition must exist')
  assert.match(sheet, /const optionStepShown = !mergeRowsIntoLotList/, 'the option step must be hidden when the lot list absorbs it')
  assert.match(sheet, /\{optionStepShown \? \(/, 'the option pills must actually be gated on it')
  assert.match(sheet, /sortBatchesForPicker\(batches\)/, 'the lot list must be rendered in picker order')
  assert.doesNotMatch(sheet, /pagedBatches = batches\.slice/, 'the lot pills must page over the ORDERED list')
  assert.match(sheet, /lotSourceProductIds/, 'merged mode must fetch every indistinguishable row\'s lots')
  assert.doesNotMatch(sheet, /'3\. Batch'/, 'the lot step number must be counted, not hardcoded')
})

// S4-18's remaining two clauses: every lot pill states its quantity, and the
// list is never rendered as two headed blocks (an "Available" / "Out of
// stock" divider would satisfy a naive ordering test while still splitting
// the list the ruling forbids).
await runTest('ProductDetailSheet: every lot pill states its quantity, and no availability header splits the list', () => {
  const sheet = fs.readFileSync(new URL('../src/components/pos/ProductDetailSheet.tsx', import.meta.url), 'utf8')
  const quantityOnPill = sheet.match(/\(\{batch\.quantity\}/g) || []
  // Two lot-picker blocks share this pill shape: the merged/group flow and
  // the flat-product flow (see ProductDetailSheet.tsx's two `pagedBatches.map`
  // call sites). Both must show quantity, not just one of them.
  assert.equal(quantityOnPill.length, 2, 'both the group-flow and flat-flow lot pills must print the quantity')
  assert.match(sheet, /selectedBatch\.quantity \|\| 0\)/, 'the collapsed trigger must also show the picked lot\'s quantity')
  // Not "no occurrence of the word available" (that also appears in unrelated
  // comments and the empty-list message "No lots available at this branch")
  // -- specifically, no posCopy call that would print an "Available" / "Out
  // of stock" heading as a divider between two blocks of lot pills.
  assert.doesNotMatch(
    sheet,
    /posCopy\('(Available|Unavailable|Out of stock)'/i,
    'the lot list must not carry an availability section heading',
  )
})

if (failed > 0) {
  process.exitCode = 1
  console.error(`\n${failed} posCore test(s) failed`)
} else {
  console.log('\nAll posCore tests passed')
}

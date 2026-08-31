import assert from 'node:assert/strict'
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

await runTest('special price mode prefers special prices and falls back to selling prices', () => {
  const special = resolveCartPriceValues(
    { selling_price_usd: 12, selling_price_khr: 49200, special_price_usd: 10, special_price_khr: 41000 },
    'special',
    4100,
  )
  assert.equal(special.price_mode, 'special')
  assert.equal(special.applied_price_usd, 10)
  assert.equal(special.applied_price_khr, 41000)

  const selling = resolveCartPriceValues(
    { selling_price_usd: 12, selling_price_khr: 49200, special_price_usd: 0, special_price_khr: 0 },
    'special',
    4100,
  )
  assert.equal(selling.price_mode, 'selling')
  assert.equal(selling.applied_price_usd, 12)
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
  // The receipt's per-line "original" price is base + product-level cut, so
  // the full discount shows (previously it used the charged price_usd).
  assert.match(receipt, /baseUnitUsd > 0\s*\n\s*\? baseUnitUsd \+ productDiscUnitUsd/)
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

if (failed > 0) {
  process.exitCode = 1
  console.error(`\n${failed} posCore test(s) failed`)
} else {
  console.log('\nAll posCore tests passed')
}

// The public product detail sheet (DESIGN-REVIEW-PUBLIC-SITE D1, D2, D3).
//
//  D1  the sheet had no way to add to My List: ProductDetailFlyout only draws
//      Add when it is handed onAddToBucket, and the storefront page never
//      handed one down. A shopper who opened a product had to close it and find
//      the card again.
//  D2  the sheet printed the stock label unconditionally while the cards obey
//      the owner's "show stock status" switch.
//  D3  the header said "Shop's Product Name" above the name; the official name
//      belongs on a small secondary line, and only when it differs.
//
// The sheet is MOUNTED (real React, real component); the page wiring that feeds
// it cannot be mounted cheaply, so that half is pinned on the source text.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHarness, propsOf, type MemoryNode } from './mountedComponentHarness.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.join(here, '..', relative), 'utf8').replace(/\r\n/g, '\n')

const copy = (_key: string, fallback?: string) => fallback ?? _key
const product = {
  id: 7,
  name: 'A&F EDT 100ml',
  description: 'Official Product Name:\nAbercrombie & Fitch Authentic Man Eau de Toilette 100 ml\n\nIntroduction:\nA woody fragrance.',
  category: 'Fragrance',
  brand: 'Abercrombie',
}
const baseView = {
  open: true,
  product,
  gallery: [] as string[],
  status: 'in_stock',
  pricePresentation: { primaryText: '$29.00' },
  showPrices: true,
}

const harness = await createHarness()
// The harness's in-memory style object predates the sheet's scroll lock, which
// reads getPropertyPriority; give it the one missing method rather than stub the lock.
const memoryStyle = Object.getPrototypeOf(document.documentElement.style) as { getPropertyPriority?: (name: string) => string }
memoryStyle.getPropertyPriority ??= () => ''
// One sheet on the page at a time: the harness queries the whole body, so a
// sheet left mounted would answer for the next assertion.
let current: Awaited<ReturnType<typeof harness.mount>> | null = null
const mountFlyout = async (props: Record<string, unknown>) => {
  await current?.unmount()
  current = await harness.mount({
    component: 'components/catalog/ProductDetailFlyout.tsx',
    props: { view: baseView, copy, onClose: () => {}, ...props },
    app: {},
    doubles: {},
  })
  return current
}
const buttonsLabelled = (surface: Awaited<ReturnType<typeof mountFlyout>>, label: RegExp): MemoryNode[] =>
  surface.findAll((node) => node.tagName === 'BUTTON' && label.test(`${node.textContent} ${node.getAttribute('aria-label') ?? ''}`))

try {
  // ---- D1: Add from the sheet reaches the bucket and the quantity shows ----
  const added: Array<{ id: unknown; priceText: unknown }> = []
  const sheet = await mountFlyout({
    onAddToBucket: (item: { id: unknown }, priceText?: string) => { added.push({ id: item.id, priceText }) },
    bucketQty: 0,
  })
  const addButton = sheet.button(/^Add$/)
  await sheet.click(addButton)
  await sheet.click(addButton)
  assert.deepEqual(added, [{ id: 7, priceText: '$29.00' }, { id: 7, priceText: '$29.00' }], 'every tap on the sheet Add reaches the shared bucket add with the product and its price')
  assert.equal(sheet.findAll((node) => propsOf(node)['data-product-detail-bucket-qty'] === 'true').length, 0, 'no quantity badge while nothing is on the list')
  await sheet.render({ view: baseView, copy, onClose: () => {}, onAddToBucket: () => {}, bucketQty: 2 })
  const badge = sheet.find((node) => propsOf(node)['data-product-detail-bucket-qty'] === 'true', 'quantity badge')
  assert.equal(badge.textContent.trim(), '2', 'the sheet shows how many are already on the list')
  assert.match(propsOf(sheet.button(/2/))['className'] as string, /min-h-11/, 'Add keeps a 44px touch target')

  // The wishlist toggle is the cards' own toggle, offered on the sheet too.
  const saved: unknown[] = []
  const withHeart = await mountFlyout({ onAddToBucket: () => {}, onToggleWishlist: (item: { id: unknown }) => { saved.push(item.id) }, isInWishlist: false })
  const heart = buttonsLabelled(withHeart, /Save to wishlist/)[0]
  assert.ok(heart, 'the sheet footer carries the save toggle when the storefront supplies one')
  await withHeart.click(heart)
  assert.deepEqual(saved, [7])
  assert.equal(propsOf(heart)['aria-pressed'], false)
  await withHeart.render({ view: baseView, copy, onClose: () => {}, onAddToBucket: () => {}, onToggleWishlist: () => {}, isInWishlist: true })
  assert.equal(buttonsLabelled(withHeart, /Remove from saved/).length, 1, 'a saved product reads as saved')

  // Without handlers the footer stays out (the editor preview keeps its old look).
  const bare = await mountFlyout({})
  assert.equal(bare.findAll((node) => node.tagName === 'BUTTON' && /^Add$/.test(node.textContent.trim())).length, 0)

  // ---- D2: the stock label follows the owner's switch ----
  const stockWords = /In Stock|Low Stock|Out of Stock/
  for (const status of ['in_stock', 'low_stock', 'out_of_stock']) {
    const off = await mountFlyout({ view: { ...baseView, status, showStockStatus: false } })
    assert.doesNotMatch(off.text(), stockWords, `${status}: stock wording is hidden when showStockStatus is false`)
    const on = await mountFlyout({ view: { ...baseView, status, showStockStatus: true } })
    assert.match(on.text(), stockWords, `${status}: stock wording shows when showStockStatus is true`)
  }
  const unset = await mountFlyout({ view: baseView })
  assert.match(unset.text(), stockWords, 'the setting defaults to shown, like the cards')
  const offWithDiscount = await mountFlyout({
    view: { ...baseView, showStockStatus: false, pricePresentation: { primaryText: '$29.00', promotion: { active: true } } },
  })
  assert.doesNotMatch(offWithDiscount.text(), stockWords, 'a promotion pill does not drag the stock label back in')
  assert.match(offWithDiscount.text(), /Discount/, 'the promotion pill still shows')

  // ---- D3: official name is a small secondary line, only when it differs ----
  const differing = await mountFlyout({})
  assert.doesNotMatch(differing.text(), /Shop's Product Name/, 'the old header label is gone')
  assert.match(differing.text(), /Official name: Abercrombie & Fitch Authentic Man Eau de Toilette 100 ml/)
  const same = await mountFlyout({
    view: { ...baseView, product: { ...product, name: 'Abercrombie & Fitch Authentic Man Eau de Toilette 100 ml.' } },
  })
  assert.doesNotMatch(same.text(), /Official name/, 'an official name that only repeats the shown name is not printed again')
  const none = await mountFlyout({ view: { ...baseView, product: { ...product, description: 'Just a paragraph.' } } })
  assert.doesNotMatch(none.text(), /Official name/, 'no official name, no line')
  const khmer = await mountFlyout({ copy: (key: string, fallback?: string, fallbackKm?: string) => fallbackKm ?? fallback ?? key })
  assert.match(khmer.text(), /ឈ្មោះផ្លូវការ: Abercrombie/, 'the Khmer fallback names the line')

  // ---- Page wiring (source shape; the page itself is too heavy to mount) ----
  const page = read('src/components/catalog/PublicCatalogPage.tsx')
  const surfaceTag = page.slice(page.indexOf('<CatalogPreviewSurface'))
  assert.match(surfaceTag, /onAddToBucket=\{addToBucket\}/, 'the storefront hands the sheet the bucket add')
  assert.match(surfaceTag, /getBucketQty=\{bucket\.getQty\}/, 'and the quantity reader')
  assert.match(surfaceTag, /onToggleWishlist=\{toggleWishlist\}/)
  const cards = page.slice(page.indexOf('<CatalogProductsSection'), page.indexOf('<CatalogProductsSection') + 4000)
  assert.match(cards, /onAddToBucket=\{addToBucket\}/, 'cards and sheet add through the same function')
  assert.match(cards, /onToggleWishlist=\{toggleWishlist\}/, 'cards and sheet save through the same function')
  assert.match(page, /setProductDetailView\(\{[^\n]*showStockStatus: shouldShowStockStatus\(displayConfig\)/, 'the sheet captures the owner switch when it opens')
  const surface = read('src/components/catalog/CatalogPreviewSurface.tsx')
  assert.match(surface, /onAddToBucket=\{onAddToBucket\}/)
  assert.match(surface, /onToggleWishlist=\{onToggleWishlist\}/)

  console.log('PASS public detail sheet adds to My List, honours the stock switch and shows the official name line')
} finally {
  await harness.close()
}

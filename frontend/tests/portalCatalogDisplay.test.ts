import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  buildPortalHighlightBadges,
  buildPortalPricePresentation,
  getPortalGridClass,
  getPortalMobileGridClass,
  getPortalPromotionDetails,
  normalizeRecommendedProductIds,
  productMatchesPortalBranches,
  shouldShowStockStatus,
  resolvePortalStockStatus,
  combinePortalStockStatus,
} from '../src/components/catalog/portalCatalogDisplay.ts'

const tailwindConfig = fs.readFileSync(new URL('../tailwind.config.ts', import.meta.url), 'utf8')
const catalogPageSource = fs.readFileSync(new URL('../src/components/catalog/CatalogPage.tsx', import.meta.url), 'utf8')
const catalogEditorSource = fs.readFileSync(new URL('../src/components/catalog/CatalogEditorSurface.tsx', import.meta.url), 'utf8')
const catalogSecondaryTabsSource = fs.readFileSync(new URL('../src/components/catalog/CatalogSecondaryTabs.tsx', import.meta.url), 'utf8')
const publicCatalogPageSource = fs.readFileSync(new URL('../src/components/catalog/PublicCatalogPage.tsx', import.meta.url), 'utf8')
const catalogPreviewSurfaceSource = fs.readFileSync(new URL('../src/components/catalog/CatalogPreviewSurface.tsx', import.meta.url), 'utf8')
const catalogProductsSectionSource = fs.readFileSync(new URL('../src/components/catalog/CatalogProductsSection.tsx', import.meta.url), 'utf8')

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

const copy = (key: string, fallback?: string): string => fallback || key
const formatPortalPrice = (usd: unknown, khr: unknown, config: { priceDisplay?: string }): string => {
  if (config.priceDisplay === 'KHR') return `${Number(khr || 0).toFixed(0)} KHR`
  if (config.priceDisplay === 'BOTH') return `$${Number(usd || 0).toFixed(2)} / ${Number(khr || 0).toFixed(0)} KHR`
  return `$${Number(usd || 0).toFixed(2)}`
}

runTest('normalizeRecommendedProductIds keeps unique positive numeric ids', () => {
  assert.deepEqual(normalizeRecommendedProductIds('[1,"2",2,-4,"bad",3]'), [1, 2, 3])
})

runTest('portal grid helpers honor configured mobile and desktop columns', () => {
  assert.equal(getPortalMobileGridClass(3), 'grid-cols-2 sm:grid-cols-3')
  assert.equal(getPortalGridClass(7), 'lg:grid-cols-4 xl:grid-cols-7')
  assert.equal(getPortalGridClass(8), 'lg:grid-cols-4 xl:grid-cols-8')
  assert.equal(getPortalGridClass(10), 'lg:grid-cols-5 xl:grid-cols-10')
  assert.match(tailwindConfig, /\{js,jsx,ts,tsx\}/, 'Tailwind must scan TypeScript helpers that contain portal grid classes')
  assert.match(catalogEditorSource, /customer_portal_grid_columns_mobile \?\? '1'/, 'mobile grid input should allow in-progress edits')
  assert.match(catalogEditorSource, /customer_portal_grid_columns_desktop \?\? '4'/, 'desktop grid input should allow in-progress edits')
  assert.match(catalogEditorSource, /customer_portal_show_product_brand/, 'portal display editor should persist brand chip toggles')
  assert.match(catalogEditorSource, /customer_portal_show_product_description/, 'portal display editor should persist description toggles')
})

runTest('branch matching uses branch presence instead of positive stock only', () => {
  const product = {
    branch_stock: [
      { branch_id: 2, quantity: 0 },
      { branch_id: 3, quantity: 4 },
    ],
  }
  assert.equal(productMatchesPortalBranches(product, ['2']), true)
  assert.equal(productMatchesPortalBranches(product, ['9']), false)
})

runTest('promotion helpers use explicit product discount, not internal special price', () => {
  const product = {
    selling_price_usd: 12,
    selling_price_khr: 49200,
    special_price_usd: 7,
    special_price_khr: 28700,
    discount_enabled: 1,
    discount_type: 'percent',
    discount_percent: 25,
    discount_label: 'Promo',
  }
  const promotion = getPortalPromotionDetails(product)
  assert.equal(promotion.active, true)
  assert.equal(promotion.percentOff, 25)

  const presentation = buildPortalPricePresentation(product, { priceDisplay: 'USD' }, formatPortalPrice)
  assert.equal(presentation.primaryText, '$9.00')
  assert.equal(presentation.originalText, '$12.00')
})

runTest('highlight badges stay compact and follow ranking priority', () => {
  const product = {
    portal_recommended: true,
    top_seller_rank: 1,
    top_product_rank: 2,
    new_arrival_rank: 1,
    selling_price_usd: 20,
    selling_price_khr: 82000,
    discount_enabled: 1,
    discount_type: 'fixed',
    discount_amount_usd: 5,
    discount_label: 'Deal',
  }
  const badges = buildPortalHighlightBadges(product, {
    showRecommendedBadge: true,
    showPromotionBadge: true,
    showTopSellerBadge: true,
    showTopProductBadge: true,
    showNewArrivalBadge: true,
    highlightRankLimit: 3,
  }, copy)

  assert.equal(badges.length, 2)
  assert.equal(badges[0].key, 'recommended')
  assert.equal(badges[1].key, 'promotion')
})

runTest('ranking badges do not render numeric prefixes in compact mobile cards', () => {
  const badges = buildPortalHighlightBadges({
    top_seller_rank: 1,
  }, {
    showTopSellerBadge: true,
    highlightRankLimit: 3,
  }, (key, fallback) => (key === 'topSellerBadge' ? 'Top {value} Seller' : fallback))

  assert.equal(badges[0].label, 'Top Seller')
})

runTest('public portal mobile contact actions stay compact', () => {
  assert.match(catalogSecondaryTabsSource, /className="relative h-(?:20|28) sm:h-(?:28|44)"/, 'public about hero banner should stay compact and fixed-height, not a tall forced viewport')
  assert.match(catalogSecondaryTabsSource, /data-portal-about-hero="true"/, 'public about hero should expose a mobile measurement hook')
  assert.match(catalogSecondaryTabsSource, /data-portal-contact-tray="true"/, 'public contact tray should expose a mobile measurement hook')
  assert.match(catalogSecondaryTabsSource, /-mt-(?:7|9) flex flex-wrap items-end gap-(?:3|4) sm:-mt-(?:9|12)/, 'public about name/tagline should sit on a plain surface below the banner, not overlaid on it')
  assert.match(catalogSecondaryTabsSource, /portal-contact-value-address/, 'long public portal addresses should be clamped on mobile')
  assert.match(catalogSecondaryTabsSource, /<span className="sr-only sm:not-sr-only">\{item\.label\}<\/span>/, 'social labels should collapse to accessible icon buttons on phones')
  assert.match(catalogSecondaryTabsSource, /businessFacts\?\.length \|\| socialLinks\?\.length/, 'contact and social actions should share one compact mobile tray')
  assert.match(catalogPageSource, /data-portal-secondary-loading="true"/, 'public secondary tab fallback should be compact and measurable')
  assert.doesNotMatch(catalogPageSource, /<SectionShell title=\{copy\('loadingPortal', 'Loading customer portal\.\.\.'\)\}>\s*<div className="text-sm text-slate-500">Loading\.\.\.<\/div>\s*<\/SectionShell>\s*}\)/, 'public secondary tab fallback should not show the large generic loading card')
})

runTest('public portal About tab keeps the story on the right, the map full-width below, and both logos clickable', () => {
  // These three items were previously listed as "still open" in progress.md,
  // but they were already fixed in this exact codebase in an earlier
  // session -- that entry was stale (copy-pasted forward without
  // re-checking). Locking each one in with a source assertion here so a
  // future session can't make the same stale-carry-forward mistake again.
  assert.match(publicCatalogPageSource, /messenger: MessengerIcon,/, 'public contact icon map should use the stylized MessengerIcon, not a generic MessageSquare stand-in')
  assert.match(catalogSecondaryTabsSource, /the business story\/description on the right per the requested/, 'About tab facts\\/contact card should stay on the left and the story on the right')
  assert.match(catalogSecondaryTabsSource, /title="portal-about-map"/, 'About tab map should render as its own full-width section')
  assert.match(catalogSecondaryTabsSource, /onClick=\{\(\) => openPortalImage\(previewConfig\.businessName \|\| copy\('logoImage', 'Logo image'\), \[versionedBusinessLogo\]\)\}/, 'About tab logo should open the image lightbox on click')
  // 6.2 (Part 399, user): the LOGO left the top bar entirely -- social
  // links took its side, language + light/dark the other. The clickable
  // logo lives on the About hero (pinned above); the header must carry
  // NO logo frame at all.
  assert.doesNotMatch(catalogPreviewSurfaceSource, /portal-logo-frame/, 'the top bar must not render a logo frame (6.2: logo removed from the header)')
  assert.match(catalogPreviewSurfaceSource, /Social links take this\s*\n?\s*side; language \+ light\/dark sit on the far side/, "6.2's split must stay documented at the header cells")
})

runTest('shouldShowStockStatus defaults to shown and only hides on explicit false', () => {
  assert.equal(shouldShowStockStatus({}), true, 'no config at all should default to shown')
  assert.equal(shouldShowStockStatus(), true, 'missing config arg should default to shown')
  assert.equal(shouldShowStockStatus({ showStockStatus: undefined }), true, 'explicit undefined should still default to shown')
  assert.equal(shouldShowStockStatus({ showStockStatus: true }), true)
  assert.equal(shouldShowStockStatus({ showStockStatus: false }), false, 'only literal false should hide it')
})

runTest('both stock-status render sites (filter pills + card badge) delegate to the shared shouldShowStockStatus helper', () => {
  assert.match(catalogProductsSectionSource, /shouldShowStockStatus\(previewConfig\)\s*\?\s*\(\s*<div className="rounded-\[1\.1rem\]/, 'stock-status filter-pill row should use the shared helper')
  assert.match(catalogProductsSectionSource, /shouldShowStockStatus\(previewConfig\)\s*\?\s*\(\s*<div className="absolute right-3 top-3">\s*<StatusPill/, 'card StatusPill badge should use the shared helper')
  assert.doesNotMatch(catalogProductsSectionSource, /previewConfig\.showStockStatus !== false/, 'no inline !== false check should remain now that the toggle is centralized')
})

// --- Server-computed stock status (public leak fix) ---------------------
// The portal payload ships stock_status/branch_availability instead of raw
// quantities+thresholds (routes/portal.ts attachPortalStockStatus). The
// resolver must read those first and only fall back to quantity math for
// legacy rows (editor preview drafts, pre-deploy caches).

runTest('resolvePortalStockStatus prefers the server-computed whole-store status', () => {
  assert.equal(resolvePortalStockStatus({ stock_status: 'low_stock', stock_quantity: 999 }, 'all'), 'low_stock')
  assert.equal(resolvePortalStockStatus({ stock_status: 'in_stock' }), 'in_stock')
})

runTest('resolvePortalStockStatus reads per-branch availability, missing branch = out of stock', () => {
  const product = {
    stock_status: 'in_stock',
    branch_availability: [
      { branch_id: 1, status: 'in_stock' },
      { branch_id: 2, status: 'out_of_stock' },
    ],
  }
  assert.equal(resolvePortalStockStatus(product, 1), 'in_stock')
  assert.equal(resolvePortalStockStatus(product, '2'), 'out_of_stock')
  // Server-shaped row with no entry for the asked branch: no stock row there.
  assert.equal(resolvePortalStockStatus(product, 99), 'out_of_stock')
})

runTest('resolvePortalStockStatus legacy fallback keeps the historical badge math', () => {
  const legacy = { stock_quantity: 5, low_stock_threshold: 10, out_of_stock_threshold: 0, branch_stock: [{ branch_id: 3, quantity: 0 }] }
  assert.equal(resolvePortalStockStatus(legacy, 'all'), 'low_stock')
  assert.equal(resolvePortalStockStatus(legacy, 3), 'out_of_stock')
  assert.equal(resolvePortalStockStatus({ stock_quantity: 50 }, 'all'), 'in_stock', 'defaults: out=0, low=10')
  assert.equal(
    resolvePortalStockStatus({ stock_quantity: 5, low_stock_threshold: 10 }, 'all', { stockThresholdMode: 'global', lowStockThreshold: 2, outOfStockThreshold: 0 }),
    'in_stock',
    'global threshold mode still honored on legacy rows',
  )
})

runTest('combinePortalStockStatus takes the most-available status and defaults unknowns to out', () => {
  assert.equal(combinePortalStockStatus('out_of_stock', 'low_stock'), 'low_stock')
  assert.equal(combinePortalStockStatus('in_stock', 'low_stock'), 'in_stock')
  assert.equal(combinePortalStockStatus(undefined, undefined), 'out_of_stock')
  assert.equal(combinePortalStockStatus('nonsense', 'low_stock'), 'low_stock')
})

runTest('the storefront no longer ships raw stock math -- components resolve via the shared helper', () => {
  assert.match(catalogProductsSectionSource, /resolvePortalStockStatus\(product, selectedStockBranch, previewConfig\)/)
  assert.match(publicCatalogPageSource, /resolvePortalStockStatus\(product, selectedStockBranch, displayConfig\)/)
  assert.match(catalogPageSource, /resolvePortalStockStatus\(product, statusBranch, displayConfig\)/)
  assert.doesNotMatch(publicCatalogPageSource, /function getStockStatus/, 'PublicCatalogPage must not keep its own quantity-based copy')
  assert.doesNotMatch(catalogPageSource, /function getStockStatus/, 'CatalogPage must not keep its own quantity-based copy')
})

runTest('productMatchesPortalBranches understands redacted branch_availability rows', () => {
  const served = { branch_availability: [{ branch_id: 1, status: 'in_stock' }, { branch_id: 2, status: 'out_of_stock' }] }
  assert.equal(productMatchesPortalBranches(served, ['1']), true)
  assert.equal(productMatchesPortalBranches(served, ['2']), false, 'out at that branch = not available there')
  const legacy = { branch_stock: [{ branch_id: 4, quantity: 2 }] }
  assert.equal(productMatchesPortalBranches(legacy, ['4']), true)
})

if (failed > 0) {
  process.exitCode = 1
}

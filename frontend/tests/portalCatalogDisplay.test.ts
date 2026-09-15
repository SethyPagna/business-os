import assert from 'node:assert/strict'
import fs from 'node:fs'
import { transformSync } from 'esbuild'
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
const catalogPaginationSource = fs.readFileSync(new URL('../src/components/catalog/catalogPagination.tsx', import.meta.url), 'utf8')
const paginationControlsSource = fs.readFileSync(new URL('../src/components/shared/PaginationControls.tsx', import.meta.url), 'utf8')
const portalFilterSource = fs.readFileSync(new URL('../src/components/catalog/PortalFilterCombobox.tsx', import.meta.url), 'utf8')
const productDetailFlyoutSource = fs.readFileSync(new URL('../src/components/catalog/ProductDetailFlyout.tsx', import.meta.url), 'utf8')
const catalogImagesSource = fs.readFileSync(new URL('../src/components/catalog/catalogImages.tsx', import.meta.url), 'utf8')
const publicPortalCssSource = fs.readFileSync(new URL('../src/styles/public-portal.css', import.meta.url), 'utf8')

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

runTest('portal cover paths are rendered as image sources instead of fragile CSS urls', () => {
  assert.match(catalogSecondaryTabsSource, /src=\{versionedBusinessCover\}/, 'public cover paths with spaces or parentheses must remain valid image URLs')
  assert.doesNotMatch(catalogSecondaryTabsSource, /`url\(\$\{versionedBusinessCover\}\)`/, 'public cover paths must not be interpolated into an unquoted CSS url')
  assert.match(catalogEditorSource, /src=\{editorDraft\.customer_portal_cover_image\}/, 'editor cover previews should use the same robust image-source rendering')
  assert.doesNotMatch(catalogEditorSource, /url\(\$\{editorDraft\.customer_portal_cover_image\}\)/, 'editor cover paths must not be interpolated into an unquoted CSS url')
})

runTest('portal contact fields are included in the settings save payload', () => {
  const payloadStart = catalogPageSource.indexOf('const fullSavePayload: Record<string, unknown> = {')
  const payloadEnd = catalogPageSource.indexOf('const savePayload = Object.fromEntries(', payloadStart)
  assert.notEqual(payloadStart, -1)
  assert.notEqual(payloadEnd, -1)
  const savePayloadSource = catalogPageSource.slice(payloadStart, payloadEnd)
  for (const key of [
    'customer_portal_contact_messenger',
    'customer_portal_contact_telegram',
    'customer_portal_contact_whatsapp',
    'customer_portal_contact_phone',
    'customer_portal_contact_instagram',
    'customer_portal_contact_messenger_label',
    'customer_portal_contact_telegram_label',
    'customer_portal_contact_whatsapp_label',
    'customer_portal_contact_phone_label',
    'customer_portal_contact_instagram_label',
    'customer_portal_show_contact_messenger',
    'customer_portal_show_contact_telegram',
    'customer_portal_show_contact_whatsapp',
    'customer_portal_show_contact_phone',
    'customer_portal_show_contact_instagram',
  ]) {
    assert.match(savePayloadSource, new RegExp(`\\b${key}\\s*:`), `${key} must survive Save portal settings`)
  }
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

runTest('portal editor compacts compatible controls into responsive rows with mobile clearance', () => {
  assert.match(catalogEditorSource, /id="portal-editor-top"[^>]*overflow-x-hidden[^>]*pb-\[calc\(4\.5rem\+env\(safe-area-inset-bottom\)\)\][^>]*md:pb-0/)
  assert.match(catalogEditorSource, /data-testid="portal-visibility-grid"[^>]*sm:grid-cols-2[^>]*xl:grid-cols-3/)
  assert.match(catalogEditorSource, /data-testid="portal-layout-grid"[^>]*sm:grid-cols-2[^>]*xl:grid-cols-4/)
  assert.match(catalogEditorSource, /data-testid="portal-highlight-grid"[^>]*sm:grid-cols-2[^>]*xl:grid-cols-3/)
  assert.match(catalogEditorSource, /data-testid="portal-business-identity-grid"[^>]*sm:grid-cols-2/)
  assert.match(catalogEditorSource, /data-testid="portal-social-links-grid"[^>]*sm:grid-cols-2[^>]*2xl:grid-cols-4/)
  assert.match(catalogEditorSource, /data-testid="portal-contact-channel-grid"[^>]*sm:grid-cols-2[^>]*2xl:grid-cols-3/)
  assert.match(catalogEditorSource, /data-testid="portal-logo-controls-grid"[^>]*sm:grid-cols-2[^>]*xl:grid-cols-3/)
  assert.match(catalogEditorSource, /min-h-11[^>]*rounded-xl/, 'compact switch rows must retain a 44px mobile touch target')
})

runTest('portal editor compaction keeps guidance, validation, preview, and linked account actions', () => {
  assert.match(catalogEditorSource, /<HintLabel[\s\S]*portalAssistantHint/)
  assert.match(catalogEditorSource, /<InfoHint[\s\S]*contactChannelsHint/)
  assert.match(catalogEditorSource, /<HintLabel[\s\S]*translationOverridesHint/)
  assert.match(catalogEditorSource, /<HintLabel[\s\S]*stockThresholdHint/)
  assert.doesNotMatch(catalogEditorSource, /<p[^>]*>\{copy\('contactChannelsHint'/)
  assert.doesNotMatch(catalogEditorSource, /<p[^>]*>\{copy\('stockThresholdHint'/)
  assert.match(catalogEditorSource, /disabled=\{editorSaving \|\| !editorDirty\} onClick=\{savePortalDraft\}/)
  assert.match(catalogEditorSource, /previewSectionRef\.current\?\.scrollIntoView/)
  assert.match(catalogEditorSource, /href=\{publicPortalUrl\}[^>]*target="_blank"/)
  assert.match(catalogEditorSource, /navigateTo\('loyalty_points'\)/)
})

runTest('portal editor compaction preserves cover, FAQ, contact, and social draft wiring', () => {
  assert.match(catalogEditorSource, /value=\{editorDraft\.customer_portal_cover_image\}/)
  assert.match(catalogEditorSource, /uploadDraftImage\('customer_portal_cover_image'\)/)
  assert.match(catalogEditorSource, /faqItems\.map[\s\S]*updateFaqItem\(item\.id, 'question'/)
  assert.match(catalogEditorSource, /faqItems\.map[\s\S]*updateFaqItem\(item\.id, 'answer'/)
  for (const key of [
    'customer_portal_website',
    'customer_portal_facebook',
    'customer_portal_instagram',
    'customer_portal_telegram',
    'customer_portal_contact_messenger',
    'customer_portal_contact_telegram',
    'customer_portal_contact_instagram',
    'customer_portal_contact_whatsapp',
    'customer_portal_contact_phone',
  ]) {
    assert.match(catalogEditorSource, new RegExp(`name="${key}"[\\s\\S]{0,320}setDraft\\('${key}'`), `${key} must keep its draft update handler`)
  }
})

runTest('portal editor work leaves product filter popovers viewport-portalled', () => {
  assert.match(portalFilterSource, /import LazyPortalMenu from '\.\.\/shared\/LazyPortalMenu'/)
  assert.match(portalFilterSource, /<LazyPortalMenu[\s\S]*max-w-\[calc\(100vw-1rem\)\]/)
  assert.match(portalFilterSource, /role="dialog"[\s\S]*role="listbox"/)
})

runTest('public product discovery uses a sticky unified search, responsive brand index, and explicit paging controls', () => {
  assert.match(catalogProductsSectionSource, /sticky top-16[\s\S]*focus-within:border-blue-400/,
    'search should stay sticky and use the same blue discovery accent as filters')
  assert.match(catalogProductsSectionSource, /copy\('jumpToBrand', 'Jump to brand'\)/,
    'the brand index still needs its labelled, translated name')
  // The brand index used to be TWO controls: a scrolling 4-column letter grid
  // in the desktop aside and a horizontally scrolling chip row below `lg`.
  // Both were inner scroll containers over the product list. They are now one
  // screen-edge rail that serves every breakpoint (see alphaIndexRail.test.ts
  // and storefrontScrollRoot.test.ts) -- and BOTH mounts of this section keep
  // an index: the storefront pins it to the screen edge, the admin portal
  // editor's preview takes the in-flow variant so it cannot float out of the
  // preview panel.
  assert.match(catalogProductsSectionSource, /<AlphaIndexRail\b[\s\S]*edge=\{publicView \? 'screen' : 'inline'\}/,
    'every breakpoint gets the same vertical brand rail, and the editor preview gets one too')
  assert.doesNotMatch(catalogProductsSectionSource, /max-h-\[min\(18rem,calc\(100vh-32rem\)\)\]/,
    'the desktop letter grid and its inner scroller are retired')
  assert.match(catalogPaginationSource, /import PaginationControls from '\.\.\/shared\/PaginationControls'/,
    'storefront paging should use the same current Back/Next control as the rest of the app')
  assert.match(catalogPaginationSource, /export const CATALOG_DEFAULT_PAGE_SIZE = 50/,
    'the default storefront page size remains aligned with the server response contract')
  // Reverses the 2026-09-07 removal of the shopper-facing size control
  // (owner decision, 2026-09-14): the selector is back, with exactly three
  // sizes, handed straight to the shared pager.
  assert.match(catalogPaginationSource, /export const CATALOG_PAGE_SIZE_OPTIONS: number\[\] = \[20, 50, 100\]/,
    'the shopper picks between exactly 20, 50 and 100 products a page')
  assert.match(catalogPaginationSource, /onPageSizeChange=\{onPageSizeChange\}[\s\S]*pageSizeOptions=\{pageSizeOptions\}/,
    'the centred public pager must forward the size handler and the option list')
  assert.match(catalogPaginationSource, /layout="centered"/,
    'public paging remains one centred Back/page/Next control')
})

runTest('public catalog scrolls through the document and keeps its pager controls in the storefront order', () => {
  // BOTH public entries, not just the one CatalogPage owns. index.tsx mounts
  // PublicCatalogRoot -> PublicCatalogPage for every path on the customer
  // host; App.tsx mounts <CatalogPage publicView /> for the in-app route. The
  // marker is what main.css keys the document-scroll unlock off, so a route
  // that forgets it ships a storefront the browser will not scroll. Each one
  // also RESTORES the previous value instead of blindly removing it, so a
  // StrictMode double-mount -- or a public route nested under a shell that
  // already set the marker -- cannot leave the document stripped of it.
  for (const [route, source] of [['PublicCatalogPage', publicCatalogPageSource], ['CatalogPage', catalogPageSource]]) {
    // Named for BOTH elements on purpose. main.css keys the scroll unlock off
    // html[data-public-portal] and the body growth off body[data-public-portal],
    // so a route that stamps only one of them still ships a page that will not
    // scroll -- and one loose wildcard match across the whole file would not
    // notice the missing half.
    assert.ok(source.includes("html.setAttribute('data-public-portal', 'true')"),
      route + ' must stamp the document element with the public scroll marker')
    assert.ok(source.includes("body.setAttribute('data-public-portal', 'true')"),
      route + ' must stamp the body with the public scroll marker')
    assert.ok(source.includes("const previousHtmlMarker = html.getAttribute('data-public-portal')")
      && source.includes("const previousBodyMarker = body.getAttribute('data-public-portal')"),
      route + ' must capture the previous marker values before overwriting them')
    assert.ok(source.includes("if (previousHtmlMarker === null) html.removeAttribute('data-public-portal')")
      && source.includes("if (previousBodyMarker === null) body.removeAttribute('data-public-portal')"),
      route + ' must RESTORE the previous markers on unmount, not blindly remove them')
  }
  // Neither public root may declare a vertical scroller of its own: the
  // document owns the one page scroll. storefrontScrollRoot.test.ts carries
  // the full shell contract, including why 'overflow-x: clip' is the only
  // overflow left on the preview surface.
  assert.match(catalogPreviewSurfaceSource, /publicView \? 'min-h-screen w-full overflow-x-clip'/,
    'the public surface must not create a nested vertical scroller')
  assert.doesNotMatch(catalogPreviewSurfaceSource, /publicView \? \{[^}]*overflowY:\s*'auto'/,
    'the content-height public root must not trap wheel/touch events in a second scroll owner')
  assert.doesNotMatch(catalogPageSource, /publicView \? \{[^}]*overflowY:\s*'auto'/,
    'legacy public-view wrappers must not trap wheel/touch events in a second scroll owner')
  // Pager ORDER, on the one control both public paths mount: CatalogPage and
  // PublicCatalogPage -> CatalogPreviewSurface both render
  // CatalogProductsSection, which mounts CatalogPaginationControls above and
  // below the grid. Asserting layout="centered" alone only proves which
  // variant is asked for; this reads the variant's own branch so a reordering
  // edit inside PaginationControls cannot silently move Back behind the page
  // number on the storefront.
  assert.match(catalogPaginationSource, /layout="centered"/)
  const pagerBranchStart = paginationControlsSource.indexOf("if (layout === 'centered')")
  const pagerBranchEnd = paginationControlsSource.indexOf('if (compact && rangeAsPageSize)')
  assert.ok(pagerBranchStart >= 0 && pagerBranchEnd > pagerBranchStart, 'the dedicated storefront pager branch must exist')
  const pagerBranch = paginationControlsSource.slice(pagerBranchStart, pagerBranchEnd)
  // Anchored on the page FIELD, not on `aria-label={pageLabel}`: the branch's
  // <nav> landmark is named from the same label and sits before Back, so that
  // string finds the wrapper first and the order check passes on any layout.
  const pageSizeSelectAt = pagerBranch.indexOf('ariaLabel={perPageLabel}')
  const backAt = pagerBranch.indexOf('aria-label={backLabel}')
  const pageFieldAt = pagerBranch.indexOf('inputMode="numeric"')
  const totalPagesAt = pagerBranch.indexOf('/ {totalPages}')
  const nextAt = pagerBranch.indexOf('aria-label={nextLabel}')
  assert.ok(backAt > 0 && pageFieldAt > 0 && totalPagesAt > 0 && nextAt > 0,
    'the storefront pager must keep a Back control, an editable page field, a total-page count and a Next control')
  // 2026-09-15 (owner, supersedes 2026-09-14's [size][Back] order): Back
  // leads the row, then the page-size selector.
  assert.ok(pageSizeSelectAt > backAt,
    'the page-size selector must sit AFTER Back: [Back] [20/50/100] [page / total] [Next] (owner, 2026-09-15)')
  assert.ok(backAt < pageSizeSelectAt && pageSizeSelectAt < pageFieldAt, 'Back and the size selector must precede the page indicator')
  assert.ok(pageFieldAt < totalPagesAt, 'the page number must precede its total')
  assert.ok(totalPagesAt < nextAt, 'the page indicator must precede Next')
  const navAt = pagerBranch.indexOf('<nav ')
  assert.ok(navAt >= 0 && navAt < backAt, 'the whole storefront pager must sit inside a landmark, not a bare div')
  assert.ok(pagerBranch.slice(navAt, backAt).includes('aria-label={pageLabel}'),
    'the pager landmark must carry an accessible name a screen-reader user can jump to')
  // Both captions come from the shared pack keys with an English fallback --
  // never the raw lowercase key, which is what a map's '|| key' fallback
  // prints when the map has no entry for it.
  assert.match(paginationControlsSource, /const backLabel = typeof t === 'function' \? \(t\('back'\) \|\| 'Back'\)/)
  assert.match(paginationControlsSource, /const nextLabel = typeof t === 'function' \? \(t\('next'\) \|\| 'Next'\)/)
})

runTest('the public pager carries a 20/50/100 size selector, wired end to end on both public paths', () => {
  const pagerBranch = paginationControlsSource.slice(
    paginationControlsSource.indexOf("if (layout === 'centered')"),
    paginationControlsSource.indexOf('if (compact && rangeAsPageSize)'),
  )
  // The shared PageSizeSelect, the same control the admin pagers use -- a
  // native <select> is banned in components/ (tests/sourceSyntaxCheck.ts).
  assert.match(pagerBranch, /<PageSizeSelect[\s\S]{0,600}ariaLabel=\{perPageLabel\}/,
    'the selector must be the shared control, named from the translated per-page label')
  assert.match(pagerBranch, /options=\{sizeOptions\}/,
    'the selector must offer the caller\'s sizes, plus any off-menu configured one')
  assert.match(pagerBranch, /allowCustom=\{false\}/,
    'the storefront must not let a shopper type an unbounded page size')
  assert.match(paginationControlsSource, /const perPageLabel = typeof t === 'function' \? \(t\('per_page'\) \|\| 'per page'\)/,
    'the per-page name comes from the shared pack key with an English fallback, never the raw key')
  // A one-page result still has a size to change. Hiding the whole pill on
  // totalPages <= 1 is exactly how the previous in-pill chooser became
  // unreachable for a shopper who had narrowed the catalogue right down.
  assert.match(pagerBranch, /if \(totalPages <= 1 && !showPageSizeSelect\) return null/,
    'a one-page result must keep the pill when it carries the size selector')

  // Wired at BOTH pager mounts of the products section...
  assert.equal((catalogProductsSectionSource.match(/onPageSizeChange=\{updatePageSize\}/g) || []).length, 2,
    'the pagers above and below the grid must both change the page size')
  // Counted, not matched: with only one mount required, dropping the key from
  // the other left every test AND verify:i18n green while that selector
  // announced the raw key "per_page" to a screen reader.
  assert.equal((catalogProductsSectionSource.match(/per_page: copy\('perPage', 'Per page'\)/g) || []).length, 2,
    'BOTH pagers must resolve the accessible name through the portal packs, which already translate perPage')
  assert.doesNotMatch(catalogProductsSectionSource, /it is a Filters field now/,
    'the size control is on the pager row again, so the Filters-field note must not survive')

  // ...and fed identically by BOTH public paths: the viewer's choice outranks
  // the server's page size, resets to page 1, and is remembered per browser.
  for (const [route, source, handler] of [
    ['PublicCatalogPage', publicCatalogPageSource, 'changeProductPageSize'],
    ['CatalogPage', catalogPageSource, 'changePortalProductPageSize'],
  ]) {
    assert.match(source, new RegExp('setProductPageSize[=:] ?\\{?' + handler),
      route + ' must hand the products section a page-size handler')
    const body = source.slice(source.indexOf('const ' + handler + ' = (nextSize: number) => {'))
    assert.ok(body.startsWith('const ' + handler), route + ' must define that handler')
    const handlerBody = body.slice(0, body.indexOf('\n  }'))
    assert.match(handlerBody, /writeStoredCatalogPageSize\(size\)/, route + ' must persist the choice for the next visit')
    assert.match(handlerBody, /viewerPageSizeRef\.current = size/, route + ' must make the choice outrank later server payloads')
    assert.match(handlerBody, /Page\(1\)/, route + ' must return to page 1 when the page size changes')
    assert.match(source, /viewerPageSizeRef = useRef\(readStoredCatalogPageSize\(\)\)/,
      route + ' must read the stored viewer size before the server tells it one')
    assert.match(source, /if \(!viewerPageSizeRef\.current\) set(Portal)?ProductPageSize\(Number\(/,
      route + ' must not let a bootstrap payload overwrite the viewer choice')
    assert.match(source, /bootstrapPageSizeMatchesViewer\(/,
      route + ' must re-run the product search when the bootstrap page was cut at another size')
  }
})

// The two portal cache readers are module-local functions inside component
// files far too heavy to bundle whole, so each is lifted out by source slice
// and compiled with esbuild: the REAL source runs, and `window` arrives as a
// parameter, which is the only way to hand it one whose storage getters throw.
function loadPortalCacheReader(source: string, keyConst: string, otherConsts: string[]) {
  const lf = source.replace(/\r\n/g, '\n')
  const start = lf.indexOf('function readPortalCache(')
  assert.ok(start > 0, 'readPortalCache must still exist')
  const end = lf.indexOf('\n}\n', start)
  assert.ok(end > start, 'readPortalCache must still end at a top-level brace')
  const declarations = [keyConst, ...otherConsts].map((name) => {
    const declared = lf.match(new RegExp('^const ' + name + ' = .*$', 'm'))
    assert.ok(declared, name + ' must still be a module constant')
    return declared[0]
  })
  const compiled = transformSync(declarations.join('\n') + '\n' + lf.slice(start, end + 2), {
    loader: 'ts',
    format: 'esm',
  }).code
  const factory = new Function('window', compiled + '\nreturn readPortalCache')
  const key = String(declarations[0].split(' = ')[1] || '').replace(/^'|'$/g, '')
  return { key, read: (hostWindow: unknown) => (factory(hostWindow) as () => unknown)() }
}

runTest('both portal cache readers survive a browser that blocks site data', () => {
  // Safari private mode and Chrome's "block all cookies" make the PROPERTY
  // throw, not getItem -- so a reader that lists the stores outside its try
  // throws out of a useRef initializer on the very first render. The
  // storefront root has a Suspense boundary but no error boundary, so that
  // rendered the whole page blank.
  const blockedWindow = {}
  for (const property of ['sessionStorage', 'localStorage']) {
    Object.defineProperty(blockedWindow, property, {
      configurable: true,
      get() { throw new Error('SecurityError: The operation is insecure.') },
    })
  }

  for (const [route, source, keyConst, otherConsts] of [
    ['PublicCatalogPage', publicCatalogPageSource, 'PUBLIC_PORTAL_CACHE_KEY', ['PUBLIC_PORTAL_CACHE_MAX_AGE_MS', 'PUBLIC_PORTAL_CACHE_PRODUCT_LIMIT']],
    ['CatalogPage', catalogPageSource, 'PORTAL_CACHE_KEY', ['PORTAL_CACHE_MAX_AGE_MS', 'PORTAL_CACHE_PRODUCT_LIMIT']],
  ] as Array<[string, string, string, string[]]>) {
    const { key, read } = loadPortalCacheReader(source, keyConst, otherConsts)
    assert.equal(read(blockedWindow), null, route + ' must read blocked storage as "no cache", never throw')

    // Positive control: same reader, same call, a storage that works. Without
    // it this test would pass just as happily against a reader that returns
    // null unconditionally.
    const entries = new Map<string, string>([[key, JSON.stringify({
      cachedAt: Date.now(),
      products: [{ id: 7, name: 'Serum' }],
    })]])
    const store = {
      getItem: (name: string) => entries.get(name) ?? null,
      setItem: (name: string, value: string) => { entries.set(name, value) },
      removeItem: (name: string) => { entries.delete(name) },
    }
    const cached = read({ sessionStorage: store, localStorage: store }) as { products?: unknown[] } | null
    assert.equal(cached?.products?.length, 1, route + ' must still read a real cached payload')
  }
})

runTest('neither public path seeds its grid from a payload cut at another page size', () => {
  // The embedded/cached payload is page 1 at the Worker's fixed 50, ordered
  // promoted/brand/name (routes/portal.ts buildPortalCatalog), while a browse
  // payload renders A-Z by name -- so for a shopper on 20 it is neither page 1
  // nor a prefix of it. Seeding it anyway put 50 cards under a pager that read
  // "1 / total-over-20" for one round trip.
  const seeded = ([
    ['PublicCatalogPage', publicCatalogPageSource],
    ['CatalogPage', catalogPageSource],
  ] as Array<[string, string]>).filter(([, source]) => (
    /const seedMatchesViewerPageSize = !cachedPortal/.test(source)
    && /seedMatchesViewerPageSize (\?|&&)/.test(source)
    && /useState\(\(\) => !seedMatchesViewerPageSize\)/.test(source)
    && /if \(bootstrapMatchesViewer\) setProducts\(/.test(source)
    && /setAwaitingViewerSizedProducts\(false\)/.test(source)
    && /loadingProducts[:=] ?\{?\(?[^\r\n]*awaitingViewerSizedProducts/.test(source)
  ))
  assert.equal(seeded.length, 2,
    'both public paths must gate the grid seed on the viewer page size and keep the skeletons up meanwhile')

  for (const [route, source] of [
    ['PublicCatalogPage', publicCatalogPageSource],
    ['CatalogPage', catalogPageSource],
  ]) {
    assert.doesNotMatch(source, /slice\(0, ?viewerPageSize/,
      route + ' must not seed a PREFIX either: the payload is ordered by brand, the grid by name')
    // EVERY seed from a bootstrap payload, not just the first one found: both
    // of CatalogPage's bootstrap paths (public route and editor preview) mount
    // the same viewer-sized pager, so one gated site proves nothing about the
    // other.
    const bootstrapSeeds = source.match(/[^\r\n]*setProducts\((?:mergedProducts|nextProducts)\)[^\r\n]*/g) || []
    assert.ok(bootstrapSeeds.length > 0, route + ' must still seed its grid from the bootstrap payload')
    for (const seed of bootstrapSeeds) {
      assert.match(seed, /if \(bootstrapMatchesViewer\) setProducts\(/,
        route + ' seeds the grid from a bootstrap payload without checking its page size: ' + seed.trim())
    }
  }
})

runTest('public product details keep every prepared section visible when its data is empty', () => {
  for (const section of ['features_benefits', 'who_for', 'ingredients', 'caution']) {
    assert.match(productDetailFlyoutSource, new RegExp(`sectionKey="${section}"`), `${section} should stay visibly wired`)
  }
  assert.match(productDetailFlyoutSource, /data-product-detail-section="need_more_details"/)
  for (const label of ['productOfficialName', 'productIntroduction', 'productCategory', 'productBrand']) {
    assert.match(productDetailFlyoutSource, new RegExp(`copy\\('${label}'`), `${label} should remain in the flyout even without content`)
  }
  assert.match(productDetailFlyoutSource, /productDetailNotProvided[\s\S]*Not provided yet\./)
  assert.match(productDetailFlyoutSource, /productNeedMoreDetailsFallback[\s\S]*Contact us for more product details\./)
})

runTest('public media blocks ordinary save, drag, and long-press interactions', () => {
  assert.match(publicCatalogPageSource, /data-public-media-protection="true"/)
  assert.match(publicCatalogPageSource, /onContextMenuCapture=/)
  assert.match(publicCatalogPageSource, /onDragStartCapture=/)
  assert.match(publicCatalogPageSource, /onAuxClickCapture=/)
  assert.match(catalogImagesSource, /data-protected-media="true"/)
  assert.match(catalogImagesSource, /draggable=\{false\}/)
  assert.match(publicPortalCssSource, /-webkit-touch-callout:\s*none/)
  assert.match(publicPortalCssSource, /-webkit-user-drag:\s*none/)
  assert.match(publicPortalCssSource, /user-select:\s*none/)
})

runTest('public mobile controls and overlays keep accessible touch/dialog contracts', () => {
  assert.match(publicPortalCssSource, /@media \(pointer: coarse\)[\s\S]*min-height:\s*44px/)
  assert.match(publicPortalCssSource, /button\[aria-label\][\s\S]*min-width:\s*44px/)
  assert.match(publicCatalogPageSource, /role="dialog"[\s\S]*aria-modal="true"/)
  assert.match(productDetailFlyoutSource, /role="dialog"[\s\S]*aria-modal="true"/)
})

if (failed > 0) {
  process.exitCode = 1
}

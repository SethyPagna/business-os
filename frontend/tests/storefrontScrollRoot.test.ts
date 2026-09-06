// "The public storefront cannot be scrolled on my device."
//
// Emulation at 375 and 1280 never reproduced it, so this test pins the four
// ways the storefront can lose its scroll -- each one a mechanism that was
// actually present in the tree, not a hypothetical:
//
//  1. A body/document scroll LOCK left armed. The storefront has no modal
//     library that locks the body, and it must stay that way: nothing in the
//     public catalog file set may write document.body.style.overflow. The
//     flyouts (bucket, contact, account, wishlist, galleries) are absolutely
//     -positioned overlays, so with every flyout CLOSED there is by
//     construction nothing left to unlock.
//  2. An inner scroll container sitting over the product list, swallowing
//     the wheel/touch gesture aimed at the page. The brand-letter GRID was
//     exactly that (`max-h-[min(18rem,...)] overflow-y-auto`), and the
//     lg:hidden letter ROW was its horizontal twin.
//  3. `overflow-y: auto` declared next to an `overflow-x: visible` class.
//     CSS resolves `visible` to `auto` when the other axis is not visible,
//     so the public shell silently became a two-axis scroll container and
//     any over-wide descendant produced a horizontal scroller at 375 that
//     html's own `overflow-x: hidden` could not reach.
//  4. Pull-to-refresh calling preventDefault() on the first touchmove of an
//     ordinary upward swipe, which cancels native scrolling for the whole
//     gesture.
//
// Run: node tests/storefrontScrollRoot.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function read(relative: string): string {
  return fs.readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
}

// Several assertions below say "this class/pattern is gone". The comment that
// records WHY it is gone has to be free to name it, so those checks read a
// comment-stripped copy of the file.
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const STOREFRONT_FILES = [
  '../src/components/catalog/PublicCatalogPage.tsx',
  '../src/components/catalog/CatalogPreviewSurface.tsx',
  '../src/components/catalog/CatalogProductsSection.tsx',
  '../src/components/catalog/CatalogSecondaryTabs.tsx',
  '../src/components/catalog/ProductDetailFlyout.tsx',
  '../src/PublicCatalogRoot.tsx',
] as const

const sources = new Map(STOREFRONT_FILES.map((file) => [file, read(file)] as const))
const previewSurface = code('../src/components/catalog/CatalogPreviewSurface.tsx')
const productsSection = code('../src/components/catalog/CatalogProductsSection.tsx')
const publicPage = sources.get('../src/components/catalog/PublicCatalogPage.tsx')!
const pullToRefreshHook = read('../src/components/shared/usePullToRefresh.ts')
const pullToRefreshUtil = read('../src/utils/pullToRefresh.ts')

// The lock pattern this test hunts for. Written once so the positive control
// below proves the pattern can actually match something in this repo -- a
// grep that matches nothing everywhere is indistinguishable from a broken
// grep.
const SCROLL_LOCK = /(document\.(body|documentElement)|body|html)\.style\.(overflow|overflowY|position)\s*=/

runTest('the scroll-lock pattern matches a real writer somewhere in the tree (positive control)', () => {
  const receipt = read('../src/utils/printReceipt.ts')
  assert.match(receipt, /\.style\.overflow\s*=/, 'printReceipt writes .style.overflow -- if this stops matching, the assertions below are vacuous')
})

runTest('no storefront file locks the body or document scroll', () => {
  for (const [file, source] of sources) {
    assert.doesNotMatch(
      source,
      SCROLL_LOCK,
      `${file} must not take a body/document scroll lock -- the storefront has no unlock path, so a lock left armed by a closed flyout is unrecoverable`,
    )
  }
})

runTest('every storefront flyout is an overlay, so a CLOSED flyout leaves nothing locked', () => {
  // Each of these renders null (or nothing) when closed; none of them is a
  // wrapper whose closed state could still be constraining the page.
  assert.match(publicPage, /const pullToRefreshEnabled = !productGalleryView\.open/, 'the flyout inventory must stay explicit')
  for (const flag of ['bucketOpen', 'contactOpen', 'accountOpen', 'wishlistOpen', 'portalImageView.open', 'filePicker.open']) {
    assert.ok(
      publicPage.includes(`!${flag}`),
      `${flag} must be part of the closed-flyout condition; a flyout outside it could hold the page while looking shut`,
    )
  }
})

runTest('the public shell is not a two-axis scroll container by accident', () => {
  const shellStart = previewSurface.indexOf('data-portal-root="true"')
  const shellEnd = previewSurface.indexOf('max-w-[1680px]')
  assert.ok(shellStart > 0 && shellEnd > shellStart, 'the public shell wrapper must still be findable')
  const shell = previewSurface.slice(shellStart, shellEnd)
  assert.match(shell, /overflowY: 'auto'/, 'iOS momentum scrolling on the shell is deliberate and stays')
  assert.doesNotMatch(
    shell,
    /overflow-visible/,
    "`overflow-visible` beside `overflowY: 'auto'` is the bug: CSS turns the visible axis into `auto`, so the shell grew a horizontal scroller of its own",
  )
  assert.match(shell, /overflowX: 'clip'/, 'the horizontal axis must be clipped explicitly')
  assert.doesNotMatch(
    shell,
    /overflowX: 'hidden'/,
    '`hidden` would make the shell a scrollport and break the sticky nav that lives inside it -- `clip` does not',
  )
  // `min-h-screen` is correct and stays; a bare `h-screen` is the bug.
  assert.doesNotMatch(shell, /(?<![\w-])h-screen\b/, 'a fixed-height shell cannot grow with the catalog and pins the page')
  assert.match(shell, /min-h-screen/, 'the shell must still fill at least the viewport')
  assert.doesNotMatch(shell, /overflow-hidden/, 'a hidden shell clips the whole storefront below the fold')
})

runTest('nothing scrollable sits over the product list except the filters dialog', () => {
  const scrollers = productsSection.match(/overflow-[xy]-auto/g) || []
  assert.equal(
    scrollers.length,
    1,
    `the products section may own exactly ONE inner scroller (the filters dialog); found ${scrollers.length}. The brand-letter grid and the lg:hidden letter row were the other two, and both ate page scrolling.`,
  )
  const dialogAt = productsSection.indexOf('max-h-[min(32rem,calc(100dvh-1rem))] overflow-y-auto')
  assert.ok(dialogAt > 0, 'the one permitted scroller must be the filters dialog panel')
  assert.match(
    productsSection.slice(Math.max(0, dialogAt - 400), dialogAt),
    /role="dialog"/,
    'the permitted scroller must be inside a dialog -- i.e. only reachable while a flyout is OPEN',
  )
})

runTest('nothing over-wide is left in the products section to overflow a 375px viewport', () => {
  assert.doesNotMatch(productsSection, /h-8 min-w-9/, 'the 36px letter chips were a full-width horizontal scroller of their own on phones')
  assert.doesNotMatch(productsSection, /\bw-max\b/, 'a w-max track inside the page flow widens the document at 375')
  assert.doesNotMatch(productsSection, /min-w-\[(?:[3-9]\d|\d{3,})rem\]/, 'no fixed minimum wider than a phone may appear in the page flow')
})

runTest('the one w-max track on the storefront stays inside its own scroller', () => {
  const trackAt = previewSurface.indexOf('portal-nav-track')
  assert.ok(trackAt > 0, 'the section-nav track must still exist')
  const before = previewSurface.slice(Math.max(0, trackAt - 300), trackAt)
  assert.match(before, /portal-nav-scroll overflow-x-auto/, 'the nav track is `w-max`, so its parent must own the horizontal scroll')
})

runTest('pull-to-refresh suppresses native scrolling only for a real downward pull', () => {
  assert.match(pullToRefreshUtil, /export function shouldBlockNativeScroll/, 'the suppression decision must be a pure, testable predicate')
  const guardAt = pullToRefreshHook.indexOf('if (!shouldBlockNativeScroll(rawDelta)) return')
  const preventAt = pullToRefreshHook.indexOf('event.preventDefault()')
  assert.ok(guardAt > 0, 'the hook must consult the predicate, not re-derive the threshold inline')
  assert.ok(
    guardAt < preventAt,
    'the hook must bail out BEFORE preventDefault() until the gesture is a real pull -- one prevented touchmove cancels native scrolling for the whole gesture',
  )
})

if (failed > 0) {
  console.error(`\n${failed} storefront scroll-root check(s) failed`)
  process.exit(1)
}
console.log('\nAll storefront scroll-root checks passed')

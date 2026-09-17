// The public storefront's product pager (leangbeauty.com -> Products).
//
// The owner's report, with a screenshot: a full-width "Showing 1-50 of 3,555
// products" bar above the grid, a per-page dropdown far wider than the "50"
// it prints, the pager itself shoved to the right-hand edge, and Back/Next
// reading as the raw lowercase keys "back"/"next" in every language.
//
// Every one of those is a property of the SHARED PaginationControls' DEFAULT
// branch, which catalogPagination.tsx reached by passing no layout at all.
// This test pins the storefront's own shape instead: one centred single-line
// pill, mounted symmetrically above AND below the grid, with no summary row
// anywhere. The page-size selector went through two reversals -- dropped
// 2026-09-07, restored 2026-09-14, reordered behind Back on 2026-09-15 -- and
// then P10-20 (owner, 2026-09-17: "no need to show rows per page options")
// retired it for good, from this branch along with every other. What
// survives here is Back, then the editable page/total, then Next, with the
// total result count printed on the SAME row as the pill.
//
// It is a source-shape test on purpose -- the storefront pager is JSX with no
// pure kernel to call, and the defect was entirely "which branch renders".
//
// Run: node tests/storefrontPagerLayout.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { getPortalLanguageText, FIRST_PARTY_PORTAL_LANGUAGE_OPTIONS } from '../src/components/catalog/portalLanguagePacks.ts'
import { pagerState } from '../src/utils/pagerState.ts'

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

const pagination = read('../src/components/shared/PaginationControls.tsx')
const catalogPagination = read('../src/components/catalog/catalogPagination.tsx')
const catalogProducts = read('../src/components/catalog/CatalogProductsSection.tsx')
const packs = read('../src/components/catalog/portalLanguagePacks.ts')

// The centred branch's own source, isolated so the assertions below can say
// "this branch does not print the summary" without the DEFAULT branch (which
// still legitimately does, for every admin list) satisfying them by accident.
function centeredBranch(): string {
  const start = pagination.indexOf("if (layout === 'centered')")
  assert.ok(start > 0, "PaginationControls must carry an opt-in `layout === 'centered'` branch")
  const rest = pagination.slice(start)
  const end = rest.indexOf('\n  if (compact')
  return end > 0 ? rest.slice(0, end) : rest
}

runTest('the shared control offers a centred storefront layout without changing the admin default', () => {
  assert.match(pagination, /layout\?: 'default' \| 'centered'/, 'the new layout must be an explicit opt-in union')
  assert.match(pagination, /layout = 'default',/, "the default must stay 'default' so all 28 admin consumers are untouched")
})

runTest('the centred branch prints no summary, and Back leads the row', () => {
  const branch = centeredBranch()
  assert.doesNotMatch(branch, /\{showingLabel\}/, 'the storefront pager must not render the Showing summary')
  assert.doesNotMatch(branch, /\{label\}/, 'the storefront pager must not render the "products" tail of the summary')
  // P10-20 (owner, 2026-09-17: "no need to show rows per page options")
  // retired the shared PageSizeSelect this branch carried after its
  // 2026-09-14 restore and 2026-09-15 reorder -- the selector itself is gone,
  // not just its position, so the property left to prove is that Back leads
  // straight into the editable page box with nothing selector-shaped between.
  assert.doesNotMatch(branch, /<PageSizeSelect/, 'the per-page selector is retired from the storefront pill')
  const backIdx = branch.indexOf('aria-label={backLabel}')
  const pageBoxIdx = branch.indexOf('aria-label={pageLabel}', branch.indexOf('aria-label={pageLabel}') + 1)
  assert.ok(
    backIdx > -1 && pageBoxIdx > backIdx,
    'Back comes BEFORE the editable page box: [Back] [page / total] [Next]',
  )
})

runTest('the centred page field grows with its digits and keeps a 40px floor', () => {
  const branch = centeredBranch()
  assert.match(branch, /max\(2\.5rem, calc\(\$\{pageDigits\}ch \+ 0\.5rem\)\)/)
  assert.match(branch, /className=\{`h-10 min-w-10/)
})

runTest('the centred branch centres the pill and orders it Back / page / total / Next', () => {
  // P10-20 dropped the size selector this order used to route through
  // (see the top-of-file comment); the remaining three controls keep their
  // relative order.
  const branch = centeredBranch()
  assert.match(branch, /flex w-full flex-wrap items-center justify-center gap-2/, 'the pager row must centre itself')
  const backAt = branch.indexOf('aria-label={backLabel}')
  const pageAt = branch.indexOf('aria-label={pageLabel}', backAt)
  const countAt = branch.indexOf('<span className={countClass}>')
  const nextAt = branch.indexOf('aria-label={nextLabel}')
  assert.ok(backAt > 0 && pageAt > backAt, 'the editable page must follow Back')
  assert.ok(countAt > pageAt, 'total page count must follow the editable page')
  assert.ok(nextAt > countAt, 'Next must close the pill')
})

runTest('the storefront wrapper opts into the centred layout', () => {
  assert.match(catalogPagination, /layout="centered"/, 'catalogPagination.tsx must request the storefront layout')
  assert.match(catalogPagination, /<PaginationControls\b/, 'the storefront must keep consuming the shared control (paginationSurfaceContract)')
  assert.match(catalogPagination, /export const CATALOG_DEFAULT_PAGE_SIZE = 50/, 'the storefront keeps its configured 50-item default')
  assert.doesNotMatch(catalogPagination, /rounded-2xl bg-white\/92/, 'the old bordered summary box wrapper must go with the summary')
})

runTest('the products grid mounts the pager above AND below, on one shared condition', () => {
  const mounts = catalogProducts.match(/<CatalogPaginationControls\b/g) || []
  assert.equal(mounts.length, 2, 'exactly one pager above the grid and one below it')
  const gates = catalogProducts.match(/\{showPager \? \(/g) || []
  assert.equal(gates.length, 2, 'both mounts must share the SAME visibility gate -- the top one used to render unconditionally while the bottom one hid on a single page')
  assert.match(
    catalogProducts,
    /const showPager = pagerState\(effectivePage, totalProducts, effectivePageSize, CATALOG_DEFAULT_PAGE_SIZE\)\.visible/,
    'the gate must be the shared kernel, not a re-inlined page-count comparison',
  )
  assert.doesNotMatch(
    catalogProducts,
    /totalProducts > effectivePageSize/,
    'the page-count gate is exactly what hid the per-page chooser on a single-page result',
  )
})

// ---------------------------------------------------------------------------
// The per-page chooser has to survive a single-page result
// ---------------------------------------------------------------------------

runTest('a single page of results still renders the pager, with both arrows dead', () => {
  // The storefront's page size is component state in PublicCatalogPage.tsx --
  // not a URL param -- and the chooser that changes it lives INSIDE this pill.
  // So `totalProducts > effectivePageSize` did not merely hide two arrows: a
  // shopper on 100/page who narrowed the list to 12 products lost the only
  // control that could put it back, short of reloading the site.
  //
  // Discriminating on purpose: the old rule answers `12 > 100` = false here.
  const onePage = pagerState(1, 12, 100)
  assert.equal(onePage.visible, true, 'the pill (and with it the per-page chooser) must survive a single-page result')
  assert.equal(onePage.totalPages, 1)
  assert.equal(onePage.backDisabled, true, 'there is no page before the first')
  assert.equal(onePage.nextDisabled, true, 'and none after the last')
  // Exactly at the boundary the old rule also said false.
  const exactlyFull = pagerState(1, 20, 20)
  assert.equal(exactlyFull.visible, true)
  assert.equal(exactlyFull.totalPages, 1)
  assert.equal(exactlyFull.nextDisabled, true)
})

runTest('an empty result renders no pager at all, and a real multi-page result pages', () => {
  assert.equal(pagerState(1, 0, 20).visible, false, 'nothing to page through is the one case that renders nothing')
  const middle = pagerState(2, 100, 20)
  assert.equal(middle.visible, true)
  assert.equal(middle.totalPages, 5)
  assert.equal(middle.backDisabled, false)
  assert.equal(middle.nextDisabled, false)
  assert.equal(middle.start, 21)
  assert.equal(middle.end, 40)
  const past = pagerState(99, 100, 20)
  assert.equal(past.page, 5, 'a stale page number clamps to the last real page')
  assert.equal(past.nextDisabled, true)
  const junk = pagerState('x', 45, 'y', 20)
  assert.equal(junk.pageSize, 20, 'a junk page size falls back rather than dividing by NaN')
  assert.equal(junk.page, 1)
  assert.equal(junk.totalPages, 3)
})

runTest('the shared control takes arrow state from the kernel, with no per-page-only exception left in centered', () => {
  assert.match(pagination, /import \{ clampPageNumber, pagerState \} from '\.\.\/\.\.\/utils\/pagerState\.ts'/, 'one kernel, not a second copy of the arithmetic')
  assert.match(pagination, /const state = pagerState\(page, totalItems, pageSize, DEFAULT_PAGE_SIZE\)/)
  assert.match(pagination, /if \(!state\.visible\) return null/, 'the render gate and the storefront gate must be the same fact')
  assert.doesNotMatch(pagination, /disabled=\{safePage <= 1\}/, 'the back arrow must read backDisabled')
  assert.doesNotMatch(pagination, /disabled=\{safePage >= totalPages\}/, 'the next arrow must read nextDisabled')
  const branch = centeredBranch()
  assert.match(branch, /disabled=\{backDisabled\}/, 'so a single-page storefront pill shows a dead Back')
  assert.match(branch, /disabled=\{nextDisabled\}/, 'and a dead Next')
  // P10-20 retired the size selector that used to keep a one-page pill alive
  // as a rows-per-page control; this branch has no selector-shaped exception
  // left, so a single page falls back to the same `state.visible` gate every
  // other layout already uses (checked once, above, before this branch even
  // runs) -- there is no second, branch-local early return to prove here.
  assert.doesNotMatch(branch, /if \(totalPages <= 1 && !showPageSizeSelect\) return null/, 'the retired per-page-only exception must not come back')
  assert.doesNotMatch(branch, /<PageSizeSelect/, 'the storefront no longer carries the shared page-size control')
})

runTest('both pager mounts translate Back and Next instead of leaking the raw keys', () => {
  const maps = catalogProducts.match(/t=\{\(key\) => \(\{[\s\S]*?\}\)\[key\] \|\| key\}/g) || []
  assert.equal(maps.length, 2, 'each mount carries its own translation map')
  for (const map of maps) {
    assert.match(map, /back: copy\('back', 'Back'\)/, "'back' fell through the map and printed itself as the button label")
    assert.match(map, /next: copy\('next', 'Next'\)/, "'next' fell through the map and printed itself as the button label")
    assert.doesNotMatch(map, /showing:/, 'the Showing key is retired with the summary bar')
  }
})

runTest("no storefront source still asks for the retired 'showing' string", () => {
  assert.doesNotMatch(catalogProducts, /copy\('showing'/, 'the Showing bar is gone; its lookup must go with it')
  assert.doesNotMatch(packs, /^\s+showing:/m, 'every language pack must drop the retired showing key')
})

runTest('every storefront language pack carries the pager and rail vocabulary', () => {
  const blocks = packs.split(/\n  ([a-zA-Z-]+): \{\n/)
  const perPagePacks = FIRST_PARTY_PORTAL_LANGUAGE_OPTIONS
    .map((option) => option.value)
    .filter((value) => getPortalLanguageText(value, 'perPage'))
  assert.ok(perPagePacks.length >= 18, `expected the 18 packs that already carry pagination words, found ${perPagePacks.length}`)
  assert.ok(blocks.length > 1, 'the pack file should still be a per-language object literal')
  for (const value of perPagePacks) {
    for (const key of ['back', 'next', 'jumpToBrand']) {
      const text = getPortalLanguageText(value, key)
      assert.ok(text, `${value}.${key} is missing -- the storefront would print the English fallback`)
      assert.notEqual(text, key, `${value}.${key} must not be the key itself`)
    }
    assert.equal(getPortalLanguageText(value, 'showing'), '', `${value}.showing must be retired`)
  }
})

runTest('the Khmer pack reuses the pager vocabulary already shipped in km.json', () => {
  // Not a fresh guess: the admin pack has carried these two words through
  // the project's own Khmer review, so the storefront says the same thing
  // the rest of the app does rather than inventing a second wording.
  const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
  assert.equal(getPortalLanguageText('km', 'back'), km.back)
  assert.equal(getPortalLanguageText('km', 'next'), km.next)
  // "Jump to <thing>" follows km.json's jump_to_letter, with the portal
  // pack's own word for brand.
  assert.ok(km.jump_to_letter?.startsWith('រំលងទៅ'), 'km.json should still carry the jump-to prefix this reuses')
  assert.equal(getPortalLanguageText('km', 'jumpToBrand'), `រំលងទៅ${getPortalLanguageText('km', 'brand')}`)
})

if (failed > 0) {
  console.error(`\n${failed} storefront pager check(s) failed`)
  process.exit(1)
}
console.log('\nAll storefront pager layout checks passed')

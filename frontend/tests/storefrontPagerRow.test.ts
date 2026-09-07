// The storefront pager row, after the owner's Sep 6 2026 screenshot of it.
//
// What the screenshot marks: a red X through the separate "50 v" page-size
// box sitting at the end of the row, and a red arrow from it into the EMPTY
// highlighted gap between "< back" and "1 / 72  next >". So: the page size
// must not be a control of its own on that row, and the row must carry no
// dead space.
//
// Both defects had structural causes in PaginationControls' `centered`
// branch, and this file pins the causes rather than the appearance:
//
//   * the box: a <PageSizeSelect> mounted as a sibling AFTER the Next button,
//     with the boxed default chrome (border + white background + its own
//     radius). The first attempt at this only removed the CHROME: the count
//     "/ 72" became the trigger, unstyled and caret-less. That is the same
//     control in a third disguise -- still a tap target on the row, and on
//     the one element that looks static. The owner struck the CONTROL off
//     the row, so there is now none: the count is text, and the chooser is a
//     field in the Filters panel.
//   * the gap: a fixed `w-9` page input (36px of box around a one-character
//     page number), `gap-1` + `px-1` around it, and a `pr-1` on the pill
//     reserving room for the box. The input is now sized from its own digit
//     count and the pill has no reserved trailing padding.
//   * while here: 32px (h-8/h-7) hit areas on the only navigation control of
//     a phone-first shopping page, under the 40px floor.
//
// Discriminating: every assertion in the three "row" tests below fails at
// 4e58891f, where the branch is [< Back][page / total][Next >][50 v].
//
// Run: node tests/storefrontPagerRow.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
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
const pageSizeSelect = read('../src/components/shared/PageSizeSelect.tsx')
const catalogPagination = read('../src/components/catalog/catalogPagination.tsx')
const catalogProducts = read('../src/components/catalog/CatalogProductsSection.tsx')

// Only the storefront branch. Comments are stripped so an assertion that says
// "`pr-1` is gone" cannot be satisfied or broken by the comment explaining
// why it went.
function centeredBranch(): string {
  const start = pagination.indexOf("if (layout === 'centered')")
  assert.ok(start > 0, "PaginationControls must carry an opt-in `layout === 'centered'` branch")
  const rest = pagination.slice(start)
  const end = rest.indexOf('\n  if (compact')
  const branch = end > 0 ? rest.slice(0, end) : rest
  return branch.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

// The shared filter body -- one source, rendered into the sub-`lg` Filters
// popover AND the `lg` rail. This is where the per-page chooser went when it
// came off the pager row. Comments stripped for the same reason.
function filterFieldsBody(): string {
  const start = catalogProducts.indexOf('const renderFilterFields = () => (')
  assert.ok(start > 0, 'CatalogProductsSection must still share one filter body between its two filter surfaces')
  const rest = catalogProducts.slice(start)
  const end = rest.indexOf('\n  return (\n    <SectionShell')
  assert.ok(end > 0, 'the filter body should end where the component starts rendering')
  return rest.slice(0, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

// ---------------------------------------------------------------------------
// 1. No separate page-size box on the row
// ---------------------------------------------------------------------------

runTest('the row carries no page-size control, in any disguise', () => {
  const branch = centeredBranch()
  const nextAt = branch.indexOf('aria-label={nextLabel}')
  assert.ok(nextAt > 0, 'the Next button must still be findable')
  // Not after Next (where the struck-out "50 v" box sat), and not anywhere
  // else on the row either -- hanging the menu off the count moved the box,
  // it did not remove the control.
  assert.doesNotMatch(branch, /<PageSizeSelect/, 'no page-size control may be mounted on the storefront pager row at all')
  const afterNext = branch.slice(nextAt)
  assert.doesNotMatch(afterNext.replace(/aria-label=\{nextLabel\}/, ''), /<(button|input|select)\b/, 'Next must be the last interactive element in the pill')
})

runTest('the count is plain text -- the row has exactly two tap targets', () => {
  const branch = centeredBranch()
  assert.match(branch, /<span className=\{countClass\}>\/ \{totalPages\}<\/span>/, 'the count must render as a span, unconditionally')
  assert.doesNotMatch(branch, /buttonContent=/, 'a buttonContent count is a trigger wearing the count')
  assert.doesNotMatch(branch, /hideCaret/, 'hiding a caret is what a disguised control needs; a span needs nothing')
  // Back and Next are the only buttons; the page field is the only input.
  assert.equal((branch.match(/<button\b/g) || []).length, 2, 'Back and Next, and nothing else')
  assert.equal((branch.match(/<input\b/g) || []).length, 1, 'the editable page number is the only field on the row')
})

runTest('PageSizeSelect kept no seam that only the removed row-control needed', () => {
  // The first attempt gave PageSizeSelect an `unstyled` variant so the count
  // could be a trigger without looking like one. With the control off the row
  // nothing consumes it, and a styling escape hatch with no caller is the
  // next reader's invitation to put the box back.
  assert.doesNotMatch(pageSizeSelect, /unstyled/, 'the unstyled seam must go with the control it existed for')
  const paginationCode = pagination.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(paginationCode, /\bunstyled\b/, 'and no caller may still ask for it')
})

// ---------------------------------------------------------------------------
// 2. No dead space
// ---------------------------------------------------------------------------

runTest('the page box is sized from its own digits, not a fixed column', () => {
  const branch = centeredBranch()
  assert.doesNotMatch(branch, /\bw-9\b/, 'a fixed 36px box around a one-character page number IS the highlighted gap')
  assert.match(branch, /const pageDigits = Math\.max\(1, String\(editablePageInput \? pageDraft : safePage\)\.length\)/,
    'the width must be derived from what the field actually prints')
  assert.match(branch, /style=\{\{ width: `calc\(\$\{pageDigits\}ch \+ 0\.5rem\)` \}\}/, 'ch is the width of a digit -- the right unit for a numeric field')
})

runTest('the pill reserves no room for the control that was removed', () => {
  const branch = centeredBranch()
  const pillAt = branch.indexOf('inline-flex max-w-full items-center rounded-full')
  assert.ok(pillAt > 0, 'the pill wrapper must still be findable')
  const pill = branch.slice(pillAt, branch.indexOf('>', pillAt))
  assert.doesNotMatch(pill, /\bpr-1\b/, 'the trailing padding existed to seat the "50 v" box and is dead space without it')
  assert.doesNotMatch(branch, /shrink items-center gap-1 px-1/, 'the gap+padding around the page number were the rest of the highlighted space')
})

runTest('the row reads as words at 375px, and still cannot wrap', () => {
  const branch = centeredBranch()
  assert.doesNotMatch(branch, /flex-wrap/, 'a pill that wraps is two rows, not one')
  // This case used to REQUIRE `hidden sm:inline` on both labels -- i.e. it
  // pinned the defect. Tailwind's `sm` is 640px, so the phone the owner
  // photographed showed two bare chevrons: the widest screen that hides the
  // words is wider than any phone. The words are visible at every width now.
  assert.doesNotMatch(branch, /hidden sm:inline">\{(?:back|next)Label\}/, 'the Back/Next words must be visible at 375px, not only from 640px up')
  assert.doesNotMatch(branch, /\bhidden sm:inline\b/, '...and nothing else on this row may hide below sm either')
  assert.equal((branch.match(/\{backLabel\}/g) || []).length, 2, 'backLabel is both the visible word and the aria-label')
  assert.equal((branch.match(/\{nextLabel\}/g) || []).length, 2, 'and so is nextLabel')
  assert.equal((branch.match(/shrink-0/g) || []).length >= 2, true, 'the arrows must not be squeezed')
  // Every text run on the row is nowrap, so a longer word (Khmer's Back/Next
  // are wider than the English) lengthens the pill instead of breaking it.
  assert.equal((branch.match(/whitespace-nowrap/g) || []).length >= 3, true, 'the count and both labels must be nowrap')
})

// ---------------------------------------------------------------------------
// 3. Tap targets -- computed, not eyeballed
// ---------------------------------------------------------------------------

// Tailwind's spacing scale: h-N is N * 0.25rem, and this app pins html to
// 16px (styles/main.css `html { font-size: 16px }`), so h-N is N * 4 px.
function tailwindHeightPx(token: string): number {
  const match = /^h-(\d+)$/.exec(token)
  return match ? Number(match[1]) * 4 : Number.NaN
}

runTest('every hit area in the storefront pill is at least 40px', () => {
  assert.equal(tailwindHeightPx('h-10'), 40)
  assert.equal(tailwindHeightPx('h-8'), 32)
  const branch = centeredBranch()
  const heights = [...new Set(branch.match(/\bh-\d+\b/g) || [])]
  assert.ok(heights.length > 0, 'the branch must declare its row height explicitly')
  for (const token of heights) {
    // h-4 is the chevron GLYPH inside a button, not a hit area of its own.
    if (token === 'h-4') continue
    assert.ok(
      tailwindHeightPx(token) >= 40,
      `${token} = ${tailwindHeightPx(token)}px is under the 40px tap-target floor, on the only navigation control of a phone-first catalogue`,
    )
  }
})

// ---------------------------------------------------------------------------
// 4. Behaviour that must NOT change
// ---------------------------------------------------------------------------

runTest('the chosen page size is written by exactly the same two calls, from its new home', () => {
  // Moving the control must not move the WRITE. `updatePageSize` +
  // `updatePage(1)` is what persists portalProductPageSize, and it is now
  // called once, from the shared filter body.
  const writes = catalogProducts.match(/updatePageSize\?\.\(size\)\n\s*updatePage\?\.\(1\)/g) || []
  assert.equal(writes.length, 1, 'one chooser, one write path -- two would be two ways to persist the same fact')
  const fields = filterFieldsBody()
  assert.match(fields, /updatePageSize\?\.\(size\)\n\s*updatePage\?\.\(1\)/, 'and it must be the Filters field that calls it')
  assert.match(fields, /<PageSizeSelect/, 'the chooser itself lives in the shared filter body')
  assert.match(fields, /options=\{CATALOG_PAGE_SIZE_OPTIONS\}/, 'it offers the storefront presets, not a second list')
  assert.match(fields, /allowCustom=\{false\}/, 'and keeps the storefront\'s fixed 20/50/100, as editablePageSizeInput={false} used to')
  // The pager row no longer has a per-page prop for anyone to pass. Comments
  // stripped: catalogPagination.tsx explains in prose why the prop is gone,
  // and naming a removed prop must not read as still declaring it.
  const wrapperCode = catalogPagination.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(wrapperCode, /onPageSizeChange/, 'the storefront wrapper must not offer a prop whose only use is re-growing the box')
  assert.doesNotMatch(wrapperCode, /editablePageSizeInput/, 'nor the flag that configured it')
  assert.match(catalogPagination, /layout="centered"/, 'and must keep opting into the centred layout')
})

runTest('both breakpoints get the chooser from that one mount', () => {
  // renderFilterFields is called twice: the popover below `lg`, and the
  // permanent rail at `lg` and up. If the chooser had gone into either call
  // site instead of the shared body, one breakpoint would silently lose the
  // only control that can undo a 100-per-page choice.
  const calls = catalogProducts.match(/\{renderFilterFields\(\)\}/g) || []
  assert.equal(calls.length, 2, 'the filter body must still be rendered at both breakpoints')
  const railAt = catalogProducts.indexOf('<aside className="hidden min-w-0 lg:sticky')
  const popoverAt = catalogProducts.indexOf('role="dialog"')
  assert.ok(railAt > 0 && popoverAt > railAt, 'one call is the lg rail, the other the sub-lg Filters dialog')
})

runTest('the arrows are still dead exactly at the bounds', () => {
  const branch = centeredBranch()
  assert.match(branch, /disabled=\{backDisabled\}/)
  assert.match(branch, /disabled=\{nextDisabled\}/)
  const first = pagerState(1, 3555, 20)
  assert.equal(first.backDisabled, true)
  assert.equal(first.nextDisabled, false)
  assert.equal(first.totalPages, 178)
  const last = pagerState(178, 3555, 20)
  assert.equal(last.backDisabled, false)
  assert.equal(last.nextDisabled, true)
  // The screenshot's own numbers: 72 pages, sitting on the first.
  const shot = pagerState(1, 1436, 20)
  assert.equal(shot.totalPages, 72, 'the count the trigger prints is totalPages, unchanged by folding the menu into it')
})

if (failed > 0) {
  console.error(`\n${failed} storefront pager-row check(s) failed`)
  process.exit(1)
}
console.log('\nAll storefront pager-row checks passed')

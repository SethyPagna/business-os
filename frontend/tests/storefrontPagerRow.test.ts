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
//     radius). It is now the count itself -- "/ 72" is the trigger, drawn
//     unstyled and caret-less inside the pill.
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

// ---------------------------------------------------------------------------
// 1. No separate page-size box on the row
// ---------------------------------------------------------------------------

runTest('nothing sits after Next: the page size is not a control of its own', () => {
  const branch = centeredBranch()
  const nextAt = branch.indexOf('aria-label={nextLabel}')
  assert.ok(nextAt > 0, 'the Next button must still be findable')
  const afterNext = branch.slice(nextAt)
  assert.doesNotMatch(afterNext, /<PageSizeSelect/, 'the struck-out "50 v" box was a PageSizeSelect mounted after Next')
  // Whatever closes the pill after Next must be markup only -- no further
  // control of any kind, or the row grows a second thing to look at.
  assert.doesNotMatch(afterNext.replace(/aria-label=\{nextLabel\}/, ''), /<(button|input|select|PageSizeSelect)\b/, 'Next must be the last interactive element in the pill')
})

runTest('the count IS the per-page menu, printed as plain inline text', () => {
  const branch = centeredBranch()
  assert.match(branch, /buttonContent=\{`\/ \$\{totalPages\}`\}/, 'the "/ 72" count must be the trigger content')
  assert.match(branch, /\n\s*hideCaret\n/, 'a caret would re-announce it as a dropdown box')
  assert.match(branch, /\n\s*unstyled\n/, 'the trigger must drop the boxed border/background chrome, or it is the same box in a new place')
  assert.match(branch, /ariaLabel=\{perPageLabel\}/, 'the per-page wording survives as the accessible name')
  // A caller with no page-size handler still gets a readable count.
  assert.match(branch, /<span className=\{countClass\}>\/ \{totalPages\}<\/span>/, 'without onPageSizeChange the count must still render as text')
})

runTest('the unstyled seam strips only chrome, and is off for every other caller', () => {
  assert.match(pageSizeSelect, /unstyled\?: boolean/, 'PageSizeSelect must expose the seam as an explicit opt-in')
  assert.match(pageSizeSelect, /unstyled = false,/, 'default false keeps all 28 admin consumers byte-identical')
  assert.match(pageSizeSelect, /unstyled\n\s*\? 'inline-flex min-w-0 items-center justify-center outline-none transition disabled:cursor-not-allowed disabled:opacity-50'/,
    'the unstyled base must keep layout + disabled behaviour and drop border/background/radius/padding/shadow/text-size')
  // Only the storefront asks for it.
  const paginationCode = pagination.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.equal((paginationCode.match(/\bunstyled\b/g) || []).length, 1, 'exactly one caller (the centred storefront pill) may go unstyled')
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

runTest('nothing on the row can wrap at 375px', () => {
  const branch = centeredBranch()
  assert.doesNotMatch(branch, /flex-wrap/, 'a pill that wraps is two rows, not one')
  assert.equal((branch.match(/hidden sm:inline">\{(?:back|next)Label\}/g) || []).length, 2,
    'both words must collapse to their icons below sm')
  assert.equal((branch.match(/shrink-0/g) || []).length >= 2, true, 'the arrows must not be squeezed')
  assert.match(branch, /whitespace-nowrap/, 'the count must not break across lines')
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

runTest('the chosen page size still leaves the pill the same way it always did', () => {
  const branch = centeredBranch()
  assert.match(branch, /onChange=\{\(nextValue\) => onPageSizeChange\?\.\(nextValue\)\}/, 'the size must still be reported to the caller')
  assert.match(catalogPagination, /onPageSizeChange=\{onPageSizeChange\}/, 'catalogPagination must keep forwarding the handler')
  assert.match(catalogPagination, /layout="centered"/, 'and keep opting into this layout')
  const mounts = catalogProducts.match(/updatePageSize\?\.\(size\)\n\s*updatePage\?\.\(1\)/g) || []
  assert.equal(mounts.length, 2, 'both pager mounts must still set the size and return to page 1 -- persistence path unchanged')
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

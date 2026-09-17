// Y20: the user asked for a single-line pager shaped "‹ page (1-20) / total ›".
// It was originally built with the item-range chip "1-20" ALSO acting as the
// per-page dropdown trigger -- tap it and the 20/50/100 options open.
//
// P10-20 (owner, supersedes Y20): "no need to show rows per page options" --
// the rows-per-page control is gone from every layout this shared component
// renders (the plain form, the `compact` three-column form, and this
// `rangeAsPageSize` form), not narrowed to a differently-shaped trigger. The
// range chip is now always a plain, non-interactive span; `onPageSizeChange`
// is still accepted on the props type (some callers still pass it) but
// nothing in this branch reads it or renders a selector.
//
// The redesign is still an OPT-IN prop (`rangeAsPageSize`) layered on the
// existing `compact` form, because the shared component is consumed by a page
// another session owns (Products) whose current call must keep behaving
// exactly as it did. These checks are structural on purpose: they pin the
// facts that make the feature both correct and backward-compatible, so a
// later edit that quietly drops the opt-in gate, or brings back a per-page
// selector the owner asked removed, fails here instead of in the app.
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

const pagination = fs.readFileSync(
  new URL('../src/components/shared/PaginationControls.tsx', import.meta.url),
  'utf8',
)
const pageSizeSelect = fs.readFileSync(
  new URL('../src/components/shared/PageSizeSelect.tsx', import.meta.url),
  'utf8',
)

runTest('the merged pager is gated on BOTH compact and the opt-in flag', () => {
  // The new branch must sit ahead of the plain `if (compact)` branch and only
  // fire when a caller opts in -- that is what keeps every existing compact
  // caller (Products included) on the three-column layout untouched.
  const optInBranch = pagination.indexOf('if (compact && rangeAsPageSize)')
  const plainCompactBranch = pagination.indexOf('if (compact) {')
  assert.ok(optInBranch !== -1, 'the compact && rangeAsPageSize branch must exist')
  assert.ok(plainCompactBranch !== -1, 'the plain compact branch must still exist')
  assert.ok(
    optInBranch < plainCompactBranch,
    'the opt-in branch must be checked before the plain compact branch, or it is unreachable',
  )
  assert.match(
    pagination,
    /rangeAsPageSize\s*=\s*false/,
    'rangeAsPageSize must default to false so callers that omit it are unaffected',
  )
})

runTest('the item range renders as a plain span, not a per-page dropdown trigger (P10-20)', () => {
  // P10-20 removed the rows-per-page control entirely, so the "1-20" chip is
  // no longer a PageSizeSelect button -- it is a static span showing the
  // start-end range, in both the plain and compactCentered forms.
  const branchStart = pagination.indexOf('if (compact && rangeAsPageSize)')
  const branchEnd = pagination.indexOf('if (compact) {', branchStart)
  const branch = pagination.slice(branchStart, branchEnd)
  assert.match(
    branch,
    /<span className="h-6 rounded-full border[^>]*>\{start\.toLocaleString\(\)\}-\{end\.toLocaleString\(\)\}<\/span>/,
    'the range chip must be a plain span rendering the item range, not an interactive size selector',
  )
  assert.doesNotMatch(branch, /<PageSizeSelect\b/, 'P10-20 removed the per-page dropdown from this branch entirely')
  assert.doesNotMatch(
    branch,
    /onPageSizeChange\?\.\(/,
    'nothing in this branch may call onPageSizeChange -- the prop is accepted for backward compatibility but unused here',
  )
})

runTest('the merged pager keeps the editable page number and total-page count', () => {
  const branchStart = pagination.indexOf('if (compact && rangeAsPageSize)')
  const branchEnd = pagination.indexOf('if (compact) {', branchStart)
  const branch = pagination.slice(branchStart, branchEnd)
  assert.ok(!branch.includes('hidden sm:inline'), 'Back and Next remain visible on phones')
  assert.ok(branch.includes('mx-auto flex w-fit'), 'pager centers without relying on page-specific alignment')
  assert.ok(branch.includes('h-10'), 'pager controls share the 40px target')
  // P10-20 removed the per-page selector, so the order is now: Back, the
  // static range chip, the editable current page, "/ totalPages", Next.
  assert.ok(branch.indexOf('{backLabel}</span>') < branch.indexOf('{start.toLocaleString()}-{end.toLocaleString()}'), 'Back precedes the item-range chip')
  assert.ok(branch.indexOf('{start.toLocaleString()}-{end.toLocaleString()}') < branch.indexOf('aria-label={pageLabel}'), 'the item-range chip precedes the current page')
  // "‹ page (1-20) / total ›": an editable current page, then the range, then
  // "/ totalPages", bracketed by the prev/next arrows.
  assert.match(branch, /onKeyDown=\{handlePageInputKeyDown\}/, 'the current page must stay editable')
  assert.match(branch, /\/ \{totalPages\}/, 'the total page count must be shown')
  assert.match(branch, /aria-label=\{backLabel\}/, 'a localized previous-page control must exist')
  assert.match(branch, /aria-label=\{nextLabel\}/, 'a localized next-page control must exist')
})

runTest('PageSizeSelect renders buttonContent over the size, but only when given', () => {
  // buttonContent is the seam the merged pager uses. When omitted the button
  // must fall back to the numeric page size, so every other PageSizeSelect
  // caller is unchanged.
  assert.match(
    pageSizeSelect,
    /buttonContent\?: ReactNode/,
    'PageSizeSelect must accept an optional buttonContent override',
  )
  assert.match(
    pageSizeSelect,
    /buttonContent !== undefined \? buttonContent : safeValue/,
    'buttonContent must win when provided and fall back to the size otherwise',
  )
})

runTest('the opt-in centered pager fits its parent without clipping meaningful content', () => {
  const branchStart = pagination.indexOf('if (compact && rangeAsPageSize)')
  const branchEnd = pagination.indexOf('if (compact) {', branchStart)
  const branch = pagination.slice(branchStart, branchEnd)
  assert.match(pagination, /compactCentered = false/, 'other compact pager consumers retain their established density')
  assert.match(branch, /mx-auto flex w-fit max-w-full/, 'the pager uses intrinsic width up to its actual centered parent instead of a clipping-prone arbitrary cap')
  assert.doesNotMatch(branch, /max-w-\[12\.5rem\]/, 'the old 200px cap must not silently compress legitimate values')
  assert.match(branch, /compactCentered \? 'px-0\.5 text-\[10px\]'/, 'the compact form reduces padding and type rather than removing controls')
  // P10-20 made the chip a plain span rather than a PageSizeSelect button, so
  // there is no separate accessible-name computation to preserve any more --
  // a screen reader reads the visible "start-end" text directly. Assert the
  // text is present (in both compact and compactCentered forms, since the
  // markup is shared) and that the old aria-label plumbing is gone.
  assert.match(branch, /\{start\.toLocaleString\(\)\}-\{end\.toLocaleString\(\)\}/, 'the visible chip text must carry the complete item range')
  assert.doesNotMatch(branch, /rangeAriaLabel/, 'the removed per-page trigger no longer needs its own accessible-name computation')
  assert.match(branch, /style=\{compactCentered \? \{ width: `max\(1\.75rem, calc\(\$\{compactPageDigits\}ch \+ 0\.75rem\)\)` \} : undefined\}/, 'five-digit pages reserve glyph width plus a browser-safe text-caret allowance')
  assert.match(branch, /min-w-7 shrink-0 text-\[10px\]/, 'the page input retains a usable floor and cannot sacrifice entered digits to neighboring flex items')
  assert.match(branch, /<span className="whitespace-nowrap">\{backLabel\}<\/span>/, 'localized Back text remains visible')
  assert.match(branch, /<span className="whitespace-nowrap">\{nextLabel\}<\/span>/, 'localized Next text remains visible')
  assert.match(branch, /inline-flex h-10/, 'smaller visuals retain the 40px click target')
  assert.match(branch, /aria-label=\{backLabel\}/)
  assert.match(branch, /aria-label=\{nextLabel\}/)
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll pagination range-control tests passed')

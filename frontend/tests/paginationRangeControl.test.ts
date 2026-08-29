// Y20: the user asked for a single-line pager shaped "‹ page (1-20) / total ›"
// where the item-range chip "1-20" is ITSELF the per-page dropdown trigger --
// tap it and the 20/50/100 options open -- so the separate per-page column
// disappears and the whole control fits inline beside a Select-all checkbox.
//
// The redesign is an OPT-IN prop (`rangeAsPageSize`) layered on the existing
// `compact` form, because the shared component is consumed by a page another
// session owns (Products) whose current call must keep behaving exactly as it
// did. These checks are structural on purpose: they pin the three facts that
// make the feature both correct and backward-compatible, so a later edit that
// quietly drops the opt-in gate, or wires the range to plain text instead of
// the size dropdown, fails here instead of in the app.
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

runTest('the item range is what triggers the per-page dropdown', () => {
  // Inside the merged branch the PageSizeSelect must be told to render the
  // range ("start-end") as its button, while still calling onPageSizeChange --
  // i.e. the "1-20" chip IS the size selector, not a static label next to one.
  const branchStart = pagination.indexOf('if (compact && rangeAsPageSize)')
  const branchEnd = pagination.indexOf('if (compact) {', branchStart)
  const branch = pagination.slice(branchStart, branchEnd)
  assert.match(
    branch,
    /buttonContent=\{`\$\{start\.toLocaleString\(\)\}-\$\{end\.toLocaleString\(\)\}`\}/,
    'the PageSizeSelect in the merged branch must show the item range as its button',
  )
  assert.match(
    branch,
    /onChange=\{\(nextValue\) => onPageSizeChange\?\.\(nextValue\)\}/,
    'tapping the range must still change the page size',
  )
})

runTest('the merged pager keeps the editable page number and total-page count', () => {
  const branchStart = pagination.indexOf('if (compact && rangeAsPageSize)')
  const branchEnd = pagination.indexOf('if (compact) {', branchStart)
  const branch = pagination.slice(branchStart, branchEnd)
  // "‹ page (1-20) / total ›": an editable current page, then the range, then
  // "/ totalPages", bracketed by the prev/next arrows.
  assert.match(branch, /onKeyDown=\{handlePageInputKeyDown\}/, 'the current page must stay editable')
  assert.match(branch, /\/ \{totalPages\}/, 'the total page count must be shown')
  assert.match(branch, /aria-label="Previous page"/, 'a previous-page control must exist')
  assert.match(branch, /aria-label="Next page"/, 'a next-page control must exist')
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

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll pagination range-control tests passed')

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pagerState } from '../src/utils/pagerState.ts'

const pagination = readFileSync(new URL('../src/components/shared/PaginationControls.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const pagerKernel = readFileSync(new URL('../src/utils/pagerState.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const start = pagination.indexOf("if (layout === 'centered')")
const end = pagination.indexOf('\n  if (compact', start)
assert.ok(start > 0 && end > start, 'the centered branch must remain isolated from admin layouts')
const centered = pagination.slice(start, end)

// The page-size selector's own history on this row: dropped 2026-09-07,
// restored 2026-09-14, reordered behind Back 2026-09-15, then retired for
// good by P10-20 (owner, 2026-09-17: "no need to show rows per page
// options") -- from this branch along with every other PaginationControls
// layout. What is left to prove is that it stays gone and the remaining
// three controls keep Back leading into page/total into Next.
assert.doesNotMatch(centered, /<PageSizeSelect/, 'P10-20: the per-page chooser must not come back to the storefront pill')
assert.doesNotMatch(centered, /ariaLabel=\{perPageLabel\}/, 'no selector-shaped remnant should still be named from the per-page label')
assert.doesNotMatch(centered, /Filters (?:panel|field)/i, 'shared pagination must not claim the selector lives somewhere else')

const backAt = centered.indexOf('aria-label={backLabel}')
const pageAt = centered.indexOf('aria-label={pageLabel}', backAt)
const totalAt = centered.indexOf('<span className={countClass}>')
const nextAt = centered.indexOf('aria-label={nextLabel}')
assert.ok(backAt > 0 && pageAt > backAt && totalAt > pageAt && nextAt > totalAt, 'the row is Back, editable page, total, Next')

assert.equal((centered.match(/<button\b/g) || []).length, 2, 'Back and Next are the only buttons this branch writes itself')
assert.equal((centered.match(/<input\b/g) || []).length, 1, 'the page remains directly editable')
// 2026-09-18 (owner): "too fat and large. make it more consistent" -- the
// pill was trimmed from a 40px floor (h-10) to 36px (h-9).
assert.match(centered, /h-9/, 'the phone-first controls are 36px high')
assert.match(centered, /max\(2\.25rem, calc\(\$\{pageDigits\}ch \+ 0\.5rem\)\)/, 'the editable field has a 36px width floor and grows with its digits')
assert.match(centered, /focus-visible:ring-2/, 'all centered focusables share a visible keyboard ring')
assert.match(centered, /focus-visible:ring-inset/, 'the pill cannot clip the focus ring')
assert.doesNotMatch(centered, /hidden sm:inline/, 'Back and Next stay visible at 375px')
assert.ok((centered.match(/whitespace-nowrap/g) || []).length >= 3, 'both labels and the count stay on one line')

// P10-20 removed the per-page-only exception this guard used to implement
// (a one-page pill no longer stays up as a rows-per-page control, because
// there is no rows-per-page control left) -- the branch now falls straight
// through to the shared `state.visible` gate checked once above.
assert.doesNotMatch(centered, /if \(totalPages <= 1 && !showPageSizeSelect\) return null/, 'the retired per-page-only exception must not come back')
const renderAt = centered.indexOf('return (')
assert.ok(renderAt > 0, 'the branch must still render its own pill')
assert.match(centered.slice(renderAt), /^return \(\n\s*<nav/m, 'the pager is a navigation landmark')
assert.match(centered, /<nav[^>]*aria-label=\{pageLabel\}/, 'the landmark is named')
assert.match(centered, /aria-live="polite"/, 'page changes are announced politely')
assert.match(centered, /aria-live="polite">\{pageLabel\} \{safePage\} \{ofLabel\} \{totalPages\}/, 'the announcement states current and total pages')

assert.equal(pagerState(1, 1, 50, 50).visible, true, 'admin semantics stay total > 0')
assert.equal(pagerState(1, 0, 50, 50).visible, false, 'empty admin results remain hidden')
assert.equal(pagerState(1, 100, 0, 50).pageSize, 50, 'an explicitly configured 50-item fallback remains 50')
assert.match(pagerKernel, /visible: total > 0/, 'the shared kernel retains admin visibility semantics')
assert.doesNotMatch(pagerKernel, /Filters (?:panel|field)/i, 'the kernel documents behavior without inventing a selector destination')

console.log('storefrontPagerRow: all checks passed')

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pagerState } from '../src/utils/pagerState.ts'

const pagination = readFileSync(new URL('../src/components/shared/PaginationControls.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const pagerKernel = readFileSync(new URL('../src/utils/pagerState.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const start = pagination.indexOf("if (layout === 'centered')")
const end = pagination.indexOf('\n  if (compact', start)
assert.ok(start > 0 && end > start, 'the centered branch must remain isolated from admin layouts')
const centered = pagination.slice(start, end)

assert.doesNotMatch(centered, /<PageSizeSelect|perPageLabel/, 'centered pagination never renders or labels a page-size selector')
assert.doesNotMatch(centered, /Filters (?:panel|field)/i, 'shared pagination must not claim the removed selector moved elsewhere')

const backAt = centered.indexOf('aria-label={backLabel}')
const pageAt = centered.indexOf('aria-label={pageLabel}', backAt)
const totalAt = centered.indexOf('<span className={countClass}>')
const nextAt = centered.indexOf('aria-label={nextLabel}')
assert.ok(backAt > 0 && pageAt > backAt && totalAt > pageAt && nextAt > totalAt, 'the row is Back, editable page, total, Next')

assert.equal((centered.match(/<button\b/g) || []).length, 2, 'Back and Next are the only buttons')
assert.equal((centered.match(/<input\b/g) || []).length, 1, 'the page remains directly editable')
assert.match(centered, /h-10/, 'the phone-first controls are 40px high')
assert.match(centered, /max\(2\.5rem, calc\(\$\{pageDigits\}ch \+ 0\.5rem\)\)/, 'the editable field has a 40px width floor and grows with its digits')
assert.match(centered, /focus-visible:ring-2/, 'all centered focusables share a visible keyboard ring')
assert.match(centered, /focus-visible:ring-inset/, 'the pill cannot clip the focus ring')
assert.doesNotMatch(centered, /hidden sm:inline/, 'Back and Next stay visible at 375px')
assert.ok((centered.match(/whitespace-nowrap/g) || []).length >= 3, 'both labels and the count stay on one line')

const guardAt = centered.indexOf('if (totalPages <= 1) return null')
const renderAt = centered.indexOf('return (')
assert.ok(guardAt > 0 && renderAt > guardAt, 'centered pagination returns null when totalPages <= 1')
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

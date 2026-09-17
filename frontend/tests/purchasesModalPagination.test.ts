import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// P10-16 and P10-20 (owner defect reports):
//   "Purchases have double scroll make it more compact and responsive so only
//   need to scroll for products" -- SupplierPurchasesModal.tsx nested a
//   second `overflow-auto` table container inside the shared Modal's own
//   scrolling body, so the operator had to scroll twice to reach a row.
//   "no need to show rows per page options" -- PaginationControls.tsx
//   rendered a rows-per-page selector (PageSizeSelect) next to the count and
//   the back/next buttons on every layout it offers.
//
// Both are asserted against the CODE, with comments stripped, because the
// comments in these very files now describe the fix in the exact words that
// would otherwise defeat a naive substring check.

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..')
const readSource = (relativePath: string): string => readFileSync(resolve(repo, relativePath), 'utf8')
const stripComments = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

let failed = 0

function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const purchasesModal = readSource('frontend/src/components/contacts/SupplierPurchasesModal.tsx')
const purchasesCode = stripComments(purchasesModal)
const paginationControls = readSource('frontend/src/components/shared/PaginationControls.tsx')
const paginationCode = stripComments(paginationControls)

runTest('the purchases table container no longer carries its own nested scroll', () => {
  // The old double-scroll shape: a max-h + overflow-auto wrapper around the
  // table, sitting inside the shared Modal's own scrolling .modal-scroll
  // body. Neither half of that pairing may still be present on the table.
  assert.doesNotMatch(purchasesCode, /max-h-\[calc\(55\*var\(--app-vh\)\)\]/)
  assert.doesNotMatch(purchasesCode, /hidden max-h-[^"]*overflow-auto[^"]*md:block/)
})

runTest('the purchases panel has exactly one live scroll region -- the list', () => {
  // Fixed rows (range picker, stat cells, pagination) get no overflow of
  // their own; only the row/card list region does, and it fills the rest of
  // the shared Modal's body via flex-1 rather than fighting it for scroll.
  assert.match(purchasesCode, /flex h-full min-h-0 flex-col gap-3/)
  assert.match(purchasesCode, /min-h-0 flex-1 overflow-y-auto rounded-xl border border-gray-200/)
  // The stat cells and the pagination row are marked shrink-0 -- they keep
  // their natural height inside the flex column instead of being squeezed
  // or themselves trying to scroll.
  assert.match(purchasesCode, /grid shrink-0 grid-cols-2/)
  assert.match(purchasesCode, /<div className="shrink-0">\s*<PaginationControls/)
})

runTest('PaginationControls renders no rows-per-page selector, in any layout', () => {
  // PageSizeSelect was the rows-per-page dropdown; it must not be imported
  // or rendered anywhere in the component now.
  assert.doesNotMatch(paginationCode, /PageSizeSelect/)
  // The centered (storefront), compact+rangeAsPageSize, compact and default
  // layouts each used to offer it; none may keep a "per page" labelled
  // control.
  assert.doesNotMatch(paginationCode, /per page/)
})

runTest('PaginationControls keeps the item count and the back/next controls', () => {
  // Back/Next survive in every layout, still wired to onPageChange.
  const backNextOccurrences = (paginationCode.match(/aria-label=\{backLabel\}/g) || []).length
  assert.ok(backNextOccurrences >= 4, 'expected a Back control in every layout')
  const nextOccurrences = (paginationCode.match(/aria-label=\{nextLabel\}/g) || []).length
  assert.ok(nextOccurrences >= 4, 'expected a Next control in every layout')
  // The item-range/count text is still printed (default layout's "Showing
  // X-Y of Z", the compact layouts' "X-Y" chip).
  assert.match(paginationCode, /showingLabel\}[^}]*start\.toLocaleString\(\)/)
  assert.match(paginationCode, /start\.toLocaleString\(\)\}-\{end\.toLocaleString\(\)/)
})

runTest('onPageSizeChange stays a supported prop for existing callers', () => {
  assert.match(paginationControls, /onPageSizeChange\?: \(pageSize: number\) => void/)
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('purchasesModalPagination tests passed')

// GLITCH regression gate: a scenario matrix over the public storefront pager
// (components/shared/PaginationControls.tsx `centered` layout,
// catalog/catalogPagination.tsx's helpers, CatalogProductsSection.tsx's two
// mounts, and the PublicCatalogPage.tsx / CatalogPage.tsx handlers that own
// the shopper's page-size choice).
//
// storefrontPagerLayout.test.ts and storefrontPagerRow.test.ts already pin
// the pill's SHAPE (order, sizing, a11y) with one representative case each.
// This file instead sweeps the STATE SPACE that shape has to keep working
// across: total pages, page size (including off-menu/corrupt/absurd stored
// values), whether a choice was ever stored, and whether the bootstrap
// payload matches it -- because "glitch" bugs in this codebase's own history
// were exactly a control that was fine at the one size someone tested and
// wrong at the next (see storefrontPagerLayout.test.ts's "single page"
// regression and PublicCatalogPage.tsx's own bootstrapPageSizeMatchesViewer
// comment for the size-mismatch one).
//
// Run: node tests/storefrontPagerScenarios.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { pagerState } from '../src/utils/pagerState.ts'
import { getPortalLanguageText, FIRST_PARTY_PORTAL_LANGUAGE_OPTIONS } from '../src/components/catalog/portalLanguagePacks.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(here, '..')

type TestCallback = () => void | Promise<void>

let failed = 0
async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function read(relative: string): string {
  return fs.readFileSync(path.join(frontendRoot, relative), 'utf8').replace(/\r\n/g, '\n')
}

const pagination = read('src/components/shared/PaginationControls.tsx')
const catalogPagination = read('src/components/catalog/catalogPagination.tsx')
const catalogProducts = read('src/components/catalog/CatalogProductsSection.tsx')
const publicCatalogPage = read('src/components/catalog/PublicCatalogPage.tsx')
const catalogPage = read('src/components/catalog/CatalogPage.tsx')

function centeredBranch(): string {
  const start = pagination.indexOf("if (layout === 'centered')")
  assert.ok(start > 0)
  const rest = pagination.slice(start)
  const end = rest.indexOf('\n  if (compact')
  return end > 0 ? rest.slice(0, end) : rest
}

// ---------------------------------------------------------------------------
// Real execution of the pure size helpers (catalogPagination.tsx carries JSX
// in the same module, so the type-stripping loader alone cannot import it;
// see startupResilience.test.ts for the same technique applied to storage).
// ---------------------------------------------------------------------------
async function loadCatalogPaginationHelpers() {
  const start = catalogPagination.indexOf('export const CATALOG_DEFAULT_PAGE_SIZE')
  const end = catalogPagination.indexOf('function clampCatalogPage')
  assert.ok(start > 0 && end > start)
  const slice = catalogPagination.slice(start, end)
  const built = await build({
    stdin: { contents: slice, loader: 'ts', resolveDir: frontendRoot, sourcefile: 'pager-scenarios-fixture.ts' },
    bundle: false,
    format: 'esm',
    platform: 'neutral',
    write: false,
  })
  const file = path.join(os.tmpdir(), `bos-pager-scenarios-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(file, built.outputFiles[0].text)
  try {
    return await import(`${'file://'}${file.replace(/\\/g, '/')}`) as {
      CATALOG_DEFAULT_PAGE_SIZE: number
      CATALOG_PAGE_SIZE_OPTIONS: number[]
      normalizeCatalogPageSize: (value: unknown) => number
      readStoredCatalogPageSize: () => number | null
      writeStoredCatalogPageSize: (value: unknown) => void
      bootstrapPageSizeMatchesViewer: (bootstrapPageSize: unknown, viewerPageSize: number | null) => boolean
    }
  } finally {
    fs.unlinkSync(file)
  }
}

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, String(value)) },
    removeItem: (key: string) => { data.delete(key) },
    clear: () => data.clear(),
    key: () => null,
    get length() { return data.size },
  } as unknown as Storage
}

function withWindow<T>(win: Record<string, unknown>, fn: () => T): T {
  const previous = (globalThis as Record<string, unknown>).window
  ;(globalThis as Record<string, unknown>).window = win
  try {
    return fn()
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'window')
    else (globalThis as Record<string, unknown>).window = previous
  }
}

// ---------------------------------------------------------------------------
// Matrix 1: totalPages x pageSize -- the pill's visibility, arrow state and
// page count must be internally consistent at every corner, not just the
// three points the existing pager tests happen to check (0, single-page,
// "some middle page").
// ---------------------------------------------------------------------------
await runTest('pagerState: totalPages x pageSize matrix stays internally consistent', () => {
  const sizes = [20, 50, 100]
  const pageCounts = [0, 1, 2, 72]
  for (const size of sizes) {
    for (const pages of pageCounts) {
      const total = pages * size
      for (const requestedPage of [1, pages, pages + 5, 0, -3]) {
        const state = pagerState(requestedPage, total, size)
        if (pages === 0) {
          assert.equal(state.visible, false, `size=${size} pages=${pages}: nothing to page`)
          assert.equal(state.totalPages, 1, 'totalPages floors at 1 even with zero items')
          continue
        }
        assert.equal(state.visible, true, `size=${size} pages=${pages} req=${requestedPage}`)
        assert.equal(state.totalPages, pages, `size=${size} pages=${pages}`)
        assert.ok(state.page >= 1 && state.page <= pages, `page must clamp into range: size=${size} pages=${pages} req=${requestedPage} got ${state.page}`)
        assert.equal(state.backDisabled, state.page <= 1)
        assert.equal(state.nextDisabled, state.page >= pages)
        assert.ok(state.start >= 1 && state.end <= total && state.start <= state.end)
      }
    }
  }
})

await runTest('pagerState: a genuinely single-page result disables BOTH arrows, never just one', () => {
  const state = pagerState(1, 20, 20)
  assert.equal(state.totalPages, 1)
  assert.equal(state.backDisabled, true)
  assert.equal(state.nextDisabled, true)
})

// ---------------------------------------------------------------------------
// Matrix 2: stored page-size value x normalization -- corrupt, off-menu and
// absurd persisted values must all land on a real, orderable option.
// ---------------------------------------------------------------------------
await runTest('normalizeCatalogPageSize: corrupt, off-menu and absurd values all normalize to a real option', async () => {
  const mod = await loadCatalogPaginationHelpers()
  const cases: Array<[unknown, number]> = [
    [20, 20],
    [50, 50],
    [100, 100],
    [30, 50], // off-menu -- not one of the three the storefront offers
    ['abc', 50], // corrupt stored string -> NaN -> default
    [5000, 50], // absurd stored value -> not on the menu -> default
    [0, 50],
    [-20, 50],
    [null, 50],
    [undefined, 50],
    ['', 50],
    ['20', 20], // a stringified valid value (what localStorage actually returns) still counts
  ]
  for (const [input, expected] of cases) {
    assert.equal(mod.normalizeCatalogPageSize(input), expected, `normalizeCatalogPageSize(${JSON.stringify(input)})`)
  }
})

await runTest('readStoredCatalogPageSize: a corrupt or absurd persisted value comes back as "no stored choice", not a bad size', async () => {
  const mod = await loadCatalogPaginationHelpers()
  for (const stored of ['abc', '5000', '30', '-1', '', '0']) {
    const storage = memoryStorage({ 'business-os-portal-page-size-v1': stored })
    const result = withWindow({ localStorage: storage }, () => mod.readStoredCatalogPageSize())
    assert.equal(result, null, `stored=${JSON.stringify(stored)} must not resurrect as a page size the menu never offered`)
  }
  for (const stored of ['20', '50', '100']) {
    const storage = memoryStorage({ 'business-os-portal-page-size-v1': stored })
    const result = withWindow({ localStorage: storage }, () => mod.readStoredCatalogPageSize())
    assert.equal(result, Number(stored), `a genuinely valid stored choice must round-trip: ${stored}`)
  }
})

// ---------------------------------------------------------------------------
// Matrix 3: stored/no-stored choice x bootstrap size match/mismatch -- the
// exact combination the owner's 2026-09-14 comment in catalogPagination.tsx
// calls out by name.
// ---------------------------------------------------------------------------
await runTest('bootstrapPageSizeMatchesViewer: stored choice x bootstrap size cartesian product', async () => {
  const mod = await loadCatalogPaginationHelpers()
  const viewerChoices: Array<number | null> = [null, 20, 50, 100]
  const bootstrapSizes: unknown[] = [undefined, 'abc', 20, 50, 100, 30]
  for (const viewer of viewerChoices) {
    for (const bootstrap of bootstrapSizes) {
      const result = mod.bootstrapPageSizeMatchesViewer(bootstrap, viewer)
      if (viewer === null) {
        assert.equal(result, true, `no stored preference must accept any bootstrap: bootstrap=${JSON.stringify(bootstrap)}`)
        continue
      }
      const normalizedBootstrap = Number(bootstrap) || 50
      assert.equal(result, normalizedBootstrap === viewer, `viewer=${viewer} bootstrap=${JSON.stringify(bootstrap)} -> normalized ${normalizedBootstrap}`)
    }
  }
})

// ---------------------------------------------------------------------------
// Matrix 4: off-menu configured size merges into the rendered options instead
// of leaving the selector showing 20/50/100 with none of them selected while
// the grid actually holds an unlisted size.
// ---------------------------------------------------------------------------
await runTest('the centered pill no longer carries the retired off-menu-size merge for a selector it does not render', () => {
  // This test used to prove the merge that fed an off-menu safePageSize into
  // the rendered size-select options. P10-20 (owner, 2026-09-17: "no need to
  // show rows per page options") retired the selector itself from this
  // branch, so a merge that fed it is dead code if it survived -- prove it
  // did not, rather than leaving an assertion that pins logic nothing reads.
  const branch = centeredBranch()
  assert.doesNotMatch(
    branch,
    /const sizeOptions = pageSizeOptions\.includes\(safePageSize\) \? pageSizeOptions : \[\.\.\.pageSizeOptions, safePageSize\]\.sort\(\(a, b\) => a - b\)/,
    'the merge that only ever fed the retired selector must not linger as dead code',
  )
  assert.doesNotMatch(branch, /<PageSizeSelect/, 'and the selector itself must stay retired')
})

// ---------------------------------------------------------------------------
// Matrix 5: a single page still shows the pill whenever the size selector is
// present (the exact 2026-09 regression storefrontPagerLayout.test.ts pins
// with one case); this sweeps every size at the boundary instead of one.
// ---------------------------------------------------------------------------
await runTest('single-page results at every offered size still surface the pill, with no selector-only exception left', () => {
  // P10-20 retired the size selector this pill used to keep alive on a
  // single page; a single page now stays up purely because the shared
  // `state.visible` gate (total > 0) already keeps it up for every layout,
  // with no branch-local exception to prove separately any more.
  for (const size of [20, 50, 100]) {
    const state = pagerState(1, Math.max(1, size - 5), size)
    assert.equal(state.totalPages, 1, `size=${size}`)
    assert.equal(state.visible, true, `size=${size} single page must still show the pill`)
  }
  const branch = centeredBranch()
  assert.doesNotMatch(branch, /if \(totalPages <= 1 && !showPageSizeSelect\) return null/, 'the retired per-page-only exception must not come back')
})

// ---------------------------------------------------------------------------
// Behavioural contracts that don't vary with the matrix but do need to hold
// for EVERY cell of it: order, persistence, reset-to-page-1, and both mounts
// staying identical.
// ---------------------------------------------------------------------------
await runTest('a size change resets to page 1 and persists the choice, on both public entry points', () => {
  assert.match(
    publicCatalogPage,
    /const changeProductPageSize = \(nextSize: number\) => \{\s*\n\s*const size = normalizeCatalogPageSize\(nextSize\)\s*\n\s*viewerPageSizeRef\.current = size\s*\n\s*writeStoredCatalogPageSize\(size\)\s*\n\s*setProductPageSize\(size\)\s*\n\s*setProductPage\(1\)/,
    'PublicCatalogPage.tsx: normalize, persist, reset to page 1 -- in that order',
  )
  assert.match(
    catalogPage,
    /const changePortalProductPageSize = \(nextSize: number\) => \{\s*\n\s*const size = normalizeCatalogPageSize\(nextSize\)\s*\n\s*viewerPageSizeRef\.current = size\s*\n\s*writeStoredCatalogPageSize\(size\)\s*\n\s*setPortalProductPageSize\(size\)\s*\n\s*setPortalProductPage\(1\)/,
    'CatalogPage.tsx publicView preview must do the identical thing -- both public paths, one handler shape',
  )
})

await runTest('server bootstrap/search responses never overwrite the viewer-selected size with a different one', () => {
  // The search request always sends the viewer's OWN current page size, so
  // the response echoing it back is an identity, not an overwrite -- but the
  // bootstrap path must defer entirely when a viewer preference exists.
  assert.match(
    publicCatalogPage,
    /if \(!viewerPageSizeRef\.current\) setProductPageSize\(Number\(next\.catalog\.pageSize \|\| CATALOG_DEFAULT_PAGE_SIZE\) \|\| CATALOG_DEFAULT_PAGE_SIZE\)/,
    'a bootstrap fetch must only ever set the page size when the viewer never chose one',
  )
  assert.match(publicCatalogPage, /pageSize: productPageSize,/, 'the product search request must send the CURRENT viewer size back to the server')
})

await runTest('the row order is [Back] [page / total] [Next] -- and both mounts share one gate', () => {
  // 2026-09-15 (owner, supersedes 2026-09-14's [size][Back] order): Back
  // leads the row, then the page-size selector. P10-20 (owner, 2026-09-17)
  // retired the selector itself, leaving Back / page / total / Next.
  const branch = centeredBranch()
  const backAt = branch.indexOf('aria-label={backLabel}')
  const pageAt = branch.indexOf('aria-label={pageLabel}', backAt)
  const totalAt = branch.indexOf('<span className={countClass}>')
  const nextAt = branch.indexOf('aria-label={nextLabel}')
  assert.ok(backAt > 0 && pageAt > backAt && totalAt > pageAt && nextAt > totalAt)
  assert.doesNotMatch(branch, /<PageSizeSelect/, 'P10-20: the per-page chooser must not come back to this row')

  const mounts = catalogProducts.match(/<CatalogPaginationControls\b/g) || []
  assert.equal(mounts.length, 2)
  const gates = catalogProducts.match(/\{showPager \? \(/g) || []
  assert.equal(gates.length, 2, 'both mounts must share exactly one visibility fact, or they can disagree at some size again')
})

await runTest('both public paths (standalone storefront and the admin publicView preview) render the same pager component with the same handler shape', () => {
  for (const source of [publicCatalogPage, catalogPage]) {
    assert.match(source, /import \{ bootstrapPageSizeMatchesViewer, CATALOG_DEFAULT_PAGE_SIZE, normalizeCatalogPageSize, readStoredCatalogPageSize, writeStoredCatalogPageSize \} from '\.\/catalogPagination'/)
  }
})

await runTest('every first-party language pack that carries pager vocabulary carries per_page too, in both packs', () => {
  const perPagePacks = FIRST_PARTY_PORTAL_LANGUAGE_OPTIONS
    .map((option) => option.value)
    .filter((value) => getPortalLanguageText(value, 'perPage'))
  assert.ok(perPagePacks.length >= 18, `expected the full set of packs carrying pager words, found ${perPagePacks.length}`)
  for (const value of perPagePacks) {
    for (const key of ['page', 'of', 'back', 'next', 'perPage']) {
      const text = getPortalLanguageText(value, key)
      assert.ok(text, `${value}.${key} missing -- the pager map's \`|| key\` fallback would print the raw key`)
    }
  }
  const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>
  assert.equal(getPortalLanguageText('km', 'back'), km.back)
  assert.equal(getPortalLanguageText('km', 'next'), km.next)
})

if (failed > 0) {
  process.exitCode = 1
}

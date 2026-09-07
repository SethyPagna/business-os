// The storefront's own name, at 375px.
//
// The header is one three-column grid -- `grid-cols-[auto_1fr_auto]`: the
// social cluster, the brand, the icon buttons. The two `auto` tracks are sized
// by their content (three 36px social icons and four 36px buttons plus gaps),
// the brand sits in the `1fr` middle with `min-w-0`, and the brand carried
// `[overflow-wrap:anywhere]`. `overflow-wrap: anywhere` differs from
// `break-word` in exactly one way that matters here: it is taken into account
// when computing the element's MIN-CONTENT size, so the brand's min-content
// contribution became one character. A `1fr` track never gets more than the
// two `auto` tracks leave it, and with nothing pushing back the middle track
// collapsed to a few characters wide -- the shop's name wrapped one letter per
// line on the phone the storefront is mostly opened on.
//
// The fix is structural, not a smaller font: below `sm` the brand leaves the
// three-column row and takes a full-width centred row of its own, so it has
// the whole 375px minus padding, and normal word-boundary wrapping is enough.
// At `sm` and up the three-column row returns, and there the brand is
// one-line: clipped names are the shared TruncatedText, so the ellipsis opens
// the full value instead of being a dead end.
//
// Sibling parity: CatalogPreviewSurface is the single header for BOTH
// storefront entries -- PublicCatalogPage (the customer host) and
// CatalogPage's `<CatalogPreviewSurface publicView />` editor preview -- so
// there is one header to fix and both get it. Asserted below.
//
// Discriminating: every assertion in "the header today" fails at 4fe515f5,
// and the positive control reproduces that exact markup so a reader that
// cannot see the defect fails here rather than in the next review.
//
// Run: node tests/storefrontWordmark.test.ts
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

const surface = read('../src/components/catalog/CatalogPreviewSurface.tsx')
const publicPage = read('../src/components/catalog/PublicCatalogPage.tsx')
const adminPage = read('../src/components/catalog/CatalogPage.tsx')

// ---------------------------------------------------------------------------
// Readers. Each takes a source string so the positive control can be pushed
// through exactly the same code as the real file.
// ---------------------------------------------------------------------------

// The header row only -- from the header shell to the nav shell below it.
function headerBlock(source: string): string {
  const start = source.indexOf('portal-header-shell')
  assert.ok(start > 0, 'the storefront header section must still be identifiable')
  const rest = source.slice(start)
  const end = rest.indexOf('portal-nav-shell')
  return end > 0 ? rest.slice(0, end) : rest
}

function classAt(source: string, index: number): string {
  const open = source.lastIndexOf('className="', index)
  assert.ok(open >= 0, 'the element must carry a className')
  const from = open + 'className="'.length
  const close = source.indexOf('"', from)
  return source.slice(from, close)
}

// The class list of the grid the header row is laid out with.
function headerGridClass(source: string): string {
  const block = headerBlock(source)
  const at = block.indexOf('grid-cols-')
  assert.ok(at > 0, 'the header row is laid out as a grid')
  return classAt(block, at)
}

// The class list of the element that carries the shop name. Anchored on the
// serif display face, which only the wordmark uses.
function brandClass(source: string): string {
  const block = headerBlock(source)
  const at = block.indexOf("'Georgia'")
  assert.ok(at > 0, 'the wordmark is the header element set in the serif display face')
  return classAt(block, at)
}

// The class list of the GRID CELL the wordmark lives in -- the element that is
// actually placed in the header's tracks. Found by walking out of the wordmark
// element to its parent rather than by a marker attribute, so the test reads
// the real structure and cannot be satisfied by a class moved onto the wrong
// element.
function classOfTag(source: string, openIndex: number): string {
  const at = source.indexOf('className="', openIndex)
  assert.ok(at > openIndex, 'the element must carry a className')
  const from = at + 'className="'.length
  return source.slice(from, source.indexOf('"', from))
}

function parentDivOpen(source: string, childOpen: number): number {
  let depth = 0
  let cursor = childOpen
  while (cursor > 0) {
    const prevClose = source.lastIndexOf('</div>', cursor - 1)
    const prevOpen = source.lastIndexOf('<div', cursor - 1)
    if (prevOpen < 0 && prevClose < 0) break
    if (prevClose > prevOpen) {
      depth += 1
      cursor = prevClose
      continue
    }
    if (depth === 0) return prevOpen
    depth -= 1
    cursor = prevOpen
  }
  throw new Error('the wordmark must sit inside a grid cell')
}

function brandCellClass(source: string): string {
  const block = headerBlock(source)
  const anchor = block.indexOf("'Georgia'")
  assert.ok(anchor > 0, 'the wordmark is the header element set in the serif display face')
  const brandOpen = block.lastIndexOf('<div', anchor)
  return classOfTag(block, parentDivOpen(block, brandOpen))
}

// Is the brand still trapped in a `1fr` track between two `auto` tracks at
// phone width? True = the defect is present.
function brandIsSqueezedUnderSm(source: string): boolean {
  const grid = headerGridClass(source)
  const threeTrack = /(^|\s)grid-cols-\[auto_1fr_auto\]/.test(grid)
  const spansTheRow = /(^|\s)col-span-\d/.test(brandCellClass(source))
  return threeTrack && !spansTheRow
}

// Does the brand break inside words (per-character wrapping)? True = defect.
function brandBreaksInsideWords(source: string): boolean {
  const brand = brandClass(source)
  return /\[overflow-wrap:anywhere\]/.test(brand) || /(^|\s)break-all/.test(brand)
}

// The unprefixed font-size step the wordmark is set at.
const SIZE_ORDER = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl', 'text-3xl']
function brandBaseSize(source: string): string {
  const brand = brandClass(source)
  const found = brand.split(/\s+/).filter((token) => SIZE_ORDER.includes(token))
  assert.ok(found.length > 0, 'the wordmark must declare a base font size')
  return found[0]
}

// ---------------------------------------------------------------------------
// Positive control: the header exactly as it shipped at 4fe515f5. The readers
// above must report it as defective, or their all-clear on the real file below
// means nothing.
// ---------------------------------------------------------------------------

const SQUEEZED_FIXTURE = `
            <section className="portal-header-shell rounded-t-[28px]">
              <div className="px-1 py-4 sm:py-5">
                <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-1" />
                  <div className="min-w-0 text-center">
                    <div
                      className="notranslate text-lg font-semibold leading-tight tracking-tight text-balance break-words [overflow-wrap:anywhere] text-slate-900 sm:truncate sm:text-2xl dark:text-neutral-100"
                      style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
                      translate="no"
                    >
                      {previewTitle || displayConfig.businessName || copy('about', 'About')}
                    </div>
                  </div>
                </div>
              </div>
            </section>
            <div className="portal-nav-shell" />
`

runTest('the readers see the squeeze in the header they were written for (positive control)', () => {
  assert.equal(
    brandIsSqueezedUnderSm(SQUEEZED_FIXTURE),
    true,
    'the fixture is the shipped header: a bare three-track grid with the brand in the 1fr middle',
  )
  assert.equal(
    brandBreaksInsideWords(SQUEEZED_FIXTURE),
    true,
    '[overflow-wrap:anywhere] is what drops the min-content contribution to one character',
  )
  assert.equal(brandBaseSize(SQUEEZED_FIXTURE), 'text-lg', 'and the reader can read the size it was set at')
})

// ---------------------------------------------------------------------------
// The header today
// ---------------------------------------------------------------------------

runTest('below sm the wordmark is not squeezed between the two icon clusters', () => {
  assert.equal(
    brandIsSqueezedUnderSm(surface),
    false,
    'at 375px the brand must own a full-width row, not the leftovers of a 1fr track between two auto tracks',
  )
  const grid = headerGridClass(surface)
  assert.match(
    grid,
    /sm:grid-cols-\[auto_1fr_auto\]/,
    'the three-column row is the WIDE layout; at sm and up nothing changes',
  )
  const cell = brandCellClass(surface)
  assert.match(cell, /(^|\s)col-span-2/, 'below sm the brand cell spans the whole header row')
  assert.match(cell, /sm:col-span-1/, 'and drops back into its own track at sm')
  assert.match(cell, /(^|\s)order-last/, 'and sits BELOW the two icon clusters on the phone, not between them')
  assert.match(cell, /sm:order-none/, 'source order returns for the wide layout')
  assert.match(cell, /(^|\s)text-center/, 'centred, as the header has always been')
})

runTest('the wordmark wraps at word boundaries, never per character', () => {
  assert.equal(
    brandBreaksInsideWords(surface),
    false,
    'with a full-width row there is nothing left for [overflow-wrap:anywhere] to buy, and it is what caused the per-letter wrap',
  )
  assert.match(brandClass(surface), /(^|\s)break-words/, 'a single word longer than the row still has to break somewhere')
})

runTest('the fix is not a smaller shop name', () => {
  const size = brandBaseSize(surface)
  assert.ok(
    SIZE_ORDER.indexOf(size) >= SIZE_ORDER.indexOf('text-lg'),
    `the wordmark must stay at text-lg or larger on phones -- found ${size}`,
  )
  assert.match(brandClass(surface), /sm:text-2xl/, 'and the wide layout keeps its larger step')
})

runTest('the one place it can still clip is a revealable truncation, not a dead end', () => {
  const block = headerBlock(surface)
  assert.match(block, /<TruncatedText/, 'the sm-and-up single line is the shared TruncatedText, so "..." opens the full name')
  assert.match(surface, /import TruncatedText from '\.\.\/shared\/TruncatedText'/, 'from the shared component, not a local copy')
  const at = block.indexOf('<TruncatedText')
  const tag = block.slice(at, block.indexOf('/>', at))
  assert.match(tag, /hidden sm:block/, 'it is the wide layout only -- below sm the name wraps in full and nothing is clipped')
})

// ---------------------------------------------------------------------------
// Sibling parity -- one header, both storefront entries
// ---------------------------------------------------------------------------

runTest('both storefront entries render this one header', () => {
  assert.match(publicPage, /import CatalogPreviewSurface from '\.\/CatalogPreviewSurface'/, 'the customer host')
  assert.match(adminPage, /import CatalogPreviewSurface from '\.\/CatalogPreviewSurface'/, "the admin editor's preview")
  assert.match(publicPage, /<CatalogPreviewSurface/)
  assert.match(adminPage, /<CatalogPreviewSurface/)
})

runTest("the admin preview's Portal Studio badge is unaffected by the phone layout", () => {
  const block = headerBlock(surface)
  const at = block.indexOf("copy('previewBadge'")
  assert.ok(at > 0, 'the badge still renders for the non-publicView editor preview')
  const badgeClass = classAt(block, at)
  assert.match(
    badgeClass,
    /(^|\s)hidden\b/,
    'the badge is hidden below sm, so the new two-row phone header cannot be crowded by it',
  )
  assert.match(badgeClass, /sm:inline-flex/, 'and it appears with the wide layout, where the row is unchanged')
})

if (failed > 0) {
  console.error(`\n${failed} storefront wordmark check(s) failed`)
  process.exit(1)
}
console.log('\nAll storefront wordmark checks passed')

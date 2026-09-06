// Every inner scroller on the public route must contain its own overscroll.
//
// The defect. This app has NO body scroll lock -- a grep for
// body.style.overflow / documentElement.style.overflow / useBodyScrollLock
// over frontend/src returns one hit, and it is the print-receipt host iframe,
// not a dialog. So when a customer flicks inside a storefront overlay -- the
// cart panel, the wishlist panel, the account panel, the product flyout, a
// filter listbox, the language menu -- and that overlay reaches its end, the
// gesture CHAINS: on Android/desktop it scrolls the catalogue behind the
// overlay, and on iOS Safari it rubber-bands the document, so the page the
// customer comes back to is not where they left it. The horizontal cases are
// worse than cosmetic: an inline swipe that runs past the last promo chip or
// the last section tab chains into the browser's own back-swipe gesture and
// navigates the shop away mid-browse.
//
// It is not a new idea in this codebase, which is what makes it a defect
// rather than a preference: the admin app contains every one of its inner
// scrollers already -- .page-scroll and .modal-scroll in styles/main.css,
// .compact-action-row, AppSelect's menu, PageSizeSelect's menu,
// AlphaIndexRail, PageHeader's action row, BackgroundImportTracker -- and so
// does exactly ONE storefront scroller, the filters dialog at
// CatalogProductsSection.tsx:563. The storefront's other ten -- eleven inner
// scrollers in all -- were simply never given the same treatment.
//
// This test enumerates the scrollers instead of naming them, so a new overlay
// added to any of these files is covered the day it lands.
//
// Discriminating: at 4e58891f ten of the eleven public scrollers carry no
// overscroll containment at all, so "every public scroller contains its own
// overscroll" fails with all ten listed by file, line and axis.
//
// Run: node tests/storefrontOverlayScroll.test.ts
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

// ---------------------------------------------------------------------------
// The instrument
// ---------------------------------------------------------------------------

export interface ScrollerFinding {
  file: string
  line: number
  axes: ('x' | 'y')[]
  contained: ('x' | 'y')[]
  missing: ('x' | 'y')[]
  classes: string
}

// A className literal that turns the element into a scrollport, and on which
// axes. overflow-auto / overflow-scroll with no axis suffix scroll both.
function scrollAxes(classes: string): ('x' | 'y')[] {
  const axes = new Set<'x' | 'y'>()
  for (const match of classes.matchAll(/\boverflow-(?:(x|y)-)?(?:auto|scroll)\b/g)) {
    if (match[1] === 'x') axes.add('x')
    else if (match[1] === 'y') axes.add('y')
    else { axes.add('x'); axes.add('y') }
  }
  return [...axes].sort()
}

// Tailwind's containment utilities. overscroll-contain covers both axes;
// overscroll-x-contain / overscroll-y-contain cover one.
function containedAxes(classes: string): ('x' | 'y')[] {
  const axes = new Set<'x' | 'y'>()
  for (const match of classes.matchAll(/\boverscroll-(?:(x|y)-)?contain\b/g)) {
    if (match[1] === 'x') axes.add('x')
    else if (match[1] === 'y') axes.add('y')
    else { axes.add('x'); axes.add('y') }
  }
  return [...axes].sort()
}

// Comments out, line numbers kept. Block comments are removed across the
// whole file first -- these sources carry multi-line /* */ and {/* */} blocks
// whose CONTINUATION lines start with neither marker -- and each is replaced
// by the newlines it spanned, so a finding still reports its true line. Then
// line comments go, wherever on the line they start.
export function stripComments(source: string): string {
  return source
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, (block) => '\n'.repeat((block.match(/\n/g) || []).length))
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// Scan one source for className literals that scroll, so the prose above a fix
// can neither be mistaken for the fix nor count as a scroller of its own.
function findScrollers(file: string, source: string): ScrollerFinding[] {
  const found: ScrollerFinding[] = []
  const lines = stripComments(source).split('\n')
  lines.forEach((line, index) => {
    const axes = scrollAxes(line)
    if (axes.length === 0) return
    const contained = containedAxes(line)
    found.push({
      file,
      line: index + 1,
      axes,
      contained,
      missing: axes.filter((axis) => !contained.includes(axis)),
      classes: line.trim(),
    })
  })
  return found
}

// ---------------------------------------------------------------------------
// Positive control -- the instrument must be able to say "no"
// ---------------------------------------------------------------------------

runTest('the scan reports an uncontained scroller, and only an uncontained one', () => {
  const fixture = [
    '<div className="max-h-40 overflow-y-auto p-2">',                // 1: uncontained y
    '<div className="max-h-40 overflow-y-auto overscroll-contain">', // 2: contained
    '<div className="flex overflow-x-auto overscroll-x-contain">',   // 3: contained x
    '<div className="flex overflow-x-auto gap-2">',                  // 4: uncontained x
    '<div className="overflow-auto overscroll-y-contain">',          // 5: y only -- x still open
    '<div className="rounded-xl border p-2">',                       // 6: not a scroller
    '// className="overflow-y-auto" in a comment is not a scroller', // 7: prose
  ].join('\n')
  const findings = findScrollers('fixture', fixture)
  assert.deepEqual(findings.map((f) => f.line), [1, 2, 3, 4, 5], 'a non-scrolling element and a comment must not be reported')
  assert.deepEqual(findings.find((f) => f.line === 1)?.missing, ['y'])
  assert.deepEqual(findings.find((f) => f.line === 2)?.missing, [])
  assert.deepEqual(findings.find((f) => f.line === 3)?.missing, [])
  assert.deepEqual(findings.find((f) => f.line === 4)?.missing, ['x'])
  assert.deepEqual(findings.find((f) => f.line === 5)?.missing, ['x'], 'overflow-auto scrolls both axes; containing one leaves the other chaining')
})

runTest('stripping comments keeps every line where it was', () => {
  // A finding whose line number has drifted sends the next reader to the
  // wrong element. Multi-line blocks must collapse to blank lines, not vanish.
  const source = [
    'const a = 1',
    '/* a block',
    '   whose middle line mentions overflow-y-auto',
    '   and whose tail does too */',
    '{/* a JSX block',
    '    also mentioning overflow-x-auto */}',
    '<div className="overflow-y-auto overscroll-contain"> // and a trailing note',
    'const url = "https://example.com/a"',
  ].join('\n')
  const stripped = stripComments(source)
  assert.equal(stripped.split('\n').length, 8, 'the file must keep its line count')
  assert.equal(stripped.split('\n')[6].trim(), '<div className="overflow-y-auto overscroll-contain">')
  assert.equal(stripped.split('\n')[7].trim(), 'const url = "https://example.com/a"', 'a URL is not a line comment')
  assert.deepEqual(findScrollers('fixture', source).map((f) => f.line), [7])
})

// ---------------------------------------------------------------------------
// The public route
// ---------------------------------------------------------------------------

// Every file whose markup renders inside the customer-facing shop. The admin
// editor's own files (CatalogEditorSurface, ManagePromotionsModal) and
// CatalogPage's admin .page-scroll branch are deliberately NOT here: the admin
// shell is contained by its class in styles/main.css, and an admin overlay
// chaining into an admin page is not the owner's report.
const PUBLIC_SOURCES = [
  '../src/components/catalog/CatalogPreviewSurface.tsx',
  '../src/components/catalog/PublicCatalogPage.tsx',
  '../src/components/catalog/CatalogProductsSection.tsx',
  '../src/components/catalog/PortalFilterCombobox.tsx',
  '../src/components/catalog/PortalPromoStrip.tsx',
  '../src/components/catalog/PortalPromotionsBanner.tsx',
  '../src/components/catalog/ProductDetailFlyout.tsx',
]

const publicFindings = PUBLIC_SOURCES.flatMap((relative) => findScrollers(relative.replace('../src/components/catalog/', ''), read(relative)))

runTest('the scan actually reaches the storefront scrollers it claims to check', () => {
  // A rename or a refactor that empties the scan would otherwise make every
  // assertion below vacuously true.
  assert.ok(publicFindings.length >= 10, `expected at least 10 public scrollers, found ${publicFindings.length}`)
  const files = new Set(publicFindings.map((f) => f.file))
  for (const expected of ['CatalogPreviewSurface.tsx', 'PublicCatalogPage.tsx', 'ProductDetailFlyout.tsx', 'PortalFilterCombobox.tsx', 'PortalPromoStrip.tsx', 'PortalPromotionsBanner.tsx', 'CatalogProductsSection.tsx']) {
    assert.ok(files.has(expected), `${expected} must still contribute at least one scroller to the scan`)
  }
})

runTest('every public scroller contains its own overscroll', () => {
  const leaking = publicFindings.filter((f) => f.missing.length > 0)
  assert.deepEqual(
    leaking.map((f) => `${f.file}:${f.line} chains on ${f.missing.join('+')} -- ${f.classes}`),
    [],
    'a flick that runs past the end of an overlay must stop there, not move the shop behind it',
  )
})

runTest('the storefront scroller that was already right was not changed to get there', () => {
  // CatalogProductsSection's filters dialog carried overscroll-contain at
  // 4e58891f. It is the real-world control: the list above is not "every file
  // I edited", and the rule it satisfies is the codebase's own, not a new one.
  const filters = publicFindings.filter((f) => f.file === 'CatalogProductsSection.tsx')
  assert.equal(filters.length, 1, 'the products section still owns exactly one inner scroller -- the filters dialog')
  assert.deepEqual(filters[0].missing, [])
  assert.match(filters[0].classes, /max-h-\[min\(32rem,calc\(100dvh-1rem\)\)\] overflow-y-auto overscroll-contain/)
})

// ---------------------------------------------------------------------------
// Why containment is the whole barrier
// ---------------------------------------------------------------------------

runTest('no storefront overlay locks the document instead', () => {
  // If an overlay ever starts writing document.body.style.overflow, it takes
  // on the obligation to restore it on every exit path -- close, Escape,
  // backdrop click, route change, unmount during a transition -- and a missed
  // one leaves the shop permanently unscrollable. The containment above needs
  // no teardown at all. Pin the absence so the two approaches never coexist.
  for (const relative of PUBLIC_SOURCES) {
    const source = read(relative)
    assert.doesNotMatch(source, /(?:document\.)?body\.style\.overflow/, `${relative} must not lock the document body`)
    assert.doesNotMatch(source, /documentElement\.style\.overflow/, `${relative} must not lock the document element`)
  }
})

if (failed > 0) {
  console.error(`\n${failed} storefront overlay-scroll check(s) failed`)
  process.exit(1)
}
console.log('\nAll storefront overlay-scroll checks passed')

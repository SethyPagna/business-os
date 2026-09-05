// The public storefront's brand index (leangbeauty.com -> Products).
//
// It used to be TWO letter lists rendered in the page flow: a 4-column grid
// in the desktop aside, held inside its own
// `max-h-[min(18rem,calc(100vh-32rem))] overflow-y-auto` box, and an
// `overflow-x-auto` row of `h-8 min-w-9` chips below `lg`. Both were inner
// scroll containers sitting directly over the product list, which is how a
// wheel/touch gesture aimed at the page got eaten, and the chip row is the
// one horizontal scroller a 375px viewport had to fight.
//
// The owner asked for one VERTICAL rail pinned to the screen edge: collapsed
// it is a column of dashes, hover (mouse) or touch opens it, a letter jumps
// to that brand group, and clicking anywhere else closes it.
//
// The jump itself is the part worth testing purely: which brand-initial
// filter a click produces is the whole contract between the rail and
// letterFilteredProducts / the server's `initial` param, and it survived the
// rewrite unchanged (tap the active letter again = back to All). Everything
// that can only be expressed as JSX is checked as source shape below.
//
// Run: node tests/alphaIndexRail.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  RAIL_ALL_KEY,
  nearestRailKey,
  nextRailFocusKey,
  railFocusKey,
  railIndexAtOffset,
  resolveBrandJump,
  sortRailKeys,
} from '../src/utils/alphaRail.ts'

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

// Assertions below say "this class is gone". A comment explaining WHY it is
// gone has to be free to name it, so the checks run against code only.
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const rail = code('../src/components/shared/AlphaIndexRail.tsx')
const catalogProducts = code('../src/components/catalog/CatalogProductsSection.tsx')
const products = code('../src/components/products/Products.tsx')
const pos = code('../src/components/pos/POS.tsx')

// ---------------------------------------------------------------------------
// The letter -> brand-filter mapping (the "jump")
// ---------------------------------------------------------------------------

runTest('a letter jump selects that brand initial, and the same letter again clears it', () => {
  // This is exactly what the two deleted button lists did inline:
  //   onClick={() => updateInitialFilter(effectiveInitialFilter === item.key ? 'all' : item.key)}
  assert.equal(resolveBrandJump('all', 'B'), 'B', 'picking a letter from All must select it')
  assert.equal(resolveBrandJump('B', 'C'), 'C', 'picking a different letter must switch to it')
  assert.equal(resolveBrandJump('B', 'B'), RAIL_ALL_KEY, 'picking the active letter again must go back to All')
})

runTest("the rail's own All entry always clears, whatever is selected", () => {
  assert.equal(resolveBrandJump('B', RAIL_ALL_KEY), RAIL_ALL_KEY)
  assert.equal(resolveBrandJump('all', RAIL_ALL_KEY), RAIL_ALL_KEY, 'clearing an already-clear filter is a no-op, not a toggle back to a letter')
})

runTest('an empty or non-string jump target never changes the filter', () => {
  assert.equal(resolveBrandJump('B', ''), 'B', 'a missed hit-test must leave the current brand filter alone')
  assert.equal(resolveBrandJump('B', null as unknown as string), 'B')
})

// ---------------------------------------------------------------------------
// The rail's data: which keys it renders, in what order
// ---------------------------------------------------------------------------

runTest("rail keys are de-duplicated, ordered like the rest of the app, and '#' sinks to the bottom", () => {
  assert.deepEqual(sortRailKeys(['C', '#', '1', 'B', 'A', 'B']), ['A', 'B', 'C', '1', '#'])
  assert.deepEqual(sortRailKeys([]), [])
  assert.deepEqual(sortRailKeys(['', null, undefined, 'A'] as unknown[]), ['A'], 'blank facet keys must not render a dead dash')
  assert.deepEqual(sortRailKeys('nope' as unknown), [], 'a non-array facet payload must degrade to an empty rail, not throw')
})

runTest('a scrubbed-past key that has no products falls back to the closest one that does', () => {
  assert.equal(nearestRailKey(['A', 'C', 'E'], 'C'), 'C', 'an exact hit stays put')
  assert.equal(nearestRailKey(['A', 'C', 'E'], 'D'), 'C', 'ties resolve to the earlier letter, the way the list reads')
  assert.equal(nearestRailKey(['A', 'C', 'E'], 'B'), 'A')
  assert.equal(nearestRailKey(['A', 'C', 'E'], 'Z'), 'E')
  assert.equal(nearestRailKey([], 'A'), null, 'an empty rail has nothing to jump to')
})

runTest('the hit-test maps a Y offset onto a letter and clamps outside the rail', () => {
  assert.equal(railIndexAtOffset(3, 45, 90), 1, 'the middle third of a 90px rail is the middle letter')
  assert.equal(railIndexAtOffset(3, -5, 90), 0, 'dragging above the rail holds the first letter')
  assert.equal(railIndexAtOffset(3, 95, 90), 2, 'dragging below the rail holds the last letter')
  assert.equal(railIndexAtOffset(0, 10, 90), -1, 'no letters means no hit')
  assert.equal(railIndexAtOffset(3, 10, 0), -1, 'a collapsed/unmeasured rail must not divide by zero')
})

// ---------------------------------------------------------------------------
// Keyboard reachability (the grid it replaced was plain <button>s, so the
// rail must not be a keyboard dead end)
// ---------------------------------------------------------------------------

runTest('focus lands on the selected letter, or the first one when nothing is selected', () => {
  assert.equal(railFocusKey(['A', 'B', 'C'], 'B'), 'B')
  assert.equal(railFocusKey(['A', 'B', 'C'], null), 'A')
  assert.equal(railFocusKey(['A', 'B', 'C'], 'Z'), 'A', 'a stale selection must not strand the tab stop')
  assert.equal(railFocusKey([], 'A'), null)
})

runTest('arrow keys walk the rail and clamp at both ends instead of wrapping', () => {
  assert.equal(nextRailFocusKey(['A', 'B', 'C'], 'A', 'down'), 'B')
  assert.equal(nextRailFocusKey(['A', 'B', 'C'], 'C', 'down'), 'C', 'the end of the rail is the end, not a wrap to A')
  assert.equal(nextRailFocusKey(['A', 'B', 'C'], 'A', 'up'), 'A')
  assert.equal(nextRailFocusKey(['A', 'B', 'C'], 'B', 'up'), 'A')
  assert.equal(nextRailFocusKey(['A', 'B', 'C'], 'B', 'first'), 'A')
  assert.equal(nextRailFocusKey(['A', 'B', 'C'], 'B', 'last'), 'C')
  assert.equal(nextRailFocusKey(['A', 'B', 'C'], null, 'down'), 'A', 'the first arrow press enters the rail at the top')
})

// ---------------------------------------------------------------------------
// Source shape: the rail exists, the storefront uses it, the two old lists
// (and their inner scrollers) are gone
// ---------------------------------------------------------------------------

runTest('the shared rail offers a screen-edge variant without moving the admin one', () => {
  assert.match(rail, /edge\?: 'sidebar' \| 'screen'/, 'the storefront edge position must be an explicit opt-in union')
  assert.match(rail, /edge = 'sidebar'/, "the default must stay 'sidebar' so Products and POS keep sitting beside the admin sidebar")
  assert.match(rail, /md:left-\[228px\] md:right-auto/, 'the sidebar variant must keep its 220px offset')
  assert.match(rail, /env\(safe-area-inset-right\)/, 'the screen-edge variant must clear a notched right edge')
  assert.match(rail, /z-30/, 'the rail sits above the grid (z-20 sticky search) and below the pinned nav (z-40) and the list FAB (z-50)')
})

runTest('the rail renders through a portal, like every other float', () => {
  assert.match(rail, /createPortal\(railNode, document\.body\)/, 'a viewport-fixed float must not depend on its ancestors not clipping it')
  assert.match(rail, /typeof document === 'undefined'/, 'the portal needs a no-DOM guard')
})

runTest('the rail is keyboard reachable: real buttons, labelled, with a roving tab stop', () => {
  assert.match(rail, /<button/, 'the letters must be buttons -- the old spans could not be tabbed to or activated')
  assert.doesNotMatch(rail, /role="option"/, 'listbox options without a listbox keyboard model were the dead end')
  assert.match(rail, /aria-label=\{/, 'each letter needs an accessible name; a bare "A" reads as nothing in a dash rail')
  assert.match(rail, /tabIndex=\{/, 'a roving tab stop keeps the rail to ONE tab stop instead of 26')
  assert.match(rail, /onKeyDown=\{/, 'arrow keys must move within the rail')
})

runTest('hover opens the rail for mouse users and touch keeps press-to-open', () => {
  assert.match(rail, /onPointerEnter=\{/, 'the owner asked for hover-to-open on desktop')
  assert.match(rail, /pointerType !== 'mouse'/, 'hover-open must not fire for the synthetic mouse events a tap emits')
  assert.match(rail, /document\.addEventListener\('pointerdown'/, 'clicking anywhere else must still close it')
})

runTest('the storefront mounts the rail at the screen edge and passes the brand vocabulary', () => {
  assert.match(catalogProducts, /<AlphaIndexRail\b/, 'the storefront must use the shared rail, not a third copy of a letter list')
  assert.match(catalogProducts, /edge="screen"/, 'the storefront rail rides the screen edge at every breakpoint')
  assert.match(catalogProducts, /copy\('jumpToBrand', 'Jump to brand'\)/, "the rail's label is the storefront's own translated string")
  assert.match(catalogProducts, /resolveBrandJump\(/, 'the jump mapping must come from the tested kernel, not a re-inlined ternary')
})

runTest('both old letter lists are gone, and with them the inner scrollers over the grid', () => {
  assert.doesNotMatch(catalogProducts, /grid-cols-4 gap-1 overflow-y-auto/, 'the aside letter GRID must be gone')
  assert.doesNotMatch(catalogProducts, /max-h-\[min\(18rem/, 'its inner scroll box is what captured wheel scrolling over the page')
  assert.doesNotMatch(catalogProducts, /`rail-\$\{item\.key\}`/, 'the desktop letter buttons must be gone')
  assert.doesNotMatch(catalogProducts, /`row-\$\{item\.key\}`/, 'the lg:hidden letter ROW must go with them')
  assert.doesNotMatch(catalogProducts, /h-8 min-w-9/, 'the 36px-wide chips were the horizontal overflow at 375')
})

runTest('the admin callers still get the sidebar rail (no edge prop, no behaviour change)', () => {
  assert.match(products, /<AlphaIndexRail\b/, 'admin Products still owns a rail')
  assert.doesNotMatch(products, /<AlphaIndexRail[^/>]*edge=/, 'admin Products must not opt into the screen edge')
  assert.match(pos, /<AlphaIndexRail\b/, 'POS still owns a rail')
  assert.doesNotMatch(pos, /<AlphaIndexRail[^/>]*edge=/, 'POS must not opt into the screen edge')
})

if (failed > 0) {
  console.error(`\n${failed} brand-rail check(s) failed`)
  process.exit(1)
}
console.log('\nAll brand-rail checks passed')

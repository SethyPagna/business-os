// Reveal for a truncated cell — one implementation, and it never steals a
// click the surface underneath already owns.
//
// At 6e3abfea `TruncatedText` owned a real reveal (measure, portalled
// tooltip, placement, dismiss) and had ONE consumer, StatsStrip.tsx:276.
// Every other truncated cell in the app -- the `.dense-cell-truncate` cells
// in Stock Changes, Stock-in Sessions, Returns and Fees -- fell back to the
// native `title` attribute, i.e. a hover tooltip, styled by the browser and
// unthemed.
//
// The fix is ONE delegated controller for `.dense-cell-truncate[title]`
// that TruncatedText itself mounts, so those surfaces gain the shared float
// with zero edits to their files and there is a single implementation
// rather than a component's tooltip beside a document-level one.
//
// This pins three things a delegated handler gets wrong: the
// single-implementation property and the coverage it buys; the open/close
// rule, which breaks if hover and click are treated as independent events;
// and -- the one that would damage four other lanes' surfaces -- WHOSE
// click a tap on a clipped cell is, when that cell sits in a row whose own
// click opens the record.
//
// Run: node tests/truncatedText.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  HOVER_OPEN_DELAY_MS,
  REVEAL_ATTR,
  REVEAL_SELECTOR,
  SURFACE_CLICK_SELECTOR,
  claimsClick,
  isClipped,
  nextFloatState,
  placeFloat,
} from '../src/components/shared/textAffordances.ts'

const read = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

/* ---------------------------------------------------------------- *
 * 1. Open/close, including the touch sequence.
 * ---------------------------------------------------------------- */

const hoverIn = { type: 'hover-in', element: 'cell', kind: 'reveal' } as const
const click = { type: 'click', element: 'cell', kind: 'reveal' } as const

assert.deepEqual(nextFloatState(null, hoverIn), { element: 'cell', kind: 'reveal', reason: 'hover' })
assert.equal(nextFloatState({ element: 'cell', kind: 'reveal', reason: 'hover' }, { type: 'hover-out', element: 'cell' }), null)

// THE case. A tap on a touch screen fires a synthetic mouseover on the
// tapped element immediately before the click. Handling hover and click
// independently means the panel opens on that synthetic mouseover and the
// click then toggles the very same panel shut -- one tap, no reveal, which
// is precisely the "nothing on touch" bug this lane is fixing. A click on
// an element already open by hover must UPGRADE the reason, not close.
const afterSyntheticHover = nextFloatState(null, hoverIn)
const afterTap = nextFloatState(afterSyntheticHover, click)
assert.deepEqual(afterTap, { element: 'cell', kind: 'reveal', reason: 'click' }, 'a tap must leave the panel OPEN')

// ...and the mouseout that follows when the finger next lands elsewhere
// must not close it either.
assert.deepEqual(
  nextFloatState(afterTap, { type: 'hover-out', element: 'cell' }),
  afterTap,
  'only hover closes what hover opened',
)

// A second deliberate click still closes it.
assert.equal(nextFloatState(afterTap, click), null)

// Moving to a different cell moves the one panel.
assert.deepEqual(
  nextFloatState(afterTap, { type: 'hover-in', element: 'other', kind: 'reveal' }),
  { element: 'other', kind: 'reveal', reason: 'hover' },
)

/* ---------------------------------------------------------------- *
 * 2. Placement — the geometry the per-cell tooltip used, unchanged.
 * ---------------------------------------------------------------- */

const viewport = { innerWidth: 1280, innerHeight: 800 }
const below = placeFloat({ left: 400, top: 100, bottom: 118 }, viewport)
assert.equal(below.placement, 'below')
assert.equal(below.top, 124, 'panel sits 6px under the trigger')
assert.equal(below.left, 400)
assert.equal(below.width, 288, 'capped at 288px on a wide viewport')

// No room under a trigger near the bottom: flip above.
const above = placeFloat({ left: 400, top: 700, bottom: 780 }, viewport)
assert.equal(above.placement, 'above', 'a trigger 20px off the bottom must open upwards')

// Narrow phone: the panel shrinks to the viewport minus two 8px gutters,
// and a trigger at the right edge pulls it back inside instead of
// overflowing the screen.
const phone = placeFloat({ left: 300, top: 200, bottom: 216 }, { innerWidth: 280, innerHeight: 640 })
assert.equal(phone.width, 264, '280 minus two 8px gutters')
assert.equal(phone.left, 8, 'a trigger at the right edge pulls the panel back inside')
// A 320px phone is still wide enough for the full 288px cap, and the panel
// is then offset to stay in the gutter rather than clipped.
const phone320 = placeFloat({ left: 300, top: 200, bottom: 216 }, { innerWidth: 320, innerHeight: 640 })
assert.equal(phone320.width, 288)
assert.equal(phone320.left, 24)

/* ---------------------------------------------------------------- *
 * 3. One implementation, and what it covers.
 * ---------------------------------------------------------------- */

const truncated = read('components/shared/TruncatedText.tsx')
const controller = read('components/shared/textAffordances.ts')

assert.match(truncated, /ensureTextAffordances\(\)/, 'TruncatedText mounts the delegated controller')
assert.match(truncated, /dense-cell-truncate/, 'TruncatedText renders the same cell contract the delegated handler matches')
assert.ok(truncated.includes(`[REVEAL_ATTR]: text`), 'TruncatedText opts its span in explicitly')
assert.doesNotMatch(truncated, /createPortal/, 'TruncatedText must no longer render a tooltip of its own')
assert.equal(REVEAL_ATTR, 'data-reveal-text')
assert.ok(REVEAL_SELECTOR.includes('.dense-cell-truncate[title]'), 'the delegated selector reaches untouched dense cells')

// Shared clipping rule: a cell that fits stays a plain cell, so the row's
// own click still opens the row.
assert.equal(isClipped({ scrollWidth: 100, clientWidth: 100 }), false)
assert.equal(isClipped({ scrollWidth: 140, clientWidth: 100 }), true)

// A label that already fits carries no native tooltip repeating itself.
assert.ok(truncated.includes('title={clipped ? text : undefined}'), 'only a clipped label gets a title')

/* ---------------------------------------------------------------- *
 * 4. Whose click is it.
 *
 * The delegated reveal reaches rows this lane never edited, and on the
 * dense surfaces those rows OPEN THE RECORD when clicked. Claiming that
 * click to show a tooltip would be a downgrade -- the detail view shows the
 * same value in full plus the rest of the record -- and it would be a
 * behaviour change inside four other lanes' files. So a clipped cell inside
 * a clickable ancestor reveals on hover only and lets the click through; a
 * clipped cell with nothing underneath it takes the click, which is the
 * user's Aug 31 "click or hover should show info" rule for the cells where
 * a click did nothing at all.
 * ---------------------------------------------------------------- */

assert.equal(claimsClick('reveal', true), false, 'a clickable row keeps its own click')
assert.equal(claimsClick('reveal', false), true, 'a cell with nothing underneath reveals on click')
// A copy field is explicitly opted in and its panel is the ONLY way to the
// value, so it takes the click wherever it sits.
assert.equal(claimsClick('copy', true), true)
assert.equal(claimsClick('copy', false), true)

// The marker the dense tables already use for "this row's click opens it",
// so the rule needs no new attribute on any file this lane does not own.
assert.ok(SURFACE_CLICK_SELECTOR.includes('[data-clickable="true"]'))
for (const native of ['a[href]', 'button', '[role="button"]']) {
  assert.ok(SURFACE_CLICK_SELECTOR.includes(native), `${native} owns its own click too`)
}
// It must be read from the trigger's PARENT: TruncatedText gives a clipped
// span role="button", so testing the element itself would make every
// TruncatedText defer to a surface that does not exist.
assert.match(controller, /element\.parentElement\?\.closest\(SURFACE_CLICK_SELECTOR\)/,
  'the clickable-ancestor test must start above the trigger')
// Every entry point obeys it -- the click, its keyboard equivalent, and the
// press that decides whether an already-open panel survives.
assert.equal((controller.match(/claimsClick\(found\.kind, insideClickableSurface\(found\.element\)\)/g) || []).length, 3,
  'click, keydown and the press check must share one ownership rule')

// A press the surface owns must also CLOSE a panel hover already opened --
// otherwise the detail view that press opens comes up underneath a float
// still floating on the z-1200 layer, pointing at a cell it has covered.
// Mouse and touch share the one rule.
assert.equal((controller.match(/if \(state && !pressWillOpenFloat\(found\)\) apply\(\{ type: 'dismiss' \}\)/g) || []).length, 2,
  'mousedown and touchstart must both drop a panel the surface is about to cover')

// Hover replaces a native `title` tooltip, which waits before it appears;
// opening instantly would flash a panel under the pointer for every cell
// crossed while sweeping a dense table.
assert.ok(HOVER_OPEN_DELAY_MS >= 300, 'hover must keep roughly the native tooltip dwell')
assert.match(controller, /setTimeout\(\(\) => \{\s*hoverTimer = null/, 'hover opens on a timer, not instantly')
assert.match(controller, /if \(intent\.type !== 'hover-in'\) cancelHover\(\)/,
  'a deliberate intent must cancel a pending hover, or the dwell re-opens what a click closed')

// The coverage the delegation buys: these four surfaces are owned by other
// lanes and were NOT edited, yet every one of them has titled dense cells
// that now reveal.
for (const file of [
  'components/products/StockChangeSection.tsx',
  'components/products/StockInSessionsSection.tsx',
  'components/returns/ReturnsListSurface.tsx',
  'components/fees/FeesPage.tsx',
]) {
  const source = read(file)
  const titled = (source.match(/dense-cell-truncate[^"]*"\s+title=/g) || []).length
  assert.ok(titled > 0, `${file} must still have titled dense cells for the delegated reveal to serve`)
  // ...and every one of them opens its record on a row click, which is the
  // reason the reveal must not take that click.
  assert.match(source, /data-clickable="true"/, `${file} rows open a record on click`)
  assert.doesNotMatch(source, /TruncatedText/, `${file} must gain the reveal with no edit of its own`)
}

// The panel is styled where it is built -- plain DOM on document.body, so a
// surface that imports nothing from this lane still gets a themed float.
const css = read('styles/main.css')
for (const token of ['.text-affordance-float', '.text-affordance-value', '.text-affordance-copy', '[data-copy-value]']) {
  assert.ok(css.includes(token), `main.css must style ${token}`)
}
assert.ok(css.includes('.text-affordance-float[hidden]'), 'the closed panel must beat the display:flex rule explicitly')
assert.match(css, /\.dark \.text-affordance-float/, 'the float must be themed in dark mode')
assert.match(controller, /document\.body\.appendChild\(host\)/, 'one body-level host, created by the controller itself')

console.log('PASS one delegated reveal serves every truncated cell, without taking a click the surface owns')

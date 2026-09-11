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
  TITLE_PARK_ATTR,
  claimsClick,
  ensureTextAffordances,
  isClipped,
  nextFloatState,
  placeFloat,
} from '../src/components/shared/textAffordances.ts'
import { LONG_PRESS_THRESHOLD_MS } from '../src/utils/longPress.ts'
import { buildClickableRow, installAffordanceDom, wait, type StubElement } from './affordanceDomStub.ts'

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
// A copy field obeys the same rule, and for the same reason: on the
// Products list it sits inside a row whose click toggles selection, so
// claiming that click would delete an affordance rather than add one.
// It answers double-click / press-and-hold there instead.
assert.equal(claimsClick('copy', true), false)
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
  // ...and every row that can open its record advertises that capability,
  // which is the reason the reveal must not take that click. Fee rows also
  // open read-only detail for viewers; edit permission is checked inside it.
  if (file === 'components/fees/FeesPage.tsx') {
    assert.match(source, /data-clickable="true" tabIndex=\{0\} onClick=\{\(\) => openDetail\(fee\)\}/,
      'fee rows open read-only detail for viewers with keyboard access')
    assert.match(source, /const openDetail = \(fee:[^]*?setModal\('detail'\)/,
      'row activation opens detail, not an editable form')
    assert.match(source, /const openEdit = \(fee:[^]*?if \(canEditFeeRef.current\)/,
      'the fee row action must remain guarded by actual edit capability')
  } else {
    assert.match(source, /data-clickable="true"/, `${file} rows open a record on click`)
  }
  assert.doesNotMatch(source, /TruncatedText/, `${file} must gain the reveal with no edit of its own`)
}

// ...and the assertions above prove only that the MARKUP is there. Nothing
// serves it unless the singleton has been installed on that route, and for a
// round it had not been: the only mount points were CopyFloat (Products,
// both product detail modals) and TruncatedText, whose sole consumer
// (StatsStrip) renders inside a modal Returns and Fees never open -- so
// exactly the surfaces this delegation exists for had a `title` and no
// reveal. The shell mounts it instead, once, for every route there is.
const shell = read('App.tsx')
assert.match(shell, /import \{ ensureTextAffordances \} from '\.\/components\/shared\/textAffordances\.ts'/,
  'the app shell must import the one controller')
assert.match(shell, /useEffect\(\(\) => \{ ensureTextAffordances\(\{ copy: t\('copy'\), copied: t\('copied'\) \}\) \}, \[t\]\)/,
  'the app shell must install it on mount, with the panel labels in the current language')

// The panel is styled where it is built -- plain DOM on document.body, so a
// surface that imports nothing from this lane still gets a themed float.
const css = read('styles/main.css')
for (const token of ['.text-affordance-float', '.text-affordance-value', '.text-affordance-copy', '[data-copy-value]']) {
  assert.ok(css.includes(token), `main.css must style ${token}`)
}
assert.ok(css.includes('.text-affordance-float[hidden]'), 'the closed panel must beat the display:flex rule explicitly')
// Press-and-hold on a clipped dense cell is now this panel's gesture on
// touch, so iOS must not raise its own selection callout over it -- the same
// suppression the copy trigger already carries.
for (const trigger of ['[data-copy-value]', '.dense-cell-truncate']) {
  const rule = css.split('\n').find((line) => line.startsWith(`${trigger} {`)) || ''
  assert.match(rule, /-webkit-touch-callout:\s*none/, `${trigger} must suppress the iOS long-press callout`)
}
assert.match(css, /\.dark \.text-affordance-float/, 'the float must be themed in dark mode')
assert.match(controller, /document\.body\.appendChild\(host\)/, 'one body-level host, created by the controller itself')

/* ---------------------------------------------------------------- *
 * 5. The controller, driven for real.
 *
 * Everything above this line reads source text or calls the pure core, and
 * neither can see the defect this section exists for. `parkTitle` REMOVES
 * the `title` attribute while the panel is open -- and `title` is the only
 * thing a plain `.dense-cell-truncate` cell matches REVEAL_SELECTOR on. So
 * from the instant the float opened, that cell resolved to NO affordance
 * target: `mouseout` returned early and the panel never closed on
 * hover-out, and a re-hover was just as dead. The fix keeps the parked cell
 * matchable (`.dense-cell-truncate[${TITLE_PARK_ATTR}]` is part of the
 * selector). Comparing against the open element inside the mouseout handler
 * would have closed the panel while leaving that cell invisible to every
 * OTHER listener, which is the same bug with one symptom hidden.
 *
 * A `data-reveal-text` span -- an opt-in parking cannot touch -- runs the
 * identical sequence as a POSITIVE CONTROL, so a broken harness cannot
 * report both halves green.
 * ---------------------------------------------------------------- */

const dom = installAffordanceDom()
ensureTextAffordances()
const host = dom.host()
if (!host) throw new Error('the controller must build its own body-level host')

const outside = dom.el('div')
dom.body.append(outside)

const hoverThenLeave = async (cell: StubElement) => {
  dom.fire('mouseover', { target: cell })
  await wait(HOVER_OPEN_DELAY_MS + 60)
  const opened = host.hidden === false
  const shown = String(host.childNodes[0]?.textContent || '')
  dom.fire('mouseout', { target: cell, relatedTarget: outside })
  return { opened, shown, closed: host.hidden === true }
}

// Control: opts in through `data-reveal-text`, which parking never touches.
const controlCell = dom.el('span', { [REVEAL_ATTR]: 'Supplier name far too long for its column' }, { scrollWidth: 240, clientWidth: 90 })
buildClickableRow(dom, controlCell)
const control = await hoverThenLeave(controlCell)
assert.equal(control.opened, true, 'control: hover opens the one panel')
assert.equal(control.shown, 'Supplier name far too long for its column', 'control: the panel shows the full value')
assert.equal(control.closed, true, 'control: hover-out closes it')

// The case: a dense cell whose ONLY opt-in is the `title` the panel parks.
const denseTitle = 'Warehouse -> Shop, damaged carton returned'
const denseCell = dom.el('span', { class: 'dense-cell-truncate', title: denseTitle }, { scrollWidth: 260, clientWidth: 80 })
buildClickableRow(dom, denseCell)
const dense = await hoverThenLeave(denseCell)
assert.equal(dense.opened, true, 'a titled dense cell opens on hover')
assert.equal(dense.shown, denseTitle, 'and shows the value its native tooltip used to')
assert.equal(dense.closed, true, 'and it must CLOSE on hover-out -- parking its title must not make it unmatchable')
assert.equal(denseCell.getAttribute('title'), denseTitle, 'the native title comes back once the panel is closed')
assert.equal(denseCell.getAttribute(TITLE_PARK_ATTR), null, 'and the parking slot is cleared')

// Re-hovering the same cell has to work too -- the failure mode was not
// "the close is missing", it was "this element stopped matching", which
// takes every later event on it with it.
const again = await hoverThenLeave(denseCell)
assert.equal(again.opened, true, 're-hovering the same cell opens it again')
assert.equal(again.closed, true, 'and it closes again')

/* ---------------------------------------------------------------- *
 * 5b. A pending hover must not outlive the tap that declined it.
 *
 * `cancelHover()` was reachable only through `apply()`, and the three
 * paths a tap on a dense row actually takes never call it: `mousedown`
 * returns without applying anything when the surface owns the press, the
 * `click` handler returns early the moment `claimsClick` says the row
 * keeps its click, and `touchstart` does the same. So the synthetic
 * mouseover every tap fires armed a 450ms timer that nothing disarmed,
 * and the panel opened a third of a second later ON TOP of the record the
 * tap had just opened -- pointing at a cell that view now covers.
 *
 * Hover itself must survive: an actual dwell still opens the panel, which
 * is the control this section leads with.
 * ---------------------------------------------------------------- */

const tapCell = dom.el('span', { class: 'dense-cell-truncate', title: 'Shop -> Warehouse, wrong size returned' }, { scrollWidth: 260, clientWidth: 80 })
buildClickableRow(dom, tapCell)

// Control: a real dwell, with no tap, still reveals.
dom.fire('mouseover', { target: tapCell })
await wait(HOVER_OPEN_DELAY_MS + 80)
assert.equal(host.hidden, false, 'control: hovering a clipped dense cell still opens the panel')
dom.fire('keydown', { key: 'Escape' })
assert.equal(host.hidden, true)

// The real order a finger produces on a touch screen: touchstart,
// touchend, then the synthetic mouseover/mousedown/mouseup/click pair the
// browser replays before the row's own handler runs.
dom.fire('touchstart', { target: tapCell, touches: [{ clientX: 30, clientY: 90 }] })
dom.fire('touchend', { target: tapCell })
dom.fire('mouseover', { target: tapCell })
dom.fire('mousedown', { target: tapCell, clientX: 30, clientY: 90 })
dom.fire('mouseup', { target: tapCell })
const tapClick = dom.fire('click', { target: tapCell })
assert.equal(tapClick.stopped, false, 'the row keeps the click that opens its record')
await wait(HOVER_OPEN_DELAY_MS + 80)
assert.equal(host.hidden, true, 'and no panel arrives afterwards, over the record that tap opened')

// A click with no press in front of it -- a keyboard activation, or any
// programmatic .click() -- has to disarm the dwell too, because the click
// handler is then the only path that sees the gesture at all.
dom.fire('mouseover', { target: tapCell })
const bareClick = dom.fire('click', { target: tapCell })
assert.equal(bareClick.stopped, false, 'still the row\u2019s click')
await wait(HOVER_OPEN_DELAY_MS + 80)
assert.equal(host.hidden, true, 'a declined click disarms the hover it declined')

// ...and each of the three entry points has to disarm it ON ITS OWN, or the
// gesture that skips the others carries the timer through.
//
// A press that turns into a drag never produces a click at all (text
// selection, a flick on a trackpad), so `mousedown` is the only path that
// sees it.
dom.fire('mouseover', { target: tapCell })
dom.fire('mousedown', { target: tapCell, clientX: 30, clientY: 90 })
await wait(HOVER_OPEN_DELAY_MS + 80)
assert.equal(host.hidden, true, 'a press disarms the dwell even when no click follows it')

// And on a hybrid machine the pointer can be resting on a cell -- dwell
// armed -- while the finger lands somewhere else entirely. No mouseout, no
// click on the hovered cell: `touchstart` is the only path that sees THAT.
dom.fire('mouseover', { target: tapCell })
dom.fire('touchstart', { target: outside, touches: [{ clientX: 5, clientY: 5 }] })
await wait(HOVER_OPEN_DELAY_MS + 80)
assert.equal(host.hidden, true, 'a touch elsewhere disarms a dwell the pointer left pending')

/* ---------------------------------------------------------------- *
 * 5c. The touch reveal -- the gap this lane opens with.
 *
 * `.dense-cell-truncate` cells reveal their full value through the native
 * `title`, which is a hover tooltip: nothing at all on a phone, where the
 * ellipsis is a dead end. Hover fixed that for a mouse only; the four
 * dense surfaces still had NO way to see a clipped value on touch.
 *
 * The controller already owns the one gesture a touch screen has spare --
 * press-and-hold -- it was just fenced to copy in two places: the press
 * was armed only for `kind === 'copy'`, and `onLongPress` hardcoded that
 * kind when it fired. Opening the same panel for a clipped cell needs no
 * edit to any of those four lanes' files.
 *
 * It takes the HOLD, never the tap: the tap still opens the record (5b),
 * exactly the trade already accepted for copy on touch.
 * ---------------------------------------------------------------- */

const holdCell = dom.el('span', { class: 'dense-cell-truncate', title: 'Return #20260904-141233, damaged carton, 3 units' }, { scrollWidth: 280, clientWidth: 90 })
const holdRow = buildClickableRow(dom, holdCell)
const holdStart = dom.fire('touchstart', { target: holdCell, touches: [{ clientX: 40, clientY: 120 }] })
assert.equal(holdStart.stopped, true, 'the hold on a clipped cell is the reveal\u2019s, so the row does not also start one')
await wait(LONG_PRESS_THRESHOLD_MS + 80)
assert.equal(host.hidden, false, 'press-and-hold reveals a clipped dense cell on touch')
assert.equal(
  String(host.childNodes[0]?.textContent || ''),
  'Return #20260904-141233, damaged carton, 3 units',
  'and it shows the value the native title used to, in full',
)
const holdEnd = dom.fire('touchend', { target: holdCell })
assert.equal(holdEnd.stopped, true, 'the release that ends a fired hold does not also open the record')
dom.fire('keydown', { key: 'Escape' })
assert.equal(host.hidden, true)

// Control: a dense cell in the same row whose text FITS is a plain cell.
// It carries no title, nothing is hidden, and a hold there must reach the
// row's own detector (select mode) untouched.
const fitsCell = dom.el('span', { class: 'dense-cell-truncate' }, { scrollWidth: 80, clientWidth: 90 })
const fitsWrap = dom.el('td')
fitsWrap.append(fitsCell)
holdRow.append(fitsWrap)
const fitsStart = dom.fire('touchstart', { target: fitsCell, touches: [{ clientX: 40, clientY: 120 }] })
assert.equal(fitsStart.stopped, false, 'control: an un-clipped cell keeps the row every touch it had')
await wait(LONG_PRESS_THRESHOLD_MS + 80)
assert.equal(host.hidden, true, 'control: and holding it reveals nothing, because nothing is hidden')

dom.restore()

console.log('PASS one delegated reveal serves every truncated cell, without taking a click the surface owns')

// Copy float — a product's NAME, BRAND, SUPPLIER and BARCODE are copyable.
//
// At 6e3abfea nothing in the app copied any of the four. `git grep -n
// 'onDoubleClick|dblclick' -- frontend/src` returned three hits and all
// three were something else (two layout resets in POS.tsx, a lightbox
// zoom); the only clipboard writes were ids (CopyableId), files, the share
// link, the password manager, and ONE bespoke plain-click button on the
// barcode row of products/surfaces/ProductDetailModal.tsx. No surface
// offered double-click or long-press at all.
//
// This pins the behaviour rule (which gesture opens/closes the one float),
// the wiring on the three surfaces this lane owns, and the fact that the
// bespoke barcode handler is GONE rather than left beside the shared one.
//
// Run: node tests/copyFloat.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  COPY_ATTR,
  COPY_SELECTOR,
  REVEAL_SELECTOR,
  claimsClick,
  ensureTextAffordances,
  isClipped,
  nextFloatState,
  resolveAffordanceTarget,
} from '../src/components/shared/textAffordances.ts'
import { LONG_PRESS_THRESHOLD_MS, createLongPressHandlers, createLongPressState } from '../src/utils/longPress.ts'
import { buildClickableRow, buildPlainBlock, installAffordanceDom, wait, type StubElement } from './affordanceDomStub.ts'

const read = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const controller = read('components/shared/textAffordances.ts')

/* ---------------------------------------------------------------- *
 * 1. Which affordance a gesture lands on.
 * ---------------------------------------------------------------- */

const fakeClosest = (matches: Record<string, string>) => (selector: string) => matches[selector] ?? null

// A copyable field that is ALSO clipped must offer exactly one panel, and it
// is the copy one -- otherwise the same element answers two gestures with
// two different floats.
assert.deepEqual(
  resolveAffordanceTarget(fakeClosest({ [COPY_SELECTOR]: 'copyEl', [REVEAL_SELECTOR]: 'revealEl' })),
  { element: 'copyEl', kind: 'copy' },
  'copy wins over reveal on an element that is both',
)
assert.deepEqual(
  resolveAffordanceTarget(fakeClosest({ [REVEAL_SELECTOR]: 'revealEl' })),
  { element: 'revealEl', kind: 'reveal' },
)
assert.equal(resolveAffordanceTarget(fakeClosest({})), null, 'ordinary text carries no affordance')

/* ---------------------------------------------------------------- *
 * 2. The open/close rule.
 * ---------------------------------------------------------------- */

const gesture = { type: 'gesture', element: 'a', kind: 'copy' } as const

assert.deepEqual(
  nextFloatState(null, gesture),
  { element: 'a', kind: 'copy', reason: 'gesture' },
  'double-click / long-press opens the copy float',
)

// The failure this rule exists for: a tap on a touch screen fires a
// SYNTHETIC mouseover on the pressed element and, when the finger next
// lands elsewhere, a synthetic mouseout. Closing on any hover-out would
// shut the panel the long-press just opened.
assert.deepEqual(
  nextFloatState({ element: 'a', kind: 'copy', reason: 'gesture' }, { type: 'hover-out', element: 'a' }),
  { element: 'a', kind: 'copy', reason: 'gesture' },
  'a synthetic mouseout must not close a panel the gesture opened',
)

// Re-pressing the same field re-opens rather than toggling shut: the
// gesture is deliberate every time, so it must never be the thing that
// dismisses the panel it just produced.
assert.deepEqual(
  nextFloatState({ element: 'a', kind: 'copy', reason: 'gesture' }, gesture),
  { element: 'a', kind: 'copy', reason: 'gesture' },
)

assert.equal(
  nextFloatState({ element: 'a', kind: 'copy', reason: 'gesture' }, { type: 'dismiss' }),
  null,
  'Escape or an outside press closes it',
)

// One float: pressing a second field moves the panel instead of stacking.
assert.deepEqual(
  nextFloatState({ element: 'a', kind: 'copy', reason: 'gesture' }, { type: 'gesture', element: 'b', kind: 'copy' }),
  { element: 'b', kind: 'copy', reason: 'gesture' },
)

// Where nothing underneath wants the click, a plain click opens the panel.
assert.deepEqual(
  nextFloatState(null, { type: 'click', element: 'value', kind: 'copy' }),
  { element: 'value', kind: 'copy', reason: 'click' },
)

// ONE ownership rule, both kinds: an affordance takes the click only where
// nothing underneath wanted it. A copy field is NOT an exception. On the
// Products list the copyable values sit inside the product row, and that
// row's click toggles selection while select mode is active (Products.tsx
// renderDesktopProductRow / renderMobileProductCard) -- a copy field that
// claims it does not add an affordance, it deletes one, exactly wherever a
// copyable value happens to be drawn.
assert.equal(claimsClick('copy', true), false, 'a copy field inside a clickable row leaves that row its click')
assert.equal(claimsClick('copy', false), true, 'with nothing underneath, a plain click opens the panel')
assert.equal(claimsClick('reveal', true), false, 'a reveal defers to the row that opens the record')

// Shared clipping rule (also used by the reveal half).
assert.equal(isClipped({ scrollWidth: 101, clientWidth: 100 }), false, '1px is sub-pixel rounding, not a clip')
assert.equal(isClipped({ scrollWidth: 102, clientWidth: 100 }), true)

/* ---------------------------------------------------------------- *
 * 3. The wiring, on every surface this lane owns.
 * ---------------------------------------------------------------- */

const hook = read('components/shared/CopyFloat.tsx')
const rowParts = read('components/products/surfaces/ProductRowParts.tsx')
const productsModal = read('components/products/surfaces/ProductDetailModal.tsx')
const inventoryModal = read('components/inventory/ProductDetailModal.tsx')

assert.equal(COPY_ATTR, 'data-copy-value')
assert.match(hook, /ensureTextAffordances\(labels\)/, 'the hook mounts the one shared controller')
assert.ok(hook.includes('[COPY_ATTR]: text'), 'the hook marks its target with the copy attribute')

assert.match(rowParts, /import \{ useCopyFloat \} from '\.\.\/\.\.\/shared\/CopyFloat\.tsx'/)
assert.ok(rowParts.includes('{...copy(product.supplier)}'), 'Products list supplier pill is copyable')

// The ownership rule only bites if the row DECLARES that its click is the
// point of the surface. Both product rows now carry the same marker the
// dense tables use -- the desktop row AND the mobile card, or a touch user
// loses selection wherever a copyable value happens to be drawn.
const productsPage = read('components/products/Products.tsx')
assert.equal(
  (productsPage.match(/data-clickable="true"/g) || []).length,
  2,
  'both the desktop product row and the mobile product card must declare their own click',
)

// "CopyFloat on the Products list" is all FOUR fields, on BOTH row shapes.
// ProductRowParts renders only the supplier pill; the name, brand and
// barcode are drawn by Products.tsx itself, and renderMobileProductCard
// renders no ProductDetailsCell at all -- so a touch user would get nothing
// on this page unless the card is wired too.
assert.match(productsPage, /const copy = useCopyFloat\(tr\)/,
  'the hook is called ONCE at the top level, never inside the per-row map')
assert.equal(
  (productsPage.match(/\{\.\.\.copy\(productName\)\}/g) || []).length,
  2,
  'the product name is copyable on the desktop row AND on the mobile card',
)
assert.ok(productsPage.includes('{...copy(item?.label)}'), 'the desktop meta line carries the affordance')
assert.match(productsPage, /metaKey !== 'barcode' && metaKey !== 'brand'/,
  'exactly barcode and brand opt in there -- category and SKU are not product fields the user copies')
assert.ok(productsPage.includes('{...copy(barcode)}'), 'the mobile card barcode chip is copyable')
assert.ok(productsPage.includes('{...copy(brandName)}'), 'the mobile card brand chip is copyable')

for (const field of ['copy(productName)', 'copy(p.brand)', 'copy(p.barcode)', 'copy(p.supplier)']) {
  assert.ok(productsModal.includes(`{...${field}}`), `products detail modal must wire ${field}`)
}
for (const field of ['copy(p.name)', 'copy(p.brand)', 'copy(p.barcode)']) {
  assert.ok(inventoryModal.includes(`{...${field}}`), `inventory detail modal must wire ${field}`)
}
// Supplier renders through this modal's label/value row list, so its
// affordance is conditional on the row rather than spread inline.
assert.ok(
  inventoryModal.includes('{...(row.copyable ? copy(row.value) : {})}'),
  'inventory detail modal must wire the supplier row',
)
assert.ok(inventoryModal.includes('copyable: true'), 'exactly the supplier row opts in')
assert.equal((inventoryModal.match(/copyable: true/g) || []).length, 1, 'SKU and description are not copyable product fields')

// One implementation: the bespoke plain-click barcode copy is replaced, not
// duplicated, and the only clipboard write left in this lane's code is the
// shared float's own.
assert.doesNotMatch(productsModal, /copyBarcode/, 'the bespoke barcode copy handler must be gone, not orphaned')
assert.doesNotMatch(productsModal, /navigator\.clipboard/, 'the detail modal must not write the clipboard itself any more')
assert.equal(
  (controller.match(/clipboard\.writeText/g) || []).length,
  1,
  'exactly one clipboard write backs every copy affordance',
)

/* ---------------------------------------------------------------- *
 * 4. Both packs, and real Khmer.
 * ---------------------------------------------------------------- */

const en = JSON.parse(read('lang/en.json')) as Record<string, string>
const km = JSON.parse(read('lang/km.json')) as Record<string, string>
for (const key of ['copy', 'copied', 'copy_hint']) {
  assert.ok(en[key], `en.json must carry ${key}`)
  assert.ok(km[key], `km.json must carry ${key}`)
}
assert.doesNotMatch(km.copy_hint, /[A-Za-z]/, 'km.json copy_hint must be Khmer, not an English placeholder')

// English names two gestures; Khmer must name the same two, joined by ឬ
// ("or"): ចុចពីរដង (press twice) ឬ ចុចឱ្យជាប់ (press and hold) ដើម្បីចម្លង
// (to copy). Whether that promise is MADE on a given surface, and whether it
// is kept there, is driven for real in section 5 -- a source-text guard
// cannot see it, and the previous round shipped a hint that was true of the
// controller and false of the surface the ASK names.
assert.match(en.copy_hint, /double-click/i, 'the English hint names the double-click half')
assert.match(en.copy_hint, /\bhold\b/i, 'and the hold half')
assert.ok(km.copy_hint.includes('ឬ'), 'the Khmer hint offers two gestures, not one')
assert.ok(km.copy_hint.includes('ចុចពីរដង'), 'ចុចពីរដង -- press twice, the double-click half')
assert.ok(km.copy_hint.includes('ចុចឱ្យជាប់'), 'ចុចឱ្យជាប់ -- press and hold, the hold half')

// The hint is a POINTER affordance -- a native `title` is a hover tooltip,
// which a touch screen never shows -- so it must be attached only where the
// pointer gestures it names are actually the copy field's. CopyFloat.tsx
// therefore no longer writes a `title` at render time (it cannot know what
// its trigger will be dropped into); the controller attaches it from the
// same `pressWillOpenFloat` predicate that decides whose press it is.
assert.doesNotMatch(hook, /title: labels\.hint/,
  'the hook must not promise gestures before it knows whose surface the value lands on')
assert.match(hook, /hint: String\(t\('copy_hint'/, 'the hook still owns the translated hint')
assert.match(hook, /ensureTextAffordances\(labels\)/, 'and hands it to the one controller')

/* ---------------------------------------------------------------- *
 * 5. The ownership rule, driven for real.
 *
 * The assertion above says what `claimsClick` returns; this says what the
 * live event path does with it, which is the half that regressed. A copy
 * field inside a row that owns its own click must leave that click
 * completely alone -- not stopped, not defaulted -- while still answering
 * the gesture the row does NOT use.
 * ---------------------------------------------------------------- */

const dom = installAffordanceDom()
ensureTextAffordances({ copy: 'Copy', copied: 'Copied', hint: en.copy_hint })
const host = dom.host()
if (!host) throw new Error('the controller must build its own body-level host')

// The Products list: a copyable value inside the product row.
const pill = dom.el('span', { [COPY_ATTR]: 'Sok Heng Trading' })
buildClickableRow(dom, pill)
const rowClick = dom.fire('click', { target: pill })
assert.equal(rowClick.stopped, false, "a copy field must not swallow its row's click")
assert.equal(host.hidden, true, 'and it opens no panel on that click')

// ...and the PRESS is the half that actually matters on this row. Outside
// selection mode the product row's `onClick` is `undefined`: it spreads
// utils/longPress.ts's onMouseDown/onMouseUp instead (Products.tsx
// renderDesktopProductRow / renderMobileProductCard,
// `{...(selectionModeActive ? {} : longPress)}`), so a tap opens the product
// and a hold enters select mode, both synthesised from the press. Stopping
// mousedown/mouseup on a copy field deleted BOTH -- and the click assertion
// above stayed green the whole time, because the click was never where this
// row's behaviour lived.
const rowPress = dom.fire('mousedown', { target: pill })
assert.equal(rowPress.stopped, false, "a copy field must not swallow its row's mousedown")
const rowRelease = dom.fire('mouseup', { target: pill })
assert.equal(rowRelease.stopped, false, 'nor its mouseup')
assert.equal(host.hidden, true, 'and a press inside a row it does not own opens no panel')

// ...AND THE DOUBLE-CLICK IS NOT THE COPY FIELD'S EITHER, ON THIS SURFACE.
//
// It looked like it was, for a whole round, because a stub can deliver a
// `dblclick` to an element a real browser can no longer reach. Outside
// selection mode the product row has no onClick: it spreads
// utils/longPress.ts, so the FIRST press-release pair of a double-click
// already fired the row's own onClick -- Products.tsx `setDetailProduct(p)`
// -- and the product detail modal is over the row before the second click
// is dispatched. That second click lands on the modal, the `dblclick` never
// resolves a copy target, and no panel ever opens.
//
// So the pointer gestures on this surface are the row's, all three of them,
// and the affordance says so instead of promising one it cannot deliver.
// Driven against the row's REAL detector, the way the touch contract is:
// the row's own open must fire exactly as often as it would with no
// affordance present at all.
let rowOpened = 0
const listDetector = createLongPressState()
const listGestures = createLongPressHandlers(listDetector, {
  onLongPress: () => { /* select mode -- not what this counts */ },
  onClick: () => { rowOpened += 1 },
})
type ListMouse = Parameters<typeof listGestures.onMouseDown>[0]
const deliverToRow = (event: { type: string; stopped: boolean }): void => {
  if (event.stopped) return
  if (event.type === 'mousedown') listGestures.onMouseDown(event as unknown as ListMouse)
  else if (event.type === 'mouseup') listGestures.onMouseUp()
}
for (let n = 0; n < 2; n += 1) {
  deliverToRow(dom.fire('mousedown', { target: pill, clientX: 18, clientY: 44 }))
  deliverToRow(dom.fire('mouseup', { target: pill }))
  dom.fire('click', { target: pill })
}
const doubleClick = dom.fire('dblclick', { target: pill })
assert.equal(doubleClick.stopped, false, 'the row owns the double-click on this surface')
assert.equal(host.hidden, true, 'so no panel opens behind the detail modal the first click already opened')
assert.equal(rowOpened, 2, "and the row's own open fires for both clicks, exactly as it would with no affordance")

// THE PROMISE IS ONLY MADE WHERE IT IS KEPT.
//
// The hint is a native `title`, i.e. a hover tooltip, i.e. a pointer-only
// affordance. On this row every pointer gesture belongs to the row -- click
// opens the product, hold enters select mode, double-click is the two
// above -- so the trigger carries no hint at all. Touch still copies here
// (section 6), and a native title would never have shown there anyway.
dom.fire('mouseover', { target: pill })
assert.equal(pill.getAttribute('title'), null,
  'a copy field inside a surface that owns the pointer promises no pointer gesture')

// The two product detail modals: nothing underneath wants the click, so a
// plain click keeps opening the panel there.
const modalValue = dom.el('span', { [COPY_ATTR]: '8850123456789' })
buildPlainBlock(dom, modalValue)
// ...and THERE the hint is attached, because there both gestures it names
// are answered -- asserted below, gesture by gesture, against this very
// element.
dom.fire('mouseover', { target: modalValue })
assert.equal(modalValue.getAttribute('title'), en.copy_hint,
  'with nothing underneath, the copy field promises the gestures it owns')
const modalClick = dom.fire('click', { target: modalValue })
assert.equal(modalClick.stopped, true, 'with nothing underneath, the copy field takes the click')
assert.equal(host.hidden, false, 'and a plain click opens the panel in the detail modals')
assert.equal(String(host.childNodes[0]?.textContent || ''), '8850123456789')
dom.fire('keydown', { key: 'Escape' })
assert.equal(host.hidden, true)

// PRESS AND HOLD, on a pointer device.
//
// Every trigger carries the hint "Double-click or hold to copy" as its
// native title. `press.onMouseDown` existed in the controller but was never
// called -- only its parameter type was referenced -- so on a pointer device
// the hold half of that promise did nothing at all, while the mousedown
// handler swallowed the press that would otherwise have reached the surface
// underneath. Where the copy field owns the press (a detail modal, nothing
// clickable underneath) the hold must open the panel on its own, with no
// click involved.
const held = dom.el('span', { [COPY_ATTR]: 'Sok Heng Trading Co., Ltd.' })
buildPlainBlock(dom, held)
const holdPress = dom.fire('mousedown', { target: held, clientX: 40, clientY: 12 })
assert.equal(holdPress.stopped, true, 'with nothing underneath, the copy field takes the press')
await wait(LONG_PRESS_THRESHOLD_MS + 80)
assert.equal(host.hidden, false, 'press-and-hold opens the copy panel on a pointer device')
assert.equal(String(host.childNodes[0]?.textContent || ''), 'Sok Heng Trading Co., Ltd.')
dom.fire('mouseup', { target: held })
assert.equal(host.hidden, false, 'releasing the hold leaves the panel up')
dom.fire('keydown', { key: 'Escape' })
assert.equal(host.hidden, true)

// A release before the threshold is a click, not a hold: no gesture fires,
// and the panel opens through the ordinary click path instead.
dom.fire('mousedown', { target: held, clientX: 40, clientY: 12 })
dom.fire('mouseup', { target: held })
await wait(LONG_PRESS_THRESHOLD_MS + 80)
assert.equal(host.hidden, true, 'a released press must not open the panel later, on the hold timer')

// EVERY GESTURE THE HINT NAMES, ANSWERED ON THE ELEMENT THAT CARRIES IT.
// Read from the pack text rather than a hardcoded list, so re-wording the
// hint cannot quietly add a promise nothing keeps.
dom.fire('mouseover', { target: held })
const promised = String(held.getAttribute('title') || '')
assert.equal(promised, en.copy_hint, 'this trigger carries the hint')
assert.ok(/\bhold\b/i.test(promised), 'which names a hold -- proven above, on this same element')
assert.ok(/double-click/i.test(promised), 'and a double-click')
const heldDouble = dom.fire('dblclick', { target: held })
assert.equal(heldDouble.stopped, true, 'so the double-click is this field’s here')
assert.equal(host.hidden, false, 'and it opens the copy panel')
assert.equal(String(host.childNodes[0]?.textContent || ''), 'Sok Heng Trading Co., Ltd.')
dom.fire('keydown', { key: 'Escape' })
assert.equal(host.hidden, true)

/* ---------------------------------------------------------------- *
 * 6. Touch — the ONLY way to copy on a phone.
 *
 * The ASK names long-press as the mobile gesture, and until this section
 * existed nothing executed it: the two test files between them fired no
 * touch event at all, and `dom.fire('touchstart')` threw inside
 * longPress.ts, which reads `event.touches[0]`.
 * ---------------------------------------------------------------- */

// (a) A hold on a copy field opens the panel with that field's value --
// inside the product row, because that is where a phone user meets it.
const touchPill = dom.el('span', { [COPY_ATTR]: '8850123456789' })
const touchRow = buildClickableRow(dom, touchPill)
const touchPress = dom.fire('touchstart', { target: touchPill, touches: [{ clientX: 30, clientY: 90 }] })
assert.equal(touchPress.stopped, true, 'the copy field owns the hold on touch, or one hold would mean two things')
await wait(LONG_PRESS_THRESHOLD_MS + 80)
assert.equal(host.hidden, false, 'press-and-hold opens the copy panel on touch')
assert.equal(String(host.childNodes[0]?.textContent || ''), '8850123456789')
const heldRelease = dom.fire('touchend', { target: touchPill })
assert.equal(heldRelease.stopped, true, 'the release that ends a fired hold belongs to the copy field')
dom.fire('keydown', { key: 'Escape' })
assert.equal(host.hidden, true)

// A TAP on the same value is not a hold, and the row still owns it: the
// Products mobile card has no onClick outside selection mode and synthesises
// "open this product" from its own touchend, so swallowing the release would
// make tapping a copyable value do nothing at all.
dom.fire('touchstart', { target: touchPill, touches: [{ clientX: 30, clientY: 90 }] })
const tapRelease = dom.fire('touchend', { target: touchPill })
assert.equal(tapRelease.stopped, false, "a tap's release goes back to the row that opens the product")
await wait(LONG_PRESS_THRESHOLD_MS + 80)
assert.equal(host.hidden, true, 'and the released tap never opens the panel on the hold timer')

// (b) A non-copy target inside the same row is left completely alone, so
// the row's own long-press (select mode) still works everywhere else on it.
const plainCell = dom.el('span')
const td = dom.el('td')
td.append(plainCell)
touchRow.append(td)
const rowTouch = dom.fire('touchstart', { target: plainCell, touches: [{ clientX: 30, clientY: 90 }] })
assert.equal(rowTouch.stopped, false, "the row keeps every touch this lane's affordance does not own")
await wait(LONG_PRESS_THRESHOLD_MS + 80)
assert.equal(host.hidden, true, 'and no panel opens for it')

// (c) THE CONTRACT, driven against the row's OWN detector.
//
// The assertions above read `event.stopped`, which is only half the story:
// the events the controller does NOT stop still have to add up to the right
// gesture once the row's handlers see them. Products.tsx spreads
// utils/longPress.ts on the mobile card outside selection mode, so "open
// this product" is synthesised by that detector from touchstart/touchmove/
// touchend -- not by an onClick.
//
// The bug that hid behind `stopped`: the controller swallowed touchstart on
// a copy field but let touchmove through. The row's detector, which never
// saw the start, still ran checkMove against its zeroed startX/startY, read
// the first 1px of finger jitter as a drag past the 18px tolerance, and
// cancelled -- so the release it did see fired nothing. A tap on a supplier
// pill, a brand chip or a product name simply did not open the product.
//
// So: build the real detector, hand it exactly the events the controller
// left alone, and count.
let opened = 0
const rowDetector = createLongPressState()
const rowGestures = createLongPressHandlers(rowDetector, {
  onLongPress: () => { /* select mode -- not what this counts */ },
  onClick: () => { opened += 1 },
})
type RowTouch = Parameters<typeof rowGestures.onTouchStart>[0]
const deliver = (event: { type: string; stopped: boolean }): void => {
  if (event.stopped) return
  if (event.type === 'touchstart') rowGestures.onTouchStart(event as unknown as RowTouch)
  else if (event.type === 'touchmove') rowGestures.onTouchMove(event as unknown as RowTouch)
  else if (event.type === 'touchend') rowGestures.onTouchEnd()
}
const gestureOn = (cell: StubElement, moveTo: { clientX: number; clientY: number }): number => {
  const before = opened
  deliver(dom.fire('touchstart', { target: cell, touches: [{ clientX: 30, clientY: 90 }] }))
  deliver(dom.fire('touchmove', { target: cell, touches: [moveTo] }))
  deliver(dom.fire('touchend', { target: cell }))
  return opened - before
}

const jitter = { clientX: 31, clientY: 90 }
const scroll = { clientX: 30, clientY: 290 }

const tapCell = dom.el('span', { [COPY_ATTR]: 'Sok Heng Trading' })
const scrollRow = buildClickableRow(dom, tapCell)
const plainTwin = dom.el('span')
const twinCell = dom.el('td')
twinCell.append(plainTwin)
scrollRow.append(twinCell)

assert.equal(gestureOn(tapCell, jitter), 1, 'a TAP on a copy field opens the record, exactly once')
assert.equal(gestureOn(tapCell, scroll), 0, 'a SCROLL that started on a copy field opens nothing')
// Positive control: an ordinary cell in the same row, through the same
// harness. A tap opens the record; a scroll opens nothing -- longPress.ts
// cancels a press that wandered, which is what keeps a flick through a list
// from opening whatever was under the finger. The copy field must read the
// SAME on both, which is the whole point: it adds a gesture, it removes none.
assert.equal(gestureOn(plainTwin, jitter), 1, 'control: a tap on a plain cell opens the record')
assert.equal(gestureOn(plainTwin, scroll), 0, 'control: a scroll opens nothing there either')
await wait(LONG_PRESS_THRESHOLD_MS + 80)
assert.equal(host.hidden, true, 'none of those four gestures was a hold, so no panel opened')

// (d) THE COMPATIBILITY MOUSE EVENTS A TOUCH LEAVES BEHIND.
//
// Every tap and hold on a touch screen is followed by a synthetic
// mousedown/mouseup/click on the same element -- that is how a page written
// for a mouse works on a phone at all. The controller swallows touchstart
// for the hold, so the row's detector never starts one; the compat
// mousedown then STARTED one on the row and the compat mouseup ended it,
// synthesising "open this product" behind the panel the hold had just
// opened -- while that same compat mousedown, seeing a copy field whose
// press it does not own, dismissed the panel on its way past. One hold: no
// panel, and the record opened.
//
// A gesture's own element keeps its panel, and the release the browser
// replays afterwards belongs to the gesture that produced it, not to the row.
let compatOpened = 0
const compatDetector = createLongPressState()
const compatGestures = createLongPressHandlers(compatDetector, {
  onLongPress: () => { /* select mode -- not what this counts */ },
  onClick: () => { compatOpened += 1 },
})
type RowMouse = Parameters<typeof compatGestures.onMouseDown>[0]
const deliverMouse = (event: { type: string; stopped: boolean }): void => {
  if (event.stopped) return
  if (event.type === 'mousedown') compatGestures.onMouseDown(event as unknown as RowMouse)
  else if (event.type === 'mouseup') compatGestures.onMouseUp()
}

const compatPill = dom.el('span', { [COPY_ATTR]: 'Chan Sophea Supply Co.' })
buildClickableRow(dom, compatPill)
dom.fire('touchstart', { target: compatPill, touches: [{ clientX: 22, clientY: 60 }] })
await wait(LONG_PRESS_THRESHOLD_MS + 80)
assert.equal(host.hidden, false, 'the hold opens the copy panel')
dom.fire('touchend', { target: compatPill })
deliverMouse(dom.fire('mousedown', { target: compatPill, clientX: 22, clientY: 60 }))
deliverMouse(dom.fire('mouseup', { target: compatPill }))
dom.fire('click', { target: compatPill })
assert.equal(host.hidden, false, 'the compat mouse events must not dismiss the panel the hold just opened')
assert.equal(String(host.childNodes[0]?.textContent || ''), 'Chan Sophea Supply Co.')
assert.equal(compatOpened, 0, 'and must not open the record behind it')
dom.fire('keydown', { key: 'Escape' })
assert.equal(host.hidden, true)

// ...and the guard is spent, not sticky: an ordinary pointer press on the
// same pill afterwards is the row's again, exactly as it was before.
deliverMouse(dom.fire('mousedown', { target: compatPill, clientX: 22, clientY: 60 }))
deliverMouse(dom.fire('mouseup', { target: compatPill }))
assert.equal(compatOpened, 1, 'a later pointer press on the same pill still opens the record')

dom.restore()

console.log('PASS product name/brand/supplier/barcode copy through one shared float')

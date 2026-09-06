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
import { LONG_PRESS_THRESHOLD_MS } from '../src/utils/longPress.ts'
import { buildClickableRow, buildPlainBlock, installAffordanceDom, wait } from './affordanceDomStub.ts'

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
ensureTextAffordances({ copy: 'Copy', copied: 'Copied' })
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

// ...but double-click, which no row uses, still copies. (Touch reaches the
// same panel through press-and-hold; both land on the one 'gesture' intent.)
const doubleClick = dom.fire('dblclick', { target: pill })
assert.equal(doubleClick.stopped, true, 'the copy field owns the double-click')
assert.equal(host.hidden, false, 'double-click opens the copy panel on the pill')
assert.equal(String(host.childNodes[0]?.textContent || ''), 'Sok Heng Trading')
dom.fire('keydown', { key: 'Escape' })
assert.equal(host.hidden, true, 'Escape closes it')

// The two product detail modals: nothing underneath wants the click, so a
// plain click keeps opening the panel there.
const modalValue = dom.el('span', { [COPY_ATTR]: '8850123456789' })
buildPlainBlock(dom, modalValue)
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

dom.restore()

console.log('PASS product name/brand/supplier/barcode copy through one shared float')

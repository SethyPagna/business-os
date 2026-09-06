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
  RAIL_GESTURE_IDLE,
  nearestRailKey,
  nextRailFocusKey,
  railFocusKey,
  railGestureStep,
  railIndexAtOffset,
  railPointerDownAction,
  railRendersThroughPortal,
  railStickyAlignSelf,
  railStickyTop,
  railTouchActionClass,
  resolveBrandJump,
  sortRailKeys,
} from '../src/utils/alphaRail.ts'
import type { RailGestureEvent } from '../src/utils/alphaRail.ts'

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

runTest('the hit-test follows the LETTER COLUMN, not the pill, when the column is taller than its box', () => {
  // The regression this pins: the expanded rail is capped (`max-h-[60vh]` on
  // the storefront, `max-h-[70vh]` on the admin sidebar variant) but its
  // entries are shrink-0, so past ~22 keys the column is taller than the
  // measured box. Splitting the CLAMPED box height into n slices then names a
  // letter several rows away from the finger.
  //
  // 28 entries at 21px + 17px of chrome = a 605px column inside a 400px box
  // (60vh of an 812px viewport). The 6th entry (index 5) spans column
  // y 105..126, so its middle is y 118.
  assert.equal(
    railIndexAtOffset(28, 118, 400, 0, 605),
    5,
    'a 605px column inside a 400px box: y=118 is the 6th entry, whatever the box was clamped to',
  )
  // Centred overflow (justify-center + -translate-y-1/2) puts the column's
  // top ABOVE the box top, so the first entries sit at negative offsets.
  assert.equal(
    railIndexAtOffset(28, 10, 400, -102, 605),
    5,
    'a column that overhangs the box top is measured from the column, not the box',
  )
  // Scrolled column: the offset the component passes is relative to the
  // rail's border box, and the column top moves with the scroll.
  assert.equal(railIndexAtOffset(28, 300, 400, -205, 605), 23, 'a scrolled column still maps 1:1 onto its entries')
  assert.equal(railIndexAtOffset(28, 900, 400, 0, 605), 27, 'dragging past the bottom of a tall column holds the last entry')
  assert.equal(railIndexAtOffset(28, -50, 400, 0, 605), 0, 'dragging past the top of a tall column holds the first entry')
  assert.equal(
    railIndexAtOffset(3, 45, 90, 0, 0),
    1,
    'an unmeasured column (no button rects on the first move) falls back to the box height rather than dying',
  )
})

// ---------------------------------------------------------------------------
// The collapsed TAP: opening the rail is not picking a letter
// ---------------------------------------------------------------------------

runTest('a touch press on a COLLAPSED rail opens it and picks nothing', () => {
  // The defect this pins, end to end: collapsed, the rail is a column of
  // ~2px dashes (h-0.5) inside a 60vh cap -- about 4.9px per entry for a
  // 27-letter facet. Touch has no hover, so the tap that a shopper means as
  // "show me the letters" WAS the tap that hit-tested those dashes, and the
  // key it landed on went straight out through onJump ->
  // updateInitialFilter(resolveBrandJump(...)): an essentially random brand
  // filter applied by the gesture that was only supposed to open the index.
  //
  // Discriminating on purpose: the old handlePointerDown called
  // jumpTo(keyAtPoint(...)) unconditionally, i.e. 'jump' for every one of
  // these four cases.
  assert.equal(railPointerDownAction(false, 'touch'), 'open', 'the first touch on a collapsed rail must only open it')
  assert.equal(railPointerDownAction(false, 'pen'), 'open', 'a pen has no hover either')
  assert.equal(railPointerDownAction(true, 'touch'), 'jump', 'once the letters are laid out at 20px, a tap picks one')
  assert.equal(railPointerDownAction(true, 'pen'), 'jump')
})

runTest('a mouse keeps press-to-jump, because it opened the rail before pressing (or never opens on hover at all)', () => {
  assert.equal(railPointerDownAction(false, 'mouse'), 'jump', 'taking this away costs the admin rails a click per jump')
  assert.equal(railPointerDownAction(true, 'mouse'), 'jump')
  assert.equal(railPointerDownAction(false, undefined), 'jump', 'a missing pointerType is the mouse default, as everywhere else in this component')
})

// Drives a whole pointer gesture through the reducer the component uses, and
// reports what the rail did: which effects fired, in order, and whether the
// rail is open at the end. `expanded` starts collapsed and follows the
// open/close effects, exactly as `dragging || stickyOpen` does in the
// component.
function runGesture(events: readonly RailGestureEvent[], startExpanded = false): { effects: string[]; expanded: boolean } {
  let state = RAIL_GESTURE_IDLE
  let expanded = startExpanded
  const effects: string[] = []
  for (const event of events) {
    const step = railGestureStep(state, event.type === 'down' ? { ...event, expanded } : event)
    state = step.state
    if (step.open) {
      effects.push('open')
      expanded = true
    }
    if (step.jump) effects.push('jump')
    if (step.close) {
      effects.push('close')
      expanded = false
    }
  }
  return { effects, expanded }
}

runTest('a swipe that starts on the collapsed rail emits nothing and leaves nothing open', () => {
  // The defect this pins, and why a distance threshold could not fix it: both
  // engines deliver the moves that exceed their pan slop BEFORE they claim the
  // gesture (iOS WebKit dispatches touchmoves through its ~10pt slop; Chrome
  // sends the move past its 8dp slop before GestureScrollBegin). So the
  // pointercancel that says "the page took this" arrives AFTER the move -- and
  // with a threshold of 8px that move had already emitted a brand filter and
  // cleared `openedOnly`, so the cancel no longer closed the rail.
  //
  // Discriminating on purpose: with the shipped 8px threshold this sequence
  // answered ['open', 'jump'] and stayed expanded.
  const swipe = runGesture([
    { type: 'down', expanded: false, pointerType: 'touch' },
    { type: 'move' },
    { type: 'cancel' },
  ])
  assert.deepEqual(swipe.effects, ['open', 'close'], 'an edge swipe must not apply a brand filter on its way past')
  assert.equal(swipe.expanded, false, 'and must not leave the index hanging over the page')

  // A longer drag is the same gesture, not a scrub that earned its way in.
  const longSwipe = runGesture([
    { type: 'down', expanded: false, pointerType: 'touch' },
    { type: 'move' },
    { type: 'move' },
    { type: 'move' },
    { type: 'cancel' },
  ])
  assert.deepEqual(longSwipe.effects, ['open', 'close'], 'distance travelled cannot promote an opening press into a scrub')
})

runTest('the press that only opened the rail never emits, however it ends', () => {
  const tap = runGesture([
    { type: 'down', expanded: false, pointerType: 'touch' },
    { type: 'move' },
    { type: 'up' },
  ])
  assert.deepEqual(tap.effects, ['open'], 'a tap with jitter opens the rail and picks nothing')
  assert.equal(tap.expanded, true, 'a completed tap leaves the letters open to aim at')

  const pen = runGesture([
    { type: 'down', expanded: false, pointerType: 'pen' },
    { type: 'move' },
    { type: 'cancel' },
  ])
  assert.deepEqual(pen.effects, ['open', 'close'], 'a pen has no hover either')
})

runTest('the second press, on the laid-out letters, is the one that picks and scrubs', () => {
  const openThenPick = runGesture([
    { type: 'down', expanded: false, pointerType: 'touch' },
    { type: 'up' },
    { type: 'down', expanded: true, pointerType: 'touch' },
    { type: 'move' },
    { type: 'move' },
    { type: 'up' },
  ])
  assert.deepEqual(
    openThenPick.effects,
    ['open', 'jump', 'jump', 'jump'],
    'once the rail is open a press picks a letter and the drag scrubs it',
  )

  // A mouse never loses press-to-jump: it either opened on hover already, or
  // (on the admin rails, which do not open on hover) has always opened and
  // jumped in one click.
  assert.deepEqual(
    runGesture([{ type: 'down', expanded: false, pointerType: 'mouse' }, { type: 'move' }, { type: 'up' }]).effects,
    ['jump', 'jump'],
    'taking press-to-jump away would cost the admin rails a click per jump',
  )
  // A cancelled MOUSE drag (the browser claiming it for a text selection, say)
  // must not collapse a rail the user opened deliberately.
  assert.equal(
    runGesture([{ type: 'down', expanded: true, pointerType: 'mouse' }, { type: 'cancel' }], true).expanded,
    true,
    'only the opening press is undone by a cancel',
  )
})

runTest('a stray pointermove outside any gesture emits nothing', () => {
  assert.equal(railGestureStep(RAIL_GESTURE_IDLE, { type: 'move' }).jump, false, 'pointer capture can deliver moves after the gesture ended')
  assert.deepEqual(railGestureStep(RAIL_GESTURE_IDLE, { type: 'cancel' }).close, false, 'and a cancel with nothing open must not close anything')
})

// ---------------------------------------------------------------------------
// The collapsed rail must not eat the page's scroll
// ---------------------------------------------------------------------------

runTest('touch suppression applies only while the rail is expanded', () => {
  // `touch-none` in EVERY state made the fixed ~20px strip over 60vh of the
  // right screen edge -- exactly where a thumb lands on a phone -- a dead
  // scroll zone, on the surface whose reported defect was "the page cannot
  // be scrolled".
  assert.equal(railTouchActionClass(true), 'touch-none', 'a scrub must not also pan the page')
  assert.notEqual(railTouchActionClass(false), 'touch-none', 'the collapsed rail must let the page scroll straight through it')
  assert.match(railTouchActionClass(false), /^touch-pan-y$/, 'vertical panning is what the page needs; the rail keeps the other axes')
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

runTest('the component wires the collapsed-tap and touch-action rules to the tested kernel', () => {
  // Every pointer phase must go through the ONE reducer above. Split rules
  // are how "this press only opened the rail" ended up true in the down
  // handler and false by the time the cancel arrived.
  const down = /const handlePointerDown = useCallback\(\(event[\s\S]*?\n  \}, \[/.exec(rail)
  assert.ok(down, 'handlePointerDown must stay one readable callback')
  assert.match(
    down![0],
    /railGestureStep\(gestureRef\.current, \{ type: 'down', expanded, pointerType \}\)/,
    'the first press of a gesture must ask the kernel what it is allowed to do',
  )
  assert.match(down![0], /if \(step\.jump\) jumpTo\(keyAtPoint\(/, 'and may only jump when the kernel says so')
  const move = /const handlePointerMove = useCallback\(\(event[\s\S]*?\n  \}, \[/.exec(rail)
  assert.ok(move, 'handlePointerMove must stay one readable callback')
  assert.match(move![0], /railGestureStep\(gestureRef\.current, \{ type: 'move' \}\)/, 'a move is a gesture phase, not its own rule')
  assert.match(move![0], /if \(!step\.jump\) return/, 'the opening press must not emit through the move handler either')
  assert.doesNotMatch(rail, /openedOnly = false/, 'nothing may clear openedOnly mid-gesture -- that is what disarmed the cancel')
  assert.match(rail, /\$\{railTouchActionClass\(expanded\)\}/, 'the container must take its touch-action from the kernel')
  // Letting the page scroll through the collapsed rail means a swipe that
  // starts on the right edge now reaches the rail's own pointerdown first.
  // Opening on that and never closing would leave the index hanging over the
  // page after every such swipe.
  assert.match(rail, /onPointerCancel=\{handlePointerCancel\}/, 'a gesture the browser turns into a page scroll needs its own ending')
  const cancel = /const handlePointerCancel = useCallback\(\(event[\s\S]*?\n  \}, \[/.exec(rail)
  assert.ok(cancel, 'handlePointerCancel must stay one readable callback')
  assert.match(
    cancel![0],
    /railGestureStep\(gestureRef\.current, \{ type: 'cancel' \}\)[\s\S]{0,200}if \(step\.close\) closeRail\(\)/,
    'a cancelled press that had only opened the rail must close it again',
  )
  const container = /className=\{`flex select-none flex-col[\s\S]*?\$\{className\}`\}/.exec(rail)
  assert.ok(container, "the rail container's className must stay one template literal")
  assert.doesNotMatch(container![0], /(?:^|[\s`])touch-none(?:[\s`]|$)/, 'a hardcoded touch-none is the dead scroll zone; it must be conditional')
})

runTest('the shared rail offers a screen-edge variant without moving the admin one', () => {
  assert.match(rail, /edge\?: 'sidebar' \| 'screen' \| 'inline'/, 'the storefront and preview edge positions must be an explicit opt-in union')
  assert.match(rail, /edge = 'sidebar'/, "the default must stay 'sidebar' so Products and POS keep sitting beside the admin sidebar")
  assert.match(rail, /md:left-\[228px\] md:right-auto/, 'the sidebar variant must keep its 220px offset')
  assert.match(rail, /env\(safe-area-inset-right\)/, 'the screen-edge variant must clear a notched right edge')
  assert.match(rail, /z-30/, 'the rail sits above the grid (z-20 sticky search) and below the pinned nav (z-40) and the list FAB (z-50)')
})

runTest('the rail hit-tests against its measured entries and can never spill outside its own pill', () => {
  assert.match(
    rail,
    /railIndexAtOffset\(\s*navKeys\.length,[\s\S]{0,160}?contentTop,\s*contentHeight,?\s*\)/,
    'the hit-test must be handed the measured letter column, not just the clamped box height',
  )
  assert.match(rail, /buttonRefs\.current\.get\(navKeys\[0\]\)/, 'the column top comes from the first entry\'s own rect')
  assert.match(
    rail,
    /buttonRefs\.current\.get\(navKeys\[navKeys\.length - 1\]\)/,
    "the column height comes from the last entry's own rect, so scroll and padding are already in it",
  )
  assert.match(rail, /overflow-y-auto/, 'a column taller than max-h must scroll inside the pill, not paint outside it')
  assert.match(rail, /overscroll-contain/, 'and scrolling it must not chain into the page behind it')
})

runTest('collapsed, the rail reads as DASHES -- not the round dots of the admin styling', () => {
  const entry = /expanded \? 'h-5 w-6[^']*' : '([^']+)'/.exec(rail)
  assert.ok(entry, 'the expanded/collapsed entry sizing must stay one readable ternary')
  const collapsed = entry![1]
  const height = Number(/(?:^|\s)h-([\d.]+)(?:\s|$)/.exec(collapsed)?.[1])
  const width = Number(/(?:^|\s)w-([\d.]+)(?:\s|$)/.exec(collapsed)?.[1])
  assert.ok(Number.isFinite(height) && Number.isFinite(width), `collapsed entries need an explicit h-/w- pair, got "${collapsed}"`)
  assert.ok(width >= height * 3, `the owner asked for a "dash dash" rail: collapsed entries must be far wider than tall, got "${collapsed}"`)
  const container = /expanded \? 'gap-\[1px\][^']*' : '([^']+)'/.exec(rail)
  assert.ok(container, 'the expanded/collapsed container spacing must stay one readable ternary')
  assert.doesNotMatch(container![1], /(?:^|\s)gap-0(?:\s|$)/, 'zero-gap dashes fuse into one solid bar -- the dashes need air between them')
})

runTest('the STOREFRONT rail renders through a portal, like every other float', () => {
  assert.match(rail, /createPortal\(railNode, document\.body\)/, 'a viewport-fixed float must not depend on its ancestors not clipping it')
  assert.match(rail, /typeof document === 'undefined'/, 'the portal needs a no-DOM guard')
  assert.match(rail, /if \(!railRendersThroughPortal\(edge\)\) return railNode/, 'and the escape hatch must be scoped to the mount that needs it')
})

runTest('the ADMIN rails stay in their own subtree, because a portal escapes display:none too', () => {
  // POS.tsx:2989 wraps the products pane (and the rail inside it) in
  // `${mobileView === 'cart' ? 'hidden md:flex' : 'flex'}`. That `display:
  // none` is what takes the fixed rail down with the pane when the cashier
  // switches to the mobile Cart tab -- portalled to <body> the rail escaped
  // it and floated on over the cart.
  //
  // Discriminating on purpose: the previous code portalled unconditionally,
  // i.e. answered true for all three of these.
  assert.equal(railRendersThroughPortal('screen'), true, 'the storefront shell is the one with the iOS fixed-descendant problem')
  assert.equal(railRendersThroughPortal('sidebar'), false, 'admin Products/POS ancestors are plain overflow containers -- no escape needed, and escaping costs them display')
  assert.equal(railRendersThroughPortal('inline'), false, 'the editor preview rail must stay inside the preview panel')
  assert.equal(railRendersThroughPortal(undefined), false, 'the default mount is the admin one')
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

runTest("hover-open is per-mount, and the admin's mid-content rail is not opted in", () => {
  // The sidebar variant is pinned at x=228px, immediately right of the admin
  // sidebar and INSIDE the content area: the cursor crosses it on the way to
  // the list many times a minute, and Products/POS have always opened it by
  // pressing. The storefront/preview rails sit at the outer right edge of
  // their own surface, where a crossing is a deliberate approach.
  assert.match(rail, /openOnHover\?: boolean/, 'hover-open must be an explicit per-mount capability')
  assert.match(rail, /const hoverOpens = openOnHover \?\? edge !== 'sidebar'/, 'the admin rails must not opt in by default')
  assert.match(rail, /if \(!hoverOpens\) return/, 'the enter handler has to honour it')
})

runTest('the storefront mounts the rail at the screen edge and passes the brand vocabulary', () => {
  assert.match(catalogProducts, /<AlphaIndexRail\b/, 'the storefront must use the shared rail, not a third copy of a letter list')
  assert.match(catalogProducts, /edge=\{publicView \? 'screen' : 'inline'\}/, 'the storefront rail rides the screen edge; the preview gets the in-flow variant')
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

runTest('the admin portal EDITOR PREVIEW gets a brand index too, not a carve-out', () => {
  // CatalogPage.tsx renders this same section with publicView={false} inside
  // its preview panel. Both letter lists were deleted for everyone, so gating
  // the replacement on `publicView && ...` left the preview with no brand
  // index at all -- an undisclosed sibling-surface carve-out.
  assert.doesNotMatch(
    catalogProducts,
    /\{publicView && initialOptions\.length > 1 \? \(/,
    'the rail must not be gated on publicView -- that is what emptied the editor preview',
  )
  assert.match(catalogProducts, /\{initialOptions\.length > 1 \? \(/, 'the only gate left is "is there more than one initial to index"')
  assert.match(
    catalogProducts,
    /className="relative lg:grid/,
    'the in-flow rail needs a positioned ancestor to stick inside',
  )
  // The preview variant must not be viewport-fixed and must not portal out of
  // the panel -- either one puts it over the admin's own chrome.
  assert.match(rail, /edge === 'inline'\s*\?\s*'relative max-h-\[60vh\]'/, "the inline variant must not be `fixed`")
  const inlineBranch = /if \(edge === 'inline'\) \{[\s\S]*?\n  \}/.exec(rail)
  assert.ok(inlineBranch, 'the inline variant needs its own render branch')
  assert.doesNotMatch(inlineBranch![0], /createPortal/, 'the preview rail must stay inside the preview panel')
  assert.match(inlineBranch![0], /pointer-events-none absolute inset-y-0 right-0/, 'its track must not swallow clicks on the product cards under it')
  assert.match(inlineBranch![0], /pointer-events-auto/, 'the rail itself still has to be operable')
})

runTest('the editor preview rail actually STICKS -- the shipped classes give it room to travel', () => {
  // `sticky top-24` on its own was a source line that read correct and behaved
  // wrong. The track is `flex`, so the wrapper inherited `align-self: stretch`
  // and was as tall as the whole 2400px grid; a sticky box that fills its
  // containing block has zero travel, so the rail scrolled away with the
  // products (measured railTop -435px after an 800px panel scroll) while a
  // /sticky top-24/ assertion kept passing. So this test derives the geometry
  // from the two class strings the component actually ships and asks where the
  // rail lands, rather than asking whether a word appears.
  const inlineBranch = /if \(edge === 'inline'\) \{[\s\S]*?\n  \}/.exec(rail)
  assert.ok(inlineBranch, 'the inline variant needs its own render branch')
  const trackClass = /<div className="((?:(?!").)*absolute inset-y-0(?:(?!").)*)"/.exec(inlineBranch![0])?.[1] ?? ''
  const stickyClass = /<div className="((?:(?!").)*sticky(?:(?!").)*)"/.exec(inlineBranch![0])?.[1] ?? ''
  assert.ok(trackClass && stickyClass, `both the track and the sticky wrapper need a readable className, got "${trackClass}" / "${stickyClass}"`)

  const offsetStep = Number(/(?:^|\s)top-(\d+)(?:\s|$)/.exec(stickyClass)?.[1])
  assert.ok(Number.isFinite(offsetStep), `the sticky wrapper needs a fixed top offset, got "${stickyClass}"`)
  const stickyOffset = offsetStep * 4 // Tailwind's 0.25rem step, at the 16px root

  const alignSelf = railStickyAlignSelf(trackClass, stickyClass)
  assert.equal(alignSelf, 'start', `a stretched flex child has no sticky travel; got "${stickyClass}" inside "${trackClass}"`)

  // A tall preview: 2400px of products, a 400px rail, the panel scrolled 800px.
  const geometry = { trackTop: 0, trackHeight: 2400, railHeight: 400, stickyOffset, scrollTop: 800 }
  assert.equal(
    railStickyTop({ ...geometry, alignSelf }),
    stickyOffset,
    'mid-scroll the rail must sit at the top of the preview scrollport, not follow the grid',
  )
  // The negative control is the shipped bug itself, so this test cannot pass
  // for the wrong reason: stretched, the same numbers put the rail 800px above
  // the scrollport -- off the panel entirely.
  assert.equal(
    railStickyTop({ ...geometry, alignSelf: 'stretch' }),
    -800,
    'a full-height wrapper cannot stick at all, whatever its top- offset says',
  )
  assert.equal(
    railStickyTop({ ...geometry, alignSelf, trackTop: 300, scrollTop: 0 }),
    300,
    'before the grid reaches the sticky line the rail sits at its natural place, beside the first row',
  )
  assert.equal(
    railStickyTop({ ...geometry, alignSelf, scrollTop: 2400 }),
    -400,
    'and it lets go at the end of the track rather than escaping the products it indexes',
  )
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

// Owner, 25 Sep 2026 (Products, large screens): the barcode / brand /
// category chips showed "visible scroll arrows and a scrollbar track". Chip
// scrolling must be invisible and built in -- no arrows, no track -- yet
// still reachable by wheel, touch and drag, on every screen size and every
// list that shares the scroller.
//
// Pinned here, each with a fixture that fails on the pre-fix shape:
//  - the shared `.detail-scroll-text` rule hides its bar (it asked for a
//    `thin` one, which Windows draws with stepper arrows);
//  - a mouse can drag any overflowing shared scroller, past the row's own
//    18px tap tolerance, and the click that ends a real drag is swallowed;
//  - a row's press detector treats a travelling mouse press as a drag, not a
//    tap, so dragging a chip does not also open the product.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDragScrollController, findDragScroller, type ScrollerLike } from '../src/runtime/horizontalDragScroll.ts'
import { createLongPressHandlers, createLongPressState, LONG_PRESS_MOVE_TOLERANCE_PX } from '../src/utils/longPress.ts'

if (typeof (globalThis as any).window === 'undefined') {
  ;(globalThis as any).window = globalThis
}

const here = path.dirname(fileURLToPath(import.meta.url))
const src = (relative: string) => fs.readFileSync(path.join(here, '..', 'src', relative), 'utf8')

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

function cssBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  assert.ok(start >= 0, `${selector} rule exists`)
  return css.slice(start, css.indexOf('}', start))
}

runTest('the shared chip scroller hides its scrollbar on every engine', () => {
  const css = src('styles/main.css')
  const rule = cssBlock(css, '.detail-scroll-text')
  assert.match(rule, /scrollbar-width:\s*none/, 'standards/Firefox bar hidden -- `thin` still draws arrows on Windows')
  assert.doesNotMatch(rule, /scrollbar-width:\s*thin/)
  assert.match(rule, /-ms-overflow-style:\s*none/)
  assert.match(rule, /overflow-x:\s*auto/, 'still a scroller: the overflow stays reachable')
  const bar = cssBlock(css, '.detail-scroll-text::-webkit-scrollbar')
  assert.match(bar, /display:\s*none/, 'WebKit/Blink bar hidden, not merely 3px tall')
})

// A fake element tree: scroller -> chip link -> text.
function scroller(scrollWidth: number, clientWidth: number, className: string, parent: ScrollerLike | null = null): ScrollerLike & { className: string } {
  const node: ScrollerLike & { className: string } = {
    className, scrollLeft: 0, scrollWidth, clientWidth, parentElement: parent,
    closest(selector) {
      const classes = selector.split(',').map((part) => part.trim().replace(/^\./, ''))
      for (let cursor: any = node; cursor; cursor = cursor.parentElement) {
        if (cursor.className && classes.some((name) => cursor.className.split(' ').includes(name))) return cursor
      }
      return null
    },
  }
  return node
}
function child(parent: ScrollerLike): ScrollerLike {
  const node: any = { className: '', scrollLeft: 0, scrollWidth: 0, clientWidth: 0, parentElement: parent }
  node.closest = (selector: string) => (parent.closest ? parent.closest(selector) : null)
  return node
}

runTest('findDragScroller picks the innermost shared scroller that actually overflows', () => {
  const outer = scroller(400, 200, 'scroll-x-clean')
  const fits = scroller(80, 80, 'detail-scroll-text', outer)
  assert.equal(findDragScroller(child(fits)), outer, 'a chip that fits hands the drag to the overflowing scroller around it')
  const overflowing = scroller(200, 80, 'detail-scroll-text', outer)
  assert.equal(findDragScroller(child(overflowing)), overflowing)
  assert.equal(findDragScroller(child(scroller(80, 80, 'detail-scroll-text'))), null, 'nothing to scroll, nothing grabbed')
  assert.equal(findDragScroller({ closest: () => null } as unknown as ScrollerLike), null)
})

runTest('a mouse drag scrolls the chip only past the tap tolerance, without a jump', () => {
  const chip = scroller(300, 80, 'detail-scroll-text')
  const drag = createDragScrollController()
  drag.down({ pointerType: 'mouse', button: 0, clientX: 100, target: child(chip) })
  assert.equal(drag.move({ clientX: 100 - LONG_PRESS_MOVE_TOLERANCE_PX }), false, 'within the tolerance it is still a tap')
  assert.equal(chip.scrollLeft, 0)
  assert.equal(drag.move({ clientX: 70 }), true, 'past it, it is a drag')
  assert.equal(chip.scrollLeft, 0, 're-anchored at the crossing, so no 18px lurch')
  drag.move({ clientX: 40 })
  assert.equal(chip.scrollLeft, 30, 'content follows the pointer')
  drag.up()
  assert.equal(drag.consumeClick(), true, 'the click that ends a real drag is swallowed (no link, no product sheet)')
  assert.equal(drag.consumeClick(), false, 'exactly once')
})

runTest('a plain click, touch, and a non-primary button are left alone', () => {
  const chip = scroller(300, 80, 'detail-scroll-text')
  const drag = createDragScrollController()
  drag.down({ pointerType: 'mouse', button: 0, clientX: 100, target: child(chip) })
  drag.move({ clientX: 105 })
  drag.up()
  assert.equal(drag.consumeClick(), false, 'a click is a click')

  drag.down({ pointerType: 'touch', clientX: 100, target: child(chip) })
  assert.equal(drag.move({ clientX: 20 }), false, 'touch pans natively')
  assert.equal(chip.scrollLeft, 0)

  drag.down({ pointerType: 'mouse', button: 2, clientX: 100, target: child(chip) })
  assert.equal(drag.move({ clientX: 20 }), false)
})

runTest('a drag whose click never came does not eat the next real click', () => {
  const chip = scroller(300, 80, 'detail-scroll-text')
  const drag = createDragScrollController()
  drag.down({ pointerType: 'mouse', button: 0, clientX: 100, target: child(chip) })
  drag.move({ clientX: 20 })
  drag.up()
  drag.down({ pointerType: 'mouse', button: 0, clientX: 10, target: null })
  drag.up()
  assert.equal(drag.consumeClick(), false)
})

runTest('a row press that travels past the tolerance is a drag, not a tap', () => {
  let opened = 0
  const state = createLongPressState()
  const row = createLongPressHandlers(state, { onLongPress: () => {}, onClick: () => { opened += 1 }, thresholdMs: 10_000 })
  const mouse = (x: number) => ({ clientX: x, clientY: 0 }) as unknown as React.MouseEvent
  row.onMouseDown(mouse(100))
  row.onMouseMove(mouse(100 - LONG_PRESS_MOVE_TOLERANCE_PX - 1))
  row.onMouseUp()
  assert.equal(opened, 0, 'dragging a chip in a row must not open the product (pre-fix: the row had no mouse move check)')

  row.onMouseDown(mouse(100))
  row.onMouseMove(mouse(105))
  row.onMouseUp()
  assert.equal(opened, 1, 'jitter inside the tolerance is still a tap')

  // A hover with no press pending changes nothing about the next press.
  row.onMouseMove(mouse(900))
  row.onMouseDown(mouse(900))
  row.onMouseUp()
  assert.equal(opened, 2)
})

runTest('the drag is installed app-wide, and the orphaned per-element drag is gone', () => {
  const index = src('index.tsx')
  assert.match(index, /import \{ installHorizontalDragScroll \} from '\.\/runtime\/horizontalDragScroll\.ts'/)
  assert.match(index, /\n\s*installHorizontalDragScroll\(\)/)
  assert.doesNotMatch(src('components/products/shared/primitives.tsx'), /function DragScrollText/)
})

if (failed) {
  console.error(`\n${failed} chip scroller test(s) failed`)
  process.exit(1)
}
console.log('PASS chipScrollerInvisible')

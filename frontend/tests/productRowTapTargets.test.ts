// Owner, 25 Sep 2026 (Products on a phone): "tapping the product name opens
// received date; tapping empty space opens records". Each region of a product
// row must open what it visibly represents.
//
// Two root causes, both pinned here with fixtures that tell the fixed code
// from the plausible wrong one:
//
//  1. utils/longPress.ts resolves a tap on TOUCHEND and opens the product
//     sheet synchronously. The browser's compatibility click for that tap is
//     hit-tested afterwards, on the sheet that now covers the finger -- its
//     "Received dates" row under a name, its records pills under empty card
//     space. The detector now cancels a touchend that it turned into a tap,
//     which is how a page tells the browser that a touch was handled.
//  2. shared/EntityLink.tsx stopped only the START of a press. The row's
//     detector opens the record on the RELEASE, so a link inside a row
//     opened both the link and the row's record. A link now owns its whole
//     press.
//
// And the product name is no longer a link at all: it opened a name search
// of the list the user was already looking at, the one region of the row
// that did something other than "open this product".
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLongPressHandlers, createLongPressState, tapLandsOnControl } from '../src/utils/longPress.ts'

if (typeof (globalThis as any).window === 'undefined') {
  ;(globalThis as any).window = globalThis
}

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.join(here, '..', 'src', relative), 'utf8')

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

function touch(x = 0, y = 0) {
  const event = { touches: [{ clientX: x, clientY: y }], cancelable: true, defaultPrevented: false, preventDefault() { event.defaultPrevented = true } }
  return event
}
const asTouch = (event: ReturnType<typeof touch>) => event as unknown as React.TouchEvent

runTest('a tap that opens something cancels its touchend, so no ghost click lands on what opened', () => {
  const state = createLongPressState()
  let opened = 0
  const handlers = createLongPressHandlers(state, { onLongPress: () => {}, onClick: () => { opened += 1 }, thresholdMs: 10_000 })
  handlers.onTouchStart(asTouch(touch(40, 40)))
  const end = touch(40, 40)
  handlers.onTouchEnd(asTouch(end))
  assert.equal(opened, 1)
  assert.equal(end.defaultPrevented, true, 'the pre-fix detector left the touchend alone and the browser clicked the new sheet')
})

runTest('a release that is NOT a tap leaves the browser its default (scrolls, holds, rows without a tap action)', () => {
  // A scroll: moved past the tolerance.
  const scrolled = createLongPressState()
  const scrolling = createLongPressHandlers(scrolled, { onLongPress: () => {}, onClick: () => { throw new Error('a scroll is not a tap') }, thresholdMs: 10_000 })
  scrolling.onTouchStart(asTouch(touch(0, 0)))
  scrolling.onTouchMove(asTouch(touch(0, 80)))
  const scrollEnd = touch(0, 80)
  scrolling.onTouchEnd(asTouch(scrollEnd))
  assert.equal(scrollEnd.defaultPrevented, false)

  // A hold that already fired.
  const held = createLongPressState()
  held.fired = true
  const holding = createLongPressHandlers(held, { onLongPress: () => {}, onClick: () => { throw new Error('a hold is not a tap') } })
  const holdEnd = touch()
  holding.onTouchEnd(asTouch(holdEnd))
  assert.equal(holdEnd.defaultPrevented, false)

  // A detector with no tap action (an over-eager fix would cancel every touchend).
  const bare = createLongPressHandlers(createLongPressState(), { onLongPress: () => {}, thresholdMs: 10_000 })
  bare.onTouchStart(asTouch(touch()))
  const bareEnd = touch()
  bare.onTouchEnd(asTouch(bareEnd))
  assert.equal(bareEnd.defaultPrevented, false)
})

// A tiny element tree: enough of closest()/contains() to model "a span inside
// a button inside a row" and "a span directly inside a row".
interface FakeEl { tag: string; role?: string; parent: FakeEl | null; closest(selector: string): FakeEl | null; contains(other: FakeEl): boolean }
function el(tag: string, parent: FakeEl | null, role?: string): FakeEl {
  const node: FakeEl = {
    tag, role, parent,
    closest(selector) {
      const tags = selector.split(',').map((part) => part.trim())
      for (let cursor: FakeEl | null = node; cursor; cursor = cursor.parent) {
        if (tags.includes(cursor.tag) || (cursor.role && tags.includes(`[role="${cursor.role}"]`))) return cursor
      }
      return null
    },
    contains(other) {
      for (let cursor: FakeEl | null = other; cursor; cursor = cursor.parent) if (cursor === node) return true
      return false
    },
  }
  return node
}
function tapOn(target: FakeEl, surface: FakeEl) {
  const handlers = createLongPressHandlers(createLongPressState(), { onLongPress: () => {}, onClick: () => {}, thresholdMs: 10_000 })
  handlers.onTouchStart(asTouch(touch()))
  const end = Object.assign(touch(), { target, currentTarget: surface })
  handlers.onTouchEnd(asTouch(end))
  return end.defaultPrevented
}

runTest('a tap on a control inside the surface keeps its click (the group card expand button, a Keep button)', () => {
  const card = el('div', null, 'button') // a surface may itself carry role="button"
  const button = el('button', card)
  const label = el('span', button)
  const bare = el('span', el('div', card))
  assert.equal(tapOn(label, card), false, 'cancelling this touchend would kill the button click on a phone')
  assert.equal(tapOn(bare, card), true, 'bare row space is the row\'s tap, and the row claims it')
  assert.equal(tapLandsOnControl(bare as unknown as EventTarget, card as unknown as EventTarget), false, 'the surface\'s own role="button" is not a control inside it')
})

runTest('a replayed release with no event (shared/textAffordances.ts) still fires the tap', () => {
  let opened = 0
  const handlers = createLongPressHandlers(createLongPressState(), { onLongPress: () => {}, onClick: () => { opened += 1 }, thresholdMs: 10_000 })
  handlers.onTouchStart(asTouch(touch()))
  handlers.onTouchEnd()
  assert.equal(opened, 1)
})

runTest('an EntityLink owns its whole press: start AND release stop at the link', () => {
  const link = read('components/shared/EntityLink.tsx')
  for (const handler of ['onMouseDown', 'onMouseUp', 'onTouchStart', 'onTouchEnd']) {
    assert.match(link, new RegExp(`${handler}=\\{\\(event\\) => event\\.stopPropagation\\(\\)\\}`), `${handler} must stop at the link, or the row opens its record too`)
  }
})

runTest('product names open the product through the row, never through a link', () => {
  const products = read('components/products/Products.tsx')
  const rails = [...products.matchAll(/<ProductNameRail name=\{productName\} \/>/g)]
  assert.equal(rails.length, 2, 'desktop row and mobile card both render the name rail')
  for (const rail of rails) {
    // Everything between the name's copy wrapper and its rail.
    const before = products.slice(0, rail.index)
    const wrapperStart = before.lastIndexOf('{...copy(productName)}>')
    assert.ok(wrapperStart > 0, 'the name keeps its copy wrapper')
    assert.doesNotMatch(before.slice(wrapperStart), /<EntityLink/, 'a link around the name made the name open a list search instead of the product')
  }
  // ...and the row itself is what opens the product sheet on a tap.
  assert.ok((products.match(/onClick: \(target\) => \{[\s\S]{0,400}?setDetailProduct\(p\)/g) || []).length >= 2, 'both row shapes open the product sheet from a tap')
})

// Owner, 25 Sep 2026: "clicking cost must open the cost details directly".
// The cost figure on both row shapes is a button that opens the cost
// calculation float and owns its whole press -- stopping only the click (the
// Inventory shape) is not enough here, because this row opens the product on
// the RELEASE, so the sheet would open over the float.
runTest('the cost figure opens the cost calculation, and only that', () => {
  const products = read('components/products/Products.tsx')
  const buttons = [...products.matchAll(/<button\b(?:(?!<\/button>)[\s\S])*?openCostFloat\(p\)(?:(?!<\/button>)[\s\S])*?<\/button>/g)].map((match) => match[0])
  assert.equal(buttons.length, 2, 'desktop cost cell and mobile price-strip cost')
  for (const button of buttons) {
    assert.match(button, /fmtUSD\(costUsd\)/, 'the button is the cost figure itself')
    for (const handler of ['onMouseDown', 'onMouseUp', 'onTouchStart', 'onTouchEnd']) {
      assert.match(button, new RegExp(`${handler}=\\{\\(event\\) => event\\.stopPropagation\\(\\)\\}`), `${handler} must stop at the cost, or the row opens the product sheet over the float`)
    }
    assert.match(button, /onClick=\{\(event\) => \{ event\.stopPropagation\(\); openCostFloat\(p\) \}\}/)
  }
  assert.match(products, /canViewCosts && costFloatProduct \? \(\s*<CostCalculationFloat/, 'the float renders only for a user who may see costs')
  assert.match(products, /openCostFloat: setCostFloatProduct,/)
})

if (failed) {
  console.error(`\n${failed} product row tap-target test(s) failed`)
  process.exit(1)
}
console.log('PASS productRowTapTargets')

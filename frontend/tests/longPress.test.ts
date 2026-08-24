import assert from 'node:assert/strict'
import {
  createLongPressState,
  createLongPressHandlers,
  consumeLongPressClick,
} from '../src/utils/longPress.ts'

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// window.setTimeout/clearTimeout aren't present under plain `node`, unlike
// the browser/jsdom environment this code actually runs in -- these tests
// exercise the real timer via a tiny polyfill instead of stubbing timing
// out of the picture, since the whole bug class here is about timing.
if (typeof (globalThis as any).window === 'undefined') {
  ;(globalThis as any).window = globalThis
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

const mouseEvent = (x = 0, y = 0) => ({ clientX: x, clientY: y }) as unknown as React.MouseEvent
const touchEvent = (x = 0, y = 0) => ({ touches: [{ clientX: x, clientY: y }] }) as unknown as React.TouchEvent

await runTest('a quick press-and-release fires onClick, not onLongPress', async () => {
  const state = createLongPressState()
  let clicked = false
  let longPressed = false
  const handlers = createLongPressHandlers(state, {
    onLongPress: () => { longPressed = true },
    onClick: () => { clicked = true },
    thresholdMs: 30,
  })
  handlers.onMouseDown(mouseEvent())
  handlers.onMouseUp()
  await wait(60)
  assert.equal(clicked, true)
  assert.equal(longPressed, false)
})

await runTest('holding past the threshold fires onLongPress, not onClick', async () => {
  const state = createLongPressState()
  let clicked = false
  let longPressed = false
  const handlers = createLongPressHandlers(state, {
    onLongPress: () => { longPressed = true },
    onClick: () => { clicked = true },
    thresholdMs: 30,
  })
  handlers.onMouseDown(mouseEvent())
  await wait(60)
  assert.equal(longPressed, true)
  assert.equal(clicked, false)
  // The eventual mouseup after the long-press already fired is just the
  // follow-up release, not a separate click.
  handlers.onMouseUp()
  assert.equal(clicked, false)
})

await runTest('moving past the tolerance before the threshold cancels the long-press entirely', async () => {
  const state = createLongPressState()
  let clicked = false
  let longPressed = false
  const handlers = createLongPressHandlers(state, {
    onLongPress: () => { longPressed = true },
    onClick: () => { clicked = true },
    thresholdMs: 30,
    moveTolerancePx: 5,
  })
  handlers.onTouchStart(touchEvent(0, 0))
  handlers.onTouchMove(touchEvent(50, 0))
  await wait(60)
  assert.equal(longPressed, false)
  // Not a click either -- a drag/scroll is neither a tap nor a hold.
  handlers.onTouchEnd()
  assert.equal(clicked, false)
})

await runTest('disabled skips both onLongPress and onClick', async () => {
  const state = createLongPressState()
  let clicked = false
  let longPressed = false
  const handlers = createLongPressHandlers(state, {
    onLongPress: () => { longPressed = true },
    onClick: () => { clicked = true },
    thresholdMs: 30,
    disabled: true,
  })
  handlers.onMouseDown(mouseEvent())
  await wait(60)
  handlers.onMouseUp()
  assert.equal(longPressed, false)
  assert.equal(clicked, false)
})

// consumeLongPressClick -- the fix for the "select mode auto-exits
// immediately" bug (Products.tsx). Root cause: once onLongPress fires and
// the caller reacts by swapping the row's own onClick handler (entering
// select mode), the browser still fires a native click after the
// eventual mouseup/touchend, landing on the NEW onClick and immediately
// reversing what the long-press just did. consumeLongPressClick lets that
// new onClick recognize and eat exactly that one ghost click.
await runTest('consumeLongPressClick is false before any long-press has fired', () => {
  const state = createLongPressState()
  assert.equal(consumeLongPressClick(state), false)
})

await runTest('consumeLongPressClick is true immediately after a long-press fires, simulating the ghost click Products.tsx must suppress', async () => {
  const state = createLongPressState()
  const handlers = createLongPressHandlers(state, {
    onLongPress: () => {},
    thresholdMs: 30,
  })
  handlers.onMouseDown(mouseEvent())
  await wait(60)
  // This is the exact bug scenario: the caller detaches these handlers
  // once its own state flips (selectionModeActive), so end() never runs
  // -- state.fired is left true for the row's own click handler to find.
  assert.equal(consumeLongPressClick(state), true)
})

await runTest('consumeLongPressClick only consumes once -- the click immediately after is a real, ordinary click', async () => {
  const state = createLongPressState()
  const handlers = createLongPressHandlers(state, {
    onLongPress: () => {},
    thresholdMs: 30,
  })
  handlers.onMouseDown(mouseEvent())
  await wait(60)
  assert.equal(consumeLongPressClick(state), true)
  // A second, later tap on the same row (fired flag already reset) must
  // NOT be silently swallowed too -- only the one ghost click following
  // the long-press itself.
  assert.equal(consumeLongPressClick(state), false)
})

await runTest('consumeLongPressClick stays false for a plain tap/click that never held long enough to fire', async () => {
  const state = createLongPressState()
  const handlers = createLongPressHandlers(state, {
    onLongPress: () => {},
    thresholdMs: 200,
  })
  handlers.onMouseDown(mouseEvent())
  handlers.onMouseUp()
  await wait(30)
  assert.equal(consumeLongPressClick(state), false)
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exitCode = 1
}

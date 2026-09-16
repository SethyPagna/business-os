import assert from 'node:assert/strict'
import {
  isNumberInputTarget,
  handleNumberInputWheel,
  installNumberInputWheelGuard,
} from '../src/runtime/numberInputWheelGuard.ts'

// A focused number input under the mouse when the panel is scrolled must
// lose focus (Part-549: POS payment $20 -> $19 while scrolling). Simulated
// via the guard's own decision function -- plain `node` has no jsdom, and
// jsdom itself doesn't implement the number input's native wheel-scrub
// default action (confirmed live-browser separately), so this test proves
// the guard's logic, not the browser's default action.

function fakeNumberInput() {
  let blurred = false
  const el = {
    tagName: 'INPUT',
    type: 'number',
    blur: () => { blurred = true },
  }
  return { el, wasBlurred: () => blurred }
}

function fakeTextInput() {
  let blurred = false
  const el = {
    tagName: 'INPUT',
    type: 'text',
    blur: () => { blurred = true },
  }
  return { el, wasBlurred: () => blurred }
}

// 1. A focused number input is blurred on wheel.
{
  const { el, wasBlurred } = fakeNumberInput()
  handleNumberInputWheel(el)
  assert.equal(wasBlurred(), true, 'a focused number input must blur on wheel')
}

// 2. A focused text input (e.g. the DualPriceInput family) is left alone --
//    this fix must not blur unrelated fields while a panel is scrolled.
{
  const { el, wasBlurred } = fakeTextInput()
  handleNumberInputWheel(el)
  assert.equal(wasBlurred(), false, 'a focused text input must not blur on wheel')
}

// 3. No focused element (activeElement === document.body, or null) is a no-op.
{
  assert.doesNotThrow(() => handleNumberInputWheel(null))
  assert.doesNotThrow(() => handleNumberInputWheel({ tagName: 'BODY' }))
}

// 4. isNumberInputTarget requires a real blur function -- guards against a
//    detached/serialised object masquerading as the active element.
{
  assert.equal(isNumberInputTarget({ tagName: 'INPUT', type: 'number' }), false)
  assert.equal(isNumberInputTarget({ tagName: 'INPUT', type: 'number', blur: () => {} }), true)
}

// 5. installNumberInputWheelGuard wires a capture-phase, passive listener on
//    the given document and blurs the active element on wheel; the returned
//    teardown removes it. A minimal fake `document` stands in for jsdom.
{
  const { el, wasBlurred } = fakeNumberInput()
  const listeners: Array<{ type: string; handler: EventListener; options: unknown }> = []
  const fakeDoc = {
    activeElement: el,
    addEventListener: (type: string, handler: EventListener, options: unknown) => {
      listeners.push({ type, handler, options })
    },
    removeEventListener: (type: string, handler: EventListener) => {
      const i = listeners.findIndex((l) => l.type === type && l.handler === handler)
      if (i >= 0) listeners.splice(i, 1)
    },
  } as unknown as Document

  const uninstall = installNumberInputWheelGuard(fakeDoc)
  assert.equal(listeners.length, 1, 'exactly one listener registered')
  assert.equal(listeners[0].type, 'wheel')
  assert.deepEqual(listeners[0].options, { capture: true, passive: true })

  listeners[0].handler({} as Event)
  assert.equal(wasBlurred(), true, 'dispatching wheel blurs the active number input')

  uninstall()
  assert.equal(listeners.length, 0, 'teardown removes the listener')
}

console.log('PASS numberInputWheelGuard')

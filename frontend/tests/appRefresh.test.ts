import assert from 'node:assert/strict'

import { normalizeRefreshChannels, refreshAppData } from '../src/utils/appRefresh.ts'

interface CapturedRefreshEvent {
  type: string
  detail: Record<string, unknown>
}

function testNormalizeRefreshChannels(): void {
  assert.deepEqual(
    normalizeRefreshChannels([' settings ', 'products', 'settings', '', null, 'products']),
    ['settings', 'products'],
  )
}

function testRefreshAppDataDispatchesMergedDetail(): void {
  const events: CapturedRefreshEvent[] = []
  globalThis.CustomEvent = class CustomEvent {
    type: string
    detail: Record<string, unknown>

    constructor(type: string, init: CustomEventInit = {}) {
      this.type = type
      this.detail = (init.detail || {}) as Record<string, unknown>
    }
  } as typeof CustomEvent
  globalThis.window = {
    dispatchEvent(event: Event) {
      events.push(event as unknown as CapturedRefreshEvent)
      return true
    },
  } as Window & typeof globalThis

  refreshAppData(['settings', 'units', 'settings'], {
    reason: 'settings-saved',
    source: 'test-suite',
  })

  assert.equal(events.length, 2)
  assert.deepEqual(
    events.map((event) => event.detail.channel),
    ['settings', 'units'],
  )
  assert.equal(events[0].detail.reason, 'settings-saved')
  assert.equal(events[0].detail.source, 'test-suite')
  assert.equal(typeof events[0].detail.ts, 'number')

  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'CustomEvent')
}

testNormalizeRefreshChannels()
testRefreshAppDataDispatchesMergedDetail()

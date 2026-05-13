import assert from 'node:assert/strict'

import { normalizeRefreshChannels, refreshAppData } from '../src/utils/appRefresh.js'

function testNormalizeRefreshChannels() {
  assert.deepEqual(
    normalizeRefreshChannels([' settings ', 'products', 'settings', '', null, 'products']),
    ['settings', 'products'],
  )
}

function testRefreshAppDataDispatchesMergedDetail() {
  const events = []
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) {
      this.type = type
      this.detail = init.detail
    }
  }
  globalThis.window = {
    dispatchEvent(event) {
      events.push(event)
      return true
    },
  }

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

  delete globalThis.window
  delete globalThis.CustomEvent
}

testNormalizeRefreshChannels()
testRefreshAppDataDispatchesMergedDetail()

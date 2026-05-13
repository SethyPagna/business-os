import assert from 'node:assert/strict'

import {
  dispatchImportCompletionRefresh,
  getImportCompletionRefreshChannels,
  shouldDispatchImportCompletionRefresh,
} from '../src/utils/importJobRefresh.js'

function testProductImportChannels() {
  assert.deepEqual(
    getImportCompletionRefreshChannels({ type: 'products' }),
    ['products', 'inventory', 'categories', 'units', 'settings', 'branches', 'suppliers', 'dashboard'],
  )
}

function testSupplierImportChannels() {
  assert.deepEqual(
    getImportCompletionRefreshChannels({ type: 'suppliers' }),
    ['suppliers', 'products'],
  )
}

function testDispatchOnlyOnTerminalTransition() {
  assert.equal(
    shouldDispatchImportCompletionRefresh(
      { id: 'job-1', type: 'products', status: 'running' },
      { id: 'job-1', type: 'products', status: 'completed' },
    ),
    true,
  )
  assert.equal(
    shouldDispatchImportCompletionRefresh(
      { id: 'job-1', type: 'products', status: 'completed' },
      { id: 'job-1', type: 'products', status: 'completed' },
    ),
    false,
  )
  assert.equal(
    shouldDispatchImportCompletionRefresh(
      { id: 'job-1', type: 'products', status: 'awaiting_review' },
      { id: 'job-1', type: 'products', status: 'approved' },
    ),
    false,
  )
}

function testDispatchEmitsExpectedEvents() {
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

  const channels = dispatchImportCompletionRefresh(
    { id: 'job-2', type: 'sales', status: 'completed_with_errors' },
    { reason: 'import-completed', source: 'test-suite' },
  )

  assert.deepEqual(channels, ['sales', 'products', 'inventory', 'returns', 'dashboard'])
  assert.equal(events.length, channels.length)
  assert.deepEqual(
    events.map((event) => event.detail.channel),
    channels,
  )
  assert.equal(events[0].detail.importJobId, 'job-2')
  assert.equal(events[0].detail.importJobType, 'sales')
  assert.equal(events[0].detail.importJobStatus, 'completed_with_errors')
  assert.equal(events[0].detail.reason, 'import-completed')
  assert.equal(events[0].detail.source, 'test-suite')

  delete globalThis.window
  delete globalThis.CustomEvent
}

testProductImportChannels()
testSupplierImportChannels()
testDispatchOnlyOnTerminalTransition()
testDispatchEmitsExpectedEvents()

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { FOREGROUND_RESUME_SYNC_UPDATE_CHANNELS } from '../src/api/syncRuntime.ts'
import { DEFAULT_REFRESH_CHANNELS, normalizeRefreshChannels } from '../src/utils/appRefresh.ts'

// KHQR S5: every committed online order change broadcasts on the `onlineOrders` channel (cloudflare lib/onlineOrderAlerts.ts announceOrderChange). A channel the
// frontend does not list is never refreshed after a resume or reconnect, and the bell never hears of it, so each place that enumerates the real channels names it.

const read = (relative: string) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8')

test('the Worker broadcasts the channel this test names (a rename on either side turns this red)', () => {
  const hub = read('../../cloudflare/src/durable-objects/broadcastHub.ts')
  assert.match(hub, /\| 'onlineOrders'/)
  const alerts = read('../../cloudflare/src/lib/onlineOrderAlerts.ts')
  assert.match(alerts, /broadcast\([^)]*'onlineOrders'/)
})

test('resume and "refresh everything" both include onlineOrders', () => {
  assert.ok((FOREGROUND_RESUME_SYNC_UPDATE_CHANNELS as readonly string[]).includes('onlineOrders'))
  assert.ok(DEFAULT_REFRESH_CHANNELS.includes('onlineOrders'))
  assert.ok(normalizeRefreshChannels().includes('onlineOrders'))
})

test('the reconnect list in api/http.ts and the bell reload list in NotificationCenter.tsx include onlineOrders', () => {
  const http = read('../src/api/http.ts')
  const list = http.slice(http.indexOf('const RECONNECT_REFRESH_CHANNELS = ['), http.indexOf(']', http.indexOf('const RECONNECT_REFRESH_CHANNELS = [')))
  assert.match(list, /'onlineOrders'/)
  assert.match(read('../src/components/shared/NotificationCenter.tsx'), /'settings', 'onlineOrders'\]\.includes\(syncChannel\.channel\)/)
})

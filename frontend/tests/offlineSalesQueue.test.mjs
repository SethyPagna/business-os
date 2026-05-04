import assert from 'node:assert/strict'
import fs from 'node:fs'

let failed = 0

async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const methodsSource = fs.readFileSync(new URL('../src/api/methods.js', import.meta.url), 'utf8')
const webApiSource = fs.readFileSync(new URL('../src/web-api.js', import.meta.url), 'utf8')
const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const serverPageSource = fs.readFileSync(new URL('../src/components/server/ServerPage.jsx', import.meta.url), 'utf8')

await runTest('createSale queues retryable offline writes with an idempotency key', () => {
  assert.match(methodsSource, /export async function createSale/)
  assert.match(methodsSource, /ensureClientRequestId\(\{ \.\.\.getDeviceInfo\(\), \.\.\.d \}, 'sale'\)/)
  assert.match(methodsSource, /catch\s*\(error\)/)
  assert.match(methodsSource, /isRetryableOfflineSaleError\(error\)/)
  assert.match(methodsSource, /queueOfflineSale\(payload/)
})

await runTest('retryPendingSyncNow syncs pending sales instead of discarding them', () => {
  assert.match(methodsSource, /async function syncPendingSalesQueue/)
  assert.match(methodsSource, /apiFetch\('POST', '\/api\/sales'/)
  assert.match(methodsSource, /skipWriteDedupe:\s*true/)
  const retryBody = methodsSource.match(/export async function retryPendingSyncNow\(\) \{([\s\S]*?)\n\}/)?.[1] || ''
  assert.match(retryBody, /syncPendingSalesQueue/)
  assert.doesNotMatch(retryBody, /discardPendingSyncQueue/)
})

await runTest('browser startup and online recovery retry queued work without clearing it', () => {
  assert.doesNotMatch(webApiSource, /discardPendingSyncQueue\?\.\(\)/)
  assert.match(webApiSource, /retryPendingSyncNow\?\.\(\)/)
  assert.match(webApiSource, /sync:reconnected/)
  assert.match(webApiSource, /addEventListener\('online'/)
})

await runTest('offline mode banner stays visible while offline and announces sync timestamps', () => {
  assert.match(appSource, /function OfflineModeBanner/)
  assert.match(appSource, /syncUrl && !canWriteToServer/)
  assert.match(appSource, /server_back_online/)
  assert.match(appSource, /formatSyncTimestamp/)
  assert.match(appSource, /sync:offline-sale-queued/)
  assert.match(appSource, /sync:offline-sale-synced/)
})

await runTest('server diagnostics queue syncs pending offline work instead of calling it invalid', () => {
  assert.match(serverPageSource, /retryPendingSyncNow/)
  assert.match(serverPageSource, /Sync now/)
  assert.match(serverPageSource, /Offline actions are queued by timestamp/)
  assert.doesNotMatch(serverPageSource, /invalid pending client actions/)
  assert.doesNotMatch(serverPageSource, /Discard invalid changes/)
})

if (failed > 0) {
  process.exitCode = 1
}

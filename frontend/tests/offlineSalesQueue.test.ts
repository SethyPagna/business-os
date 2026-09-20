import assert from 'node:assert/strict'
import fs from 'node:fs'

type TestCallback = () => void | Promise<void>

let failed = 0

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const methodsSource = fs.readFileSync(new URL('../src/api/methods.ts', import.meta.url), 'utf8')
const saleWriteTransportSource = fs.readFileSync(new URL('../src/api/saleWriteTransport.ts', import.meta.url), 'utf8')
const salesTransportSource = fs.readFileSync(new URL('../src/api/salesTransport.ts', import.meta.url), 'utf8')
const pendingSyncTransportSource = fs.readFileSync(new URL('../src/api/pendingSyncTransport.ts', import.meta.url), 'utf8')
const offlineSnapshotTransportSource = fs.readFileSync(new URL('../src/api/offlineSnapshotTransport.ts', import.meta.url), 'utf8')
const webApiSource = fs.readFileSync(new URL('../src/web-api.ts', import.meta.url), 'utf8')
const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const serverPageSource = fs.readFileSync(new URL('../src/components/server/ServerPage.tsx', import.meta.url), 'utf8')

await runTest('createSale retains the request identity but never queues new offline writes', () => {
  assert.match(methodsSource, /export async function createSale/)
  assert.match(methodsSource, /loadSaleWriteTransport\(\)/)
  assert.match(saleWriteTransportSource, /ensureSaleClientRequestId\(stampOfflineSaleOwner\(\{ \.\.\.getClientDeviceInfo\(\), \.\.\.payload \}\), 'sale'\)/)
  assert.match(saleWriteTransportSource, /const scope = captureActorReadScope\(\)[\s\S]*stampOfflineSaleOwner[\s\S]*await createSaleRequest/)
  assert.match(saleWriteTransportSource, /catch\s*\(error\)/)
  assert.match(saleWriteTransportSource, /isRetryableOfflineSaleError\(error\)/)
  assert.doesNotMatch(saleWriteTransportSource, /queueOfflineSale\(/)
  assert.match(saleWriteTransportSource, /code: 'sale_confirmation_required', client_request_id: salePayload.client_request_id/)
})

await runTest('retryPendingSyncNow syncs pending sales instead of discarding them', () => {
  assert.match(saleWriteTransportSource, /export function syncPendingSalesQueue/)
  assert.match(saleWriteTransportSource, /pendingSalesSyncPromise/)
  assert.match(saleWriteTransportSource, /db\.transaction\('rw', syncQueue, sales/)
  assert.match(saleWriteTransportSource, /options.manualRecovery !== true/)
  assert.match(saleWriteTransportSource, /createSaleWithoutWriteDedupe\(payload\)/)
  assert.match(salesTransportSource, /apiFetch\(\s*'POST',\s*'\/api\/sales'/)
  assert.match(salesTransportSource, /skipWriteDedupe:\s*true/)
  const retryBody = methodsSource.match(/export async function retryPendingSyncNow\(reviewToken\?: string\) \{([\s\S]*?)\n\}/)?.[1] || ''
  assert.match(retryBody, /loadPendingSyncTransport\(\)/)
  assert.doesNotMatch(retryBody, /discardPendingSyncQueue/)
  assert.match(pendingSyncTransportSource, /export async function retryPendingSyncNow\(reviewToken\?: string\)[\s\S]*validatedReview\(reviewToken\)[\s\S]*syncPendingSalesQueue\(\{ force: true, manualRecovery: true, expectedOwner: review.owner, reviewedRows: review.rows \}\)/)
  assert.doesNotMatch(methodsSource, /syncPendingSalesQueue\(\{ force: true \}\)/)
})

await runTest('browser startup and reconnect refresh reads without replaying retained sales', () => {
  assert.doesNotMatch(webApiSource, /discardPendingSyncQueue\?\.\(\)/)
  assert.doesNotMatch(webApiSource, /module\.syncPendingSalesQueue\(/)
  assert.match(webApiSource, /loadOfflineSnapshotTransportModule\(\)[\s\S]*module\.refreshOfflineDeviceSnapshot\(\{ force \}\)/)
  assert.match(webApiSource, /sync:reconnected/)
  assert.match(webApiSource, /addEventListener\('online'/)
})

await runTest('online device snapshots refresh local mirrors for server-offline reopening', () => {
  assert.match(methodsSource, /export async function refreshOfflineDeviceSnapshot/)
  assert.match(methodsSource, /loadOfflineSnapshotTransport\(\)/)
  assert.doesNotMatch(methodsSource, /offline_device_snapshot_meta/)
  assert.match(offlineSnapshotTransportSource, /offline_device_snapshot_meta/)
  assert.match(offlineSnapshotTransportSource, /getSettingsSnapshot\(\)/)
  assert.match(offlineSnapshotTransportSource, /getProducts\(\)/)
  assert.match(offlineSnapshotTransportSource, /getBranches\(\)/)
  assert.match(offlineSnapshotTransportSource, /getSales\(\{\}\)/)
  assert.match(offlineSnapshotTransportSource, /getReturnsSnapshot\(\)/)
  assert.match(offlineSnapshotTransportSource, /getInventoryMovements\(\{ pageSize: 5000 \}\)/)
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
  assert.match(serverPageSource, /Recover reviewed sales/)
  assert.match(serverPageSource, /New sales require the server/)
  assert.match(serverPageSource, /recovered only when you choose/)
  assert.doesNotMatch(serverPageSource, /invalid pending client actions/)
  assert.doesNotMatch(serverPageSource, /Discard invalid changes/)
})

if (failed > 0) {
  process.exitCode = 1
}

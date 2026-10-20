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
const webApiSource = fs.readFileSync(new URL('../src/web-api.ts', import.meta.url), 'utf8')
const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const serverPageSource = fs.readFileSync(new URL('../src/components/server/ServerPage.tsx', import.meta.url), 'utf8')
const legacyNoticeSource = fs.readFileSync(new URL('../src/components/server/LegacyQueueNotice.tsx', import.meta.url), 'utf8')

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
  const retryBody = webApiSource.match(/async retryPendingSyncNow\(reviewToken\?: string\) \{([\s\S]*?)\n  \},/)?.[1] || ''
  assert.match(retryBody, /import\('\.\/api\/pendingSyncTransport\.ts'\)/)
  assert.doesNotMatch(retryBody, /discardPendingSyncQueue/)
  assert.doesNotMatch(methodsSource, /PendingSync/)
  assert.match(pendingSyncTransportSource, /export async function retryPendingSyncNow\(reviewToken\?: string\)[\s\S]*validatedReview\(reviewToken\)[\s\S]*syncPendingSalesQueue\(\{ force: true, manualRecovery: true, expectedOwner: review.owner, reviewedRows: review.rows \}\)/)
  assert.doesNotMatch(methodsSource, /syncPendingSalesQueue\(\{ force: true \}\)/)
})

await runTest('browser startup and reconnect refresh reads without replaying retained sales', () => {
  assert.doesNotMatch(webApiSource, /discardPendingSyncQueue\?\.\(\)/)
  assert.doesNotMatch(webApiSource, /module\.syncPendingSalesQueue\(/)
  // F1: reconnect no longer refreshes the retired offline snapshot at all.
  assert.doesNotMatch(webApiSource, /loadOfflineSnapshotTransportModule|refreshOfflineDeviceSnapshot/)
  assert.match(webApiSource, /addEventListener\('online'/)
})

// Offline mode is cancelled (owner, 26 Sep 2026). The device snapshot made
// eleven serial GETs whose rows localMirrors.ts discards on any http(s)
// origin; F1 removed its only caller, so the transport, the registry wrapper
// and its chunk rule are gone too (R-F1F3 F-11).
await runTest('the retired offline device snapshot has no transport, wrapper or loader left', () => {
  assert.equal(fs.existsSync(new URL('../src/api/offlineSnapshotTransport.ts', import.meta.url)), false)
  assert.doesNotMatch(methodsSource, /offlineSnapshotTransport|refreshOfflineDeviceSnapshot|offline_device_snapshot_meta/)
  assert.doesNotMatch(webApiSource, /offlineSnapshotTransport|refreshOfflineDeviceSnapshot/)
})

await runTest('offline mode banner stays visible while offline; no offline-sale event is announced any more', () => {
  assert.match(appSource, /function OfflineModeBanner/)
  assert.match(appSource, /syncUrl && !canWriteToServer/)
  assert.match(appSource, /server_back_online/)
  assert.doesNotMatch(appSource, /sync:offline-sale-queued|sync:offline-sale-synced|formatSyncTimestamp/)
})

await runTest('retained sales are recovered by hand in the legacy notice, never called invalid', () => {
  assert.match(legacyNoticeSource, /retryPendingSyncNow!\(reviewToken\)/)
  assert.match(legacyNoticeSource, /t\('legacy_queue_upload'\)/)
  assert.doesNotMatch(serverPageSource, /retryPendingSyncNow|discardPendingSyncQueue|getPendingSyncState/)
  assert.doesNotMatch(legacyNoticeSource, /invalid pending client actions|Discard invalid changes/)
})

if (failed > 0) {
  process.exitCode = 1
}

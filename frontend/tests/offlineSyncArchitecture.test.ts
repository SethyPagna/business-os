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

const swSource = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const webApiSource = fs.readFileSync(new URL('../src/web-api.ts', import.meta.url), 'utf8')
const methodsSource = fs.readFileSync(new URL('../src/api/methods.ts', import.meta.url), 'utf8')
const saleWriteTransportSource = fs.readFileSync(new URL('../src/api/saleWriteTransport.ts', import.meta.url), 'utf8')
const syncRuntimeSource = fs.readFileSync(new URL('../src/api/syncRuntime.ts', import.meta.url), 'utf8')

await runTest('legacy service-worker triggers cannot replay retained business writes', async () => {
  assert.match(swSource, /const OUTBOX_SYNC_TAG = 'business-os-sync-outbox'/)
  assert.match(swSource, /self\.addEventListener\('sync'/)
  assert.match(swSource, /event\.tag === OUTBOX_SYNC_TAG/)
  assert.match(swSource, /indexedDB\.open\(DB_NAME\)/)
  assert.match(swSource, /readQueuedBusinessOutbox/)
  assert.match(swSource, /credentials: 'include'/)
  assert.match(swSource, /fetch\(`\$\{base\}\/api\/sync\/outbox`/)
  assert.doesNotMatch(swSource, /OFFLINE_AUTH_SESSION_TOKEN_KEY/)
  assert.doesNotMatch(swSource, new RegExp(`x-auth-${'session'}`))
  const trigger = swSource.match(/function syncOutboxOnce\(\) \{[\s\S]*?\n\}/)?.[0] || ''
  assert.ok(trigger)
  let calls = 0
  const result = await new Function('syncOutbox', `${trigger}; return syncOutboxOnce()`)(() => { calls++; return Promise.resolve() })
  assert.equal(calls, 0, 'old sync/message events must not send business writes')
  assert.equal(result.manual_recovery_required, true)
})

await runTest('service worker preserves conflicts and auth failures instead of overwriting newer server state', () => {
  assert.match(swSource, /status === 409/)
  assert.match(swSource, /status: 'conflict'/)
  assert.match(swSource, /retry_at: null/)
  assert.match(swSource, /status === 401 \|\| status === 403/)
  assert.match(swSource, /reason: 'auth_required'/)
})

await runTest('browser no longer registers or messages automatic business replay', () => {
  assert.doesNotMatch(webApiSource, /registerOutboxBackgroundSync/)
  assert.match(syncRuntimeSource, /function registerOutboxBackgroundSync/)
  assert.doesNotMatch(syncRuntimeSource, /syncRegistration\.sync\.register\(OUTBOX_SYNC_TAG\)/)
  assert.doesNotMatch(syncRuntimeSource, /postMessage\(\{ type: 'BUSINESS_OS_SYNC_NOW' \}\)/)
  assert.match(webApiSource, /queueBusinessOutboxOperation/)
  assert.doesNotMatch(webApiSource, /encryptOfflineVaultValue|decryptOfflineVaultValue/)
  assert.doesNotMatch(webApiSource, /OFFLINE_AUTH_SESSION_TOKEN_KEY/)
  assert.doesNotMatch(webApiSource, /function syncBackgroundAuthSessionToken/)
})

await runTest('vault-unlocked foreground replay is denied without decryption or network dispatch', () => {
  assert.match(webApiSource, /async function syncUnlockedOfflineOutbox/)
  assert.doesNotMatch(webApiSource, /decryptOfflineVaultValue\(row\.encrypted_payload/)
  assert.doesNotMatch(webApiSource, /apiFetch\('POST', '\/api\/sync\//)
  assert.match(webApiSource, /code: 'legacy_recovery_required'/)
  assert.match(webApiSource, /String\(type\)\.startsWith\('BUSINESS_OS_OUTBOX_'\)/)
  assert.match(webApiSource, /BUSINESS_OS_OUTBOX_CONFLICT/)
  assert.match(webApiSource, /async function syncUnlockedOfflineFileChunks/)
  assert.doesNotMatch(webApiSource, /function dispatchOutbox(?:File)?Progress/)
})

await runTest('disabled offline file replay does not change retained chunk status', () => {
  assert.doesNotMatch(webApiSource, /OFFLINE_FILE_CHUNK_STATUS_WRITE_CONCURRENCY|mapOfflineFileChunkStatusUpdates/)
  assert.doesNotMatch(webApiSource, /offlineDb\.offline_file_chunks\.(update|put|delete)\(/)
  assert.doesNotMatch(webApiSource, /Promise\.all\(rows\.map\(\(row\) => (dexieDb|offlineDb)\.offline_file_chunks\.update/)
})

// F1 (27 Sep 2026): offline selling is cancelled, so the five-minute offline
// mirror refresh is gone and index.tsx is the only app-shell update checker.
// singleAppUpdateChecker.test.ts runs both behaviours; this pins the absence.
await runTest('no background offline maintenance loop; the app shell update check lives only in index.tsx', () => {
  assert.doesNotMatch(webApiSource, /OFFLINE_REFRESH_INTERVAL_MS|startOfflineMaintenanceLoop|refreshOfflineSnapshotSoon|runOfflineMaintenance/)
  assert.doesNotMatch(webApiSource, /window\.setInterval/)
  assert.doesNotMatch(webApiSource, /registration\.update\?\.\(\)/)
})

await runTest('legacy sale payloads retain their original identity and never disappear on conflicts', () => {
  assert.match(methodsSource, /loadSaleWriteTransport\(\)/)
  assert.doesNotMatch(webApiSource, /registerOutboxBackgroundSync/)
  assert.doesNotMatch(saleWriteTransportSource, /registerOutboxBackgroundSync/)
  assert.match(saleWriteTransportSource, /emitSyncQueueChanged/)
  assert.match(saleWriteTransportSource, /payload.client_request_id !== row.id/)
  assert.match(saleWriteTransportSource, /options.manualRecovery !== true/)
  assert.doesNotMatch(saleWriteTransportSource, /queueOfflineSale\(/)
  assert.match(saleWriteTransportSource, /isWriteConflictError/)
  assert.match(saleWriteTransportSource, /status: 'conflict'/)
  assert.doesNotMatch(saleWriteTransportSource, /isWriteConflictError\(error\)[\s\S]{0,120}completeQueuedSale/)
})

if (failed > 0) {
  process.exitCode = 1
}

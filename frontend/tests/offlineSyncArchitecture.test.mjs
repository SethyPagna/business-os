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

const swSource = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const webApiSource = fs.readFileSync(new URL('../src/web-api.js', import.meta.url), 'utf8')
const methodsSource = fs.readFileSync(new URL('../src/api/methods.js', import.meta.url), 'utf8')

await runTest('service worker replays the IndexedDB outbox through secure authenticated background sync', () => {
  assert.match(swSource, /const OUTBOX_SYNC_TAG = 'business-os-sync-outbox'/)
  assert.match(swSource, /self\.addEventListener\('sync'/)
  assert.match(swSource, /event\.tag === OUTBOX_SYNC_TAG/)
  assert.match(swSource, /indexedDB\.open\(DB_NAME\)/)
  assert.match(swSource, /readQueuedBusinessOutbox/)
  assert.match(swSource, /credentials: 'include'/)
  assert.match(swSource, /fetch\(`\$\{base\}\/api\/sync\/outbox`/)
  assert.doesNotMatch(swSource, /OFFLINE_AUTH_SESSION_TOKEN_KEY/)
  assert.doesNotMatch(swSource, /x-auth-session/)
})

await runTest('service worker preserves conflicts and auth failures instead of overwriting newer server state', () => {
  assert.match(swSource, /status === 409/)
  assert.match(swSource, /status: 'conflict'/)
  assert.match(swSource, /retry_at: null/)
  assert.match(swSource, /status === 401 \|\| status === 403/)
  assert.match(swSource, /reason: 'auth_required'/)
})

await runTest('browser registers background sync without sharing auth tokens with the worker', () => {
  assert.match(webApiSource, /function registerOutboxBackgroundSync/)
  assert.match(webApiSource, /registration\.sync\.register\(OUTBOX_SYNC_TAG\)/)
  assert.match(webApiSource, /postMessage\(\{ type: 'BUSINESS_OS_SYNC_NOW' \}\)/)
  assert.match(webApiSource, /queueBusinessOutboxOperation/)
  assert.match(webApiSource, /encrypted_payload/)
  assert.doesNotMatch(webApiSource, /OFFLINE_AUTH_SESSION_TOKEN_KEY/)
  assert.doesNotMatch(webApiSource, /function syncBackgroundAuthSessionToken/)
})

await runTest('vault-unlocked foreground sync decrypts outbox payloads and reports progress', () => {
  assert.match(webApiSource, /async function syncUnlockedOfflineOutbox/)
  assert.match(webApiSource, /decryptOfflineVaultValue\(row\.encrypted_payload/)
  assert.match(webApiSource, /\/api\/sync\/outbox/)
  assert.match(webApiSource, /BUSINESS_OS_OUTBOX_PROGRESS/)
  assert.match(webApiSource, /BUSINESS_OS_OUTBOX_CONFLICT/)
  assert.match(webApiSource, /async function syncUnlockedOfflineFileChunks/)
  assert.match(webApiSource, /BUSINESS_OS_OUTBOX_FILE_PROGRESS/)
})

await runTest('online maintenance keeps the offline mirror and app shell fresh without blocking the UI', () => {
  assert.match(webApiSource, /const OFFLINE_REFRESH_INTERVAL_MS = 5 \* 60_000/)
  assert.match(webApiSource, /startOfflineMaintenanceLoop/)
  assert.match(webApiSource, /window\.setInterval/)
  assert.match(webApiSource, /refreshOfflineSnapshotSoon/)
  assert.match(webApiSource, /registration\.update\?\.\(\)/)
})

await runTest('queued offline writes carry version metadata and do not disappear on server conflicts', () => {
  assert.match(methodsSource, /registerOutboxBackgroundSync/)
  assert.match(methodsSource, /queue_version/)
  assert.match(methodsSource, /base_updated_at/)
  assert.match(methodsSource, /isWriteConflictError/)
  assert.match(methodsSource, /status: 'conflict'/)
  assert.doesNotMatch(methodsSource, /isWriteConflictError\(error\)[\s\S]{0,120}completeQueuedSale/)
})

if (failed > 0) {
  process.exitCode = 1
}

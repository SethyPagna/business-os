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

const httpSource = fs.readFileSync(new URL('../src/api/http.ts', import.meta.url), 'utf8')
const localDbSource = fs.readFileSync(new URL('../src/api/localDb.ts', import.meta.url), 'utf8')
const webApiSource = fs.readFileSync(new URL('../src/web-api.ts', import.meta.url), 'utf8')
const swSource = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const appUpdateSource = fs.readFileSync(new URL('../src/utils/appUpdate.ts', import.meta.url), 'utf8')
const sidebarSource = fs.readFileSync(new URL('../src/components/navigation/Sidebar.tsx', import.meta.url), 'utf8')
const serverPageSource = fs.readFileSync(new URL('../src/components/server/ServerPage.tsx', import.meta.url), 'utf8')
const packageSource = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
const swRuntimeSource = fs.readFileSync(new URL('../src/public-runtime/service-worker.ts', import.meta.url), 'utf8')
const websocketSource = fs.readFileSync(new URL('../src/api/websocket.ts', import.meta.url), 'utf8')
const appContextSource = fs.readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')

await runTest('frontend uses cookie credentials and does not persist auth tokens for offline sync', () => {
  assert.match(httpSource, /credentials:\s*'include'/)
  assert.doesNotMatch(httpSource, /sessionStorage\.getItem\('businessos_auth_token'\)/)
  assert.doesNotMatch(httpSource, /localStorage\.getItem\('businessos_auth_token'\)/)
  assert.doesNotMatch(webApiSource, /OFFLINE_AUTH_SESSION_TOKEN_KEY/)
  assert.doesNotMatch(swSource, /OFFLINE_AUTH_SESSION_TOKEN_KEY/)
  assert.match(swSource, /credentials:\s*'include'/)
})

await runTest('IndexedDB schema has encrypted vault, generic outbox, file chunks, and safe plaintext metadata', () => {
  assert.match(localDbSource, /offline_vault/)
  assert.match(localDbSource, /sync_outbox/)
  assert.match(localDbSource, /offline_file_chunks/)
  assert.match(localDbSource, /encrypted_payload/)
  assert.match(localDbSource, /payload_digest/)
  assert.match(localDbSource, /schema_version/)
})

await runTest('offline vault uses Web Crypto PIN derivation, AES-GCM, persistence, and idle relock', () => {
  assert.match(webApiSource, /deriveOfflineVaultKey/)
  assert.match(webApiSource, /PBKDF2/)
  assert.match(webApiSource, /AES-GCM/)
  assert.match(webApiSource, /OFFLINE_VAULT_IDLE_LOCK_MS = 15 \* 60_000/)
  assert.match(webApiSource, /navigator\.storage\.persist/)
  assert.match(webApiSource, /offline:vault-locked/)
})

await runTest('all business offline edits use operation ids and the versioned outbox endpoint', () => {
  assert.match(webApiSource, /queueBusinessOutboxOperation/)
  assert.match(webApiSource, /business_outbox_operation/)
  assert.match(swSource, /\/api\/sync\/outbox/)
  assert.match(swSource, /operation_id/)
  assert.match(swSource, /schema_version/)
  assert.match(swSource, /payload_digest/)
})

await runTest('chunked offline files are queued and replayed separately from JSON edits', () => {
  assert.match(webApiSource, /queueOfflineFileChunks/)
  assert.match(webApiSource, /syncUnlockedOfflineOutbox/)
  assert.match(webApiSource, /syncUnlockedOfflineFileChunks/)
  assert.match(webApiSource, /system_busy/)
  assert.match(webApiSource, /status:\s*'paused'/)
  assert.match(webApiSource, /BUSINESS_OS_OUTBOX_FILE_PROGRESS/)
  assert.match(webApiSource, /OFFLINE_FILE_CHUNK_SIZE = 1024 \* 1024/)
  assert.match(swSource, /\/api\/sync\/files\/chunks\/init/)
  assert.match(swSource, /\/chunk/)
  assert.match(swSource, /\/complete/)
  assert.match(swSource, /offline_file_chunks/)
})

await runTest('interrupted file staging cannot be completed as a corrupt upload', () => {
  assert.match(webApiSource, /status:\s*'building'/)
  assert.match(webApiSource, /staging_status:\s*'ready'/)
  assert.match(webApiSource, /file\.slice\(start, start \+ OFFLINE_FILE_CHUNK_SIZE\)\.arrayBuffer\(\)/)
  assert.match(webApiSource, /manifestRow\.status !== 'ready'/)
  assert.match(webApiSource, /hasCompleteChunkSet/)
  assert.match(webApiSource, /Offline file staging was interrupted\. Reselect the file/)
})

await runTest('iOS resume repairs half-open sockets and coalesces foreground recovery bursts', () => {
  assert.match(websocketSource, /const WS_PONG_TIMEOUT_MS = 55_000/)
  assert.match(websocketSource, /ws\.close\(4000, 'pong-timeout'\)/)
  assert.match(websocketSource, /ws\.close\(4000, 'resume-stale-socket'\)/)
  assert.match(webApiSource, /deferredForegroundRecoveryTimer/)
  assert.match(webApiSource, /FOREGROUND_REFRESH_AFTER_MS = 45_000/)
})

await runTest('worker upgrades retain one prior cache generation and never overwrite dirty work', () => {
  assert.match(swRuntimeSource, /cacheNamesToRetain/)
  assert.match(swRuntimeSource, /CACHE_METADATA_URL/)
  assert.match(swRuntimeSource, /previous\.replace\('business-os-app-shell-', 'business-os-static-'\)/)
  assert.match(appContextSource, /if \(hasDirtyWork\(\)\) \{[\s\S]*flushPendingWorkDrafts\(\)[\s\S]*An app update is ready/)
})

await runTest('UX exposes vault, conflicts, storage, security, and update states', () => {
  assert.match(appSource, /Vault locked/)
  assert.match(appSource, /Conflicts need review/)
  assert.match(appSource, /New version ready/)
  assert.match(appSource, /sync:app-update-available/)
  assert.match(appSource, /function AppUpdateBanner/)
  assert.match(appSource, /fixed inset-x-0 top-0/)
  assert.match(appSource, /Restart now/)
  assert.match(appSource, /App updates are independent of authentication[\s\S]*window\.addEventListener\('sync:app-update-available',[\s\S]*\}, \[\]\)/)
  assert.match(appSource, /announcedHash === FRONTEND_BUILD_HASH/)
  assert.match(appUpdateSource, /if \(hasDirtyWork\(\)\)[\s\S]*flushPendingWorkDrafts\(\)[\s\S]*return 'blocked'/)
  assert.match(appUpdateSource, /BUSINESS_OS_SKIP_WAITING/)
  assert.match(sidebarSource, /restartIntoLatestApp/)
  assert.match(serverPageSource, /Sync Center/)
  assert.match(serverPageSource, /Storage/)
  assert.match(serverPageSource, /Security/)
  assert.match(serverPageSource, /Cloudflare Access/)
})

await runTest('offline security hardening test is part of the utility suite', () => {
  // test:utils now runs every tests/*.test.ts through the discovery runner, so
  // this file is in the suite by existing; pin the runner instead of a name in
  // a hand-maintained list (that list stopped launching at 8188 characters).
  assert.match(packageSource, /"test:utils": "node tests\/runTestChain\.ts"/)
})

if (failed > 0) {
  process.exitCode = 1
}

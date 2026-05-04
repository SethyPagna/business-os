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

const httpSource = fs.readFileSync(new URL('../src/api/http.js', import.meta.url), 'utf8')
const localDbSource = fs.readFileSync(new URL('../src/api/localDb.js', import.meta.url), 'utf8')
const webApiSource = fs.readFileSync(new URL('../src/web-api.js', import.meta.url), 'utf8')
const swSource = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const serverPageSource = fs.readFileSync(new URL('../src/components/server/ServerPage.jsx', import.meta.url), 'utf8')
const packageSource = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')

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
  assert.match(webApiSource, /OFFLINE_FILE_CHUNK_SIZE = 1024 \* 1024/)
  assert.match(swSource, /\/api\/sync\/files\/chunks\/init/)
  assert.match(swSource, /\/chunk/)
  assert.match(swSource, /\/complete/)
  assert.match(swSource, /offline_file_chunks/)
})

await runTest('UX exposes vault, conflicts, storage, security, and update states', () => {
  assert.match(appSource, /Vault locked/)
  assert.match(appSource, /Conflicts need review/)
  assert.match(appSource, /New version ready/)
  assert.match(appSource, /sync:app-update-available/)
  assert.match(serverPageSource, /Sync Center/)
  assert.match(serverPageSource, /Storage/)
  assert.match(serverPageSource, /Security/)
  assert.match(serverPageSource, /Cloudflare Access/)
})

await runTest('offline security hardening test is part of the utility suite', () => {
  assert.match(packageSource, /offlineSecurityHardening\.test\.mjs/)
})

if (failed > 0) {
  process.exitCode = 1
}

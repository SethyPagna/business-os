// Offline selling is cancelled (26 Sep 2026). The service worker's outbox and
// queued-sale replay had been unreachable since d464bc025 (20 Sep): its only
// triggers, the Background Sync event and BUSINESS_OS_SYNC_NOW, ran
// syncOutboxOnce, which returned a constant. 6.0.880 removed that code. This
// locks the removal in the TS source and in the shipped public/sw.js: the
// worker opens no IndexedDB, reaches no /api/ route and handles no sync event,
// so a till's retained queue can only ever move through the foreground manual
// review path. Run: node tests/swOfflineSaleReplay.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const swSource = fs.readFileSync(new URL('../src/public-runtime/service-worker.ts', import.meta.url), 'utf8')
const builtSw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')

for (const [label, source] of [['source', swSource], ['shipped sw.js', builtSw]] as const) {
  runTest(`the worker has no replay machinery at all (${label})`, () => {
    assert.doesNotMatch(source, /indexedDB/, 'the worker must not open the business IndexedDB')
    assert.doesNotMatch(source, /sync_queue|sync_outbox|offline_file_chunks/, 'no queue store is read or written')
    assert.doesNotMatch(source, /\/api\/sync\//, 'no sync endpoint is called')
    assert.doesNotMatch(source, /replayQueuedSale|syncOutbox|markQueueFailure|putQueueRow|deleteQueueRow/)
    assert.doesNotMatch(source, /normalizeOfflineSaleOwner|offlineSaleOwnersMatch|payload_digest|crypto\.subtle/)
  })

  runTest(`no event or message can start a business write (${label})`, () => {
    assert.doesNotMatch(source, /addEventListener\('sync'/, 'no Background Sync handler')
    assert.doesNotMatch(source, /BUSINESS_OS_SYNC_NOW/, 'no sync-now message handler')
    assert.doesNotMatch(source, /BUSINESS_OS_OUTBOX_/, 'the worker announces no outbox state')
    // The only network reads left are the shell, static assets and the
    // recovery navigation; none of them is a write.
    for (const call of source.matchAll(/fetch\(([^)]*)\)/g)) {
      assert.doesNotMatch(call[1], /method|body|\/api\//, `unexpected fetch(${call[1]})`)
    }
  })

  runTest(`update and recovery messages are still answered (${label})`, () => {
    assert.match(source, /BUSINESS_OS_SKIP_WAITING/)
    assert.match(source, /BUSINESS_OS_APP_VERSION_REQUEST/)
    assert.match(source, /BUSINESS_OS_APP_UPDATE_AVAILABLE/)
    assert.match(source, /BUSINESS_OS_STALE_ASSET/)
  })
}

if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1) }
console.log('\nAll service-worker no-replay tests passed')

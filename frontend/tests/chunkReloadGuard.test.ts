import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LIVE_BUILD_MANIFEST_URL,
  decideChunkReload,
  fetchLiveBuildHash,
  parseChunkReloadMarker,
  serializeChunkReloadMarker,
  type ChunkReloadMarker,
} from '../src/utils/chunkReloadGuard.ts'

// Pins the chunk-recovery reload guard (Sep 2026 incident: a tab open across
// several deploys armed a tab-lifetime '1' sentinel after one reload and could
// never self-heal again -- every lazy page/modal behind a stale chunk stayed
// broken until a hard refresh). The guard must:
//   1. ignore the legacy sentinel,
//   2. allow one reload per (key, LIVE build) and re-arm on a newer live build,
//   3. fall back to one reload per (key, RUNNING build) when the manifest is
//      unreachable, re-arming when a reload lands on a different build,
//   4. stay bounded (<= 2 reloads for any fixed live/running pair),
//   5. read the manifest with cache:'no-store' and never mistake the SPA
//      fallback HTML for a manifest,
//   6. be the ONLY reload gate used by App.tsx and utils/lazyImport.ts.

// 1. legacy sentinel / garbage never blocks
assert.equal(parseChunkReloadMarker('1'), null)
assert.equal(parseChunkReloadMarker(''), null)
assert.equal(parseChunkReloadMarker(null), null)
assert.equal(parseChunkReloadMarker('{"live":"","build":" "}'), null)
assert.deepEqual(
  parseChunkReloadMarker(serializeChunkReloadMarker({ live: 'aaa', build: 'bbb' })),
  { live: 'aaa', build: 'bbb' },
)

// 2. live-hash keyed: one reload per (key, live build); a NEW live build re-arms
const first = decideChunkReload(null, 'live-1', 'run-0')
assert.equal(first.allow, true)
assert.equal(first.reason, 'live-build-first-attempt')
assert.deepEqual(first.marker, { live: 'live-1', build: 'run-0' })
const repeat = decideChunkReload(first.marker, 'live-1', 'run-0')
assert.equal(repeat.allow, false, 'the same live build must not reload twice for one key')
assert.equal(repeat.reason, 'live-build-already-tried')
const redeployed = decideChunkReload(first.marker, 'live-2', 'run-0')
assert.equal(redeployed.allow, true, 'a newer live build must re-arm the guard')
assert.equal(redeployed.reason, 'live-build-changed')

// 3. fallback when the live hash is unknown: one reload per running build
const blind = decideChunkReload(null, null, 'run-0')
assert.equal(blind.allow, true)
assert.equal(blind.reason, 'running-build-first-attempt')
assert.deepEqual(blind.marker, { live: null, build: 'run-0' })
assert.equal(decideChunkReload(blind.marker, null, 'run-0').allow, false, 'same running build must not reload twice blind')
assert.equal(decideChunkReload(blind.marker, null, 'run-1').allow, true, 'a reload that landed on a new build re-arms')
// mixed: a live-keyed marker still blocks a blind attempt on the same running build
assert.equal(decideChunkReload(first.marker, null, 'run-0').allow, false)
// mixed: a blind marker followed by a now-known live hash gets exactly one more try
const afterBlind = decideChunkReload(blind.marker, 'live-1', 'run-0')
assert.equal(afterBlind.allow, true)
assert.equal(decideChunkReload(afterBlind.marker, 'live-1', 'run-0').allow, false)
assert.equal(decideChunkReload(afterBlind.marker, null, 'run-0').allow, false)
// empty running hash degrades to 'dev' rather than to "always allow"
assert.equal(decideChunkReload({ live: null, build: 'dev' }, null, '').allow, false)

// 4. bounded: worst-case alternation of known/unknown live hash on one build
{
  let marker: ChunkReloadMarker | null = null
  let reloads = 0
  for (let i = 0; i < 20; i += 1) {
    const decision = decideChunkReload(marker, i % 2 ? 'live-1' : null, 'run-0')
    if (decision.allow) {
      reloads += 1
      marker = decision.marker
    }
  }
  assert.ok(reloads <= 2, `alternating live/blind decisions must stay bounded, got ${reloads}`)
}

// 5. manifest fetch: no-store, JSON only, every failure -> null
{
  type Call = { url: string; init: RequestInit | undefined }
  const calls: Call[] = []
  const stub = (status: number, contentType: string, body: string) => (
    async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, init })
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
        json: async () => JSON.parse(body) as unknown,
      } as unknown as Response
    }
  )
  assert.equal(
    await fetchLiveBuildHash(stub(200, 'application/json', '{"hash":"95037fa81a17df84","revision":"abc"}')),
    '95037fa81a17df84',
  )
  assert.equal(calls[0]?.url, LIVE_BUILD_MANIFEST_URL)
  assert.equal(calls[0]?.init?.cache, 'no-store', 'the manifest must bypass the HTTP cache')
  assert.equal(
    await fetchLiveBuildHash(stub(200, 'text/html; charset=utf-8', '{}')),
    null,
    'the SPA fallback HTML must not be mistaken for a manifest',
  )
  assert.equal(await fetchLiveBuildHash(stub(404, 'application/json', '{"hash":"x"}')), null)
  assert.equal(await fetchLiveBuildHash(stub(200, 'application/json', '{"hash":""}')), null)
  assert.equal(await fetchLiveBuildHash(async () => { throw new Error('offline') }), null)
}

// 6. source shape: both consumers gate on the guard, nobody keeps a '1' sentinel
const here = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => fs.readFileSync(path.join(here, '..', rel), 'utf8')
const lazyImport = read('src/utils/lazyImport.ts')
const app = read('src/App.tsx')
for (const [name, src] of [['utils/lazyImport.ts', lazyImport], ['App.tsx', app]] as const) {
  assert.match(src, /from '\.\/(?:utils\/)?chunkReloadGuard\.ts'/, `${name} must import the shared reload guard`)
  assert.match(src, /await claimChunkReload\(/, `${name} must claim its recovery reload through the guard`)
  assert.match(src, /clearChunkReloadMarker\(/, `${name} must clear the marker through the guard on success`)
  assert.doesNotMatch(src, /setItem\([^)]*,\s*'1'\)/, `${name} must not arm a tab-lifetime '1' sentinel`)
  assert.doesNotMatch(src, /getItem\([^)]*\)\s*[!=]==\s*'1'/, `${name} must not gate on the '1' sentinel`)
}
// the nested path reloads immediately, so it must persist drafts first
assert.match(lazyImport, /flushPendingWorkDrafts\(\)\s*\n\s*const url = new URL\(window\.location\.href\)/, 'nested chunk recovery must flush drafts before navigating')
// App.tsx must not re-arm the marker on a final failure (that turned every
// navigation into another reload within the same build)
assert.doesNotMatch(app, /clearRetryMarker\(/, 'App.tsx must not keep its own marker reset that re-armed on final failure')
// the manifest the guard depends on must keep being emitted by the build
assert.match(read('vite.config.ts'), /fileName: 'business-os-build\.json'/, 'vite must keep emitting /business-os-build.json')

console.log('chunkReloadGuard.test.ts OK')

// K5: the offline device snapshot is retired. Until U-drain removes the two
// web-api.ts callers, api/offlineSnapshotTransport.ts is a stub that must not
// touch the network or IndexedDB.
//
// Discriminating: the fixture is the exact state in which the old module DID
// run its eleven reads -- a configured sync server, a stored signed-in user,
// navigator online and `force: true` (which skipped the five-minute floor).
// Against the old module this test sees apiFetch reach fetch() for
// /api/settings first; against the stub it sees nothing.
//
// Run: node tests/offlineSnapshotRetired.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'

const requests: string[] = []
const storage = new Map<string, string>([['businessos_user', JSON.stringify({ id: 7, name: 'Cashier' })]])
const browserStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  removeItem: (key: string) => { storage.delete(key) },
}
Object.assign(globalThis, {
  window: {
    location: { origin: 'https://till.example.test', href: 'https://till.example.test/' },
    localStorage: browserStorage,
    sessionStorage: browserStorage,
    setTimeout, clearTimeout,
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
  },
  fetch: async (input: unknown) => {
    requests.push(String(input))
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  },
})
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true })

const http = await import('../src/api/http.ts')
http.setSyncServerUrl('https://till.example.test')
const { refreshOfflineDeviceSnapshot } = await import('../src/api/offlineSnapshotTransport.ts')

const result = await refreshOfflineDeviceSnapshot({ force: true })
await new Promise((resolve) => setTimeout(resolve, 50))
assert.deepEqual(requests, [], 'a forced snapshot on a signed-in, online till must make no request at all')
assert.deepEqual(result, { skipped: true, reason: 'offline_snapshot_retired' })
console.log('PASS the retired snapshot makes no request on a signed-in, online, forced run')

const source = fs.readFileSync(new URL('../src/api/offlineSnapshotTransport.ts', import.meta.url), 'utf8')
assert.doesNotMatch(source, /^\s*import\b/m, 'the stub imports nothing -- no http, no Dexie, no transports')
assert.match(source, /K5: stub until U-drain removes the web-api\.ts callers/, 'the stub names the lane that deletes it')
console.log('PASS the stub imports nothing and names its removal owner')

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import * as scopes from '../src/api/actorReadScope.ts'
import { salesCustomerPickerFallbackMatches } from '../src/api/customerPickerMatch.ts'

const timers: Array<() => void> = []
const storage = new Map<string, string>()
const fakeStorage = { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value) }
Object.assign(globalThis, { window: { location: { origin: 'http://local' }, localStorage: fakeStorage, sessionStorage: fakeStorage, setTimeout: (fn: () => void) => timers.push(fn) } })
function switchActor(id: number) { storage.set('businessos_user', JSON.stringify({ id })); scopes.resetActorReadSession() }
function deferred() { let resolve!: (v: unknown) => void; let reject!: (e: unknown) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
const requests: ReturnType<typeof deferred>[] = []
let localReads = 0, mirrors = 0
let localRows: unknown[] = [{ id: 99, name: 'Prior administrator private row' }]
let localDeferred: ReturnType<typeof deferred> | null = null
const localDbModule = { getLocalDb: async () => ({ table: () => ({ orderBy: () => ({ toArray: () => { localReads++; return localDeferred?.promise || Promise.resolve(localRows) } }) }) }) }
const mirrorModule = { shouldPersistLocalMirror: () => true, mirrorTable: (_name: string, scope: scopes.ActorReadScope) => async (data: unknown[]) => { scopes.assertActorReadScope(scope); mirrors++; localRows = data } }
const source = readFileSync(new URL('../src/api/contactReadTransport.ts', import.meta.url), 'utf8')
  .replace("import('./lazyLocalDb.ts')", 'Promise.resolve(localDbModule)')
  .replace("import('./localMirrors.ts')", 'Promise.resolve(mirrorModule)')
const mod = { exports: {} as any }
const code = transformSync(source, { loader: 'ts', format: 'cjs' }).code
new Function('module', 'exports', 'require', 'localDbModule', 'mirrorModule', code)(mod, mod.exports, (name: string) => {
  if (name.endsWith('/actorReadScope.ts')) return scopes
  if (name.endsWith('/httpState.ts')) return { getSyncServerUrl: () => '' }
  if (name.endsWith('/http.ts')) return { apiFetch: () => { const read = deferred(); requests.push(read); return read.promise }, isInvalidSessionError: () => false }
  if (name.endsWith('/customerIdentity.ts')) return { filterSelectableCustomerRows: (rows: unknown[]) => rows }
  if (name.endsWith('/customerPickerMatch.ts')) return { salesCustomerPickerFallbackMatches }
  throw new Error(name)
}, localDbModule, mirrorModule)
const { getCustomers, getSuppliers, getSalesCustomerPicker, invalidateCustomerReadCache } = mod.exports
const stale = (error: any) => error?.code === 'stale_read_scope'
switchActor(1)
const admin = getCustomers(); requests.at(-1)!.resolve([{ id: 1, name: 'Admin-only' }]); await admin
const cached = getCustomers(); switchActor(2); await assert.rejects(cached, stale)
const denied = getCustomers(); requests.at(-1)!.reject({ status: 403 }); await assert.rejects(denied, (e: any) => e.status === 403)
assert.equal(localReads, 0)
timers.splice(0).forEach(fn => fn()); await flush(); assert.equal(mirrors, 0, 'delayed admin mirror retired')

switchActor(3)
const old = getSuppliers(); const oldRequest = requests.at(-1)!
switchActor(4)
const fresh = getSuppliers(); const freshRequest = requests.at(-1)!
assert.notEqual(oldRequest, freshRequest, 'new actor never deduplicates with old inflight')
oldRequest.resolve([{ id: 3 }]); await assert.rejects(old, stale)
freshRequest.resolve([{ id: 4 }]); assert.deepEqual(await fresh, [{ id: 4 }])
assert.deepEqual(await getSuppliers(), [{ id: 4 }], 'old finally cannot remove/publish over new cache')
for (const status of [401, 403]) {
  const request = getCustomers({ search: String(status) }); requests.at(-1)!.reject({ status })
  await assert.rejects(request, (e: any) => e.status === status)
}
const offlineUnknown = getCustomers({ search: 'legacy' }); requests.at(-1)!.reject(new Error('offline'))
await assert.rejects(offlineUnknown, /offline/); assert.equal(localReads, 0, 'unowned local rows never substitute')

// Live authenticated reads never seed legacy mirror provenance, even if a
// mirror implementation would return a successful-looking empty result.
assert.equal(mirrors, 0)
// Only a non-live, unauthenticated local runtime can preserve this old path.
storage.delete('businessos_user'); (globalThis as any).window.location.origin = 'file://'; scopes.resetActorReadSession()
const online = getCustomers(); requests.at(-1)!.resolve([{ id: 8, name: 'Sok Dara', phone: '012 345 678', notes: 'private' }]); await online
timers.splice(0).forEach(fn => fn()); await flush()
const offline = getSalesCustomerPicker({ search: '+85512345678' }); requests.at(-1)!.reject(new Error('offline'))
const result = await offline
assert.equal(result.items[0].id, 8); assert.equal('notes' in result.items[0], false)
for (const status of [401, 403]) {
  const blocked = getSalesCustomerPicker(); requests.at(-1)!.reject({ status })
  await assert.rejects(blocked, (e: any) => e.status === status)
}
localDeferred = deferred()
const lateLocal = getSalesCustomerPicker(); requests.at(-1)!.reject(new Error('offline')); await flush()
switchActor(5); localDeferred.resolve([{ id: 8 }]); await assert.rejects(lateLocal, stale); localDeferred = null
const latePicker = getSalesCustomerPicker(); switchActor(6); requests.at(-1)!.resolve({ items: [{ id: 5 }] }); await assert.rejects(latePicker, stale)
const invalidated = getCustomers(); invalidateCustomerReadCache(); requests.at(-1)!.resolve([{ id: 6 }]); await assert.rejects(invalidated, stale)
const sameActorReauth = getCustomers(); scopes.resetActorReadSession(); requests.at(-1)!.resolve([{ id: 6 }]); await assert.rejects(sameActorReauth, stale)
console.log('PASS actual contacts transport with real opaque scopes: cached/inflight actor switch, late mirrors/local reads, authorization denial, channel invalidation and same-actor phone fallback')

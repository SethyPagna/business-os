import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import * as scopes from '../src/api/actorReadScope.ts'

const storage = new Map<string, string>()
const localStorage = { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value) }
Object.assign(globalThis, { window: { location: { origin: 'https://local' }, localStorage, dispatchEvent() {}, addEventListener() {} } })
function deferred() { let resolve!: (v: any) => void; let reject!: (e: any) => void; const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
let compression = deferred(), fetchResponse = deferred(), apiResponse = deferred()
let sent = 0, downloads = 0
const file = new File(['test'], 'image.jpg', { type: 'image/jpeg' })
Object.assign(globalThis, { fetch: () => { sent++; return fetchResponse.promise } })
Object.assign(globalThis, { XMLHttpRequest: class {
  upload = {}; status = 200; responseText = '{"data":{"public_path":"/uploaded"}}'; onload = () => {}; onerror = () => {}; onabort = () => {}
  open() {} setRequestHeader() {} abort() {} send() { sent++; fetchResponse.promise.then(() => this.onload()) }
} })
Object.assign(globalThis, { document: { createElement: () => ({ click() { downloads++ }, remove() {} }), body: { appendChild() {} } } })
const modules = new Map<string, any>()
function load(name: string): any {
  if (modules.has(name)) return modules.get(name)
  const mod = { exports: {} as any }; modules.set(name, mod.exports)
  const source = readFileSync(new URL(`../src/api/${name}.ts`, import.meta.url), 'utf8')
  const code = transformSync(source, { loader: 'ts', format: 'cjs' }).code
  new Function('module', 'exports', 'require', code)(mod, mod.exports, (path: string) => {
    if (path.endsWith('/actorReadScope.ts')) return scopes
    if (path.endsWith('/importTransport.ts')) return load('importTransport')
    if (path.endsWith('/http.ts')) return {
      getSyncServerUrl: () => 'https://local', requireLiveServerWrite() {}, apiFetch: () => apiResponse.promise,
      // Deliberately permissive fallback proves the transport cannot rely on
      // a generic wrapper to mask permission errors correctly.
      route: async (_key: string, server: () => Promise<any>, fallback?: () => any) => { try { return await server() } catch (error) { if (fallback) return fallback(); throw error } },
    }
    if (path.endsWith('/imageCompression.ts')) return { compressImageFile: () => compression.promise, isCompressibleImageFile: () => true }
    if (path.endsWith('/videoCompression.ts')) return { isCompressibleVideoFile: () => false }
    if (path.endsWith('/multipartHeaders.ts')) return { buildMultipartHeaders: () => ({}) }
    if (path.endsWith('/deviceInfo.ts')) return { getClientDeviceInfo: () => ({}) }
    if (path.endsWith('/mediaUpload.ts')) return { canonicalizePersistedMediaPath: (v: unknown) => v }
    if (path.endsWith('/actorQuery.ts')) return { getCurrentUserContext: () => ({ userId: 1 }) }
    if (path.endsWith('/publicAssetUrls.ts')) return { resolvePublicAssetUrl: (v: unknown) => v }
    if (path.endsWith('/query.ts')) return { buildQueryString: () => '', appendQuery: (v: string) => v }
    throw new Error(path)
  })
  modules.set(name, mod.exports)
  return mod.exports
}
const products = load('productImageUploadTransport'), files = load('fileTransport'), imports = load('importJobsTransport'), form = load('importTransport')
const stale = (e: any) => e?.code === 'stale_read_scope'
const notDispatched = (e: any) => e?.code === 'actor_session_quarantined' && e?.outcome === 'not_dispatched'
for (const invoke of [
  () => products.uploadProductImage({ file }),
  () => products.uploadProductImage({ filePath: 'data:image/jpeg;base64,dGVzdA==' }),
  () => files.uploadFileAsset({ file }),
  () => files.uploadUserAvatar({ filePath: 'data:image/jpeg;base64,dGVzdA==' }),
  () => imports.uploadImportJobImages({ jobId: 1, files: [{ file }] }),
]) {
  compression = deferred(); sent = 0
  const pending = invoke(); scopes.resetActorReadSession(); compression.resolve(file)
  await assert.rejects(pending, notDispatched); assert.equal(sent, 0, 'earlier actor cannot dispatch after compression')
}
// A dispatched mutation must keep its real response after a session change.
for (const invoke of [() => products.uploadProductImage({ file }), () => files.uploadFileAsset({ file }), () => form.apiFormPost('/upload', new FormData())]) {
  compression = deferred(); fetchResponse = deferred(); sent = 0
  const pending = invoke(); compression.resolve(file); await flush(); assert.equal(sent, 1)
  scopes.resetActorReadSession(); fetchResponse.resolve(new Response('{"data":{"public_path":"/uploaded"}}', { status: 200 }))
  assert.equal((await pending).public_path, '/uploaded')
}
apiResponse = deferred(); const admin = imports.listImportJobs(); apiResponse.resolve({ jobs: [{ id: 'admin-private' }] }); await admin
scopes.resetActorReadSession(); apiResponse = deferred(); const employee = imports.listImportJobs(); apiResponse.reject({ status: 503 })
assert.deepEqual(await employee, { jobs: [], unavailable: true, transient: true })
apiResponse = deferred(); const seeded = imports.listImportJobs(); apiResponse.resolve({ jobs: [{ id: 'employee' }] }); await seeded
for (const status of [401, 403]) { apiResponse = deferred(); const denied = imports.listImportJobs(); apiResponse.reject({ status }); await assert.rejects(denied, (e: any) => e.status === status) }
apiResponse = deferred(); const late = imports.listImportJobs(); scopes.resetActorReadSession(); apiResponse.resolve({ jobs: [{ id: 'late-private' }] }); await assert.rejects(late, stale)
compression = deferred(); compression.resolve(file); fetchResponse = deferred(); sent = 0
const partial = imports.uploadImportJobImages({ jobId: 1, files: [{ file }, { file }], batchSize: 1, onProgress: () => scopes.resetActorReadSession() })
await flush(); assert.equal(sent, 1)
fetchResponse.resolve(new Response('{"data":{"files":[{"id":71}]}}', { status: 200 }))
await assert.rejects(partial, (e: any) => e.outcome === 'partially_dispatched' && e.completedBatches === 1 && e.uploaded[0].id === 71)
assert.equal(sent, 1, 'second batch is blocked without erasing first completed batch')
fetchResponse = deferred(); const csv = imports.downloadImportJobErrors(1); scopes.resetActorReadSession(); fetchResponse.resolve(new Response('secret', { status: 200 })); await assert.rejects(csv, stale); assert.equal(downloads, 0)
// A cross-tab cookie identity change quarantines even an otherwise current
// freshly captured scope. No global fetch interception is involved.
storage.set('businessos_read_session', 'external-login')
sent = 0
await assert.rejects(form.apiFormPost('/upload', new FormData()), notDispatched)
await assert.rejects(imports.downloadImportJobErrors(1), notDispatched)
assert.equal(sent, 0)
console.log('PASS private transports: real scope guards fence compression/dispatch, dispatched write outcomes survive, ImportJobs fallback is actor-scoped and denial-safe, CSV late publication blocked')

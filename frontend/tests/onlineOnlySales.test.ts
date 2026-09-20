import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import * as ownership from '../src/api/offlineQueueOwnership.ts'
import { serializePendingSyncPreview } from '../src/api/syncPreview.ts'

type Row = Record<string, any>
const source = (file: string) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
const ownerA = { version: 1, actor_id: 71, organization_id: null, authority: 'https://shop.example', runtime: 'cloudflare-workers' }
const ownerB = { ...ownerA, actor_id: 72 }
let actor: Row = ownerA
let scope = 1
let liveActor: Row | null = ownerA
let beforeRead: (() => void) | undefined
let beforeTransaction: (() => void) | undefined
let postError: Error | null = null
let posts = 0
let recoveryCalls: Row[] = []
const rows = new Map<number, Row>()
const mirrors = new Map<number, Row>()
const clone = <T,>(value: T): T => structuredClone(value)
const authStorage = { getItem: () => JSON.stringify({ id: actor.actor_id, organization_id: actor.organization_id }) }
Object.assign(globalThis, { window: { location: { origin: ownerA.authority }, sessionStorage: authStorage, localStorage: authStorage, dispatchEvent() {} }, CustomEvent: class {} })
const table = (data: Map<number, Row>) => ({
  orderBy: () => ({ toArray: async () => { beforeRead?.(); return [...data.values()].map(clone) } }),
  where: () => ({ equals: () => ({ toArray: async () => [...data.values()].map(clone) }) }),
  get: async (id: number) => clone(data.get(id)),
  delete: async (id: number) => data.delete(id),
  put: async (row: Row) => { data.set(row._seq, clone(row)) },
})
const db = { table: (name: string) => table(name === 'sales' ? mirrors : rows), transaction: async (...args: any[]) => { beforeTransaction?.(); return args.at(-1)() } }
const actorScope = { captureActorReadScope: () => scope, isActorReadScopeCurrent: (value: number) => value === scope }
const api = {
  apiFetch: async (method: string, _path: string, payload: Row) => {
    if (method === 'GET') { if (!liveActor) throw Error('unauthenticated'); return { owner: clone(liveActor) } }
    posts++; if (postError) throw postError
    return { id: 10, client_request_id: payload.client_request_id, offline_owner: payload.offline_owner }
  },
  route: (_channel: string, run: () => unknown) => run(), isNetErr: () => false,
  isTransientGatewayError: (status: number) => status === 503, isWriteBlockedError: () => false, isWriteConflictError: () => false,
}
function load(text: string, dependencies: Row): Row {
  const output = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', output)((key: string) => { assert.ok(key in dependencies, key); return dependencies[key] }, module, module.exports)
  return module.exports
}
const syncRuntime = { dispatchSyncUpdates() {}, emitSyncQueueChanged() {}, DISCARD_SYNC_UPDATE_CHANNELS: [], OFFLINE_SALE_SYNC_UPDATE_CHANNELS: [] }
const pending = load(source('api/pendingSyncTransport.ts'), {
  './lazyLocalDb.ts': { getLocalDb: async () => db }, './saleWriteTransport.ts': { syncPendingSalesQueue: async (options: Row) => { recoveryCalls.push(options); return { success: true } } },
  './http.ts': api, './actorReadScope.ts': actorScope, './offlineQueueOwnership.ts': ownership, './syncPreview.ts': { serializePendingSyncPreview }, './syncRuntime.ts': syncRuntime,
})
const sale = load(source('api/saleWriteTransport.ts'), {
  '../utils/deviceInfo.ts': { getClientDeviceInfo: () => ({}) }, './http.ts': api, './lazyLocalDb.ts': { getLocalDb: async () => db },
  './actorReadScope.ts': actorScope, './offlineQueueOwnership.ts': ownership, './syncRuntime.ts': syncRuntime,
})
function row(seq: number, owner: unknown): Row { return { _seq: seq, id: `sale-${seq}`, channel: 'sales:create', status: 'pending', entity_id: -seq, entity_name: `private-${seq}`, error: `private-error-${seq}`, created_at: '2026-01-01', updated_at: '2026-01-01', payload: { client_request_id: `sale-${seq}`, offline_owner: owner } } }
function reset() { rows.clear(); mirrors.clear(); actor = ownerA; liveActor = ownerA; scope++; posts = 0; recoveryCalls = []; beforeRead = undefined; beforeTransaction = undefined; postError = null }
let passed = 0
async function test(name: string, run: () => unknown) { await run(); passed++; console.log(`PASS ${name}`) }

await test('new network-failed sale preserves supplied request/draft and does not queue a business write', async () => {
  reset(); postError = Object.assign(Error('offline'), { status: 503 }); const draft = { client_request_id: 'original-id', items: [{ product_id: 1 }] }; const before = clone(draft)
  await assert.rejects(sale.createSale(draft), (error: any) => error.code === 'sale_confirmation_required' && error.client_request_id === 'original-id')
  assert.deepEqual(draft, before); assert.equal(rows.size, 0); assert.equal(mirrors.size, 0)
})
await test('ordinary/forced background queue calls never replay or clear legacy work', async () => {
  reset(); rows.set(1, row(1, ownerA)); await sale.syncPendingSalesQueue(); await sale.syncPendingSalesQueue({ force: true }); assert.equal(posts, 0); assert.equal(rows.size, 1)
})
await test('preview exposes only authenticated actor rows, counts others without private payload', async () => {
  reset(); rows.set(1, row(1, ownerA)); rows.set(2, row(2, ownerB)); rows.set(3, row(3, null))
  const state = await pending.getPendingSyncState(); assert.equal(state.total, 1); assert.equal(state.quarantined, 2); assert.equal(state.items[0].entity_name, 'private-1'); assert.doesNotMatch(JSON.stringify(state), /private-2|private-3|private-error-2|private-error-3/)
  assert.deepEqual(state.owner, ownerA); assert.ok(state.review_token)
})
await test('unverified cookie and mid-read account switch expose no actor details or action token', async () => {
  for (const change of ['cookie', 'during-read']) { reset(); rows.set(1, row(1, ownerA)); if (change === 'cookie') liveActor = ownerB; else beforeRead = () => { scope++; actor = ownerB; liveActor = ownerB }; const state = await pending.getPendingSyncState(); assert.equal(state.total, 0); assert.equal(state.items.length, 0); assert.equal(state.review_token, null); assert.equal(state.quarantined, 1) }
})
await test('explicit same-owner reviewed recovery required; missing/stale token cannot retarget B', async () => {
  reset(); rows.set(1, row(1, ownerA)); await assert.rejects(pending.retryPendingSyncNow(), /Keep this pending sale/); const state = await pending.getPendingSyncState(); await pending.retryPendingSyncNow(state.review_token); assert.deepEqual(recoveryCalls[0], { force: true, manualRecovery: true, expectedOwner: ownerA, reviewedRows: [row(1, ownerA)] })
  actor = ownerB; liveActor = ownerB; scope++; await assert.rejects(pending.retryPendingSyncNow(state.review_token), /Keep this pending sale/); assert.equal(recoveryCalls.length, 1)
})
await test('manual recovery dispatches only reviewed unchanged rows, not newer same-account arrivals', async () => {
  reset(); rows.set(1, row(1, ownerA)); rows.set(2, row(2, ownerA)); const result = await sale.syncPendingSalesQueue({ manualRecovery: true, expectedOwner: ownerA, reviewedRows: [row(1, ownerA)], force: true }); assert.equal(result.synced, 1); assert.equal(posts, 1); assert.deepEqual([...rows.keys()], [2])
})
await test('manual recovery never invents a missing or inconsistent original request identity', async () => {
  for (const requestId of [undefined, 'different-request']) { reset(); const original = row(1, ownerA); original.payload.client_request_id = requestId; rows.set(1, original); const result = await sale.syncPendingSalesQueue({ manualRecovery: true, expectedOwner: ownerA, reviewedRows: [clone(original)], force: true }); assert.equal(result.synced, 0); assert.equal(posts, 0); assert.equal(rows.get(1)?.payload.client_request_id, requestId) }
})
await test('discard removes only exact reviewed A rows/mirrors; B, ownerless, new and syncing rows survive', async () => {
  reset(); rows.set(1, row(1, ownerA)); rows.set(2, row(2, ownerB)); rows.set(3, row(3, null)); rows.set(4, { ...row(4, ownerA), status: 'syncing' }); mirrors.set(-1, { client_request_id: 'sale-1', offline_owner: ownerA })
  const state = await pending.getPendingSyncState(); rows.set(5, row(5, ownerA)); const result = await pending.discardPendingSyncQueue('explicit review', state.review_token); assert.equal(result.discarded, 1); assert.deepEqual([...rows.keys()], [2, 3, 4, 5]); assert.equal(mirrors.size, 0)
})
await test('discard cannot clear replaced rows, foreign mirror collisions or a changed-account transaction', async () => {
  reset(); rows.set(1, row(1, ownerA)); const state = await pending.getPendingSyncState(); rows.set(1, { ...row(1, ownerA), sync_lease: 'new-lease' }); assert.equal((await pending.discardPendingSyncQueue('', state.review_token)).discarded, 0)
  reset(); rows.set(1, row(1, ownerA)); mirrors.set(-1, { client_request_id: 'sale-B', offline_owner: ownerB }); const own = await pending.getPendingSyncState(); assert.equal((await pending.discardPendingSyncQueue('', own.review_token)).discarded, 1); assert.equal(mirrors.size, 1)
  reset(); rows.set(1, row(1, ownerA)); const stale = await pending.getPendingSyncState(); beforeTransaction = () => { scope++; actor = ownerB }; assert.equal((await pending.discardPendingSyncQueue('', stale.review_token)).discarded, 0); assert.equal(rows.size, 1)
})
await test('all automatic sale triggers are absent and background registration is a no-op', () => {
  const web = source('web-api.ts'); const sw = source('public-runtime/service-worker.ts'); const runtime = source('api/syncRuntime.ts')
  const functionBody = (text: string, name: string) => { const parsed = ts.createSourceFile('test.ts', text, ts.ScriptTarget.Latest, true); return parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name)?.getText(parsed) || '' }
  assert.doesNotMatch(functionBody(web, 'runOfflineMaintenance'), /syncPendingSalesQueue/)
  assert.doesNotMatch(functionBody(sw, 'syncOutbox'), /replayQueuedSale\(/)
  assert.doesNotMatch(functionBody(sw, 'syncOutboxOnce'), /syncOutbox\(/)
  assert.doesNotMatch(functionBody(runtime, 'registerOutboxBackgroundSync'), /\.register\(|postMessage\(/)
  assert.match(web, /module\.discardPendingSyncQueue\(reason, reviewToken\)/)
})
console.log(`${passed} online-only and private recovery checks passed`)

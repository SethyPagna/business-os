import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import * as ownership from '../src/api/offlineQueueOwnership.ts'
import * as preview from '../src/api/syncPreview.ts'

type Row = Record<string, any>
const owner = { version: 1, actor_id: 71, organization_id: null, authority: 'https://shop.example', runtime: 'cloudflare-workers' }
const foreign = { ...owner, actor_id: 72 }
const storage = { getItem: () => JSON.stringify({ id: owner.actor_id, organization_id: null }) }
Object.assign(globalThis, { window: { location: { origin: owner.authority }, sessionStorage: storage, localStorage: storage, dispatchEvent() {} }, CustomEvent: class {} })
const clone = <T,>(value: T): T => structuredClone(value)
const rows = new Map<number, Row>()
const mirrors = new Map<number, Row>()
const posts: string[] = []
const table = (data: Map<number, Row>) => ({
  orderBy: () => ({ toArray: async () => [...data.values()].map(clone) }),
  where: () => ({ equals: () => ({ toArray: async () => [...data.values()].map(clone) }) }),
  get: async (id: number) => clone(data.get(id)),
  delete: async (id: number) => data.delete(id),
  put: async (row: Row) => { data.set(row._seq, clone(row)) },
})
const db = { table: (name: string) => table(name === 'sales' ? mirrors : rows), transaction: async (...args: any[]) => args.at(-1)() }
const api = {
  apiFetch: async (method: string, _path: string, payload: Row) => {
    if (method === 'GET') return { owner }
    posts.push(payload.client_request_id)
    return { id: 10, client_request_id: payload.client_request_id, offline_owner: payload.offline_owner }
  },
  route: (_channel: string, run: () => unknown) => run(), isNetErr: () => false,
  isTransientGatewayError: () => false, isWriteBlockedError: () => false, isWriteConflictError: () => false,
}
const common = {
  './lazyLocalDb.ts': { getLocalDb: async () => db }, './http.ts': api,
  './actorReadScope.ts': { captureActorReadScope: () => 1, isActorReadScopeCurrent: () => true },
  './offlineQueueOwnership.ts': ownership,
  './syncRuntime.ts': { dispatchSyncUpdates() {}, emitSyncQueueChanged() {}, DISCARD_SYNC_UPDATE_CHANNELS: [], OFFLINE_SALE_SYNC_UPDATE_CHANNELS: [] },
}
function load(file: string, dependencies: Row): Row {
  const source = fs.readFileSync(new URL(`../src/api/${file}.ts`, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)((id: string) => { assert.ok(id in dependencies, id); return dependencies[id] }, module, module.exports)
  return module.exports
}
const sales = load('saleWriteTransport', { ...common, '../utils/deviceInfo.ts': { getClientDeviceInfo: () => ({}) } })
const pending = load('pendingSyncTransport', { ...common, './saleWriteTransport.ts': sales, './syncPreview.ts': preview })
function row(seq: number, actor: unknown = owner): Row {
  return { _seq: seq, id: `sale-${seq}`, channel: 'sales:create', status: 'pending', entity_id: -seq, created_at: '2026-01-01', updated_at: '2026-01-01', payload: { client_request_id: `sale-${seq}`, offline_owner: actor } }
}
function seed(count: number) {
  rows.clear(); mirrors.clear(); posts.length = 0
  // Deliberately reverse storage order; equal dates must sort by sequence.
  for (let seq = count; seq > 0; seq--) rows.set(seq, row(seq))
  rows.set(100, row(100, foreign))
  rows.set(101, row(101, null))
  rows.set(102, { ...row(102), channel: 'products:update' })
}
for (const action of ['discard', 'recover']) {
  for (const count of [26, 40]) {
    seed(count)
    // Creation date precedes sequence: this high-sequence row must be shown.
    rows.get(count)!.created_at = '2025-12-31'
    const state = await pending.getPendingSyncState()
    const shown = [count, ...Array.from({ length: 24 }, (_, i) => i + 1)]
    assert.equal(state.total, count)
    assert.equal(state.quarantined, 3)
    assert.deepEqual(state.items.map((item: Row) => item._seq), shown)
    rows.set(200, row(200)) // Not part of the reviewed snapshot.
    if (count === 40) {
      rows.get(1)!.payload = { ...rows.get(1)!.payload, note: 'changed after review' }
      rows.get(2)!.sync_lease = 'new lease after review'
    }
    const eligible = shown.filter(seq => count !== 40 || (seq !== 1 && seq !== 2))
    if (action === 'discard') {
      const result = await pending.discardPendingSyncQueue('explicit review', state.review_token)
      assert.equal(result.discarded, eligible.length)
    } else {
      const result = await pending.retryPendingSyncNow(state.review_token)
      assert.equal(result.synced, eligible.length)
      assert.deepEqual([...posts].sort(), eligible.map(seq => `sale-${seq}`).sort())
    }
    for (const seq of eligible) assert.equal(rows.has(seq), false)
    for (const seq of [...(count === 40 ? [1, 2] : []), 25, 100, 101, 102, 200]) assert.equal(rows.has(seq), true, `${action} retains unreviewed/changed row ${seq}`)
    assert.equal(rows.size, count + 4 - eligible.length)
    console.log(`PASS ${action}: ${count} rows, visible ordered prefix only; foreign, unseen, new and changed rows retained`)
  }
}

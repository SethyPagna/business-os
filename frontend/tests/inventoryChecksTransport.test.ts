import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as query from '../src/api/query.ts'

let actor = 1
let authority = 1
let current = { branchId: '1', sessionId: 'session-a', epoch: 1 }
const calls: Array<{ method: string; path: string; body: any; options: any }> = []
const routes: Array<{ channel: string; local: unknown; options: any }> = []
let response: any = { item: { id: 'confirmed' } }
let pending: Promise<unknown> | null = null
let fail: unknown = null
let beforeDispatch: (() => void) | null = null
const source = readFileSync(new URL('../src/api/inventoryChecksTransport.ts', import.meta.url), 'utf8')
const exports: any = {}
const dependencies: Record<string, unknown> = {
  './query.ts': query,
  './actorReadScope.ts': {
    captureActorReadScope: () => ({ authority, channel: 'inventoryChecks', revision: '1' }),
    captureActorWriteIdentity: () => ({ owner: actor, epoch: actor }),
    assertActorReadScope: (scope: any) => { if (scope.authority !== authority) throw new Error('stale authority') },
    assertActorWriteIdentity: (identity: any) => { if (identity.owner !== actor) throw new Error('stale owner') },
  },
  './http.ts': {
    apiFetch: async (method: string, path: string, body: any, _headers: unknown, options: any) => {
      calls.push({ method, path, body, options })
      if (pending) await pending
      if (fail) throw fail
      return response
    },
    route: async (channel: string, run: () => Promise<unknown>, local: unknown, options: unknown) => {
      routes.push({ channel, local, options })
      beforeDispatch?.()
      return run()
    },
  },
}
new Function('exports', 'require', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(exports, (name: string) => {
  assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`)
  return dependencies[name]
})
const capture = () => exports.captureInventoryCheckWriteScope(current, (context: typeof current) => current.branchId === context.branchId && current.sessionId === context.sessionId && current.epoch === context.epoch)
const save = (scope = capture()) => exports.saveInventoryCheckObservation(scope, 7, { state: 'done', counted_quantity: 0 }, 2, 3, 'request-a')
const signal = new AbortController().signal
await exports.readInventoryCheckProducts({ query: 'a & b', startDate: '2026-10-01', page: 2 }, signal)
assert.equal(calls.at(-1)?.path, '/api/inventory-checks/products?query=a+%26+b&startDate=2026-10-01&page=2')
assert.equal(calls.at(-1)?.options.signal, signal)
await exports.readInventoryCheckSessions({ page: 2 }, signal)
await exports.readInventoryCheckSession('a/b', signal)
assert.equal(calls.at(-1)?.path, '/api/inventory-checks/sessions/a%2Fb')
await exports.readInventoryCheckHistory('a/b', { page: 3 }, signal)
assert.equal(routes.length, 0, 'reads never enter route caches or local fallbacks')
await save()
assert.equal(calls.at(-1)?.body.counted_quantity, 0)
assert.equal(calls.at(-1)?.body.expectedRevision, 2)
assert.equal(routes.at(-1)?.channel, 'inventoryChecks:session-a')
assert.equal(routes.at(-1)?.local, null)
assert.equal(routes.at(-1)?.options.isWrite, true)
assert.ok(routes.at(-1)?.options.writeScope && routes.at(-1)?.options.writeIdentity)
const previous = capture()
current = { ...current, sessionId: 'session-b', epoch: 2 }
const sent = calls.length
await assert.rejects(save(previous), (error: any) => error.code === 'inventory_check_scope_changed' && error.outcome === 'not_dispatched')
assert.equal(calls.length, sent)
current = { ...current, sessionId: 'session-a', epoch: 3 }
await assert.rejects(save(previous), /selection changed/, 'A to B to A must not revive the old editor')
const actorScope = capture()
actor++
await assert.rejects(save(actorScope), /stale owner/)
const authorityScope = capture()
authority++
await assert.rejects(save(authorityScope), (error: any) => error.message === 'stale authority' && error.outcome === 'not_dispatched')
beforeDispatch = () => { current = { ...current, epoch: current.epoch + 1 } }
await assert.rejects(save(), /selection changed/, 'context is checked again at actual dispatch')
beforeDispatch = null
let resolve!: () => void
pending = new Promise<void>(done => { resolve = done })
const delayed = save()
await Promise.resolve()
current = { ...current, branchId: '2', epoch: current.epoch + 1 }
resolve()
await assert.rejects(delayed, (error: any) => error.outcome === 'unknown', 'a sent save cannot be described as rolled back after switching')
pending = null
pending = new Promise<void>(done => { resolve = done })
const revoked = save()
await Promise.resolve()
authority++
resolve()
await assert.rejects(revoked, (error: any) => error.message === 'stale authority' && error.outcome === 'unknown', 'same-owner authority refresh after dispatch must preserve an unknown outcome')
pending = null
const unknown = Object.assign(new Error('lost ack'), { outcome: 'unknown' })
fail = unknown
await assert.rejects(save(), error => error === unknown)
fail = null
current = { branchId: '1', sessionId: '', epoch: 8 }
const input = { title: 'Count', productIds: [7], scope: { query: 'original' }, requestId: 'create-a' }
pending = new Promise<void>(done => { resolve = done })
const created = exports.createInventoryCheckSession(capture(), input)
input.productIds[0] = 99
input.scope.query = 'mutated'
assert.deepEqual(calls.at(-1)?.body.productIds, [7])
assert.equal(calls.at(-1)?.body.scope.query, 'original')
resolve()
await created
pending = null
current = { branchId: '1', sessionId: 's', epoch: 9 }
await exports.changeInventoryCheckSession(capture(), 'close', 4, 'close-a')
assert.equal(calls.at(-1)?.body.action, 'close')
assert.equal(calls.at(-1)?.body.expectedRevision, 4)
assert.throws(() => exports.saveInventoryCheckObservation(capture(), 0, { state: 'done' }, 0, 1, 'invalid'), /product are required/)
console.log('PASS Inventory transport uncached reads, receipt payloads, zero, actor/authority/context fences, A-B-A, lost ACK and immutable request payload')

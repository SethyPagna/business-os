import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import * as money from '../src/utils/moneyPrecision.ts'
import * as scopes from '../src/api/actorReadScope.ts'
import * as httpState from '../src/api/httpState.ts'
import { ensureClientRequestId } from '../src/api/requestIds.ts'

const data = new Map<string, string>([['businessos_read_session', 'session-A'], ['businessos_user', '{"id":7}']])
let failWrite = false
const storage = { getItem: (key: string) => data.get(key) ?? null, setItem(key: string, value: string) { if (failWrite) throw Error('quota'); data.set(key, value) }, removeItem: (key: string) => { data.delete(key) }, key: (i: number) => [...data.keys()][i] ?? null, get length() { return data.size } }
Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'https://fixture.local' }, localStorage: storage, sessionStorage: storage } })
let lockTail = Promise.resolve()
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true, locks: { request: (_name: string, fn: () => unknown) => {
  const result = lockTail.then(fn); lockTail = result.then(() => undefined, () => undefined); return result
} } } })
httpState.setSyncServerUrl('https://fixture.local')
const calls: Array<{ method: string; url: string; body: unknown }> = []
let network: (method: string, url: string, body: any) => Promise<any>
const dependencies: Record<string, unknown> = {
  './actorReadScope.ts': scopes, './httpState.ts': httpState, '../utils/moneyPrecision.ts': money,
  './requestIds.ts': { ensureClientRequestId }, '../utils/deviceInfo.ts': { getClientDeviceInfo: () => ({ clientTime: 'fixed', deviceTz: 'UTC' }) },
  '../utils/timestampId.ts': { businessDateTimeId: () => '20260913-120000' }, './conflicts.ts': {}, './expectedUpdatedAt.ts': {},
  './lazyLocalDb.ts': { getLocalDb: () => { throw Error('unexpected local mirror') } }, './returnsReadTransport.ts': {},
  './http.ts': { apiFetch: async (method: string, url: string, body: unknown) => { calls.push({ method, url, body: JSON.parse(JSON.stringify(body ?? null)) }); return network(method, url, body) }, route: () => { throw Error('v1 must not enter write route/offline queue') } },
}
function load() {
  const source = fs.readFileSync(new URL('../src/api/returnsTransport.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', js)((name: string) => { assert.ok(name in dependencies, name); return dependencies[name] }, mod, mod.exports)
  return mod.exports as any
}
let api = load()
const quote = { money_precision_version: 1, sale_id: 11, sale_revision: 7, calculated_refund_usd: 9.6667, rounding_adjustment_usd: .0033, total_refund_usd: 9.67, total_refund_khr: 38680,
  items: [{ sale_item_id: 3, quantity: 1, total_usd: 9.6667, total_khr: 38666.8, applied_price_usd: 9.6667, applied_price_khr: 38666.8 }] }
const capability = { customer_return_create_version: 1, customer_return_edit_version: 0 }
const intent = [{ sale_item_id: 3, quantity: 1 }]
const payload = { reason: 'Original reason', return_type: 'restock', items: [{ sale_item_id: 3, quantity: 1, stock_action: 'none', branch_id: 2 }] }
network = async (_method, url) => url.endsWith('/quote') ? { ...quote, ...capability } : capability
assert.deepEqual(await api.getReturnQuoteV1(11, intent), quote)
assert.deepEqual(calls.map(c => [c.method, c.url]), [['POST', '/api/returns/quote']])
for (const change of [{ customer_return_create_version: 0 }, { customer_return_create_version: undefined }, { sale_id: 12 }, { items: [] }, { refund_snapshot_json: 'secret' }]) {
  network = async () => ({ ...quote, ...capability, ...change })
  await assert.rejects(api.getReturnQuoteV1(11, intent))
}
failWrite = true
await assert.rejects(api.prepareReturnCreateV1(7, payload, quote), /return_v1_storage_failed/)
assert.equal(calls.some(c => c.url === '/api/returns'), false)
failWrite = false
const pending = await api.prepareReturnCreateV1(7, payload, quote)
const original = pending.bodyJson
assert.throws(() => api.loadPendingReturnCreateV1(8), /return_v1_session_changed/, 'other actor cannot recover this request')
await assert.rejects(api.prepareReturnCreateV1(7, payload, quote), /return_v1_pending/)
let release!: (value: unknown) => void
network = async (_method, url, body) => url.endsWith('/capabilities') ? capability : new Promise(resolve => { release = resolve })
const first = api.submitReturnCreateV1(7, pending)
await new Promise(resolve => setTimeout(resolve, 0))
await assert.rejects(api.submitReturnCreateV1(7, pending), /return_v1_pending/)
assert.equal(calls.filter(c => c.url === '/api/returns').length, 1, 'double click dispatches once')
release({ id: 91, returnNumber: JSON.parse(original).return_number, replacementSaleId: null, replacementReceiptNumber: null })
await first
assert.equal(api.loadPendingReturnCreateV1(7).bodyJson, original, 'only acknowledged UI clears pending')
// Reload the actual module and recover the exact saved body; no quote is fetched.
api = load()
assert.equal(api.loadPendingReturnCreateV1(7).bodyJson, original)
network = async (_method, url) => url.endsWith('/capabilities') ? capability : Promise.reject(Object.assign(Error('lost acknowledgement'), { status: 503, code: 'retry_same_request' }))
await assert.rejects(api.submitReturnCreateV1(7, pending), /lost acknowledgement/)
assert.equal(api.loadPendingReturnCreateV1(7).bodyJson, original)
const beforeRollback = calls.filter(c => c.url === '/api/returns').length
network = async () => ({ customer_return_create_version: 0 })
await assert.rejects(api.submitReturnCreateV1(7, pending), /return_v1_unavailable/)
assert.equal(calls.filter(c => c.url === '/api/returns').length, beforeRollback)
assert.equal(api.loadPendingReturnCreateV1(7).bodyJson, original, 'rollback never downgrades/removes unknown request')
data.set('businessos_read_session', 'session-B')
scopes.completeActorSessionReconciliation('session-B')
await assert.rejects(api.submitReturnCreateV1(7, pending), /return_v1_session_changed/)
assert.equal(api.loadPendingReturnCreateV1(7).bodyJson, original, 'session rotation quarantines, not deletes')
assert.throws(() => api.authorizeReturnCreateRecovery(7, pending, false), /return_v1_review_required/)
const recovered = api.authorizeReturnCreateRecovery(7, pending, true)
const originalEnvelope = JSON.stringify(api.loadPendingReturnCreateV1(7))
network = async (_method, url) => url.endsWith('/capabilities') ? capability : Promise.reject(Error('lost acknowledgement'))
await assert.rejects(api.submitReturnCreateV1(7, pending, recovered), /lost acknowledgement/)
assert.equal(JSON.stringify(api.loadPendingReturnCreateV1(7)), originalEnvelope, 'reauthorization never changes original envelope/session/body')
const recoveryBeforeSwitch = calls.filter(c => c.url === '/api/returns').length
network = async () => new Promise(resolve => { release = resolve })
const recoveryFlight = api.submitReturnCreateV1(7, pending, api.authorizeReturnCreateRecovery(7, pending, true))
await new Promise(resolve => setTimeout(resolve, 0))
data.set('businessos_read_session', 'session-C'); scopes.completeActorSessionReconciliation('session-C')
release(capability)
await assert.rejects(recoveryFlight, /earlier account/)
assert.equal(calls.filter(c => c.url === '/api/returns').length, recoveryBeforeSwitch, 'session rotation during capability blocks POST')
await assert.rejects(api.submitReturnCreateV1(7, pending, recovered), /earlier account/)
const finalRecovery = api.authorizeReturnCreateRecovery(7, pending, true)
network = async (_method, url, body) => url.endsWith('/capabilities') ? capability : ({ id: 91, returnNumber: body.return_number, replacementSaleId: null, replacementReceiptNumber: null })
await api.submitReturnCreateV1(7, pending, finalRecovery)
assert.equal(JSON.stringify(api.loadPendingReturnCreateV1(7)), originalEnvelope)
network = async () => new Promise(resolve => { release = resolve })
const actorRecovery = api.submitReturnCreateV1(7, pending, api.authorizeReturnCreateRecovery(7, pending, true))
await new Promise(resolve => setTimeout(resolve, 0))
const postsBeforeActorChange = calls.filter(c => c.url === '/api/returns').length
data.set('businessos_user', '{"id":8}')
release(capability)
await assert.rejects(actorRecovery, /earlier account/)
assert.equal(calls.filter(c => c.url === '/api/returns').length, postsBeforeActorChange)
assert.throws(() => api.authorizeReturnCreateRecovery(8, pending, true), /return_v1_review_required/)
data.set('businessos_user', '{"id":7}')
data.set('businessos_read_session', 'session-A')
scopes.completeActorSessionReconciliation('session-A')
httpState.setSyncServerUrl('https://other.fixture')
assert.equal(api.loadPendingReturnCreateV1(7), null)
await assert.rejects(api.submitReturnCreateV1(7, pending), /return_v1_session_changed/)
httpState.setSyncServerUrl('https://fixture.local')
// Authority changes while capability is pending: no POST can follow it.
network = async () => new Promise(resolve => { release = resolve })
const beforeSwitch = calls.filter(c => c.url === '/api/returns').length
const switched = api.submitReturnCreateV1(7, pending)
await new Promise(resolve => setTimeout(resolve, 0))
data.set('businessos_user', '{"id":8}')
release(capability)
await assert.rejects(switched, /earlier account/)
assert.equal(calls.filter(c => c.url === '/api/returns').length, beforeSwitch)
data.set('businessos_user', '{"id":7}')
network = async (_method, url, body) => url.endsWith('/capabilities') ? capability : ({ id: 91, returnNumber: body.return_number, replacementSaleId: null, replacementReceiptNumber: null })
await api.submitReturnCreateV1(7, pending)
for (const call of calls.filter(c => c.url === '/api/returns')) assert.equal(JSON.stringify(call.body), original, 'all attempts retain request ID and exact JSON')
await api.clearPendingReturnCreateV1(7, pending)
assert.equal(api.loadPendingReturnCreateV1(7), null)
// Two independent module instances share the browser admission lock, not the
// per-runtime one-flight Set. Only one new request may occupy the durable slot.
const otherTab = load()
const admissions = await Promise.allSettled([api.prepareReturnCreateV1(7, payload, quote), otherTab.prepareReturnCreateV1(7, payload, quote)])
assert.equal(admissions.filter(result => result.status === 'fulfilled').length, 1)
assert.equal(admissions.filter(result => result.status === 'rejected').length, 1)
const saved = api.loadPendingReturnCreateV1(7)
assert.equal(saved.bodyJson, (admissions.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<any>).value.bodyJson)
await api.clearPendingReturnCreateV1(7, saved)
const old = await api.prepareReturnCreateV1(7, payload, quote)
const clearA = api.clearPendingReturnCreateV1(7, old)
const newPrepare = otherTab.prepareReturnCreateV1(7, payload, quote)
const clearB = api.clearPendingReturnCreateV1(7, old)
await clearA
const newer = await newPrepare
await assert.rejects(clearB, /return_v1_session_changed/)
assert.equal(api.loadPendingReturnCreateV1(7).bodyJson, newer.bodyJson, 'late clear never erases a different newly prepared request')
await api.clearPendingReturnCreateV1(7, newer)
const oldSessionPending = await api.prepareReturnCreateV1(7, payload, quote)
data.set('businessos_read_session', 'session-D'); scopes.completeActorSessionReconciliation('session-D')
const clearRecovery = api.authorizeReturnCreateRecovery(7, oldSessionPending, true)
network = async (_method, url, body) => url.endsWith('/capabilities') ? capability : ({ id: 92, returnNumber: body.return_number, replacementSaleId: null, replacementReceiptNumber: null })
await api.submitReturnCreateV1(7, oldSessionPending, clearRecovery)
await api.clearPendingReturnCreateV1(7, oldSessionPending, clearRecovery)
assert.equal(api.loadPendingReturnCreateV1(7), null, 'confirmed recovered receipt clears the original session envelope safely')
console.log('PASS actual return-v1 transport: read-only quote, capability rollback, one-flight, frozen lost-ack/reload retry, actor/session/server fences, storage failure')

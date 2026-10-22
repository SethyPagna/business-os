import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import * as money from '../src/utils/moneyPrecision.ts'
import * as scopes from '../src/api/actorReadScope.ts'
import * as httpState from '../src/api/httpState.ts'
import { ensureClientRequestId } from '../src/api/requestIds.ts'

// 6.0.958: the one-step exchange on the wire. The actual transport module (transpiled, not re-implemented) is driven through the exchange
// quote, the frozen create body and the acknowledgement. An exchange is ONE unit: replacement lines, the reviewed replacement quote and the
// customer's payment are saved together and retried together, and a body that has only part of that is never sent.

const data = new Map<string, string>([['businessos_read_session', 'session-A'], ['businessos_user', '{"id":7}']])
const storage = { getItem: (key: string) => data.get(key) ?? null, setItem(key: string, value: string) { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) }, key: (i: number) => [...data.keys()][i] ?? null, get length() { return data.size } }
Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'https://fixture.local' }, localStorage: storage, sessionStorage: storage } })
let lockTail = Promise.resolve()
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true, locks: { request: (_name: string, fn: () => unknown) => {
  const result = lockTail.then(fn); lockTail = result.then(() => undefined, () => undefined); return result
} } } })
httpState.setSyncServerUrl('https://fixture.local')
const calls: Array<{ method: string; url: string; body: any }> = []
let network: (method: string, url: string, body: any) => Promise<any>
const dependencies: Record<string, unknown> = {
  './actorReadScope.ts': scopes, './httpState.ts': httpState, '../utils/moneyPrecision.ts': money,
  './requestIds.ts': { ensureClientRequestId }, '../utils/deviceInfo.ts': { getClientDeviceInfo: () => ({ clientTime: 'fixed', deviceTz: 'UTC' }) },
  '../utils/timestampId.ts': { businessDateTimeId: () => '20260922-120000' }, './conflicts.ts': {},
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
const api = load()
const quote = { money_precision_version: 1, sale_id: 11, sale_revision: 7, calculated_refund_usd: 9.67, rounding_adjustment_usd: 0, total_refund_usd: 9.67, total_refund_khr: 38680,
  items: [{ sale_item_id: 3, quantity: 1, total_usd: 9.67, total_khr: 38680, applied_price_usd: 9.67, applied_price_khr: 38680 }] }
const exchange = { version: 1, sale_id: 11, exchange_rate: 4000, not_paid: false,
  lines: [{ product_id: 9, product_name: 'Gloss', branch_id: 2, batch_id: null, quantity: 1, unit_price_usd: 6.48, unit_price_khr: 25920, total_usd: 6.48, total_khr: 25920 }],
  calculated_total_usd: 6.48, rounding_adjustment_usd: 0, total_usd: 6.48, total_khr: 25920, refund_usd: 9.67, owed_reduction_usd: 0, credit_usd: 9.67, net_usd: -3.19 }
const capability = { customer_return_create_version: 1, customer_return_edit_version: 0 }
const intent = [{ sale_item_id: 3, quantity: 1 }]
const lines = [{ product_id: 9, branch_id: 2, batch_id: null, quantity: 1 }]
const payment = { details: [], change_currency: 'KHR' }
const payload = { reason: 'Swap', return_type: 'restock', items: [{ sale_item_id: 3, quantity: 1, stock_action: 'restock', branch_id: 2 }] }

// ---- the exchange quote ---------------------------------------------------------------------------------------------------------------------
network = async () => ({ ...quote, ...capability, exchange })
const asked = await api.getReturnExchangeQuoteV1(11, intent, lines)
assert.deepEqual(asked, { quote, exchange })
assert.deepEqual(calls.map(c => [c.method, c.url, c.body]), [['POST', '/api/returns/quote', { sale_id: 11, items: intent, replacement_items: lines }]], 'one read, carrying the replacement lines')
for (const [name, change] of Object.entries({
  'net off by a cent': { exchange: { ...exchange, net_usd: -3.18 } },
  'credit is not refund less debt (net follows the wrong credit)': { exchange: { ...exchange, credit_usd: 9.66, net_usd: -3.18 } },
  'total is not lines plus rounding': { exchange: { ...exchange, total_usd: 6.49 } },
  'lines do not sum to the calculated total': { exchange: { ...exchange, calculated_total_usd: 6.47, total_usd: 6.47, net_usd: -3.2 } },
  'a different sale': { exchange: { ...exchange, sale_id: 12 } },
  'refund differs from the return quote': { exchange: { ...exchange, refund_usd: 9.66, credit_usd: 9.66, net_usd: -3.18 } },
  'no exchange at all': { exchange: undefined },
  'an unknown field': { exchange: { ...exchange, secret: 1 } },
  'no lines': { exchange: { ...exchange, lines: [] } },
})) {
  network = async () => ({ ...quote, ...capability, ...change })
  await assert.rejects(api.getReturnExchangeQuoteV1(11, intent, lines), /return_v1_review_required/, name)
}

// ---- the frozen body --------------------------------------------------------------------------------------------------------------------------
network = async () => ({ ...quote, ...capability, exchange })
const pending = await api.prepareReturnCreateV1(7, payload, quote, { quote: exchange, payment, lines })
const body = JSON.parse(pending.bodyJson)
assert.deepEqual([body.replacement_items, body.expected_exchange, body.exchange_payment], [lines, exchange, payment], 'lines, reviewed replacement quote and payment are one frozen unit')
assert.equal(api.loadPendingReturnCreateV1(7).bodyJson, pending.bodyJson)
await api.clearPendingReturnCreateV1(7, pending)
await assert.rejects(api.prepareReturnCreateV1(7, payload, quote, { quote: { ...exchange, sale_id: 12 }, payment, lines }), /return_v1_review_required/, 'a replacement quote for another sale is never frozen')
await assert.rejects(api.prepareReturnCreateV1(7, payload, quote, { quote: { ...exchange, net_usd: 0 }, payment, lines }), /return_v1_review_required/, 'a replacement quote whose arithmetic does not hold is never frozen')
await assert.rejects(api.prepareReturnCreateV1(7, payload, quote, { quote: exchange, payment, lines: [] }), /return_v1_review_required/)
assert.equal(api.loadPendingReturnCreateV1(7), null, 'nothing was left behind by the refused ones')

// A stored request that carries only part of an exchange cannot be recovered or sent.
const key = [...data.keys()].find(k => k.startsWith('businessos_pending_return_create_v1:')) ?? 'businessos_pending_return_create_v1:' + encodeURIComponent('https://fixture.local|https://fixture.local') + ':7'
const fresh = await api.prepareReturnCreateV1(7, payload, quote, { quote: exchange, payment, lines })
const envelope = JSON.parse(data.get(key)!)
const full = JSON.parse(fresh.bodyJson)
for (const [name, mutate] of Object.entries({
  'replacement lines without the reviewed quote': (b: any) => { delete b.expected_exchange },
  'replacement lines without the payment': (b: any) => { delete b.exchange_payment },
  'a reviewed quote with no replacement lines': (b: any) => { b.replacement_items = [] },
  'a payment with the wrong currency': (b: any) => { b.exchange_payment = { details: [], change_currency: 'EUR' } },
  'a quote for another sale': (b: any) => { b.expected_exchange = { ...b.expected_exchange, sale_id: 12 } },
})) {
  const broken = JSON.parse(JSON.stringify(full)); mutate(broken)
  data.set(key, JSON.stringify({ ...envelope, bodyJson: JSON.stringify(broken) }))
  assert.throws(() => api.loadPendingReturnCreateV1(7), /return_v1_storage_failed/, name)
}
data.set(key, JSON.stringify(envelope))
assert.equal(api.loadPendingReturnCreateV1(7).bodyJson, fresh.bodyJson)

// ---- the acknowledgement ------------------------------------------------------------------------------------------------------------------------
const ack = (extra: Record<string, unknown>) => async (_method: string, url: string, b: any) => url.endsWith('/capabilities') ? capability : ({ id: 91, returnNumber: b.return_number, ...extra })
network = ack({ replacementSaleId: null, replacementReceiptNumber: null })
await assert.rejects(api.submitReturnCreateV1(7, fresh), /return_v1_pending/, 'an exchange acknowledged without its replacement sale is not a confirmed result')
network = ack({ replacementSaleId: 55, replacementReceiptNumber: '' })
await assert.rejects(api.submitReturnCreateV1(7, fresh), /return_v1_pending/, 'nor one without the replacement receipt')
assert.equal(api.loadPendingReturnCreateV1(7).bodyJson, fresh.bodyJson, 'the frozen request survives an unconfirmed acknowledgement')
network = ack({ replacementSaleId: 55, replacementReceiptNumber: '20260922-120001' })
const done = await api.submitReturnCreateV1(7, fresh)
assert.equal(done.replacementSaleId, 55)
for (const call of calls.filter(c => c.url === '/api/returns')) assert.equal(JSON.stringify(call.body), fresh.bodyJson, 'every attempt re-sends the exact same exchange')
await api.clearPendingReturnCreateV1(7, fresh)

// A plain return still expects NO replacement sale.
const plain = await api.prepareReturnCreateV1(7, payload, quote)
assert.equal(Object.hasOwn(JSON.parse(plain.bodyJson), 'expected_exchange'), false, 'a plain return carries no exchange keys')
network = ack({ replacementSaleId: 55, replacementReceiptNumber: '20260922-120001' })
await assert.rejects(api.submitReturnCreateV1(7, plain), /return_v1_pending/, 'a plain return acknowledged with a replacement sale is not the request that was sent')
network = ack({ replacementSaleId: null, replacementReceiptNumber: null })
await api.submitReturnCreateV1(7, plain)
await api.clearPendingReturnCreateV1(7, plain)
console.log('PASS return exchange transport: replacement quote validated, exchange frozen as one unit, partial bodies refused, acknowledgement needs the replacement sale')

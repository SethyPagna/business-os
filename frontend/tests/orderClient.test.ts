// The storefront's client for /api/portal/orders (KHQR S7): the exact requests it sends and how it reads every kind of answer.
//
// Run: node tests/orderClient.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { createOrderApi } from '../src/components/catalog/orders/orderClient.ts'

const TOKEN = 'AAAAAAAAAAAAAAAAAAAAAA'
type Call = { url: string; init: RequestInit & { headers: Record<string, string> } }

function scripted(answers: Array<{ status?: number; body?: unknown; headers?: Record<string, string>; throws?: Error }>) {
  const calls: Call[] = []
  const queue = [...answers]
  const fetchStub = (async (input: string, init: Call['init']) => {
    calls.push({ url: input, init })
    const answer = queue.shift() ?? { status: 200, body: {} }
    if (answer.throws) throw answer.throws
    const status = answer.status ?? 200
    return new Response(answer.body === undefined ? '' : typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body), { status, headers: answer.headers })
  }) as unknown as typeof fetch
  return { calls, api: createOrderApi({ fetch: fetchStub, baseUrl: 'https://shop.test', now: () => 1_000_000 }) }
}
const ORDER = { order_no: 'W261109K7Q2', status: 'awaiting_payment' }

test('create is a same-origin JSON POST that carries the shopper\'s cookie, and hands back the order and its link token', async () => {
  // CATCHES: a form-encoded or credential-less create (the Worker refuses the first with 415 and cannot attach the account on the second).
  const { api, calls } = scripted([{ status: 201, body: { order: ORDER, token: TOKEN } }])
  const result = await api.create({ name: 'Sample Buyer' })
  assert.equal(result.ok, true)
  assert.ok(result.ok && result.data.token === TOKEN && result.data.order.order_no === 'W261109K7Q2')
  assert.equal(calls[0].url, 'https://shop.test/api/portal/orders')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json')
  assert.equal(calls[0].init.credentials, 'include')
  assert.equal(JSON.parse(String(calls[0].init.body)).name, 'Sample Buyer')
})

test('every write goes to its own route with the token in the path, and reads are plain GETs with no body', async () => {
  // CATCHES: a withdraw sent to the request route, a top-up without the request id, a phone missing from a withdraw, a GET with a body.
  const { api, calls } = scripted(Array.from({ length: 9 }, () => ({ body: { order: ORDER, state: 'paid', revision: 1, paid_at: null, total_usd: 1 } })))
  await api.get(TOKEN)
  await api.status(TOKEN)
  await api.edit(TOKEN, { name: 'B' })
  await api.cancel(TOKEN)
  await api.retry(TOKEN)
  await api.topUp(TOKEN, 7)
  await api.request(TOKEN, { kind: 'cancel', phone: '012345678' })
  await api.withdraw(TOKEN, 9, '012345678')
  assert.deepEqual(calls.map((c) => `${c.init.method} ${c.url.replace('https://shop.test/api/portal/orders', '')}`), [
    `GET /${TOKEN}`, `GET /${TOKEN}/status`, `POST /${TOKEN}/edit`, `POST /${TOKEN}/cancel`, `POST /${TOKEN}/retry`, `POST /${TOKEN}/topup`, `POST /${TOKEN}/requests`, `POST /${TOKEN}/requests/9/withdraw`,
  ])
  assert.equal(calls[0].init.body, undefined)
  assert.equal(calls[1].init.body, undefined)
  assert.deepEqual(JSON.parse(String(calls[5].init.body)), { request_id: 7 })
  assert.deepEqual(JSON.parse(String(calls[7].init.body)), { phone: '012345678' })
  assert.ok(calls.every((c) => c.init.credentials === undefined), 'only create sends credentials')
})

test('a refusal comes back as a value with the server\'s code, never as a throw, and its English sentence is dropped', async () => {
  // CATCHES: showing the Worker's English `error` text to a Khmer reader, and an exception where the screen needs a code.
  const { api } = scripted([{ status: 409, body: { error: 'Some items are not in stock.', code: 'out_of_stock', items: [{ product_id: 5, name: 'Sample Cream', available: 1 }] } }])
  const result = await api.create({})
  assert.equal(result.ok, false)
  assert.ok(!result.ok)
  assert.equal(result.code, 'out_of_stock')
  assert.equal(result.status, 409)
  assert.deepEqual(result.extra, { items: [{ product_id: 5, name: 'Sample Cream', available: 1 }] })
  assert.ok(!JSON.stringify(result).includes('Some items are not in stock'))
})

test('a refused create that still made an order carries its token, so the page can open it with "Try again"', async () => {
  // CATCHES: losing the order when ABA could not issue a QR: the buyer would be told to start over while an order already exists.
  const { api } = scripted([{ status: 502, body: { error: 'x', code: 'payment_busy', retryable: true, token: TOKEN, order_no: 'W261109K7Q2' } }])
  const result = await api.create({})
  assert.ok(!result.ok)
  assert.equal(result.code, 'payment_busy')
  assert.equal(result.token, TOKEN)
  assert.equal(result.orderNo, 'W261109K7Q2')
  assert.equal(result.retryable, true)
  assert.deepEqual(result.extra, {}, 'token, order number and the retry flag are lifted out of extra')
})

test('network failures, timeouts and unreadable answers each get a code the screens can translate', async () => {
  // CATCHES: a thrown fetch error escaping into a blank page, a hung request that never fails, and a 200 with no JSON read as success.
  const net = await scripted([{ throws: new TypeError('Failed to fetch') }]).api.get(TOKEN)
  assert.ok(!net.ok && net.code === 'network' && net.retryable)
  const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' })
  const slow = await scripted([{ throws: aborted }]).api.get(TOKEN)
  assert.ok(!slow.ok && slow.code === 'timeout' && slow.retryable)
  const html = await scripted([{ status: 502, body: '<html>bad gateway</html>' }]).api.get(TOKEN)
  assert.ok(!html.ok && html.code === 'unknown' && html.status === 502 && html.retryable)
  const empty = await scripted([{ status: 200, body: '' }]).api.get(TOKEN)
  assert.ok(!empty.ok && empty.code === 'bad_response')
  const noOrder = await scripted([{ status: 200, body: { nothing: true } }]).api.get(TOKEN)
  assert.ok(!noOrder.ok && noOrder.code === 'bad_response')
  const noToken = await scripted([{ status: 201, body: { order: ORDER } }]).api.create({})
  assert.ok(!noToken.ok && noToken.code === 'bad_response', 'a create answer without its token cannot open the order')
  const limited = await scripted([{ status: 429, body: { code: 'rate_limited' } }]).api.create({})
  assert.ok(!limited.ok && limited.code === 'rate_limited' && limited.retryable)
})

test('a malformed token never reaches the network', async () => {
  // CATCHES: sending a junk path segment to the Worker (and a path traversal through the token).
  const { api, calls } = scripted([])
  for (const token of ['', 'short', '../../api/auth/login', `${TOKEN}/x`, 'AAAAAAAAAAAAAAAAAAAA?x']) {
    const result = await api.get(token)
    assert.ok(!result.ok && result.code === 'order_not_found' && result.status === 404, token)
    assert.ok(!(await api.cancel(token)).ok)
  }
  assert.equal(calls.length, 0)
})

test('the clock skew is read from the Date header of a good answer', async () => {
  // CATCHES: a countdown that trusts a phone's wrong clock (the shop's expiry time is on the shop's clock).
  const { api } = scripted([{ body: { order: ORDER }, headers: { date: new Date(1_000_000 + 4_000).toUTCString() } }, { body: { order: ORDER } }])
  const first = await api.get(TOKEN)
  assert.ok(first.ok)
  assert.ok(Math.abs((first.ok ? first.skewMs ?? NaN : NaN) - 4_000) < 1_000, 'within the Date header\'s one-second resolution')
  const second = await api.get(TOKEN)
  assert.ok(second.ok && second.skewMs === null)
})

test('a request that never answers is cut off by the timeout', async () => {
  // CATCHES: a spinner that never ends on a dead connection.
  const hung = (async (_input: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  })) as unknown as typeof fetch
  const api = createOrderApi({ fetch: hung, baseUrl: 'https://shop.test', timeoutMs: 20 })
  const result = await api.get(TOKEN)
  assert.ok(!result.ok && result.code === 'timeout')
})

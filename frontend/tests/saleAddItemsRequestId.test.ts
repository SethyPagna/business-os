// N18 (a2-salesfix lane): "Write failed - data not saved: client_request_id
// is required when adding sale items. (operation: sales:addItems)".
//
// The Worker has required client_request_id on POST /api/sales/:id/items since
// e35e933c and SaleDetailModal has minted a stable one since 860d561f, so the
// failure looked like a stale cached PWA shell. It was not. The id was being
// dropped INSIDE the current client, one hop before the transport:
//
//   SaleDetailModal -> Sales.tsx handleAddSaleItems
//     -> getSalesApi().addSaleItems(saleId, items, '', review)   <- 4 args
//     -> window.api (web-api.ts Proxy -> api/methods.ts registry)
//     -> methods.ts  `addSaleItems = async (id, items, notes) =>`  <- 3 params
//     -> salesTransport.addSaleItems(id, items, notes)             <- review gone
//
// methods.ts carries `// @ts-nocheck`, so the arity drop was invisible to
// `tsc --noEmit`; nothing else in the app types that registry either. This
// test therefore drives the REAL registry function over a stubbed fetch and
// reads the request body that actually goes on the wire.
//
// Run: node tests/saleAddItemsRequestId.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

type CapturedRequest = { method: string; url: string; body: Record<string, unknown> | null }

const captured: CapturedRequest[] = []

// ---------------------------------------------------------------------------
// Minimal browser surface. api/http.ts only needs window (for its CustomEvent
// dispatches), navigator.onLine (its offline write gate) and fetch; the local
// Dexie mirror it writes afterwards is absent here, which is fine -- the
// request has already been made by then and the transport's own failure is
// caught below.
const g = globalThis as unknown as Record<string, unknown>
const bus = new EventTarget()
g.addEventListener = bus.addEventListener.bind(bus)
g.removeEventListener = bus.removeEventListener.bind(bus)
g.dispatchEvent = bus.dispatchEvent.bind(bus)
g.window = globalThis
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true, userAgent: 'node-test', language: 'en' },
  configurable: true,
})
g.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
g.fetch = async (url: string, init: { method?: string; body?: string } = {}) => {
  captured.push({
    method: String(init.method || 'GET'),
    url: String(url),
    body: init.body ? JSON.parse(init.body) : null,
  })
  return {
    ok: true,
    status: 200,
    url: String(url),
    headers: { get: () => null },
    json: async () => ({ addedLines: 1, stockMoved: true, updated_at: '2026-09-06T01:00:00Z' }),
    text: async () => '{}',
  }
}

const http = await import('../src/api/http.ts')
http.setSyncServerUrl('http://localhost:8787')

// The registry behind window.api -- the exact object web-api.ts's Proxy
// forwards every `getSalesApi().<name>(...)` call into.
const methods = await import('../src/api/methods.ts')

const REVIEW = {
  client_request_id: 'sale-settlement-stable-1',
  expected_exchange_rate: 4100,
  expected_updated_at: '2026-09-06T00:00:00Z',
}

async function callAddItems(review: unknown): Promise<void> {
  try {
    await (methods as unknown as { addSaleItems: (...args: unknown[]) => Promise<unknown> })
      .addSaleItems(7, [{ product_id: 1, quantity: 2, applied_price_usd: 3 }], 'note', review)
  } catch (error) {
    // The transport's post-write local-mirror update needs Dexie, which does
    // not exist in node. That happens strictly AFTER the request, so the
    // captured body is still the real one. Any OTHER failure is a real defect.
    const message = String((error as Error)?.message || error)
    if (!/indexeddb|dexie|localdb|not defined|not a function|not available/i.test(message)) throw error
  }
}

// ---------------------------------------------------------------------------
// 1. The end-to-end body: the caller's client_request_id reaches the wire.
//    Discriminating -- with methods.ts's 3-parameter wrapper the body has no
//    client_request_id at all, which is exactly the 400 the owner reported.

await callAddItems(REVIEW)

const addRequests = captured.filter((entry) => /\/api\/sales\/7\/items$/.test(entry.url))
assert.equal(addRequests.length, 1, 'expected exactly one POST /api/sales/:id/items')
assert.equal(addRequests[0].method, 'POST')
const body = addRequests[0].body || {}
assert.equal(
  body.client_request_id,
  REVIEW.client_request_id,
  'window.api.addSaleItems must forward the caller review\'s client_request_id to the Worker',
)
assert.equal(body.expected_exchange_rate, REVIEW.expected_exchange_rate)
assert.equal(body.expected_updated_at, REVIEW.expected_updated_at)
assert.equal(body.notes, 'note')
assert.deepEqual(body.items, [{ product_id: 1, quantity: 2, applied_price_usd: 3 }])

// ---------------------------------------------------------------------------
// 2. Retry stability: the SAME user action retried sends the SAME id. A
//    transport that minted its own id per call would satisfy test 1 while
//    silently re-adding the lines on every retry, so this is the guard that
//    makes "just generate one in the transport" an unacceptable fix.

captured.length = 0
await callAddItems(REVIEW)
await callAddItems(REVIEW)
const retryIds = captured
  .filter((entry) => /\/api\/sales\/7\/items$/.test(entry.url))
  .map((entry) => (entry.body || {}).client_request_id)
assert.equal(retryIds.length, 2, 'expected both retries to reach the wire')
assert.deepEqual(
  retryIds,
  [REVIEW.client_request_id, REVIEW.client_request_id],
  'a retry of one user action must reuse the caller id, never mint a fresh one',
)

// ---------------------------------------------------------------------------
// 3. A caller that supplies no id fails LOCALLY and loudly, before the
//    request, instead of spending a round trip to earn an opaque 400. The
//    transport must not paper over it by generating one (see test 2).

captured.length = 0
let missingIdError: Error | null = null
try {
  await (methods as unknown as { addSaleItems: (...args: unknown[]) => Promise<unknown> })
    .addSaleItems(7, [{ product_id: 1, quantity: 2 }], '', { expected_exchange_rate: 4100 })
} catch (error) {
  missingIdError = error as Error
}
assert.ok(missingIdError, 'a review without client_request_id must reject')
assert.match(String(missingIdError?.message), /client_request_id/i)
assert.equal(
  captured.filter((entry) => /\/api\/sales\/7\/items$/.test(entry.url)).length,
  0,
  'no request may be sent when the caller supplied no client_request_id',
)

// ---------------------------------------------------------------------------
// 4. Source shape: the whole class of defect, not just this one call.
//    Every sales-registry wrapper in methods.ts must forward exactly the
//    arguments it declares AND declare every parameter its transport twin
//    takes. methods.ts is @ts-nocheck, so this is the only check there is.

const methodsSource = read('src/api/methods.ts')
const transportSource = read('src/api/salesTransport.ts')

function registryParams(name: string): string[] {
  const match = new RegExp(`export const ${name} = async \\(([^)]*)\\)`).exec(methodsSource)
  assert.ok(match, `expected a ${name} wrapper in api/methods.ts`)
  return String(match?.[1] || '').split(',').map((part) => part.trim()).filter(Boolean)
}

function transportParamCount(name: string): number {
  const match = new RegExp(`export async function ${name}\\(([\\s\\S]*?)\\)\\s*:\\s*Promise`).exec(transportSource)
  assert.ok(match, `expected an exported ${name} in api/salesTransport.ts`)
  // Split on TOP-LEVEL commas only (parameter types here contain object
  // literals and array/union syntax) and drop the empty tail a trailing
  // comma leaves behind.
  const params = String(match?.[1] || '')
  const segments: string[] = []
  let depth = 0
  let current = ''
  for (const char of params) {
    if ('([{'.includes(char)) depth += 1
    else if (')]}'.includes(char)) depth -= 1
    if (char === ',' && depth === 0) {
      segments.push(current)
      current = ''
      continue
    }
    current += char
  }
  segments.push(current)
  return segments.filter((segment) => segment.trim()).length
}

for (const name of ['addSaleItems', 'amendSale']) {
  const params = registryParams(name)
  const expected = transportParamCount(name)
  assert.equal(
    params.length,
    expected,
    `api/methods.ts's ${name} wrapper declares ${params.length} parameter(s) but salesTransport.${name} takes ${expected} -- the extra argument is silently dropped (methods.ts is @ts-nocheck, so tsc cannot see this)`,
  )
  const call = new RegExp(`${name}Request\\(([^)]*)\\)`).exec(methodsSource)
  assert.ok(call, `expected the ${name} wrapper to call its transport`)
  assert.deepEqual(
    String(call?.[1] || '').split(',').map((part) => part.trim()).filter(Boolean),
    params,
    `api/methods.ts's ${name} wrapper must forward every parameter it declares`,
  )
}

// ---------------------------------------------------------------------------
// 5. Add-items must never be queued offline. The transport comment says so
//    (a replay minutes later could deduct units a different sale has since
//    taken); this pins the mechanism, not the comment: it routes as a WRITE
//    (route(..., true), which blocks when the server is unreachable) and has
//    no outbox/mirror path at all.

const addItemsBlock = /export async function addSaleItems\([\s\S]*?\r?\n}\r?\n/.exec(transportSource)?.[0] || ''
assert.ok(addItemsBlock, 'expected to find addSaleItems in salesTransport.ts')
assert.match(addItemsBlock, /'sales:addItems',[\s\S]{0,200}?\r?\n\s*true,\r?\n/, 'addSaleItems must route as a write')
assert.doesNotMatch(addItemsBlock, /queueBusinessOutboxOperation|routeMirrored|mirrorTable/, 'add-items must never be queued or mirrored offline')

// The offline write gate itself, exercised rather than read: an add-items
// that cannot reach the server FAILS -- it is never banked for replay.
const liveFetch = g.fetch
captured.length = 0
g.fetch = async () => { throw new TypeError('Failed to fetch') }

let unreachableError: Error | null = null
try {
  await (methods as unknown as { addSaleItems: (...args: unknown[]) => Promise<unknown> })
    .addSaleItems(7, [{ product_id: 1, quantity: 2 }], '', REVIEW)
} catch (error) {
  unreachableError = error as Error
}
assert.ok(unreachableError, 'an unreachable-server add-items must reject')
assert.match(String(unreachableError?.message), /offline/i)
assert.equal(
  (unreachableError as unknown as { code?: unknown })?.code,
  'write_requires_live_server',
  'the failure must be a write-blocked refusal, not a queued success',
)

// ...and the second attempt, now that the browser reports itself offline and
// that failure has marked the server down, is refused BEFORE any request --
// no outbox row, no deferred replay.
Object.defineProperty(globalThis, 'navigator', { value: { onLine: false, userAgent: 'node-test', language: 'en' }, configurable: true })
let offlineError: Error | null = null
try {
  await (methods as unknown as { addSaleItems: (...args: unknown[]) => Promise<unknown> })
    .addSaleItems(7, [{ product_id: 1, quantity: 2 }], '', REVIEW)
} catch (error) {
  offlineError = error as Error
}
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'node-test', language: 'en' }, configurable: true })
g.fetch = liveFetch
assert.ok(offlineError, 'an offline add-items must fail rather than queue')
assert.match(String(offlineError?.message), /offline/i)

console.log('saleAddItemsRequestId.test.ts OK')

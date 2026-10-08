import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { __resetApiWriteDedupeForTests, setSyncServerUrl } from '../src/api/http.ts'
import { bulkPriceAdjustAllProducts } from '../src/api/productWriteTransport.ts'

// PROD-PERM follow-up (loophole review N6): the whole-catalog price adjustment is a RELATIVE change, so the apply
// sends one client request id and the Worker answers a repeat of it from the first run's receipt
// (cloudflare/scripts/test-products-bulk-price-adjust-idempotency-native.cjs). The id must be fixed before any
// transport retry and must never be minted for a preview, which writes nothing.

let failed = 0
async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

type Wire = Record<string, unknown>
const PAYLOAD = { direction: 'increase' as const, amount: 1, fields: ['selling_price_usd'], skip_zero: false }

async function withFetch(handler: (attempt: number, body: Wire) => Response, run: (bodies: Wire[]) => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch
  const bodies: Wire[] = []
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Wire
    bodies.push(body)
    return handler(bodies.length, body)
  }) as typeof fetch
  setSyncServerUrl('https://sync.example.test')
  try { await run(bodies) } finally {
    globalThis.fetch = originalFetch
    setSyncServerUrl('')
    __resetApiWriteDedupeForTests()
  }
}
const ok = (): Response => new Response(JSON.stringify({ success: true, changed: 2 }), { status: 200, headers: { 'Content-Type': 'application/json' } })

await runTest('an apply puts a request id on the wire, a supplied one unchanged, and each apply gets its own', async () => {
  await withFetch(() => ok(), async (bodies) => {
    await bulkPriceAdjustAllProducts(PAYLOAD)
    await bulkPriceAdjustAllProducts(PAYLOAD)
    await bulkPriceAdjustAllProducts({ ...PAYLOAD, client_request_id: 'price_adjust_fixed_0001' })
    const [first, second, third] = bodies.map((body) => String(body.client_request_id))
    assert.match(first, /^price_adjust_[A-Za-z0-9_-]{8,}$/, 'the id matches what the Worker accepts')
    assert.ok(first.length <= 120)
    assert.notEqual(first, second, 'two separate applies are two separate requests')
    assert.equal(third, 'price_adjust_fixed_0001', 'a caller-supplied id is not replaced')
  })
})

await runTest('a preview carries no request id (it writes nothing)', async () => {
  await withFetch(() => new Response(JSON.stringify({ count: 2 }), { status: 200, headers: { 'Content-Type': 'application/json' } }), async (bodies) => {
    await bulkPriceAdjustAllProducts({ ...PAYLOAD, preview: true })
    assert.equal(bodies.length, 1)
    assert.equal('client_request_id' in bodies[0], false)
    assert.equal(bodies[0].preview, true)
  })
})

await runTest('the page sends the apply through the transport that stamps the id (no second fetch path)', () => {
  const page = readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')
  const transport = readFileSync(new URL('../src/api/productWriteTransport.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  assert.equal(page.match(/bulk-price-adjust/g)?.length ?? 0, 0, 'Products.tsx never posts to the route itself')
  assert.ok(transport.includes("const stamped = payload.preview ? payload : ensureClientRequestId(payload, 'price_adjust')"))
  assert.ok(transport.includes("{ ...stamped, ...getDevicePayload() }"), 'the stamped payload, not the bare one, is what is sent and retried')
})

if (failed) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}

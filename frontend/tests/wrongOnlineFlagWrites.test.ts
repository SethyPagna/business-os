// Owner rule: a wrong browser flag must never block a write the server would accept, and a real outage must still block, with
// the reason. navigator.onLine is only a hint (a VPN adapter or an iOS PWA leaves it false with a working server), so every
// write that used to refuse on it alone now asks the server (/health) first. Each transport below is run REAL, over a modelled
// fetch, twice: navigator.onLine === false with /health answering (the write goes out) and with /health failing (it is refused
// with its reason and nothing is sent).
import assert from 'node:assert/strict'

const storage = (): Storage => {
  const values = new Map<string, string>()
  return {
    get length() { return values.size }, clear: () => values.clear(), key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, String(v)) }, removeItem: (k: string) => { values.delete(k) },
  }
}
const locks = { request: async (_name: string, _options: unknown, run: () => unknown) => run() }
const navigatorState = { onLine: false, locks, userAgent: 'node-test', language: 'en' }
const win = Object.assign(new EventTarget(), { navigator: navigatorState, localStorage: storage(), sessionStorage: storage(), location: { origin: 'https://till.example.test', hostname: 'till.example.test', port: '' } })
Object.assign(globalThis, { window: win })
Object.defineProperty(globalThis, 'navigator', { value: navigatorState, configurable: true })

const { setSyncServerUrl, __resetApiHealthForTests } = await import('../src/api/http.ts')
const sales = await import('../src/api/salesTransport.ts')
const returns = await import('../src/api/returnsTransport.ts')

let failed = 0
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const realFetch = globalThis.fetch
let serverUp = true
let sent: string[] = []
function model(): void {
  sent = []
  __resetApiHealthForTests()
  globalThis.fetch = (async (input: unknown, init?: { method?: string }) => {
    const path = new URL(String(input), 'https://till.example.test').pathname
    if (path === '/health') {
      if (!serverUp) throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
    }
    if (!serverUp) throw new TypeError('Failed to fetch')
    sent.push(`${init?.method || 'GET'} ${path}`)
    return new Response(JSON.stringify({ success: true, changedCount: 0, unchangedCount: 0, changed: [], items: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

const writes: Array<[string, string, () => Promise<unknown>, RegExp]> = [
  ['bulk return action', 'POST /api/returns/bulk', () => returns.bulkUpdateReturns({ ids: [1], action: 'approve' } as never), /Connect to the server before changing returns in bulk/],
  ['bulk sale status', 'POST /api/sales/bulk-status', () => sales.updateSalesBulkStatus({ client_request_id: 'c1', items: [], target_status: 'completed' } as never), /Connect to the server to change sale status/],
  ['bulk sale update', 'POST /api/sales/bulk-update', () => sales.updateSalesBulkField({ client_request_id: 'c2', items: [], field: 'notes' } as never), /Connect to the server to update sales/],
  ['return quote', 'POST /api/returns/quote', () => returns.getReturnQuoteV1(5, []), /return_v1_unavailable|Return/i],
]

try {
  setSyncServerUrl('https://till.example.test')
  for (const [name, request, run, reason] of writes) {
    await check(`${name}: navigator.onLine false but /health answers -> the write goes out`, async () => {
      model(); serverUp = true
      await run().catch(() => {})
      assert.ok(sent.includes(request), `${request} was sent (sent: ${sent.join(', ') || 'nothing'})`)
    })
    await check(`${name}: a real outage (offline and /health failing) still refuses with the reason and sends nothing`, async () => {
      model(); serverUp = false
      await assert.rejects(run(), reason)
      assert.deepEqual(sent, [])
    })
  }
} finally {
  globalThis.fetch = realFetch
}

if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nwrongOnlineFlagWrites: all checks passed')

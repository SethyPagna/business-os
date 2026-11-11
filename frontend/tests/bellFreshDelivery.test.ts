import assert from 'node:assert/strict'

// Behavioural: the REAL http.ts + notificationSummary.ts + bellFreshness.ts against a stub fetch. A bell-relevant own write
// and the refresh button must each put `GET ...?fresh=1` on the wire, even inside route()'s 20 s client cache and with a
// plain read still in flight (d1-bell review B1/B6: the source-shape pins passed while the flag was never sent).
function store(): Storage {
  const m = new Map<string, string>()
  return { get length() { return m.size }, clear() { m.clear() }, key: (i: number) => [...m.keys()][i] ?? null, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)) }, removeItem: (k: string) => { m.delete(k) } }
}
Object.assign(globalThis as any, { localStorage: store(), sessionStorage: store() })
// Signed in (B9): a window stub plus a businessos_user puts apiFetch/route() in the privateRead mode the till actually runs in;
// without a window the test ran signed out and passed on a build that failed signed in.
const __st=new Map([['businessos_user', JSON.stringify({id:1, role:'admin'})]]);
Object.assign(globalThis, { window: { location: { origin: 'https://admin.fixture.test', hostname: 'admin.fixture.test' }, localStorage: { getItem:(k: string)=>__st.get(k)??null, setItem:(k,v)=>{__st.set(k,String(v))}, removeItem:(k: string)=>{__st.delete(k)} }, sessionStorage: { getItem: () => null, setItem(){}, removeItem(){} }, setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} } })
const http = await import('../src/api/http.ts')
const { getNotificationSummary, getNotificationSectionItems } = await import('../src/api/notificationSummary.ts')
const bell = await import('../src/api/bellFreshness.ts')
http.setSyncServerUrl('https://sync.example.test')

const calls: string[] = []
let gate: Promise<void> | null = null
globalThis.fetch = (async (input: any, init: any) => {
  const url = new URL(String(typeof input === 'string' ? input : input.url))
  const method = String(init?.method || 'GET')
  const p = url.pathname + url.search
  calls.push(`${method} ${p}`)
  if (method === 'GET' && p.startsWith('/api/notifications/') && gate) await gate
  return new Response(JSON.stringify({ success: true, sections: [], items: [], unreadCount: 0, generatedAt: '2026-11-11T07:00:00.000Z' }), { status: 200, headers: { 'content-type': 'application/json' } })
}) as any

const reset = () => { http.cacheInvalidate('notifications'); calls.length = 0; bell.takeBellFresh('summary'); bell.takeBellFresh('items') }
const summaries = () => calls.filter((c) => c.startsWith('GET /api/notifications/summary') && !c.includes('/items'))
const items = () => calls.filter((c) => c.startsWith('GET /api/notifications/summary/items'))
const PLAIN = 'GET /api/notifications/summary'
const FRESH = 'GET /api/notifications/summary?fresh=1'

// 1. Owner, 11 Nov ("Wait"): a till's own SALE does not force a fresh bell read; the cache holds inside 20 s.
reset()
await getNotificationSummary()
await http.apiFetch('POST', '/api/sales', { a: 1 })
await getNotificationSummary()
assert.deepEqual(summaries(), [PLAIN], 'own sale then a read inside 20 s must NOT send ?fresh=1')
assert.equal(bell.peekBellFresh('summary'), false)
// every sale-family write behaves the same
for (const [method, path] of [['POST', '/api/sales/7/items'], ['POST', '/api/sales/7/amendments'], ['PATCH', '/api/sales/7/status']] as const) {
  reset()
  await getNotificationSummary()
  await http.apiFetch(method, path, { a: 1 })
  await getNotificationSummary()
  assert.deepEqual(summaries(), [PLAIN], `${method} ${path} is a sale: no fresh read`)
}
// a product edit still does
reset()
await getNotificationSummary()
await http.apiFetch('PATCH', '/api/products/9', { a: 1 })
await getNotificationSummary()
assert.deepEqual(summaries(), [PLAIN, FRESH], 'a product edit still reaches the network fresh')
assert.equal(bell.peekBellFresh('summary'), false, 'the flag is consumed')
await getNotificationSummary()
assert.deepEqual(summaries(), [PLAIN, FRESH], 'one fresh per write')
// a return is not a sale in this rule
reset()
await getNotificationSummary()
await http.apiFetch('POST', '/api/returns', { a: 1 })
await getNotificationSummary()
assert.deepEqual(summaries(), [PLAIN, FRESH], 'returns still arm a fresh read')

// 2. Refresh button within 20 s of opening.
reset()
await getNotificationSummary()
bell.requestFreshBell()
await getNotificationSummary()
assert.deepEqual(summaries(), [PLAIN, FRESH], 'refresh inside 20 s of a load asks fresh')

// 3. A plain read in flight, then an own write, then another read: that second read must not join the old one.
reset()
{
  let open!: () => void
  gate = new Promise<void>((r) => { open = r })
  const first = getNotificationSummary()
  await new Promise((r) => setTimeout(r, 5))
  const g = gate
  gate = null
  await http.apiFetch('POST', '/api/inventory/adjust', { a: 2 })
  const second = getNotificationSummary()
  open()
  await Promise.all([first, second, g])
  assert.deepEqual(summaries(), [PLAIN, FRESH], 'read in flight, own write, second read: the second is fresh')
}

// 4. The expanded list follows the same rule.
reset()
await getNotificationSectionItems('inventory')
await http.apiFetch('PATCH', '/api/batches/5', { a: 3 })
await getNotificationSectionItems('inventory')
assert.deepEqual(items(), [
  'GET /api/notifications/summary/items?section=inventory',
  'GET /api/notifications/summary/items?section=inventory&fresh=1',
], 'items: own write inside 20 s reaches the network fresh')

// 5. Controls: writes that cannot change a bell count, and a read-only preview, send nothing fresh.
for (const [method, path] of [['POST', '/api/settings'], ['POST', '/api/sales/quote'], ['POST', '/api/suppliers']] as const) {
  reset()
  await getNotificationSummary()
  await http.apiFetch(method, path, { a: 4 })
  await getNotificationSummary()
  assert.deepEqual(summaries(), [PLAIN], `${method} ${path} does not force a fresh read (cache holds)`)
}

// 6. Five product edits in a row coalesce into one fresh read; five sales add none.
reset()
await getNotificationSummary()
for (let i = 0; i < 5; i++) await http.apiFetch('PATCH', '/api/products/1', { a: 10 + i })
await getNotificationSummary()
await getNotificationSummary()
assert.deepEqual(summaries(), [PLAIN, FRESH])
reset()
await getNotificationSummary()
for (let i = 0; i < 5; i++) await http.apiFetch('POST', '/api/sales', { a: 20 + i })
await getNotificationSummary()
assert.deepEqual(summaries(), [PLAIN])

console.log('bellFreshDelivery.test.ts: ok')

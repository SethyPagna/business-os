// N18(b) (a2-salesfix lane): a client that predates a Worker's request-id
// requirement gets a 400 whose body is written for a developer --
// "client_request_id is required when adding sale items." -- and the global
// write banner printed it verbatim under "Write failed - data not saved:".
// That tells a shopkeeper nothing they can act on. The one thing they CAN do
// is take the update the app already offers in its top-row "Restart now" bar
// (App.tsx's AppUpdateBanner), so the banner now says that, in their language.
//
// Two things have to hold for that to be possible at all:
//   1. api/http.ts's `sync:error` event must carry the server's error CODE.
//      It only carried { channel, error, ts }, so nothing downstream could
//      tell this failure apart from any other 400.
//   2. App.tsx's SyncErrorBanner must key off that code, and the strings must
//      exist in BOTH packs.
//
// Run: node tests/staleClientWriteNotice.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// ---------------------------------------------------------------------------
// Browser surface (see tests/saleAddItemsRequestId.test.ts for the same setup).
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

const WORKER_400 = {
  error: 'client_request_id is required when adding sale items.',
  code: 'client_request_id_required',
}
g.fetch = async () => ({
  ok: false,
  status: 400,
  url: 'http://localhost:8787/api/sales/7/items',
  headers: { get: () => null },
  json: async () => WORKER_400,
  text: async () => JSON.stringify(WORKER_400),
})

const http = await import('../src/api/http.ts')
http.setSyncServerUrl('http://localhost:8787')

// ---------------------------------------------------------------------------
// 1. The event carries the code. Behavioral, and discriminating: before this
//    change `detail.code` was undefined on every sync:error, so the banner
//    had nothing but the raw English sentence to work with.

const seen: Array<Record<string, unknown>> = []
bus.addEventListener('sync:error', (event) => {
  seen.push(((event as CustomEvent).detail || {}) as Record<string, unknown>)
})

await assert.rejects(() => http.route(
  'sales:addItems',
  () => http.apiFetch('POST', '/api/sales/7/items', { items: [] }),
  null,
  true,
))

assert.equal(seen.length, 1, 'a failed write must raise exactly one sync:error')
assert.equal(seen[0].channel, 'sales:addItems')
assert.equal(seen[0].error, WORKER_400.error)
assert.equal(
  seen[0].code,
  'client_request_id_required',
  "sync:error must carry the server's error code so the UI can explain the failure",
)
assert.equal(seen[0].status, 400, 'sync:error must carry the HTTP status too')

// ---------------------------------------------------------------------------
// 2. The banner keys off the code -- and off ALL THREE sibling codes, since
//    routes/sales.ts returns the same client_request_id_required for settle
//    (/status), add-items (/items) and amend (/amendments). A banner that
//    only special-cased add-items would leave the other two showing the
//    developer sentence.

const appSource = read('src/App.tsx')
assert.match(
  appSource,
  /client_request_id_required/,
  'SyncErrorBanner must recognize the stale-client code',
)
// The replacement message is shown INSTEAD of the raw server text.
assert.match(
  appSource,
  /write_failed_app_out_of_date/,
  'SyncErrorBanner must render the localized out-of-date message',
)
// ...and it points at the update path that actually exists on this tip: the
// AppUpdateBanner's "Restart now" control.
assert.match(appSource, /function AppUpdateBanner/, 'the top-row update bar must exist for the message to reference it')
assert.match(appSource, /t\('restart_now'\)/, "the top-row update bar's action must still be restart_now")

// ---------------------------------------------------------------------------
// 3. Both packs carry the strings, and the Khmer is really Khmer.

const en = JSON.parse(read('src/lang/en.json')) as Record<string, unknown>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, unknown>

for (const key of ['write_failed_app_out_of_date', 'app_update_ready', 'restart_now']) {
  assert.equal(typeof en[key], 'string', `en.json must define ${key}`)
  assert.equal(typeof km[key], 'string', `km.json must define ${key}`)
  assert.ok(String(en[key]).trim(), `en.json's ${key} must not be blank`)
  assert.ok(String(km[key]).trim(), `km.json's ${key} must not be blank`)
}
// The Khmer entry must be Khmer script, not the English string copied across.
assert.notEqual(km.write_failed_app_out_of_date, en.write_failed_app_out_of_date)
assert.match(String(km.write_failed_app_out_of_date), /[ក-៿]/, 'the Khmer message must be in Khmer script')
// It names the same restart action the top bar shows, so the two agree.
assert.ok(
  String(km.write_failed_app_out_of_date).includes(String(km.restart_now)),
  "the Khmer message must name the top bar's own Restart now label",
)
assert.ok(
  String(en.write_failed_app_out_of_date).includes(String(en.restart_now)),
  "the English message must name the top bar's own Restart now label",
)

console.log('staleClientWriteNotice.test.ts OK')

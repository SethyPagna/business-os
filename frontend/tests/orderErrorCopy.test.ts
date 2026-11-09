// Every code the order API can answer with has English and Khmer text, in the language packs and on the page (KHQR S7).
//
// The codes are read from the Worker's own source, so a refusal added there tomorrow turns this red until the storefront can say it:
//   onlineOrderStore.ts (refuse / OrderError / the payment and request refusal tables / the typed-text limits), portalOrders.ts (its guards),
//   requestBodyGuard.ts (body size, JSON and same-origin guards), and orderClient.ts (the codes the client makes up for a dead network).
//
// Run: node tests/orderErrorCopy.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { ORDER_ERROR_KEYS, orderErrorKey, orderErrorMessage } from '../src/components/catalog/orders/orderErrors.ts'

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (...parts: string[]) => fs.readFileSync(path.join(FRONTEND, ...parts), 'utf8')
const worker = (file: string) => read('..', 'cloudflare', 'src', file)
const KHMER = /[ក-៿]/
const SLOT = /\{[A-Za-z0-9_]+\}/g

type Tree = Record<string, unknown>
const en = JSON.parse(read('src', 'lang', 'en.json')) as Tree
const km = JSON.parse(read('src', 'lang', 'km.json')) as Tree

/** Every code the Worker can send to an order route, as parsed from its source (and the client's own). */
function serverCodes(): Set<string> {
  const store = worker('lib/onlineOrderStore.ts')
  const codes = new Set<string>()
  const collect = (source: string, pattern: RegExp) => { for (const match of source.matchAll(pattern)) codes.add(match[1]) }
  collect(store, /\brefuse\(\s*\d{3},\s*'([a-z_]+)'/g)
  collect(store, /new OrderError\(\s*\d{3},\s*'([a-z_]+)'/g)
  collect(store, /\bcode: '([a-z_]+)'/g)
  const routes = worker('routes/portalOrders.ts')
  collect(routes, /new OrderError\(\s*\d{3},\s*'([a-z_]+)'/g)
  collect(routes, /\bcode: '([a-z_]+)'/g)
  collect(worker('lib/requestBodyGuard.ts'), /\bcode: '([a-z_]+)'/g)
  collect(read('src', 'components', 'catalog', 'orders', 'orderClient.ts'), /failure\('([a-z_]+)'/g)
  codes.add('network')
  codes.add('timeout')
  // The typed-text refusals are built from a field name: `${field}_invalid` and `${field}_too_long`, for every field cleanText is called with.
  const suffixes = [...store.matchAll(/\$\{field\}(_[a-z_]+)/g)].map((match) => match[1])
  const fields = [...store.matchAll(/cleanText\([^\n]*?,\s*\d+,\s*'([a-z_]+)'/g)].map((match) => match[1])
  const contactFields = /export const CONTACT_FIELDS = \[([^\]]+)\]/.exec(store)?.[1].match(/'([a-z]+)'/g)?.map((value) => value.slice(1, -1)) ?? []
  assert.ok(/cleanText\(source\[field\], 100, `contact_\$\{field\}`/.test(store), 'the contact fields still go through cleanText as contact_<field>')
  for (const field of [...fields, ...contactFields.map((field) => `contact_${field}`)]) for (const suffix of suffixes) codes.add(`${field}${suffix}`)
  return codes
}

test('the parse found the real set: a floor and sentinels, so an empty or half-read source cannot pass', () => {
  // CATCHES: a regex that quietly stops matching (every code "has a key" because there are none).
  const codes = serverCodes()
  assert.ok(codes.size >= 70, `expected the Worker's whole set, parsed ${codes.size}`)
  for (const sentinel of [
    'out_of_stock', 'phone_mismatch', 'duplicate_request', 'feature_off', 'rate_limited', 'payment_busy', 'payment_limit', 'request_window_closed',
    'request_not_pending', 'request_body_too_large', 'credential_origin_refused', 'name_too_long', 'contact_telegram_too_long', 'address_invalid',
    'comment_too_long', 'qr_still_valid', 'order_not_found', 'network', 'timeout',
  ]) assert.ok(codes.has(sentinel), `parsed set lacks ${sentinel}`)
})

test('every code the Worker or the client can produce has an entry, and no entry is for a code that no longer exists', () => {
  // CATCHES: a new refusal on the Worker that the page would show as a raw code, and a stale entry that hides a renamed one.
  const codes = serverCodes()
  const handled = new Set(Object.keys(ORDER_ERROR_KEYS))
  const unhandled = [...codes].filter((code) => !handled.has(code)).sort()
  assert.deepEqual(unhandled, [], `codes with no storefront text: ${unhandled.join(', ')}`)
  // bad_response and unknown are the client's catch-alls (orderClient.ts builds them from a status, not from a literal refusal).
  const stale = [...handled].filter((code) => !codes.has(code) && !['unknown', 'bad_response'].includes(code)).sort()
  assert.deepEqual(stale, [], `entries for codes nothing sends: ${stale.join(', ')}`)
})

test('each code shows the key it maps to, and every key has the same English and Khmer in both packs as on the page', () => {
  // CATCHES: a mapped key the page never renders (it would fall to the generic sentence), a pack that drifted from the page, English left in km.json.
  const shown = new Map<string, { en: string; km: string }>()
  for (const code of Object.keys(ORDER_ERROR_KEYS)) {
    const calls: Array<{ key: string; en: string; km: string }> = []
    const text = orderErrorMessage((key, fallback = '', fallbackKm = '') => { calls.push({ key, en: fallback, km: fallbackKm }); return fallback }, code)
    assert.equal(calls.length, 1, `${code} renders through exactly one copy() call`)
    assert.equal(calls[0].key, orderErrorKey(code), `${code} shows ${orderErrorKey(code)}`)
    assert.ok(text.length > 0)
    shown.set(calls[0].key, calls[0])
  }
  assert.ok(shown.size >= 40, `distinct sentences: ${shown.size}`)
  for (const [key, page] of shown) {
    assert.equal(en[key], page.en, `en.json ${key} is the page's English`)
    assert.equal(km[key], page.km, `km.json ${key} is the page's Khmer`)
    assert.ok(KHMER.test(page.km), `${key} Khmer contains Khmer script`)
    assert.notEqual(page.km, page.en, `${key} Khmer is not the English`)
    assert.deepEqual([...(page.km.match(SLOT) ?? [])].sort(), [...(page.en.match(SLOT) ?? [])].sort(), `${key} keeps the same {slots} in both languages`)
    assert.ok(!/\bcustomers?\b/i.test(page.en), `${key} speaks to the shopper, not about "customers"`)
  }
})

test('a code nobody has heard of shows the generic sentence, never the code', () => {
  // CATCHES: "order_blah_blah" shown to a shopper when the Worker gains a refusal this page has not been taught yet.
  for (const code of ['', 'order_blah_blah', 'constructor', '__proto__', 'toString']) {
    assert.equal(orderErrorKey(code), 'order_err_generic', code)
    const calls: string[] = []
    orderErrorMessage((key, fallback = '') => { calls.push(key); return fallback }, code)
    assert.deepEqual(calls, ['order_err_generic'])
  }
})

test('the quantity limit quoted to the shopper is the Worker\'s own', () => {
  // CATCHES: the page promising "1 to 99" after the Worker's cap moved.
  const max = /export const MAX_LINE_QUANTITY = (\d+)/.exec(worker('lib/onlineOrders.ts'))?.[1]
  assert.ok(max, 'the Worker still names MAX_LINE_QUANTITY')
  assert.match(String(en.order_err_invalid_line), new RegExp(`\\b1 and ${max}\\b`))
  assert.match(String(km.order_err_invalid_line), new RegExp(`\\b1\\b.*\\b${max}\\b`))
})

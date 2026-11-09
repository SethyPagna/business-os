// The order link and "My orders" (KHQR S7): where an order lives in the address bar, and what this browser remembers of the orders it placed.
//
// Run: node tests/orderPathAndHistory.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { ORDER_HISTORY_STORAGE_KEY, hasSavedOrders, isOrderToken, orderPathFor, orderRouteFromPath } from '../src/components/catalog/orders/orderPath.ts'
import {
  ORDER_HISTORY_MAX, addSavedOrder, forgetOrder, readSavedOrders, rememberOrder, removeSavedOrder, sanitizeSavedOrders, writeSavedOrders,
  type SavedOrder,
} from '../src/components/catalog/orders/orderHistory.ts'

const TOKEN_A = 'AAAAAAAAAAAAAAAAAAAAAA'
const TOKEN_B = 'BBBBBBBBBBBBBBBBBBBBBB'
const saved = (token: string, orderNo = 'W261109K7Q2', savedAt = '2026-11-09T03:00:00.000Z', totalUsd = 12.5): SavedOrder => ({ token, orderNo, savedAt, totalUsd })

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, data }
}

test('a path selects its order route: one order, the list, or none', () => {
  // CATCHES: a prefix match that also claims /orders-and-more or /order-x, and a catalogue path wrongly taken as an order.
  assert.deepEqual(orderRouteFromPath(`/order/${TOKEN_A}`), { kind: 'order', token: TOKEN_A })
  assert.deepEqual(orderRouteFromPath(`/order/${TOKEN_A}/`), { kind: 'order', token: TOKEN_A })
  assert.deepEqual(orderRouteFromPath('/order'), { kind: 'list' })
  assert.deepEqual(orderRouteFromPath('/order/'), { kind: 'list' })
  for (const other of ['/', '/login', '/orders', '/order-history', '/orderly/x', `/products/order/${TOKEN_A}`, '', null, undefined]) {
    assert.equal(orderRouteFromPath(other), null, `${String(other)} is the catalogue`)
  }
})

test('a malformed token is still an order route (so the page can say "not found"), and never reads as a real token', () => {
  // CATCHES: dropping a bad link back onto the catalogue with no word, and a token check that accepts anything.
  assert.deepEqual(orderRouteFromPath('/order/not-a-token'), { kind: 'order', token: 'not-a-token' })
  assert.equal(isOrderToken('not-a-token'), false)
  assert.equal(isOrderToken(TOKEN_A), true)
  assert.equal(isOrderToken(`${TOKEN_A}A`), false, '23 characters')
  assert.equal(isOrderToken(`${TOKEN_A.slice(0, 21)}.`), false, 'a dot is not in the alphabet')
  assert.deepEqual(orderRouteFromPath(`/order/${TOKEN_A}/extra`), null, 'a deeper path is not an order link')
})

test('the path built for a token reads back as the same token', () => {
  assert.equal(orderPathFor(TOKEN_A), `/order/${TOKEN_A}`)
  assert.deepEqual(orderRouteFromPath(orderPathFor('a-b_c'.padEnd(22, 'x'))), { kind: 'order', token: 'a-b_c'.padEnd(22, 'x') })
})

test('saved orders: newest first, one row per token, bounded, and junk is dropped', () => {
  // CATCHES: a duplicate row for a re-saved order, unbounded growth of the phone's storage, and a stored row that would crash the list.
  const once = addSavedOrder([], saved(TOKEN_A))
  const twice = addSavedOrder(once, saved(TOKEN_B))
  assert.deepEqual(twice.map((o) => o.token), [TOKEN_B, TOKEN_A])
  const again = addSavedOrder(twice, saved(TOKEN_A, 'W261109K7Q2', '2026-11-09T04:00:00.000Z'))
  assert.deepEqual(again.map((o) => o.token), [TOKEN_A, TOKEN_B], 'the re-saved order moves to the top, once')
  let many: SavedOrder[] = []
  for (let i = 0; i < ORDER_HISTORY_MAX + 5; i += 1) many = addSavedOrder(many, saved(`T${String(i).padStart(21, '0')}`))
  assert.equal(many.length, ORDER_HISTORY_MAX)
  assert.equal(many[0].token, `T${String(ORDER_HISTORY_MAX + 4).padStart(21, '0')}`, 'the newest survives, the oldest goes')
  assert.deepEqual(sanitizeSavedOrders('nope'), [])
  assert.deepEqual(sanitizeSavedOrders([null, 5, {}, { token: 'short' }, { token: TOKEN_A }, { token: TOKEN_A, orderNo: 'W1', savedAt: 'not a date', totalUsd: 1 }, { token: TOKEN_A, orderNo: 'W1', savedAt: '2026-11-09T03:00:00Z', totalUsd: -3 }]), [])
  assert.deepEqual(removeSavedOrder(twice, TOKEN_B).map((o) => o.token), [TOKEN_A])
})

test('only the link, the number, the time and the total are stored: never a name, phone or address', () => {
  // CATCHES: a save that spreads the whole order into localStorage (the phone and address would then sit on the device in clear).
  const storage = memoryStorage()
  assert.equal(rememberOrder({ ...saved(TOKEN_A), name: 'Sample Buyer', phone: '012345678', address: '12 Street' } as SavedOrder, storage), true)
  const raw = storage.data.get(ORDER_HISTORY_STORAGE_KEY) ?? ''
  assert.deepEqual(Object.keys(JSON.parse(raw)[0]).sort(), ['orderNo', 'savedAt', 'token', 'totalUsd'])
  assert.ok(!/Sample Buyer|012345678|12 Street/.test(raw))
  assert.deepEqual(readSavedOrders(storage).map((o) => o.token), [TOKEN_A])
  assert.equal(forgetOrder(TOKEN_A, storage), true)
  assert.deepEqual(readSavedOrders(storage), [])
})

test('storage that is blocked or corrupt never throws: the order is safe on the server and in its link', () => {
  // CATCHES: a private-browsing visitor whose checkout dies on a storage exception after the order was already placed.
  const blocked = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  assert.deepEqual(readSavedOrders(blocked), [])
  assert.equal(writeSavedOrders([saved(TOKEN_A)], blocked), false)
  assert.equal(rememberOrder(saved(TOKEN_A), blocked), false)
  assert.deepEqual(readSavedOrders(memoryStorage({ [ORDER_HISTORY_STORAGE_KEY]: '{not json' })), [])
  assert.deepEqual(readSavedOrders(null), [])
  assert.equal(writeSavedOrders([saved(TOKEN_A)], null), false)
})

test('the cart drawer learns whether any order is saved without parsing the list, and an emptied list reads as none', () => {
  // CATCHES: a "My orders" link shown to a browser that has none (the empty "[]" left after removing the last order), and a throw in blocked storage.
  const withWindow = (localStorage: unknown, run: () => void) => {
    const had = Object.getOwnPropertyDescriptor(globalThis, 'window')
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage } })
    try { run() } finally { if (had) Object.defineProperty(globalThis, 'window', had); else delete (globalThis as { window?: unknown }).window }
  }
  const storage = memoryStorage()
  withWindow(storage, () => assert.equal(hasSavedOrders(), false, 'nothing saved'))
  rememberOrder(saved(TOKEN_A), storage)
  withWindow(storage, () => assert.equal(hasSavedOrders(), true, 'one saved'))
  forgetOrder(TOKEN_A, storage)
  withWindow(storage, () => assert.equal(hasSavedOrders(), false, 'the "[]" left after removing the last one is none'))
  withWindow({ getItem: () => { throw new Error('denied') } }, () => assert.equal(hasSavedOrders(), false, 'blocked storage'))
  assert.equal(hasSavedOrders(), false, 'no window (server render)')
})

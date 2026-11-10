// The storefront order screens' rules (KHQR S7): countdown, polling cadence, which screen an order shows, the checkout body and money notes.
//
// Run: node tests/orderLogic.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  POLL_BACKOFF_MAX_MS, POLL_FAST_MS, POLL_FAST_WINDOW_MS, POLL_MIN_MS, POLL_SLOW_MS,
  buildCheckoutBody, checkoutProblems, clockSkewMs, emptyCheckoutForm, formatCountdown, formatUsd, isFinishedState, isPlausiblePhone, newClientRequestId, nextPollDelayMs,
  orderMoneyNotes, orderScreen, orderableLines, parseServerTime, phoneDigits, secondsUntilExpiry,
} from '../src/components/catalog/orders/orderLogic.ts'
import { canonicalizePhone } from '../../cloudflare/src/lib/phone.ts'

const NOW = Date.parse('2026-11-09T10:00:00.000Z')

test('server times read as UTC, in both of the shapes the Worker writes', () => {
  // CATCHES: reading SQLite's zone-less "YYYY-MM-DD HH:MM:SS" in the device's zone (a Phnom Penh phone would be 7 hours off).
  assert.equal(parseServerTime('2026-11-09 10:15:00'), Date.parse('2026-11-09T10:15:00Z'))
  assert.equal(parseServerTime('2026-11-09 10:15:00.250'), Date.parse('2026-11-09T10:15:00.250Z'))
  assert.equal(parseServerTime('2026-11-09T10:15:00.000Z'), Date.parse('2026-11-09T10:15:00Z'))
  assert.equal(parseServerTime(''), null)
  assert.equal(parseServerTime(null), null)
  assert.equal(parseServerTime('soon'), null)
})

test('the countdown counts to the shop clock, never below zero, and rounds up so 0:00 means over', () => {
  // CATCHES: a negative countdown, a countdown that shows 0:00 while a second is left, and one that ignores a wrong device clock.
  assert.equal(secondsUntilExpiry('2026-11-09 10:15:00', NOW), 900)
  assert.equal(secondsUntilExpiry('2026-11-09 10:00:00.400', NOW), 1)
  assert.equal(secondsUntilExpiry('2026-11-09 09:59:00', NOW), 0)
  assert.equal(secondsUntilExpiry(null, NOW), null)
  assert.equal(secondsUntilExpiry('2026-11-09 10:15:00', NOW - 3 * 60_000, 3 * 60_000), 900, 'a phone 3 minutes slow still shows 15:00')
  assert.equal(clockSkewMs('Mon, 09 Nov 2026 10:00:00 GMT', NOW - 5_000), 5_000)
  assert.equal(clockSkewMs(null, NOW), null)
  assert.equal(clockSkewMs('garbage', NOW), null)
  assert.equal(formatCountdown(905), '15:05')
  assert.equal(formatCountdown(65), '1:05')
  assert.equal(formatCountdown(0), '0:00')
  assert.equal(formatCountdown(-4), '0:00')
  assert.equal(formatCountdown(3725), '1:02:05')
})

test('polling is modest: quicker while the QR is fresh, then slower, doubling after failures up to a cap, and never tight', () => {
  // CATCHES: a fixed 1 s loop, no back-off on a failing network, an unbounded back-off, and a floor under the Worker's own limits.
  assert.equal(nextPollDelayMs(0, 0), POLL_FAST_MS)
  assert.equal(nextPollDelayMs(POLL_FAST_WINDOW_MS - 1, 0), POLL_FAST_MS)
  assert.equal(nextPollDelayMs(POLL_FAST_WINDOW_MS, 0), POLL_SLOW_MS)
  assert.equal(nextPollDelayMs(0, 1), POLL_FAST_MS * 2)
  assert.equal(nextPollDelayMs(0, 2), POLL_FAST_MS * 4)
  assert.equal(nextPollDelayMs(POLL_FAST_WINDOW_MS, 3), POLL_BACKOFF_MAX_MS, 'capped')
  assert.equal(nextPollDelayMs(POLL_FAST_WINDOW_MS, 99), POLL_BACKOFF_MAX_MS)
  for (const elapsed of [0, 30_000, 119_999, 120_000, 900_000]) {
    for (const failures of [0, 1, 2, 3, 4, 50, -3]) {
      const delay = nextPollDelayMs(elapsed, failures)
      assert.ok(delay >= POLL_MIN_MS && delay <= POLL_BACKOFF_MAX_MS, `${elapsed}/${failures} -> ${delay}`)
    }
  }
  assert.ok(POLL_MIN_MS >= 3_000, 'at least 3 seconds between reads')
})

test('the poll stops for the states that need no watching and keeps going only while the order waits', () => {
  // CATCHES: polling a paid or cancelled order forever, or stopping while the order is still waiting for money.
  for (const state of ['paid', 'review', 'expired', 'cancelled', 'fulfilled', 'qr_failed']) assert.equal(isFinishedState(state), true, state)
  assert.equal(isFinishedState('awaiting_payment'), false)
  assert.equal(isFinishedState('something_new'), false)
})

test('which screen an order shows, from its status, its QR and the clock', () => {
  // CATCHES: showing a dead QR as payable, a Pay button after payment, and no way forward for a failed or expired QR.
  const qr = { amount: 5, currency: 'USD', qr_string: 'x', deeplink: null, expires_at: '2026-11-09 10:15:00' }
  assert.equal(orderScreen({ status: 'awaiting_payment', payment: qr }, 600), 'pay')
  assert.equal(orderScreen({ status: 'awaiting_payment', payment: qr }, 0), 'pay_expired', 'time ran out by the clock before the sweep noticed')
  assert.equal(orderScreen({ status: 'awaiting_payment', payment: qr }, null), 'pay', 'no expiry to count to: the QR stays')
  assert.equal(orderScreen({ status: 'awaiting_payment', payment: null }, null), 'new_qr')
  assert.equal(orderScreen({ status: 'qr_failed', payment: null }, null), 'new_qr')
  assert.equal(orderScreen({ status: 'expired', payment: null }, null), 'new_qr')
  assert.equal(orderScreen({ status: 'paid', payment: null }, null), 'paid')
  assert.equal(orderScreen({ status: 'review', payment: null }, null), 'review')
  assert.equal(orderScreen({ status: 'cancelled', payment: null }, null), 'cancelled')
  for (const status of ['completed', 'balance_due', 'delivery_pending', 'sale_cancelled'] as const) assert.equal(orderScreen({ status, payment: null }, null), 'after_sale', status)
})

test('required fields: name and phone always, an address only for delivery', () => {
  // CATCHES: demanding an address for pickup (the owner's answer was delivery only), and letting a delivery order through without one.
  const form = emptyCheckoutForm()
  assert.deepEqual(checkoutProblems(form), ['name_required', 'phone_invalid'])
  assert.deepEqual(checkoutProblems({ ...form, name: 'Sample Buyer', phone: '012 345 678' }), [])
  assert.deepEqual(checkoutProblems({ ...form, name: 'Sample Buyer', phone: '012 345 678', fulfilment: 'delivery' }), ['address_required'])
  assert.deepEqual(checkoutProblems({ ...form, name: 'Sample Buyer', phone: '012 345 678', fulfilment: 'delivery', address: '  ' }), ['address_required'])
  assert.deepEqual(checkoutProblems({ ...form, name: 'Sample Buyer', phone: '012 345 678', fulfilment: 'delivery', address: '12 Street 271' }), [])
  assert.deepEqual(checkoutProblems({ ...form, name: '   ', phone: '012 345 678' }), ['name_required'])
  assert.deepEqual(checkoutProblems({ ...form, name: 'A', phone: '1234567' }), ['phone_invalid'], 'seven digits')
  assert.deepEqual(checkoutProblems({ ...form, name: 'A', phone: '+855 12 345 678' }), [])
})

test('the phone rule is the Worker\'s own: same digit count after its canonical form, on a spread of real shapes', () => {
  // CATCHES: a client rule that drifts from lib/phone.ts and refuses a number the Worker accepts (or the other way round).
  for (const raw of ['012 345 678', '+855 12 345 678', '855123456789', '(012) 345-678', '12345', '0123456789012345', '', '   ', 'abc', '+']) {
    const canonical = canonicalizePhone(raw)
    const workerAccepts = !!canonical && canonical.length >= 8 && canonical.length <= 15
    assert.equal(isPlausiblePhone(raw), workerAccepts, raw)
  }
  assert.equal(phoneDigits('+855 (12) 345-678'), '85512345678')
})

test('the order body: whole lines, trimmed text, empty optional fields left out, the request id attached', () => {
  // CATCHES: sending a blank address or empty contacts (the Worker would then store empty strings), a fractional quantity, and a missing request id.
  const form = { ...emptyCheckoutForm(), name: '  Sample Buyer ', phone: ' 012 345 678 ', fulfilment: 'delivery' as const, address: ' 12 Street 271 ', note: '  ', contacts: { ...emptyCheckoutForm().contacts, telegram: ' @sample ', tiktok: '' } }
  const body = buildCheckoutBody(form, [{ id: '1000', qty: 2 }, { id: 1001, qty: 3.4 }], 'RID1234567890abc')
  assert.deepEqual(body, {
    lines: [{ product_id: 1000, quantity: 2 }, { product_id: 1001, quantity: 3 }],
    name: 'Sample Buyer', phone: '012 345 678', fulfilment: 'delivery', address: '12 Street 271',
    contacts: { telegram: '@sample' }, client_request_id: 'RID1234567890abc',
  })
  const pickup = buildCheckoutBody({ ...emptyCheckoutForm(), name: 'A', phone: '012345678' }, [{ id: 7, qty: 1 }], 'RID1234567890abc')
  assert.deepEqual(Object.keys(pickup).sort(), ['client_request_id', 'fulfilment', 'lines', 'name', 'phone'])
  assert.equal(pickup.fulfilment, 'pickup')
})

test('lines that cannot be ordered are filtered, and a request id has the shape the Worker accepts', () => {
  // CATCHES: sending a product id of "abc" or a zero quantity (the Worker refuses the whole order as invalid_line), and an id the Worker's shape check rejects.
  assert.deepEqual(orderableLines([{ id: 5, qty: 1 }, { id: 'abc', qty: 1 }, { id: 0, qty: 1 }, { id: 6, qty: 0 }, { id: '7', qty: 2 }]), [{ id: 5, qty: 1 }, { id: '7', qty: 2 }])
  const id = newClientRequestId()
  assert.match(id, /^[A-Za-z0-9_-]{8,64}$/)
  assert.notEqual(newClientRequestId(), newClientRequestId(), 'two ids differ')
  assert.equal(newClientRequestId(() => new Uint8Array(16)).length, 16)
})

test('money notes: refund first, then what was refunded, then what is still to pay; nothing for zero', () => {
  // CATCHES: a "$0.00 refund" line, and a balance shown before the refund the buyer is waiting on.
  const money = (over: Partial<{ paid_usd: number; refunded_usd: number; refund_due_usd: number; balance_due_usd: number }>) => ({ money: { paid_usd: 10, refunded_usd: 0, refund_due_usd: 0, balance_due_usd: 0, ...over } })
  assert.deepEqual(orderMoneyNotes(money({})), [])
  assert.deepEqual(orderMoneyNotes(money({ refund_due_usd: 4, refunded_usd: 2, balance_due_usd: 1.5 })), [
    { kind: 'refund_due', amountUsd: 4 }, { kind: 'refunded', amountUsd: 2 }, { kind: 'balance_due', amountUsd: 1.5 },
  ])
  assert.equal(formatUsd(21.5), '$21.50')
  assert.equal(formatUsd('3'), '$3.00')
  assert.equal(formatUsd(undefined), '$0.00')
})

test('this client\'s notion of finished states matches the Worker\'s own order states', () => {
  // CATCHES: the Worker gaining or renaming a state the page does not know (it would poll or show the wrong screen).
  const here = path.dirname(fileURLToPath(import.meta.url))
  const source = fs.readFileSync(path.join(here, '..', '..', 'cloudflare', 'src', 'lib', 'onlineOrders.ts'), 'utf8')
  const states = /export const ORDER_STATES = \[([^\]]+)\]/.exec(source)?.[1].match(/'([a-z_]+)'/g)?.map((s) => s.slice(1, -1)) ?? []
  assert.deepEqual(states, ['awaiting_payment', 'qr_failed', 'paid', 'review', 'expired', 'cancelled', 'fulfilled'])
  const viewStatuses = /export type ViewStatus =([^;]+?)\nexport type ViewChip/s.exec(source)?.[1].match(/'([a-z_]+)'/g)?.map((s) => s.slice(1, -1)) ?? []
  assert.deepEqual(viewStatuses.sort(), ['awaiting_payment', 'balance_due', 'cancelled', 'completed', 'delivery_pending', 'expired', 'paid', 'qr_failed', 'review', 'sale_cancelled'])
})

test('a pickup order never sends an address, even one typed before switching from delivery', () => {
  // CATCHES: the shop keeping a home address for an order the customer collects (the policy keeps an address only to deliver).
  const typed = { ...emptyCheckoutForm(), name: 'A', phone: '012345678', address: '12 Street 271' }
  const pickup = buildCheckoutBody({ ...typed, fulfilment: 'pickup' }, [{ id: 7, qty: 1 }], 'RID1234567890abc')
  assert.equal('address' in pickup, false)
  const delivery = buildCheckoutBody({ ...typed, fulfilment: 'delivery' }, [{ id: 7, qty: 1 }], 'RID1234567890abc')
  assert.equal(delivery.address, '12 Street 271')
})

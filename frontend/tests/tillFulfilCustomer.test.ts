// KHQR security review N5: the till sale that fulfils an order is made for the order's customer, and a delivery order arrives as a delivery with its address. The customer link is the
// Worker's (phone AND name; the staff detail's `customer_match`); the till never matches by the masked phone it holds.
//
// Run: node tests/tillFulfilCustomer.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { fulfilHandoff, FULFIL_HANDOFF_KEY, type StaffOrderDetail } from '../src/components/online-orders/onlineOrdersLogic.ts'
import { fulfilMoney, fulfilTillFields, needsCustomerForBalance, readFulfilHandoff, suggestedCustomerFields, suggestionOpen } from '../src/components/online-orders/fulfilOrder.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]) => fs.readFileSync(path.join(here, '..', ...parts), 'utf8').split('\r\n').join('\n')
const recorded = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'staff-order-detail-contract.json'), 'utf8')).paid as StaffOrderDetail
const withMatch = (match: StaffOrderDetail['customer_match'], over: Record<string, unknown> = {}): StaffOrderDetail => ({ ...recorded, customer_match: match, order: { ...recorded.order, ...over } })

test('the Worker\'s recorded detail carries customer_match, and the hand-off carries its id (through session storage too)', () => {
  // CATCHES: a hand-off with no customer, and an id lost on the way through storage.
  assert.ok('customer_match' in recorded, 'the recorded Worker detail names customer_match')
  assert.equal(fulfilHandoff(recorded).customer_id, null)
  const handoff = fulfilHandoff(withMatch({ id: 42, name: 'Dara', auto: true }))
  assert.equal(handoff.customer_id, 42)
  const stored = JSON.stringify(handoff)
  assert.equal(readFulfilHandoff({ getItem: (key: string) => (key === FULFIL_HANDOFF_KEY ? stored : null) })?.customer_id, 42)
  assert.equal(fulfilHandoff(withMatch({ id: 0, name: 'x', auto: true })).customer_id, null, 'a bad id is no link')
})

test('owner 10 Nov: only a signed-in buyer links at once; a typed phone and name is a SUGGESTION the cashier taps, and picking any customer closes it', () => {
  // CATCHES: a guest's typed name and phone silently linking a real customer (the sale, its receipt and any debt land on the wrong person), and a suggestion that stays after a pick.
  const guess = fulfilHandoff(withMatch({ id: 42, name: 'Dara' }))
  assert.equal(guess.customer_id, null, 'not linked'); assert.deepEqual(guess.customer_suggestion, { id: 42, name: 'Dara' })
  assert.equal(fulfilTillFields(guess).customer.id, null, 'the till starts without the customer')
  const stored = JSON.stringify(guess)
  assert.deepEqual(readFulfilHandoff({ getItem: (key: string) => (key === FULFIL_HANDOFF_KEY ? stored : null) })?.customer_suggestion, { id: 42, name: 'Dara' })
  assert.equal(suggestionOpen(guess, null), true); assert.equal(suggestionOpen(guess, 42), false); assert.equal(suggestionOpen(guess, 7), false, 'another pick closes it too')
  const taken = suggestedCustomerFields(guess)
  assert.deepEqual([taken?.customer.id, taken?.customer.name, taken?.customer.phone, taken?.customerSearch], [42, 'Dara', '', 'Dara'])
  const signedIn = fulfilHandoff(withMatch({ id: 42, name: 'Dara', auto: true }))
  assert.equal(signedIn.customer_suggestion, null); assert.equal(suggestedCustomerFields(signedIn), null)
  assert.equal(fulfilTillFields(signedIn).customer.id, 42)
})

test('a matched customer fills the till customer by id; no match carries the name only, never the masked phone', () => {
  // CATCHES: the masked phone ("012 *** 678") saved as the customer's number, a match dropped, and a walk-in sale for a named online buyer.
  const matched = fulfilTillFields(fulfilHandoff(withMatch({ id: 42, name: 'Dara', auto: true }, { customer_name: 'Dara', customer_phone: '012 *** 678' })))
  assert.deepEqual([matched.customer.id, matched.customer.name, matched.customer.phone, matched.customerSearch], [42, 'Dara', '', 'Dara'])
  const unmatched = fulfilTillFields(fulfilHandoff(withMatch(null, { customer_name: 'Dara', customer_phone: '012 *** 678' })))
  assert.deepEqual([unmatched.customer.id, unmatched.customer.name, unmatched.customer.phone], [null, 'Dara', ''])
})

test('a delivery order arrives as a delivery with its address; a pickup does not', () => {
  // CATCHES: a delivery sale rung as a walk-in (missing from delivery reports and driver lists), and an address on a pickup.
  const delivery = fulfilTillFields(fulfilHandoff(withMatch(null, { fulfilment: 'delivery', customer_address: '12 Street 271, Phnom Penh' })))
  assert.equal(delivery.isDelivery, true); assert.equal(delivery.customer.address, '12 Street 271, Phnom Penh')
  const pickup = fulfilTillFields(fulfilHandoff(withMatch(null, { fulfilment: 'pickup', customer_address: null })))
  assert.equal(pickup.isDelivery, false); assert.equal(pickup.customer.address, '')
})

test('an unpaid balance with no customer on the till tells the cashier to pick one; once the till has a customer, or when the sale is covered, it does not', () => {
  // CATCHES: a Not Paid debt silently created with no name behind it, and a note that stays after the cashier picked a customer (it read the hand-off, not the till).
  assert.equal(needsCustomerForBalance(null, fulfilMoney(25, 30)), true)
  assert.equal(needsCustomerForBalance(undefined, fulfilMoney(25, 30)), true)
  assert.equal(needsCustomerForBalance(42, fulfilMoney(25, 30)), false, 'picked in the cart')
  assert.equal(needsCustomerForBalance(null, fulfilMoney(25, 25)), false)
  assert.equal(needsCustomerForBalance(null, fulfilMoney(25, 20)), false)
})

test('the till applies those fields at both places it takes a hand-off, and the packs have the new sentence', () => {
  // CATCHES: the fields applied only when the hand-off lands in an empty tab (a second order opens a bare tab), and a missing Khmer line.
  const pos = read('src', 'components', 'pos', 'POS.tsx')
  assert.equal((pos.match(/\.\.\.fulfilTillFields\(handoff\)/g) ?? []).length, 2)
  const en = JSON.parse(read('src', 'lang', 'en.json')) as Record<string, string>, km = JSON.parse(read('src', 'lang', 'km.json')) as Record<string, string>
  assert.ok(en.oo_till_no_customer && km.oo_till_no_customer && km.oo_till_no_customer !== en.oo_till_no_customer && /[ក-៿]/.test(km.oo_till_no_customer))
  const banner = read('src', 'components', 'online-orders', 'FulfilBanner.tsx')
  assert.ok(/needsCustomerForBalance\(tillCustomerId, money\)/.test(banner) && /suggestionOpen\(handoff, tillCustomerId\)/.test(banner))
  assert.ok(/tillCustomerId=\{active\.customer\?\.id\}/.test(pos) && /suggestedCustomerFields\(onlineOrder\)/.test(pos), 'the till passes its own customer and applies a tapped suggestion')
  for (const key of ['oo_till_suggest', 'oo_till_use_customer']) assert.ok(en[key] && km[key] && /[ក-៿]/.test(km[key]), key)
  assert.ok(!/not in your customer list/.test(en.oo_till_no_customer), 'the wording does not claim the customer is missing from the list')
})

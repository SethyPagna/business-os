// What the order page sends when a shopper changes a waiting order or asks for a change or a return after paying (KHQR S7), and the link and
// amount helpers its QR screen uses. Each case names the wrong implementation it catches.
//
// Run: node tests/orderForms.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  PAID_STATUSES, buildRequestBody, draftForRequest, draftFromOrder, editBodyFor, estimateCartTotal, formatAmount, hasPendingRequest, orderScreen, requestKindsOffered, requestProblem, safeDeeplink,
} from '../src/components/catalog/orders/orderLogic.ts'
import type { OrderView } from '../src/components/catalog/orders/orderTypes.ts'

const NO_CONTACTS = { telegram: null, instagram: null, facebook: null, tiktok: null, whatsapp: null, other: null }
function order(over: Partial<OrderView> = {}): OrderView {
  return {
    order_no: 'W261109K7Q2', status: 'awaiting_payment', phase: 'before_sale', chips: [], fulfilment: 'pickup', name: 'Sample Buyer', phone_hint: '*** 678', address: null,
    contacts: { ...NO_CONTACTS, telegram: '@old', instagram: 'old_ig' }, note: null,
    items: [
      { product_id: 1000, name: 'Sample Cream', quantity: 2, unit_price_usd: 10, line_total_usd: 20 },
      { product_id: 1001, name: 'Sample Soap', quantity: 1, unit_price_usd: 5, line_total_usd: 5 },
    ],
    total_usd: 25, total_khr: 102500, currency: 'USD', created_at: '2026-11-09 03:00:00', paid_at: null, payment: null, top_ups: [], requests: [],
    money: { paid_usd: 0, refunded_usd: 0, refund_due_usd: 0, balance_due_usd: 0 },
    can_edit: true, can_cancel: true, requests_open: true, request_kinds: ['items', 'fulfilment', 'address', 'contact', 'note', 'cancel'], request_window_days: 7,
    ...over,
  }
}

test('an edit sends only what changed: nothing at all when nothing changed', () => {
  // CATCHES: a save that rewrites every field (and so asks the Worker for a new QR) when the shopper only fixed a typo in the note.
  const o = order()
  assert.deepEqual(editBodyFor(o, draftFromOrder(o)), {})
  assert.deepEqual(editBodyFor(o, { ...draftFromOrder(o), note: '  Gift wrap please ' }), { note: 'Gift wrap please' })
  assert.deepEqual(editBodyFor(o, { ...draftFromOrder(o), name: ' New Name ' }), { name: 'New Name' })
  assert.deepEqual(editBodyFor(o, { ...draftFromOrder(o), newPhone: ' 099 111 222 ' }), { phone: '099 111 222' })
  assert.deepEqual(editBodyFor(o, { ...draftFromOrder(o), fulfilment: 'delivery', address: '12 Street 271' }), { fulfilment: 'delivery', address: '12 Street 271' })
})

test('the items go with the edit only when they changed, as whole lines', () => {
  // CATCHES: sending the list when it is unchanged (a needless new QR), and a removed line still sent.
  const o = order()
  const draft = draftFromOrder(o)
  assert.equal('lines' in editBodyFor(o, draft), false)
  assert.deepEqual(editBodyFor(o, { ...draft, lines: [{ ...draft.lines[0], qty: 1 }, draft.lines[1]] }).lines, [{ product_id: 1000, quantity: 1 }, { product_id: 1001, quantity: 1 }])
  assert.deepEqual(editBodyFor(o, { ...draft, lines: [draft.lines[0]] }).lines, [{ product_id: 1000, quantity: 2 }])
})

test('a change to one contact sends all six, because the Worker reads `contacts` as the whole set', () => {
  // CATCHES: sending only the changed field (the Worker would clear the other five). The Worker's own merge is pinned below.
  const o = order()
  const body = editBodyFor(o, { ...draftFromOrder(o), contacts: { ...draftFromOrder(o).contacts, telegram: '@new' } })
  assert.deepEqual(body, { contacts: { telegram: '@new', instagram: 'old_ig', facebook: '', tiktok: '', whatsapp: '', other: '' } })
  const worker = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'cloudflare', 'src', 'lib', 'onlineOrderStore.ts'), 'utf8')
  assert.match(worker, /\{ \.\.\.current, \.\.\.normalizeContacts\(body\.contacts\) \}/, 'the Worker still merges the contacts it is sent over the current ones')
  assert.match(worker, /CONTACT_FIELDS\.map\(\(field\) => \[field, cleanText\(source\[field\]/, 'and normalizeContacts still answers every field, empty ones as null')
})

test('what each kind of request needs before it can be sent', () => {
  // CATCHES: a return with no items or no reason, an "items" request that changes nothing, a delivery switch with no address, and a request without the phone.
  const o = order({ status: 'paid' })
  const ask = (kind: Parameters<typeof draftForRequest>[1], over: Partial<ReturnType<typeof draftForRequest>> = {}) => requestProblem(o, { ...draftForRequest(o, kind), phone: '012 345 678', ...over })
  assert.equal(requestProblem(o, draftForRequest(o, 'cancel')), 'phone_invalid', 'no phone: nothing is sent, whatever the kind')
  assert.equal(ask('cancel'), null)
  assert.equal(ask('return'), 'need_items')
  assert.equal(ask('return', { quantities: { 1000: 1, 1001: 0 } }), 'need_reason')
  assert.equal(ask('return', { quantities: { 1000: 1, 1001: 0 }, reason: '   ' }), 'need_reason')
  assert.equal(ask('return', { quantities: { 1000: 1, 1001: 0 }, reason: 'Cracked cap' }), null)
  assert.equal(ask('items'), 'no_change')
  assert.equal(ask('items', { quantities: { 1000: 1, 1001: 1 } }), null)
  assert.equal(ask('items', { quantities: { 1000: 0, 1001: 0 } }), 'need_items')
  assert.equal(ask('fulfilment'), 'no_change')
  assert.equal(ask('fulfilment', { fulfilment: 'delivery' }), 'address_required')
  assert.equal(ask('fulfilment', { fulfilment: 'delivery', address: '12 Street 271' }), null)
  assert.equal(ask('address'), 'address_required')
  assert.equal(ask('address', { address: '12 Street 271' }), null)
  assert.equal(ask('contact'), 'no_change')
  assert.equal(ask('contact', { name: '  ' }), 'name_required')
  assert.equal(ask('contact', { name: 'Other Name' }), null)
  assert.equal(ask('note'), 'no_change')
  assert.equal(ask('note', { note: 'Leave at the gate' }), null)
})

test('the request body: kind, phone, a trimmed comment only when given, and the proposal under `after`', () => {
  // CATCHES: a return without its reason under after.reason, quantities kept for items not chosen, an empty comment sent, contacts sent partially.
  const o = order({ status: 'paid' })
  const ret = { ...draftForRequest(o, 'return'), phone: ' 012 345 678 ', quantities: { 1000: 1, 1001: 0 }, reason: ' Cracked cap ', comment: '' }
  assert.deepEqual(buildRequestBody(o, ret), { kind: 'return', phone: '012 345 678', after: { lines: [{ product_id: 1000, quantity: 1 }], reason: 'Cracked cap' } })
  assert.deepEqual(buildRequestBody(o, { ...ret, comment: ' Photos on request ' }), { kind: 'return', phone: '012 345 678', comment: 'Photos on request', after: { lines: [{ product_id: 1000, quantity: 1 }], reason: 'Cracked cap' } })
  assert.deepEqual(buildRequestBody(o, { ...draftForRequest(o, 'items'), phone: '012345678', quantities: { 1000: 3, 1001: 0 } }), { kind: 'items', phone: '012345678', after: { lines: [{ product_id: 1000, quantity: 3 }] } })
  assert.deepEqual(buildRequestBody(o, { ...draftForRequest(o, 'cancel'), phone: '012345678' }), { kind: 'cancel', phone: '012345678', after: {} })
  assert.deepEqual(buildRequestBody(o, { ...draftForRequest(o, 'address'), phone: '012345678', address: ' 9 Street ' }), { kind: 'address', phone: '012345678', after: { address: '9 Street' } })
  assert.deepEqual(buildRequestBody(o, { ...draftForRequest(o, 'contact'), phone: '012345678', name: 'N', contacts: { ...draftForRequest(o, 'contact').contacts, tiktok: 'tt' } }).after, { name: 'N', contacts: { telegram: '@old', instagram: 'old_ig', facebook: '', tiktok: 'tt', whatsapp: '', other: '' } })
})

test('a return starts from nothing chosen and a change starts from what was ordered', () => {
  // CATCHES: a return form that opens with every item already marked for return.
  const o = order({ status: 'paid' })
  assert.deepEqual(draftForRequest(o, 'return').quantities, { 1000: 0, 1001: 0 })
  assert.deepEqual(draftForRequest(o, 'items').quantities, { 1000: 2, 1001: 1 })
})

test('requests: the form offers only what the order allows, and one pending request blocks another', () => {
  // CATCHES: offering kinds while the window is closed, and a second request while one waits (the Worker refuses it as request_pending).
  assert.deepEqual(requestKindsOffered(order({ requests_open: true, request_kinds: ['items', 'cancel'] })), ['items', 'cancel'])
  assert.deepEqual(requestKindsOffered(order({ requests_open: false, request_kinds: ['items', 'cancel'] })), [])
  const pending = { id: 1, kind: 'note' as const, stage: 'paid', status: 'pending' as const, staff_reply: null, comment: null, attachments: [], created_at: '2026-11-09 03:00:00' }
  assert.equal(hasPendingRequest(order({ requests: [] })), false)
  assert.equal(hasPendingRequest(order({ requests: [{ ...pending, status: 'rejected' }] })), false)
  assert.equal(hasPendingRequest(order({ requests: [{ ...pending, status: 'rejected' }, pending] })), true)
})

test('the changes-and-returns section belongs to paid orders only', () => {
  // CATCHES: a request form on an order nobody has paid for, or none once a sale exists.
  for (const status of ['paid', 'review', 'completed', 'balance_due', 'delivery_pending', 'sale_cancelled'] as const) assert.equal(PAID_STATUSES.has(status), true, status)
  for (const status of ['awaiting_payment', 'qr_failed', 'expired', 'cancelled'] as const) assert.equal(PAID_STATUSES.has(status), false, status)
})

test('the bank-app link is only ever an ABA scheme or https, and the amount reads in its own currency', () => {
  // CATCHES: a javascript: or data: link built from a server string, and riel shown as dollars.
  assert.equal(safeDeeplink('abamobilebank://ababank.com?type=payway&qrcode=abc'), 'abamobilebank://ababank.com?type=payway&qrcode=abc')
  assert.equal(safeDeeplink('https://link.payway.com.kh/ABA?x=1'), 'https://link.payway.com.kh/ABA?x=1')
  assert.equal(safeDeeplink('abapay://x'), 'abapay://x')
  for (const bad of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'http://example.com', 'not a url', '', null, undefined, 5, 'ftp://x', `https://x/${'a'.repeat(2100)}`]) assert.equal(safeDeeplink(bad), null, String(bad))
  assert.equal(formatAmount(37.26, 'USD'), '$37.26')
  assert.equal(formatAmount(152766, 'KHR'), '152,766 ៛')
  assert.equal(formatAmount('x', 'usd'), '$0.00')
})

test('the checkout total is the cart as the shopper sees it, and nothing at all when a price is not a plain dollar amount', () => {
  // CATCHES: a total built with floating point (18.63 x 2 as 37.260000000000005), a comma price read as 1, and a wrong figure shown when one line is not in dollars.
  assert.equal(estimateCartTotal([{ qty: 2, priceText: '$18.63' }, { qty: 1, priceText: '$5.00' }]), 42.26)
  assert.equal(estimateCartTotal([{ qty: 3, priceText: '$1,250.50' }]), 3751.5)
  assert.equal(estimateCartTotal([{ qty: 1, priceText: '$0.1' }, { qty: 2, priceText: '$0.2' }]), 0.5)
  assert.equal(estimateCartTotal([{ qty: 1, priceText: '$5.00' }, { qty: 1, priceText: '12,000 ៛' }]), null)
  assert.equal(estimateCartTotal([{ qty: 1, priceText: '' }]), null)
  assert.equal(estimateCartTotal([{ qty: 0, priceText: '$5.00' }]), null)
  assert.equal(estimateCartTotal([]), 0)
})

test('a closed order shows the closed screen whatever its status says, so it offers no new QR', () => {
  // CATCHES: an old unpaid link that still offers "Get a new QR" after the shop closed the order.
  assert.equal(orderScreen({ status: 'expired', payment: null, closed: true }, null), 'closed')
  assert.equal(orderScreen({ status: 'awaiting_payment', payment: null, closed: true }, null), 'closed')
  assert.equal(orderScreen({ status: 'expired', payment: null, closed: false }, null), 'new_qr')
  assert.equal(orderScreen({ status: 'expired', payment: null }, null), 'new_qr')
})

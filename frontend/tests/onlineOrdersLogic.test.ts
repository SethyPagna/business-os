// The staff Orders screen's rules (KHQR G6): chips, search, paging, what each action offers and sends, how a request reads before and after, and the error text for
// every refusal code the Worker's staff routes can answer. Each case names the wrong implementation it catches.
//
// Run: node tests/onlineOrdersLogic.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  FIRST_PAGE, ONLINE_REFUSAL_FALLBACK, ONLINE_REFUSAL_KEYS, ORDER_FILTERS, SEARCH_MAX, onlineRefusalText, searchState, STAFF_ERROR_FALLBACK, STAFF_ERROR_KEYS, applyBody, availableActions, cancelBody, currentCursor, decideBody, fulfilHandoff, nextTrail, noteBody,
  orderAccess, pageNumber, previousTrail, refundBody, refundProblem, requestCanBeApplied, requestChanges, resolveBody, rowChips, staffErrorKey, staffMessage, stateChip,
  type StaffOrderDetail,
} from '../src/components/online-orders/onlineOrdersLogic.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
// The money of a detail is the Worker's own recorded staff-detail money (fixtures/staff-order-detail-contract.json), not a shape this test assumes.
const workerPaid = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'staff-order-detail-contract.json'), 'utf8')).paid as StaffOrderDetail
const row = (over = {}) => ({ state: 'paid', pending_requests: 0, held_review: 0, ...over })
const detail = (over: Record<string, unknown> = {}, money = {}): StaffOrderDetail => ({
  order: { id: 7, order_no: 'W261109K7Q2', state: 'paid', revision: 4, sale_id: null, goods_total_usd: 25, currency: 'USD', branch_id: 2, customer_name: 'Sample Buyer', customer_phone: '*** 678', fulfilment: 'pickup', customer_address: null,
    items_json: JSON.stringify([{ product_id: 1000, name: 'Sample Cream', quantity: 2, unit_price_usd: 10, line_total_usd: 20 }, { product_id: 1001, name: 'Sample Soap', quantity: 1, unit_price_usd: 5, line_total_usd: 5 }]), ...over },
  payments: [], requests: [], events: [], status: 'paid', chips: [], money: { ...workerPaid.money, ...money },
})
const ALL = { canView: true, canDecide: true, canRefund: true }

test('each state wears its own chip, and a request or a held payment adds one without hiding the state', () => {
  // CATCHES: a paid order with an unanswered request looking like any paid order, and a held payment on a paid order going unseen.
  assert.deepEqual(['paid', 'review', 'awaiting_payment', 'qr_failed', 'expired', 'cancelled', 'fulfilled'].map((s) => stateChip(s).id), ['to_fulfil', 'needs_review', 'not_paid', 'qr_failed', 'expired', 'cancelled', 'fulfilled'])
  assert.deepEqual(rowChips(row()).map((c) => c.id), ['to_fulfil'])
  assert.deepEqual(rowChips(row({ pending_requests: 2 })), [{ id: 'to_fulfil', tone: 'todo' }, { id: 'requests', tone: 'todo', count: 2 }])
  assert.deepEqual(rowChips(row({ held_review: 1 })).map((c) => c.id), ['to_fulfil', 'needs_review'])
  assert.deepEqual(rowChips(row({ state: 'review', held_review: 1 })).map((c) => c.id), ['needs_review'], 'review state is one chip, not two')
})

test('the filters are exactly the ones the Worker answers, with what needs a person first', () => {
  // CATCHES: a chip that asks for a filter the Worker would treat as "attention" without saying so.
  assert.deepEqual([...ORDER_FILTERS], ['attention', 'paid', 'review', 'requests', 'refund_due', 'awaiting_payment', 'fulfilled', 'expired', 'qr_failed', 'cancelled', 'all'])
  const worker = path.join(here, '..', '..', 'cloudflare', 'src', 'lib', 'onlineOrderStaff.ts')
  if (fs.existsSync(worker)) {
    const list = /LIST_FILTERS = \[([^\]]*)\]/.exec(fs.readFileSync(worker, 'utf8'))?.[1] ?? ''
    const answered = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    for (const id of ORDER_FILTERS) assert.ok(answered.includes(id), `the Worker answers the ${id} filter`)
  }
})

test('search waits for enough text, reads phone text by its digits and order numbers by their characters, and never exceeds the Worker limit', () => {
  // CATCHES: asking the Worker on one keystroke (it refuses with search_too_short), counting "+855 1" as long enough because of its punctuation, and an order number counted with its dashes.
  assert.deepEqual(searchState(''), { kind: 'none' })
  assert.deepEqual(searchState('   '), { kind: 'none' })
  assert.deepEqual(searchState('01'), { kind: 'short' })
  assert.deepEqual(searchState('+8 5'), { kind: 'short' }, 'three digits are needed, not three characters')
  assert.deepEqual(searchState('(012) 345'), { kind: 'ok', q: '(012) 345' })
  assert.deepEqual(searchState('W2'), { kind: 'short' })
  assert.deepEqual(searchState('w - 2'), { kind: 'short' }, 'spaces and dashes do not count toward the three')
  assert.deepEqual(searchState('  W2611 '), { kind: 'ok', q: 'W2611' })
  assert.equal((searchState('x'.repeat(80)) as { q: string }).q.length, SEARCH_MAX)
})

test('a list row wears Refund due when the Worker says money is owed back, and not otherwise', () => {
  // CATCHES: reading refund_due_usd instead of the flag (0 for orders that never took money), and a chip on an order whose refund is complete.
  const base = { state: 'cancelled', pending_requests: 0, held_review: 0 }
  assert.deepEqual(rowChips({ ...base, refund_due: true }).map((c) => c.id), ['cancelled', 'refund_due'])
  assert.deepEqual(rowChips({ ...base, refund_due: false }).map((c) => c.id), ['cancelled'])
  assert.deepEqual(rowChips(base).map((c) => c.id), ['cancelled'])
})

test('Previous and Next walk keyset cursors without ever losing the first page', () => {
  // CATCHES: Previous on page 1 popping the only cursor, Next with no cursor adding a page, and the cursor of the wrong page being sent.
  assert.equal(pageNumber(FIRST_PAGE), 1)
  assert.equal(currentCursor(FIRST_PAGE), null)
  assert.deepEqual(previousTrail(FIRST_PAGE), FIRST_PAGE)
  assert.deepEqual(nextTrail(FIRST_PAGE, null), FIRST_PAGE)
  const two = nextTrail(FIRST_PAGE, '2026-11-09 10:00:00.000|55')
  const three = nextTrail(two, '2026-11-09 09:00:00.000|40')
  assert.equal(pageNumber(three), 3)
  assert.equal(currentCursor(three), '2026-11-09 09:00:00.000|40')
  assert.equal(currentCursor(previousTrail(three)), '2026-11-09 10:00:00.000|55')
  assert.deepEqual(previousTrail(previousTrail(three)), FIRST_PAGE)
})

test('a request reads as plain before and after, and only the parts it changes are listed', () => {
  // CATCHES: an items request with no before column, an address-only request listing the unchanged pickup, a return without its reason.
  const items = requestChanges({ kind: 'items', before_json: JSON.stringify({ items: [{ product_id: 1000, name: 'Sample Cream', quantity: 2 }] }), after_json: JSON.stringify({ items: [{ product_id: 1000, name: 'Sample Cream', quantity: 3 }] }) })
  assert.deepEqual(items, [{ field: 'items', before: '2 × Sample Cream', after: '3 × Sample Cream' }])
  assert.deepEqual(requestChanges({ kind: 'fulfilment', before_json: JSON.stringify({ fulfilment: 'pickup', address: null }), after_json: JSON.stringify({ fulfilment: 'delivery', address: '12 Street 271' }) }),
    [{ field: 'fulfilment', before: 'pickup', after: 'delivery' }, { field: 'address', before: '', after: '12 Street 271' }])
  assert.deepEqual(requestChanges({ kind: 'address', before_json: JSON.stringify({ address: 'old' }), after_json: JSON.stringify({ address: 'old' }) }), [])
  assert.deepEqual(requestChanges({ kind: 'return', before_json: JSON.stringify({ items: [{ product_id: 1, quantity: 2 }] }), after_json: JSON.stringify({ items: [{ product_id: 1, quantity: 1 }], reason: 'Cracked cap' }) }).map((c) => c.field), ['items', 'reason'])
  assert.deepEqual(requestChanges({ kind: 'cancel', before_json: JSON.stringify({ state: 'paid' }), after_json: '{}' }), [{ field: 'cancel', before: 'paid', after: '' }])
  assert.deepEqual(requestChanges({ kind: 'note', before_json: 'not json', after_json: JSON.stringify({ note: 'Gift' }) }), [{ field: 'note', before: '', after: 'Gift' }], 'a broken stored snapshot reads as empty, never throws')
  assert.deepEqual(requestChanges({ kind: 'contact', before_json: JSON.stringify({ name: 'A', contacts: { telegram: '@a', tiktok: null } }), after_json: JSON.stringify({ name: 'A', contacts: { telegram: '@b' } }) }), [{ field: 'contacts', before: 'telegram: @a', after: 'telegram: @b' }])
})

test('applying is offered only for an accepted, paid-stage request on a paid order with no sale, and only for the kinds that edit the order', () => {
  // CATCHES: Apply on a return (the Worker refuses it as apply_on_sale), on a still-pending request, and after the sale exists.
  const order = { state: 'paid', sale_id: null }
  const ok = { state: 'accepted', kind: 'items', stage: 'paid' }
  assert.equal(requestCanBeApplied(ok, order), true)
  assert.equal(requestCanBeApplied({ ...ok, state: 'pending' }, order), false)
  assert.equal(requestCanBeApplied({ ...ok, kind: 'return' }, order), false)
  assert.equal(requestCanBeApplied({ ...ok, kind: 'cancel' }, order), false)
  assert.equal(requestCanBeApplied({ ...ok, stage: 'after_sale' }, order), false)
  assert.equal(requestCanBeApplied(ok, { state: 'review', sale_id: null }), false)
  assert.equal(requestCanBeApplied(ok, { state: 'paid', sale_id: 9 }), false)
})

test('the actions on offer follow the order and the person: resolve only in review, refund only with a refund due and its own grant, nothing once a sale exists', () => {
  // CATCHES: a Cancel on a handed-over order, Accept payment on a plain paid one, a refund button for someone without the refund grant, and Fulfil on an unpaid order.
  assert.deepEqual(availableActions(detail(), ALL), ['recheck', 'note', 'cancel', 'fulfil'])
  assert.deepEqual(availableActions(detail({ state: 'review' }), ALL), ['recheck', 'note', 'resolve', 'cancel'])
  assert.deepEqual(availableActions(detail({}, { refund_due_usd: 12.5 }), ALL), ['recheck', 'note', 'cancel', 'refund', 'fulfil'])
  assert.deepEqual(availableActions(detail({}, { refund_due_usd: 12.5 }), { canView: true, canDecide: true, canRefund: false }), ['recheck', 'note', 'cancel', 'fulfil'])
  assert.deepEqual(availableActions(detail(), { canView: true, canDecide: false, canRefund: false }), ['recheck', 'note', 'fulfil'])
  assert.deepEqual(availableActions(detail({ state: 'cancelled' }, { refund_due_usd: 25 }), ALL), ['recheck', 'note', 'refund'])
  assert.deepEqual(availableActions(detail({ state: 'fulfilled', sale_id: 3 }), ALL), ['note'])
  assert.deepEqual(availableActions(detail({ state: 'awaiting_payment' }, { paid_usd: 0 }), ALL), ['recheck', 'note'])
  assert.deepEqual(availableActions(detail(), { canView: false, canDecide: true, canRefund: true }), [], 'no view, no actions')
})

test('the permission tiers become view, decide and refund, and decide and refund need view as well', () => {
  // CATCHES: a refund grant alone opening the screen's actions (the Worker needs view too).
  const grants = (set: string[]) => (key: string, action: string) => key === 'online_orders' && set.includes(action)
  assert.deepEqual(orderAccess(grants(['view', 'decide', 'refund'])), ALL)
  assert.deepEqual(orderAccess(grants(['view'])), { canView: true, canDecide: false, canRefund: false })
  assert.deepEqual(orderAccess(grants(['decide', 'refund'])), { canView: false, canDecide: false, canRefund: false })
})

test('the refund amount must be dollars and cents, more than 0 and no more than what is due', () => {
  // CATCHES: 0, a negative, text, three decimals and an amount above the refund due being accepted.
  for (const bad of ['', '0', '0.00', '-5', 'abc', '1.234', '1,5', ' ']) assert.equal(refundProblem(bad, 25), 'amount_invalid', JSON.stringify(bad))
  assert.equal(refundProblem('25.01', 25), 'refund_over_due')
  assert.equal(refundProblem('25', 25), null)
  assert.equal(refundProblem(' 12.5 ', 25), null)
  assert.equal(refundProblem('0.1', 0.3 - 0.2), null, 'floating point does not refuse an exact amount')
})

test('each action sends exactly what the Worker reads: trimmed text, nothing empty, the order revision it saw', () => {
  // CATCHES: an empty comment sent as "", a revision left out (the Worker would then apply to whatever is current), a message cut at the wrong length.
  assert.deepEqual(decideBody('accept', '  Packed, thanks ', ''), { decision: 'accept', public_comment: 'Packed, thanks' })
  assert.deepEqual(decideBody('reject', '', ' not possible '), { decision: 'reject', internal_note: 'not possible' })
  assert.equal((decideBody('accept', 'x'.repeat(400), '') as { public_comment: string }).public_comment.length, 300)
  assert.deepEqual(applyBody(4), { revision: 4 })
  assert.deepEqual(resolveBody('', 4), { revision: 4 })
  assert.deepEqual(resolveBody(' checked in ABA ', 4), { note: 'checked in ABA', revision: 4 })
  assert.deepEqual(cancelBody(' duplicate ', 4), { reason: 'duplicate', revision: 4 })
  assert.deepEqual(noteBody('  call after 5 '), { note: 'call after 5' })
  assert.deepEqual(refundBody(' 12.5 ', ' ABA-123 ', ''), { amount_usd: 12.5, reference: 'ABA-123' })
  assert.deepEqual(refundBody('7', '', ' sent '), { amount_usd: 7, note: 'sent' })
})

test('the hand-off to the till carries the lines, the order link id, the revision and what was paid', () => {
  // CATCHES: a till opened with the order's price text instead of product ids, a missing online_order_id (the sale would not close the order), and a deleted line sent.
  const handoff = fulfilHandoff(detail({ customer_address: '12 Street 271', fulfilment: 'delivery', items_json: JSON.stringify([{ product_id: 1000, quantity: 2 }, { product_id: 'x', quantity: 1 }, { product_id: 1001, quantity: 0 }]) }))
  assert.deepEqual(handoff, { online_order_id: 7, order_no: 'W261109K7Q2', revision: 4, branch_id: 2, customer_name: 'Sample Buyer', customer_phone: '*** 678', fulfilment: 'delivery', address: '12 Street 271', lines: [{ product_id: 1000, quantity: 2 }], paid_usd: 25 })
})

test('every refusal code the Worker staff routes can answer has a sentence key, and every key has its English', () => {
  // CATCHES: a new refusal on the Worker that staff would see as the generic sentence, and a key with no fallback text.
  const codes = new Set<string>()
  for (const file of ['lib/onlineOrderStaff.ts', 'routes/onlineOrders.ts']) {
    const source = path.join(here, '..', '..', 'cloudflare', 'src', file)
    if (!fs.existsSync(source)) continue
    const text = fs.readFileSync(source, 'utf8')
    for (const m of text.matchAll(/refuse\(\d+, '([a-z_]+)'/g)) codes.add(m[1])
    for (const m of text.matchAll(/code: '([a-z_]+)'/g)) codes.add(m[1])
    for (const m of text.matchAll(/text\([^)]*'([a-z_]+_invalid)'/g)) codes.add(m[1])
  }
  const unexplained = [...codes].filter((code) => !(code in STAFF_ERROR_KEYS)).sort()
  assert.deepEqual(unexplained, [], `staff refusals with no sentence: ${unexplained.join(', ')}`)
  for (const key of new Set(Object.values(STAFF_ERROR_KEYS))) assert.ok(STAFF_ERROR_FALLBACK[key], `${key} has an English sentence`)
  assert.equal(staffErrorKey('something_new'), 'oo_err_generic')
  const tt = (key: string, fallback: string) => (key === 'oo_err_changed' ? 'PACK TEXT' : fallback)
  assert.equal(staffMessage(tt, 'order_changed'), 'PACK TEXT', 'the pack wins over the fallback')
  assert.equal(staffMessage(tt, 'refund_over_due'), STAFF_ERROR_FALLBACK.oo_err_refund_over_due)
  assert.equal(staffMessage(tt, 'nonsense'), STAFF_ERROR_FALLBACK.oo_err_generic)
})

test('the bell anchor the Worker sends for an online order opens the Orders section of Sales', async () => {
  // CATCHES: a bell row (pageId sales, anchor hub:sales:orders) that lands on the Sales list, because the hub does not recognise the section.
  const { hubAnchor, getHubPageFromLocation, resolveHubSection } = await import('../src/components/shared/hubNavigation.ts')
  const { getHubDestinations } = await import('../src/components/shared/hubDestinations.ts')
  assert.equal(hubAnchor('sales', 'orders'), 'hub:sales:orders')
  assert.equal(getHubPageFromLocation('/', '#hub:sales:orders'), 'sales')
  const everything = { getPermissionTier: () => 'full', hasPermission: () => true, can: () => true }
  const ids = getHubDestinations('sales', everything).map((d) => d.id)
  assert.ok(ids.includes('orders'))
  assert.equal(resolveHubSection('sales', '/sales', '#hub:sales:orders', ids, 'sales'), 'orders')
  const viewOnly = { ...everything, can: (key: string) => key === 'online_orders' }
  assert.deepEqual(getHubDestinations('sales', viewOnly).map((d) => d.id), ['orders'], 'online_orders view alone shows the Orders section and nothing else')
})

test('money held in review is resolved before Fulfil is offered, even when the order itself says paid', () => {
  // CATCHES: Fulfil on a paid order whose second payment is held (the held money then vanishes from the order once a sale exists), and Resolve missing for it.
  const held = { ...detail(), payments: [{ id: 1, state: 'paid' }, { id: 2, state: 'review' }] } as unknown as StaffOrderDetail
  assert.deepEqual(availableActions(held, ALL), ['recheck', 'note', 'resolve', 'cancel'])
  assert.deepEqual(availableActions(held, { canView: true, canDecide: false, canRefund: false }), ['recheck', 'note'], 'resolving needs the decide grant')
  const clean = { ...detail(), payments: [{ id: 1, state: 'paid' }] } as unknown as StaffOrderDetail
  assert.ok(availableActions(clean, ALL).includes('fulfil') && !availableActions(clean, ALL).includes('resolve'))
  // N2: after a Fulfil, a payment held in review is still resolved (it counts as refund due); cancel and fulfil are for an order without a sale.
  const sold = { ...held, order: { ...held.order, sale_id: 9, state: 'fulfilled' } } as unknown as StaffOrderDetail
  const soldActions = availableActions(sold, ALL)
  assert.ok(soldActions.includes('resolve') && !soldActions.includes('cancel') && !soldActions.includes('fulfil'))
  assert.ok(!availableActions(sold, { canView: true, canDecide: false, canRefund: true }).includes('resolve'), 'resolving still needs the decide grant')
  const soldClean = { ...sold, payments: [{ id: 1, state: 'paid' }] } as unknown as StaffOrderDetail
  assert.ok(!availableActions(soldClean, ALL).includes('resolve'), 'a sold order with nothing held has nothing to resolve')
})

test('every refusal the till and Returns can get for an online order has a sentence in both packs, restated by code and never as the Worker\'s English', () => {
  // CATCHES: a code the Worker answers with no pack key (a Khmer till then shows English), a key with no Khmer, and a code that falls back to the generic sentence.
  const en = JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'lang', 'en.json'), 'utf8')) as Record<string, string>
  const km = JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'lang', 'km.json'), 'utf8')) as Record<string, string>
  const wanted = ['order_in_review', 'order_other_branch', 'online_tender_mismatch', 'online_order_changed', 'aba_refund_over_online', 'refund_channel_requires_online_order', 'return_exchange_refund_channel', 'order_already_fulfilled', 'order_not_paid', 'online_currency_unsupported', 'online_order_invalid', 'order_not_found']
  assert.deepEqual(Object.keys(ONLINE_REFUSAL_KEYS).sort(), [...wanted].sort())
  for (const [code, key] of Object.entries(ONLINE_REFUSAL_KEYS)) {
    assert.equal(en[key], ONLINE_REFUSAL_FALLBACK[key], `${code}: the English pack text is the fallback`)
    assert.ok(km[key] && km[key] !== en[key] && /[ក-៿]/.test(km[key]), `${code}: a real Khmer sentence`)
  }
  const tt = (key: string, fallback: string) => (key === 'oo_err_in_review' ? 'PACK' : fallback)
  assert.equal(onlineRefusalText({ code: 'order_in_review' }, tt), 'PACK')
  assert.equal(onlineRefusalText({ code: 'online_tender_mismatch' }, tt), ONLINE_REFUSAL_FALLBACK.oo_err_tender_mismatch)
  assert.equal(onlineRefusalText({ code: 'something_else' }, tt), null)
  assert.equal(onlineRefusalText(new Error('x'), tt), null)
  // Against the Worker's own codes when its source for them is present in this tree.
  const worker = path.join(here, '..', '..', 'cloudflare', 'src', 'lib', 'onlineOrderFulfil.ts')
  if (fs.existsSync(worker)) {
    const source = fs.readFileSync(worker, 'utf8')
    for (const m of source.matchAll(/refuse\(\d+, '([a-z_]+)'/g)) assert.ok(m[1] in ONLINE_REFUSAL_KEYS, `the Worker's ${m[1]} has a sentence`)
  }
})

test('a refused order sale reads in Khmer on a Khmer screen and is left as the Worker said it on an English one; other errors are untouched', async () => {
  // CATCHES: the Worker's English on a Khmer till, a pack text replacing English that was already right, and an unrelated refusal being rewritten.
  // The module under test, with its pack import served from the real Khmer pack (a Node test cannot import JSON the way the bundler does).
  const km = JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'lang', 'km.json'), 'utf8')) as Record<string, string>
  const { transformSync } = await import('esbuild')
  const source = fs.readFileSync(path.join(here, '..', 'src', 'components', 'online-orders', 'onlineRefusalKeys.ts'), 'utf8').replace("import('../../lang/km.json')", 'Promise.resolve({ default: __km })')
  const mod = { exports: {} as { restateOnlineRefusal: <T extends Error & { code?: unknown }>(error: T) => Promise<T> } }
  new Function('module', 'exports', '__km', transformSync(source, { loader: 'ts', format: 'cjs' }).code)(mod, mod.exports, km)
  const { restateOnlineRefusal } = mod.exports
  const document = { documentElement: { getAttribute: (name: string) => (name === 'lang' ? lang : null) } }
  let lang = 'km'
  Object.assign(globalThis, { document })
  const refusal = (code: string) => Object.assign(new Error('Worker English'), { code })
  assert.equal((await restateOnlineRefusal(refusal('order_in_review'))).message, km.oo_err_in_review)
  assert.equal((await restateOnlineRefusal(refusal('aba_refund_over_online'))).message, km.aba_refund_over_online)
  assert.equal((await restateOnlineRefusal(refusal('something_else'))).message, 'Worker English')
  assert.equal((await restateOnlineRefusal(new Error('no code'))).message, 'no code')
  lang = 'en'
  assert.equal((await restateOnlineRefusal(refusal('order_in_review'))).message, 'Worker English')
  // only a sale that carries an order pays for the lookup
  const till = fs.readFileSync(path.join(here, '..', 'src', 'components', 'pos', 'POS.tsx'), 'utf8')
  assert.match(till, /if \(payload\.online_order_id == null\) return created/)
})

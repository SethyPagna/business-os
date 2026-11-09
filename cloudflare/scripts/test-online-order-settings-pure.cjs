// KHQR S5: the two owner-editable online order numbers (payment minutes, request window days) are validated on write, never clamped, and the tolerant readers agree
// with the validator. Mirrors the low-stock settings rule (test-low-stock-settings-pure.cjs).
//
// Run: node scripts/test-online-order-settings-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { load } = require('./test-request-body-guard-pure.cjs')

const orders = load('lib/onlineOrders.ts')
const { validateOnlineOrderSettingsWrite: validate, PAYMENT_MINUTES_KEY, REQUEST_WINDOW_DAYS_KEY, resolveRequestWindowDays } = orders
const SRC = path.join(__dirname, '..', 'src')
let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }

check('keys are the ones the reader and the settings row use', () => {
  assert.equal(PAYMENT_MINUTES_KEY, 'online_order_payment_minutes'); assert.equal(REQUEST_WINDOW_DAYS_KEY, 'online_order_request_days')
})

check('payment minutes: 3 to 60 whole numbers pass (number or text), everything else is refused with the minutes code (a clamping build accepts 2, 61 and 12.5)', () => {
  for (const ok of [3, 15, 60, '3', ' 45 ']) assert.equal(validate({ [PAYMENT_MINUTES_KEY]: ok }), null, String(ok))
  for (const bad of [2, 0, -5, 61, 1000, 12.5, '12.5', 'abc', '1e1', true, {}, [], NaN]) assert.equal(validate({ [PAYMENT_MINUTES_KEY]: bad }), 'invalid_online_order_payment_minutes', String(bad))
})

check('request window days: 1 to 30 whole numbers pass, everything else is refused with the days code', () => {
  for (const ok of [1, 7, 30, '30']) assert.equal(validate({ [REQUEST_WINDOW_DAYS_KEY]: ok }), null, String(ok))
  for (const bad of [0, 31, 45, -1, 2.5, 'week', false]) assert.equal(validate({ [REQUEST_WINDOW_DAYS_KEY]: bad }), 'invalid_online_order_request_days', String(bad))
})

check('clearing a value (empty or null) is allowed: the default applies; unrelated keys and an empty body are untouched', () => {
  assert.equal(validate({ [PAYMENT_MINUTES_KEY]: '' }), null); assert.equal(validate({ [REQUEST_WINDOW_DAYS_KEY]: null }), null)
  assert.equal(validate({ theme: 'dark', exchange_rate: 'nonsense' }), null); assert.equal(validate({}), null); assert.equal(validate(null), null); assert.equal(validate(undefined), null)
})

check('one bad key refuses the whole write even beside a good one', () => {
  assert.equal(validate({ [PAYMENT_MINUTES_KEY]: 20, [REQUEST_WINDOW_DAYS_KEY]: 99 }), 'invalid_online_order_request_days')
  assert.equal(validate({ [PAYMENT_MINUTES_KEY]: 1, [REQUEST_WINDOW_DAYS_KEY]: 7 }), 'invalid_online_order_payment_minutes')
})

check('the reader and the validator agree: every accepted day count reads back as itself, every refused one reads as the default', () => {
  for (let day = -2; day <= 40; day += 1) {
    const accepted = validate({ [REQUEST_WINDOW_DAYS_KEY]: day }) === null
    assert.equal(resolveRequestWindowDays(day), accepted ? day : orders.REQUEST_WINDOW_DAYS_DEFAULT, String(day))
  }
  const store = fs.readFileSync(path.join(SRC, 'lib', 'onlineOrderStore.ts'), 'utf8')
  assert.match(store, /minutes >= PAYMENT_MINUTES_MIN && minutes <= PAYMENT_MINUTES_MAX/, 'the payment minutes reader uses the shared bounds')
})

check('POST /api/settings runs the validator and answers 400 with its code BEFORE the amendment window block and any write', () => {
  const settings = fs.readFileSync(path.join(SRC, 'routes', 'settings.ts'), 'utf8')
  const at = settings.indexOf('validateOnlineOrderSettingsWrite(body)')
  assert.ok(at > -1, 'the route calls the validator')
  assert.ok(at < settings.indexOf("if (attemptedKeys.includes('sale_amendment_window_minutes'))"), 'before the later checks')
  const block = settings.slice(at, at + 700)
  assert.match(block, /code: onlineOrderError/); assert.match(block, /\}, 400\)/)
})

console.log(`online order settings: ${passed} checks passed`)

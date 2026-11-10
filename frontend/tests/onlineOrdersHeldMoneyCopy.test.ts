// KHQR round 2, D7 (display): the staff Orders screen must show what the Worker's money already says about money held in review, for every state of the order:
// the review banner whenever a payment is held (not only in the review state), a Cancel preview that counts the held money, and a Resolve dialog whose words are true for an
// order that is already paid.
//
// Run: node tests/onlineOrdersHeldMoneyCopy.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]) => fs.readFileSync(path.join(here, '..', ...parts), 'utf8').split('\r\n').join('\n')
const page = read('src', 'components', 'online-orders', 'OnlineOrdersPage.tsx')
const en = JSON.parse(read('src', 'lang', 'en.json')) as Record<string, string>
const km = JSON.parse(read('src', 'lang', 'km.json')) as Record<string, string>

test('the held-payment banner shows whenever a payment is held, with its own words once the order is no longer in review', () => {
  // CATCHES: a payment held on a paid or handed-over order that no banner mentions (the staff never learn that money is waiting), and "cancel the order" offered for an order that has a sale.
  assert.ok(/\{heldPayments\.length \? \(/.test(page), 'the banner depends on held payments')
  assert.ok(!/\{order\.state === 'review' \? \(\s*<div className="rounded-xl bg-rose-50/.test(page), 'not on the review state alone')
  assert.ok(/order\.state === 'review'\s*\? tt\('oo_review_banner'/.test(page) && /: tt\('oo_review_banner_late'/.test(page))
  assert.ok(!/cancel/i.test(en.oo_review_banner_late), 'the late banner does not offer Cancel')
})

test('the Cancel preview adds the held money to what will be owed back', () => {
  // CATCHES: a preview that says $25 will be owed when the Worker will owe $37 because $12 is held (the cashier promises the wrong refund).
  assert.ok(/usd\(Math\.max\(0, paid \+ heldUsd - Number\(money\.refunded_usd \?\? 0\)\)\)/.test(page))
  assert.ok(!/Math\.max\(refundDue, paid - Number\(money\.refunded_usd/.test(page), 'the old figure that ignored held money is gone')
})

test('the Resolve dialog tells the truth for an order that is already paid: no status change, no "less than the total" note, and a sentence of its own', () => {
  // CATCHES: "Status: In review -> Paid" on an order that is already paid or handed over, and the collect-the-difference advice for money that is extra.
  assert.ok(/value: order\.state === 'review' \? `\$\{statusWord\('review'\)\} → \$\{statusWord\('paid'\)\}` : statusWord\(String\(order\.state\)\)/.test(page))
  assert.ok(/order\.state !== 'review'\s*\? tt\('oo_resolve_late'/.test(page))
  assert.ok(/paid \+ heldUsd \+ 0\.005 < Number\(order\.goods_total_usd\)/.test(page), 'the short note counts what was already paid')
})

test('the new sentences exist in English and in Khmer, with their placeholder', () => {
  for (const key of ['oo_review_banner_late', 'oo_resolve_late']) {
    assert.ok(en[key] && km[key] && /[ក-៿]/.test(km[key]) && km[key] !== en[key], key)
  }
  assert.ok(en.oo_review_banner_late.includes('{amount}') && km.oo_review_banner_late.includes('{amount}'))
})

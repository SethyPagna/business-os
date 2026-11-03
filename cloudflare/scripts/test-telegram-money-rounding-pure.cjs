'use strict'
// Telegram prints dollars at the NEAREST cent, read from the exact decimal -- the same figure the receipt and the reports print
// (owner, 24 Sep 2026). Lane MONEY-1 review fix (REVIEW-MONEY-1.md, E1), 4 Nov 2026.
//
// telegram.ts rounded with Math.round(value * 100) / 100 and (in money()) toFixed(2), which read the FLOAT: 10.075 is 1007.4999999999999 and
// printed $10.07 beside a receipt that said $10.08; 2.155 -> $2.15, 1.005 -> $1.00, a sub-cent negative -> "$-0.00". Every dollar figure now
// goes through saleTotals.displayMoney2 (exact decimal, half away from zero, never -0).
// DISCRIMINATING: the tie rows below (x.xx5) are where float rounding and the exact decimal differ; TELEGRAM_MUTATION=float_round runs the
// message formatter with the old Math.round and must go red on them. The frontend's roundDisplayMoney (what the receipt prints through) is
// bundled and compared value by value, so the two packages cannot drift.
//
// Run (from cloudflare/scripts): node test-telegram-money-rounding-pure.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const { buildSync } = require('esbuild')

function bundle(entry) {
  const out = buildSync({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2020', logLevel: 'silent', external: ['cloudflare:*', 'node:*'] })
  return out.outputFiles[0].text
}
function load(text) {
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', text)(require, loaded, loaded.exports)
  return loaded.exports
}

let telegramText = bundle(path.join(__dirname, '..', 'src', 'lib', 'telegram.ts'))
if (process.env.TELEGRAM_MUTATION === 'float_round') {
  // esbuild suffixes the name (round25): find telegram's own round2 line by its body.
  const rows = telegramText.split(String.fromCharCode(10))
  const at = rows.findIndex((row) => row.startsWith('var round2') && row.endsWith('=> displayMoney2(value);'))
  assert.ok(at >= 0, 'the mutation anchor (telegram round2 -> displayMoney2) is present in the bundle')
  rows[at] = rows[at].replace('displayMoney2(value)', 'Math.round(value * 100) / 100')
  telegramText = rows.join(String.fromCharCode(10))
}
const telegram = load(telegramText)
const saleTotals = load(bundle(path.join(__dirname, '..', 'src', 'lib', 'saleTotals.ts')))
const { roundDisplayMoney } = load(bundle(path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'pricing.ts')))

const ties = [10.075, 2.155, 1.005, 23.775, 1.115, 0.005, 4.7475, 8.345, 0.285, 1.255, 7.835]
const line = (value) => telegram.formatSaleTelegramLines({ receiptNumber: 'R1', items: [{ name: 'Tea', quantity: 1, unitPriceUsd: value, basePriceUsd: value, lineTotalUsd: value }],
  subtotalUsd: value, discountUsd: 0, taxUsd: 0, totalUsd: value, deliveryFeeUsd: 0, paymentMethod: 'Cash', amountPaidUsd: value, amountPaidKhr: 0 }).join('\n')

// 1. The review's figures.
assert.equal(telegram.telegramMoney(10.075, 0), '$10.08', '10.075 reads $10.08 (the float said $10.07)')
assert.equal(telegram.telegramMoney(23.775, 0), '$23.78')
assert.equal(telegram.telegramMoney(2.155, 0), '$2.16')
assert.equal(telegram.telegramMoney(1.005, 0), '$1.01')
assert.equal(telegram.telegramMoney(-0.004, 0), '$0.00', 'a sub-cent negative is $0.00, never "$-0.00"')
assert.equal(telegram.telegramMoney(2.161, 4000), '$2.16 · 4,000៛', 'an amount, not a price: nearest cent')

// 2. The message lines (unit price, line total, payment) print the same figure.
const message = line(10.075)
assert.match(message, /1 × \$10\.08 = \$10\.08/, message)
assert.match(message, /Completed: \$10\.08/, message)
assert.doesNotMatch(message, /\$10\.07/, 'no figure in the message disagrees with the receipt')

// 3. Every tie: Telegram, the shared helper and the frontend's displayed-money rounding are one answer.
for (const value of ties) {
  const expected = roundDisplayMoney(value)
  assert.equal(saleTotals.displayMoney2(value), expected, `displayMoney2(${value})`)
  assert.equal(telegram.telegramMoney(value, 0), `$${expected.toFixed(2)}`, `telegramMoney(${value})`)
  const figure = '$' + expected.toFixed(2)
  assert.ok(line(value).includes('1 × ' + figure + ' = ' + figure), `message line for ${value}`)
}
for (let cents = 0; cents <= 2000; cents += 1) {
  const value = cents / 100 + 0.005
  assert.equal(saleTotals.displayMoney2(value), roundDisplayMoney(value), `grid ${value}`)
}
// 4. Never -0, never NaN.
for (const bad of [-0.004, -0, null, undefined, 'abc', Number.NaN]) {
  const rounded = saleTotals.displayMoney2(bad)
  assert.ok(!Object.is(rounded, -0) && Number.isFinite(rounded), `displayMoney2(${String(bad)}) is a clean zero`)
}
console.log('PASS Telegram prints displayed money at the nearest cent from the exact decimal, equal to the frontend rounding on every tie')

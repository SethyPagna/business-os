// RET-A verifier P2 (6 Oct 2026): a riel refund always records the riel it
// hands back. lib/refundTender.ts refundRielFigure decides the riel figure a
// return is written with; the drawer (REFUND_DRAWER_KHR_SQL) takes the cash
// share of exactly that figure. Before this, a riel refund whose lines had no
// riel price recorded 0 riel and left both drawers untouched.
// The route half is driven for real by test-return-exchange-debt-native.cjs.
// Run: node scripts/test-refund-riel-figure-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const path = require('node:path')
const { buildSync } = require('esbuild')

const output = buildSync({ entryPoints: [path.join(__dirname, '../src/lib/refundTender.ts')], bundle: true, write: false,
  platform: 'node', format: 'cjs', target: 'es2022' }).outputFiles[0].text
const mod = { exports: {} }
new Function('module', 'exports', 'require', output)(mod, mod.exports, require)
const { refundRielFigure } = mod.exports
assert.equal(typeof refundRielFigure, 'function', 'refundTender exports refundRielFigure')

const base = { currency: 'KHR', refundUsd: 4, refundKhr: 16000, anyLineWithoutRiel: false, exchangeRate: 4000 }
assert.equal(refundRielFigure(base), 16000, 'a riel refund with full riel prices keeps them')
assert.equal(refundRielFigure({ ...base, refundKhr: 0, anyLineWithoutRiel: true }), 16000, 'no riel price: riel from the dollars at the rate')
assert.equal(refundRielFigure({ ...base, refundKhr: 9000, anyLineWithoutRiel: true }), 16000,
  'one line without a riel price: the whole refund is taken from the dollars, not a short riel total')
assert.equal(refundRielFigure({ ...base, refundUsd: 4.25, refundKhr: 0, anyLineWithoutRiel: true, exchangeRate: 4100 }), 17425)
assert.equal(refundRielFigure({ ...base, refundKhr: 0, anyLineWithoutRiel: true, exchangeRate: 0 }), null, 'no rate: impossible, the caller refuses')
assert.equal(refundRielFigure({ ...base, refundKhr: 0, anyLineWithoutRiel: true, exchangeRate: null }), null)
assert.equal(refundRielFigure({ ...base, currency: 'USD', refundKhr: 0, anyLineWithoutRiel: true }), 0, 'a dollar refund keeps its riel twin as recorded')
assert.equal(refundRielFigure({ ...base, refundUsd: 0, refundKhr: 0 }), 0, 'nothing refunded, nothing derived')
console.log('PASS a riel refund records real riel: kept when every line has a riel price, else derived at the rate, refused without one')

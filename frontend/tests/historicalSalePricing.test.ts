import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import * as frontend from '../src/utils/historicalSalePricing.ts'

const backendFile = process.env.HISTORICAL_SALE_PRICING_BACKEND_SOURCE || fileURLToPath(new URL('../../cloudflare/src/lib/historicalSalePricing.ts', import.meta.url))
const source = fs.readFileSync(new URL('../src/utils/historicalSalePricing.ts', import.meta.url), 'utf8')
const normalize = (text: string) => text.replace(/\r/g, '').replace("from './moneyPrecision.ts'", "from './moneyPrecision'").trim()
assert.equal(normalize(source), normalize(fs.readFileSync(backendFile, 'utf8')), 'only import suffix may differ from the pinned server pure core')
const module = { exports: {} as typeof frontend }
new Function('module', 'exports', buildSync({ entryPoints: [path.resolve(backendFile)], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text)(module, module.exports)
const row = { id: 70, product_id: 7, quantity: 2, base_price_usd: 10, base_price_khr: 40000,
  applied_price_usd: 9, applied_price_khr: 36000, manual_discount_type: 'fixed', manual_discount_value: 1,
  manual_discount_usd: 1, manual_discount_khr: 4000, product_discount_usd: .23456,
  total_usd: 18, total_khr: 72000, pricing_snapshot_json: null, cost_price_usd: null }
for (const [body, quantity] of [[{}, 2], [{}, 3], [{ selling_price_input_usd: 1.2301, manual_discount_type: null }, 3],
  [{ manual_discount_type: 'percent', manual_discount_value: 33.3333 }, 3], [{ manual_discount_type: 'fixed', manual_discount_value: 2.12345 }, 2]] as const) {
  const before = JSON.stringify(row)
  const actual = frontend.planHistoricalSaleLine(row, body, quantity, 4020)
  assert.deepEqual(actual, module.exports.planHistoricalSaleLine(row, body, quantity, 4020))
  assert.equal(JSON.stringify(row), before)
  assert.equal(actual.row.pricing_snapshot_json, null)
  assert.equal(actual.row.cost_price_usd, null)
  assert.equal(actual.row.product_discount_usd, .23456, 'recorded product promotion metadata remains verbatim, not current-catalog evaluation')
}
assert.deepEqual(frontend.planHistoricalSaleLine(row, {}, 2, 4020), { row, changed: false, quote: null })
const quantityOnly = frontend.planHistoricalSaleLine(row, {}, 3, 4020)
assert.equal(quantityOnly.row.total_usd, 27)
assert.equal(quantityOnly.row.total_khr, 108540)
assert.equal(quantityOnly.row.applied_price_khr, 36000, 'unchanged unit KHR is not silently rebased')
const staleBase = { ...row, base_price_usd: 0, applied_price_usd: 1.23454, manual_discount_usd: 0, manual_discount_type: null, manual_discount_value: null }
const staleBasePlan = frontend.planHistoricalSaleLine(staleBase, {}, 3, 4020)
assert.equal(staleBasePlan.quote!.total_usd, 3.7036)
assert.equal(staleBasePlan.quote!.gross_usd, 3.7036)
assert.equal(staleBasePlan.row.base_price_usd, 0, 'stale historical base metadata is preserved but never overrules recorded applied+manual quantity arithmetic')
for (const applied of [1.23454, 1.23456]) {
  const old = { ...row, base_price_usd: null, applied_price_usd: applied, manual_discount_type: null, manual_discount_value: null, manual_discount_usd: 0 }
  const result = frontend.planHistoricalSaleLine(old, {}, 3, 4020)
  assert.equal(result.row.applied_price_usd, applied)
  assert.equal(result.quote!.manual_discount_usd, 0)
  assert.deepEqual(result, module.exports.planHistoricalSaleLine(old, {}, 3, 4020))
}
assert.deepEqual(frontend.recordedHistoricalLineTotal(row), { amount: 18, derived: false })
assert.deepEqual(frontend.recordedHistoricalLineTotal({ ...row, total_usd: null }), { amount: 18, derived: true })
for (const body of [{ base_price_usd: 1.23004 }, { base_price_usd: -.000001 }, { manual_discount_value: -.000001 }, { manual_discount_type: 'percent', manual_discount_value: 101 }]) {
  assert.throws(() => frontend.planHistoricalSaleLine(row, body, 3, 4020))
  assert.throws(() => module.exports.planHistoricalSaleLine(row, body, 3, 4020))
}
console.log('PASS historical pricing exact twin: no-op/metadata preservation, raw fallback, recorded operands and negative refusal')

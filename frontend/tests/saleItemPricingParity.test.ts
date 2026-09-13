import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import * as frontend from '../src/utils/saleItemPricing.ts'
import { normalizePromotionRule } from '../src/utils/promotionRules.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const backendFile = process.env.SALE_ITEM_PRICING_BACKEND_SOURCE || path.resolve(here, '../../cloudflare/src/lib/saleItemPricing.ts')
const frontendFile = path.resolve(here, '../src/utils/saleItemPricing.ts')
const pureBody = (source: string) => source.split('/** Guard the exact authorized SELECT * capture')[0].replace(/from '\.\/(moneyPrecision|promotionRules)(?:\.ts)?'/g, "from './$1'").replace(/\r/g, '').trim()
assert.equal(pureBody(fs.readFileSync(frontendFile, 'utf8')), pureBody(fs.readFileSync(backendFile, 'utf8')), 'pure math/snapshot body is identical; only import suffix and backend SQL guard differ')
const module = { exports: {} as typeof frontend }
new Function('module', 'exports', buildSync({ entryPoints: [backendFile], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text)(module, module.exports)
const backend = module.exports
const rule = normalizePromotionRule({ id: 1, rule_type: 'quantity_save', min_quantity: 3, save_usd: 1, product_ids: [7], scope_type: 'products', is_active: 1 }, 1)!
const pool: frontend.CapturedPricingPool = { version: 1, pool_key: 'pool-1', evaluation_time: '2026-09-13T00:00:00.000Z', exchange_rate: 4000, rules: [rule], lines: [
  { line_key: 'a', source: 'promotion', product: { id: 7, selling_price_usd: 10, selling_price_khr: 1 }, selling_price_input_usd: null, manual: { type: 'none', value: 0 } },
] }
function compare(context: frontend.CapturedPricingPool, quantities: Record<string, number>) {
  const result = frontend.evaluateCapturedPricingPool(context, quantities)
  assert.deepEqual([...result], [...backend.evaluateCapturedPricingPool(context, quantities)])
  for (const key of result.keys()) {
    const json = frontend.serializeSaleItemPricing(context, quantities, key)
    assert.equal(json, backend.serializeSaleItemPricing(context, quantities, key), 'byte-identical saved JSON')
    assert.deepEqual(frontend.parseSaleItemPricing(json), backend.parseSaleItemPricing(json))
  }
  return result
}
assert.equal(compare(pool, { a: 3 }).get('a')!.total_usd, 29)
assert.equal(compare(pool, { a: 3 }).get('a')!.applied_price_usd, 9.6667, 'unit projection is not exact line authority')
assert.equal(compare(pool, { a: 3 }).get('a')!.total_khr, 116000, 'saved USD/FX wins over conflicting catalog KHR')
assert.equal(compare(pool, { a: 2 }).get('a')!.total_usd, 20, 'captured threshold re-evaluates at changed quantity')
for (const quantity of [0.5, 1, 2, 3, 4, 6, 10, 19.25]) {
  for (const manual of [{ type: 'none', value: 0 }, { type: 'percent', value: 12.3456 }, { type: 'fixed', value: 1 }, { type: 'fixed', value: 100 }] as const) {
    const context = structuredClone(pool); context.lines[0].manual = manual
    compare(context, { a: quantity })
  }
}
const manualPool = structuredClone(pool); manualPool.lines[0].manual = { type: 'percent', value: 12.3456 }
assert.equal(compare(manualPool, { a: 3 }).get('a')!.total_usd, 25.4198, 'manual percent uses exact29, not9.6667*3')
const paired = structuredClone(pool)
paired.rules = [normalizePromotionRule({ id: 2, rule_type: 'next_item', percent_off: 100, min_quantity: 1, product_ids: [7], scope_type: 'products', is_active: 1 }, 1)!]
paired.lines.push({ ...structuredClone(paired.lines[0]), line_key: 'b' })
const expected = compare(paired, { a: 1, b: 1 })
paired.lines.reverse()
assert.deepEqual([...compare(paired, { b: 1, a: 1 })], [...expected], 'stable keys—not incoming row order—resolve pooled ties')
assert.equal(compare(paired, { a: 1, b: 2 }).get('b')!.total_usd, 20)
const stored = frontend.serializeSaleItemPricing(pool, { a: 3 }, 'a')
pool.rules[0].save_usd = 999; pool.lines[0].product.selling_price_usd = 999
assert.equal(frontend.parseSaleItemPricing(stored)!.amounts.total_usd, 29, 'saved source/time/rules do not drift with current catalog objects')
for (const api of [frontend, backend]) {
  assert.equal(api.parseSaleItemPricing(null), null, 'legacy missing provenance stays unknown')
  const changed = JSON.parse(stored); changed.amounts.total_usd = 29.0001
  assert.throws(() => api.parseSaleItemPricing(JSON.stringify(changed)))
  assert.throws(() => api.parseSaleItemPricing('{'))
  for (const bad of [0, -1, Infinity, NaN, 10001]) assert.throws(() => api.evaluateCapturedPricingPool(JSON.parse(stored).pool, { a: bad }))
  const duplicate = JSON.parse(stored).pool; duplicate.lines.push(duplicate.lines[0])
  assert.throws(() => api.evaluateCapturedPricingPool(duplicate, { a: 3 }))
}
console.log('PASS captured pricing frontend/backend: byte parity, exact quote/JSON, manual layers, saved rules/FX, threshold/pool ordering and refusal')

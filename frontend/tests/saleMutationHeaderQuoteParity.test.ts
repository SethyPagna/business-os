import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import * as frontend from '../src/utils/saleMutationHeaderQuote.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const backendFile = process.env.SALE_HEADER_QUOTE_BACKEND_SOURCE || path.resolve(here, '../../cloudflare/src/lib/saleMutationHeaderQuote.ts')
const normalize = (value: string) => value.replace(/from '\.\/moneyPrecision(?:\.ts)?'/g, "from './moneyPrecision'").replace(/\r/g, '').trim()
assert.equal(normalize(fs.readFileSync(path.resolve(here, '../src/utils/saleMutationHeaderQuote.ts'), 'utf8')), normalize(fs.readFileSync(backendFile, 'utf8')))
const module = { exports: {} as typeof frontend }
new Function('module', 'exports', buildSync({ entryPoints: [backendFile], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text)(module, module.exports)
const backend = module.exports
const saved = { subtotal_usd: 10, discount_usd: 1, membership_discount_usd: 0, tax_usd: 0.9, exchange_rate: 4020, is_delivery: 0, delivery_fee_usd: 1.2345, delivery_fee_paid_by: 'customer' }
let count = 0
for (const subtotal of [1, 1.2345, 10, 20.0001, 1000]) {
  for (const settings of [{ tax_enabled: '1', tax_rate: '10' }, { tax_enabled: '0', tax_rate: '10' }, { tax_enabled: '1', tax_rate: '12.3456' }, { tax_enabled: '', tax_rate: '' }]) {
    for (const overrides of [{}, { is_delivery: true }, { is_delivery: true, delivery_fee_paid_by: 'store' as const }]) {
      if (subtotal === 1 && settings.tax_enabled !== '1' || subtotal === 1 && settings.tax_rate !== '10') { assert.throws(() => frontend.quoteSaleMutationHeader(saved, subtotal, settings, overrides)); assert.throws(() => backend.quoteSaleMutationHeader(saved, subtotal, settings, overrides)); continue }
      const quote = frontend.quoteSaleMutationHeader(saved, subtotal, settings, overrides)
      assert.deepEqual(quote, backend.quoteSaleMutationHeader(saved, subtotal, settings, overrides))
      assert.equal(frontend.compareSaleHeaderQuote(quote, quote), 'match')
      assert.equal(backend.compareSaleHeaderQuote(quote, quote), 'match')
      count++
    }
  }
}
const quote = frontend.quoteSaleMutationHeader(saved, 20, { tax_enabled: '1', tax_rate: '10' })
assert.equal(quote.tax_usd, 1.9)
assert.equal(quote.total_usd, 20.9)
assert.equal(quote.total_khr, 84018)
const changed = frontend.quoteSaleMutationHeader(saved, 20, { tax_enabled: '1', tax_rate: '20' })
assert.equal(changed.tax_usd, 0.9, 'a changed rate does not silently rebase saved tax')
assert.equal(changed.tax_reason, 'rate_mismatch')
assert.equal(frontend.compareSaleHeaderQuote(quote, changed), 'mismatch')
assert.equal(frontend.compareSaleHeaderQuote(undefined, quote), 'missing')
for (const malformed of [null, {}, { ...quote, total_usd: 1 }, { ...quote, subtotal_usd: '20' }, { ...quote, exchange_rate: 0 }, { ...quote, extra: 1 }, { ...quote, rounding_adjustment_usd: 0.00001 }]) {
  assert.throws(() => frontend.compareSaleHeaderQuote(malformed, quote))
  assert.throws(() => backend.compareSaleHeaderQuote(malformed, quote))
}
assert.equal(frontend.quoteSaleMutationHeader({ ...saved, tax_usd: 0 }, 1.2345, { tax_enabled: '1', tax_rate: '10' }).rounding_adjustment_usd, -0.0045)
console.log(`saleMutationHeaderQuoteParity: PASS (${count} exact frontend/backend vectors, tax guards, malformed and stale review)`)

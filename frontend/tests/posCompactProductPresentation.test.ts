import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { canViewAcquisitionCosts } from '../src/utils/acquisitionCostAccess.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const pos = read('../src/components/pos/POS.tsx')
const sheet = read('../src/components/pos/ProductDetailSheet.tsx')
const adapter = read('../src/components/shared/ProductOptionSheet.tsx')

assert.match(pos, /<ProductDetailSheet\s+posPresentation/)
assert.match(sheet, /posPresentation = false/)
assert.doesNotMatch(adapter, /posPresentation/)

// Execute the actual cost gate: even an administrator must not see costs
// in POS, while inventory/product pickers keep the existing permission gate.
const gate = sheet.match(/const canReadCost = ([^\r\n]+)/)?.[1]
assert.ok(gate)
const canReadCost = new Function('posPresentation', 'canViewAcquisitionCosts', 'user', `return ${gate}`)
for (const products of ['none', 'read', 'edit']) {
  for (const inventory of ['none', 'read', 'edit']) {
    const user = { permissions: { products, inventory } }
    assert.equal(canReadCost(true, canViewAcquisitionCosts, user), false)
    assert.equal(canReadCost(false, canViewAcquisitionCosts, user), false)
  }
}
assert.equal(canReadCost(true, canViewAcquisitionCosts, { username: 'admin' }), false)
assert.equal(canReadCost(false, canViewAcquisitionCosts, { permissions: { product_cost_view: true } }), true)
assert.equal((sheet.match(/\{canReadCost \? \(/g) || []).length, 2, 'both flat and grouped cost rows use the gate')
assert.match(sheet, /\{canReadCost && costFloatTarget \? \(/)
for (const amount of ['asNumber(product.selling_price_khr)', 'asNumber(product.wholesale_price_khr || 0)', '(promotion.applied_price_khr || 0)']) {
  assert.ok(sheet.includes(`!posPresentation && ${amount} > 0`), `POS hides ${amount}`)
}
assert.match(pos, /\[&_\.input\]:min-h-9/)
assert.match(pos, /h-9 px-2 py-1\.5 text-base md:text-sm/, 'phone search retains 16px text to avoid focus zoom')
assert.match(pos, /<ProductCard\s+posPresentation/)
const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('../src/components/pos/ProductCard.tsx', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react-dom'], write: false })
const module = { exports: {} as { default: React.ComponentType<any> } }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
const props = {
  product: { id: 7, name: 'Product', selling_price_usd: 10, selling_price_khr: 40000, stock_quantity: 8, unit: 'bottles', discount_enabled: true, discount_type: 'percent', discount_percent: 10, discount_label: 'Long promotion name '.repeat(20) },
  variants: [], groupMeta: null, getStock: () => 8,
  lowStockConfig: { enabled: true, mode: 'product', threshold: 10 }, promotionRules: [], exchangeRate: 4000,
  fmtUSD: (value: number) => `USD${value}`, fmtKHR: (value: number) => `KHR${value}`,
  t: (key: string) => key, copy: (text: string) => text, onOpen: () => {},
}
const compact = renderToStaticMarkup(React.createElement(module.exports.default, { ...props, posPresentation: true }))
assert.ok(compact.includes('USD10'))
assert.ok(!compact.includes('KHR40000'))
assert.ok(compact.includes('8 bottles'))
assert.ok(compact.includes('>Deal</span>'), 'promotion remains discoverable in one compact badge')
assert.ok(!compact.includes('absolute bottom-1'), 'POS has no duplicate promotion overlay')
assert.ok(compact.includes('max-w-[45%] shrink-0 truncate'), 'long promotion names cannot expand the badge')
const shared = renderToStaticMarkup(React.createElement(module.exports.default, props))
assert.ok(shared.includes('KHR40000'), 'non-POS callers keep their currency presentation')
console.log('PASS POS hides product costs for every permission tier and preserves shared picker behavior')

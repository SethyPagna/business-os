// Products -> Conflicts: unknown-cost and no-barcode sections (owner, 14 Oct 2026). The row card is rendered for
// real; the wiring (one fresh keyset read per kind, a tap opens the product, both language packs) is pinned in source.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

async function loadRowCard(): Promise<React.ComponentType<any>> {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/components/products/ProductDataGapsSection.tsx', import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react', 'react-dom'], logLevel: 'silent',
  })
  const module = { exports: {} as { ProductDataGapRowCard: React.ComponentType<any> } }
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  return module.exports.ProductDataGapRowCard
}
const ProductDataGapRowCard = await loadRowCard()

const read = (rel: string) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')
const en = JSON.parse(read('lang/en.json')) as Record<string, string>
const km = JSON.parse(read('lang/km.json')) as Record<string, string>
const tr = (key: string) => en[key]

let failures = 0
function runTest(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failures++; console.error(`FAIL ${name}`); console.error(String((error as Error).message)) }
}

const row = { id: 41, name: 'Lip Gloss 05', barcode: '', sku: null, brand: null, category: null, stock_quantity: 7, image_path: null }
const card = (kind: 'unknown_cost' | 'empty_barcode', over = {}) =>
  renderToStaticMarkup(React.createElement(ProductDataGapRowCard, { row: { ...row, ...over }, kind, t: tr, onOpen: () => {} }))

runTest('the row names the gap with the conflict triangle and opens the product on tap', () => {
  const unknown = card('unknown_cost')
  assert.match(unknown, /data-product-data-gap-row="41"/)
  assert.ok(unknown.includes(en.conflict_unknown_cost_catalog), 'unknown-cost label')
  assert.match(unknown, /lucide-triangle-alert|lucide-alert-triangle/)
  assert.ok(unknown.includes('Lip Gloss 05') && unknown.includes('7 pcs'))
  assert.ok(card('empty_barcode').includes(en.conflict_type_empty_barcode), 'no-barcode label')
  assert.ok(unknown.includes(`${en.product_preview_open}: Lip Gloss 05`), 'the whole row is the open-product button')
})

runTest('a whitespace barcode is not drawn as if it were one; a real barcode is shown', () => {
  assert.ok(!card('empty_barcode', { barcode: '   ' }).includes('>   <'))
  assert.ok(card('unknown_cost', { barcode: '8850000000011' }).includes('8850000000011'))
})

runTest('without an open handler the row is inert, not a dead link', () => {
  const html = renderToStaticMarkup(React.createElement(ProductDataGapRowCard, { row, kind: 'unknown_cost', t: tr }))
  assert.match(html, /disabled=""/)
})

runTest('the section reads fresh pages by kind and loads more by keyset, the tab mounts it, the transport hits the gated routes', () => {
  const section = read('components/products/ProductDataGapsSection.tsx')
  assert.match(section, /getProductDataGaps\(nextKind, after\)/)
  assert.match(section, /loadPage\(kind, nextAfter\)/)
  assert.match(section, /getProductDataGapCounts\(\)/)
  assert.match(read('components/products/ProductDuplicatesTab.tsx'), /<ProductDataGapsSection t=\{t\} notify=\{notify\} onPreviewProduct=\{onPreviewProduct\} refreshToken=\{gapsRefreshToken\} \/>/)
  const transport = read('api/productWriteTransport.ts')
  assert.match(transport, /\/api\/products\/data-gaps\?\$\{query\}/)
  assert.match(transport, /\/api\/products\/data-gaps\/counts/)
})

runTest('the section adds no second Refresh (the tab own Refresh bumps refreshToken); Load more keeps icon + one word', () => {
  const section = read('components/products/ProductDataGapsSection.tsx')
  assert.ok(!/refresh-cw/.test(section), 'no second Refresh button beside the tab title action')
  assert.match(read('components/products/ProductDuplicatesTab.tsx'), /setGapsRefreshToken\(\(token\) => token \+ 1\); void load\(\)/)
  assert.match(section, /<ChevronDown[^>]*\/>\s*\{loadMoreLabel\}/)
})

runTest('new strings exist in both packs, and Khmer is not an English placeholder', () => {
  for (const key of ['product_data_gaps_none_unknown_cost', 'product_data_gaps_none_empty_barcode', 'product_data_gaps_load_failed', 'conflict_type_unknown_cost', 'conflict_type_empty_barcode', 'conflict_unknown_cost_catalog']) {
    assert.ok(en[key], `${key} en`)
    assert.ok(km[key], `${key} km`)
    assert.notEqual(km[key], en[key], `${key} km is not English`)
    assert.match(km[key], /[\u1780-\u17FF]/, `${key} km has Khmer`)
  }
})

if (failures) process.exit(1)

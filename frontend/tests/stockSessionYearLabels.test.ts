import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const tr = (_key: string, fallback = '') => fallback
for (const name of ['StockSessionItems', 'StockSessionReviewStep']) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(`../src/components/stock-session/${name}.tsx`, import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', write: false, jsx: 'automatic', external: ['react', 'react/jsx-runtime'],
  })
  const module = { exports: {} as { default: React.ComponentType<any> } }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports)
  const labels = ['07/10/2025', '07/10/2026', 'CUSTOM-LOT']
  const lines = labels.map((batchLabel, i) => ({
    key: String(i), mode: 'set', productName: 'Fixture', product: {}, batchLabel,
    quantity: 7, freeQuantity: 0, status: 'queued', reason: '',
  }))
  const reviews = labels.map((lotLabel, i) => ({
    key: String(i), name: 'Fixture', mode: 'set', lotLabel, lotBefore: 6, lotAfter: 7,
    stockBefore: 8, stockAfter: 9, freeQuantity: 0,
  }))
  const html = renderToStaticMarkup(React.createElement(module.exports.default, {
    tr, usdSymbol: '$', canViewCosts: false, canFree: false, busy: false,
    editingKey: '', freeEditKey: '', invalidKey: '', lines, reviews, summary: [],
    onEdit() {}, onRemove() {}, onFree() {}, onFreeQuantity() {},
  }))
  for (const label of labels) assert.ok(html.includes(label), `${name} preserves ${label}, distinguishing identical day/month across years`)
}
console.log('PASS Items and Review preserve full received dates and custom lot codes')

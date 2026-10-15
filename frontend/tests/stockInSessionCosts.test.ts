import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
const source = readFileSync(new URL('../src/components/products/StockInSessionsSection.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('StockInSessionsSection.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let facts = ''
const functions: string[] = []
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && ['formatUsd', 'formatCostUsd'].includes(node.name?.text || '')) functions.push(node.getText(ast))
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'div') {
    const props = node.openingElement.attributes.getText(ast)
    if (props.includes('grid-cols-2 gap-x-3') && node.getText(ast).includes('selectedLine.cost_price_usd')) facts = node.getText(ast)
  }
  ts.forEachChild(node, visit)
}
visit(ast)
assert.ok(facts, 'execute the actual receipt detail facts JSX')
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/components/shared/CostValue.tsx', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react', 'react-dom'] })
const costModule = { exports: {} as { default: React.ComponentType<any> } }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, costModule, costModule.exports)
const compiled = ts.transpileModule(`${functions.join('\n')}\nreturn (${facts});`, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
const renderFacts = new Function('React', 'CostValue', 'selectedLine', 'canViewCosts', 'tr', 't', 'batchDisplayLabel', 'fmtDate', 'supplierDisplay', 'setCostFloatOpen', compiled)
const plain = (html: string) => html.replace(/<[^>]*>/g, '')
for (const language of ['en', 'km']) {
  const labels = JSON.parse(readFileSync(new URL(`../src/lang/${language}.json`, import.meta.url), 'utf8'))
  const t = (key: string) => labels[key] || key
  const tr = (key: string, fallback: string) => labels[key] || fallback
  const render = (overrides: Record<string, unknown>, view = true) => plain(renderToStaticMarkup(renderFacts(React, costModule.exports.default, {
    unit_cost_usd: null, batch_unit_cost_usd: 7.7777, cost_price_usd: 9.9999, purchase_price_usd: 88.8888,
    selling_price_usd: 12.34, ...overrides,
  }, view, tr, t, () => 'Date', String, () => 'Supplier', () => {})))
  const unknownReceipt = render({})
  assert.ok(unknownReceipt.includes(labels.cost_price + labels.cost_unknown), `${language}: unknown receipt cannot borrow the current batch cost`)
  assert.ok(!unknownReceipt.includes('7.7777'), 'different current batch value is not the receipt cost')
  const unknownCatalog = render({ cost_price_usd: null })
  assert.ok(unknownCatalog.includes(labels.catalog_cost_price + labels.cost_unknown), `${language}: canonical unknown cannot borrow the purchase mirror`)
  assert.ok(!unknownCatalog.includes('88.8888'))
  const known = render({ unit_cost_usd: 5.1234, cost_price_usd: 5.1244 })
  assert.ok(known.includes('5.1234') && known.includes('5.1244'), `${language}: distinct four-decimal costs survive rendering`)
  const zero = render({ unit_cost_usd: 0, cost_price_usd: 0 })
  assert.ok(zero.includes(labels.cost_price + '$0') && zero.includes(labels.catalog_cost_price + '$0'))
  assert.ok(!zero.includes(labels.cost_unknown), 'known zero is not unknown')
  const denied = render({ unit_cost_usd: 5.1234, cost_price_usd: 5.1244 }, false)
  assert.ok(!denied.includes('5.1234') && !denied.includes('5.1244') && !denied.includes(labels.cost_unknown))
  assert.ok(denied.includes('$12.34'), 'ordinary selling price remains visible')
}
console.log('PASS actual receipt detail JSX preserves unknown, zero, precision and cost permissions in both languages')

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { reviewStockLine, type StockSessionLine } from '../src/utils/stockSessionDraft.ts'

const require = createRequire(import.meta.url)
const source = readFileSync(new URL('../src/components/products/StockInSessionsSection.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('StockInSessionsSection.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let facts = ''
const functions: string[] = []
const lineCosts: string[] = []
let unitCostDeclaration = ''
let breakdownFormatter = ''
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && ['formatUsd', 'formatCostUsd'].includes(node.name?.text || '')) functions.push(node.getText(ast))
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'div') {
    const props = node.openingElement.attributes.getText(ast)
    if (props.includes('grid-cols-2 gap-x-3') && node.getText(ast).includes('selectedLine.cost_price_usd')) facts = node.getText(ast)
  }
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'unitCost') unitCostDeclaration = `const ${node.getText(ast)};`
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'CostCalculationFloat') {
    const attr = node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(ast) === 'fmtUSD')
    if (attr && ts.isJsxAttribute(attr) && attr.initializer && ts.isJsxExpression(attr.initializer)) breakdownFormatter = attr.initializer.expression?.getText(ast) || ''
  }
  if (ts.isJsxElement(node)) {
    const tag = node.openingElement.tagName.getText(ast)
    const attrs = node.openingElement.attributes.getText(ast)
    const text = node.getText(ast)
    if ((tag === 'td' && attrs.includes('text-right tabular-nums') || tag === 'span' && attrs.includes('block text-[11px] text-gray-400'))
      && (text.includes('unitCost') || text.includes('row.unit_cost_usd'))) lineCosts.push(text)
  }
  ts.forEachChild(node, visit)
}
visit(ast)
assert.ok(facts, 'execute the actual receipt detail facts JSX')
assert.equal(lineCosts.length, 2, 'desktop and mobile receipt unit-cost cells are both executed')
assert.ok(breakdownFormatter, 'actual breakdown receives a formatter')
const formatterSource = ts.transpileModule(`${functions.join('\n')}\nreturn ${breakdownFormatter};`, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
assert.equal(new Function(formatterSource)()(5.1234), '$5.1234', 'opening the breakdown preserves the precise cost shown in the receipt')
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/components/shared/CostValue.tsx', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react', 'react-dom'] })
const costModule = { exports: {} as { default: React.ComponentType<any> } }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, costModule, costModule.exports)
const reviewBundle = await build({ entryPoints: [fileURLToPath(new URL('../src/components/stock-session/StockSessionReviewStep.tsx', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react', 'react-dom'] })
const reviewModule = { exports: {} as { default: React.ComponentType<any> } }
new Function('require', 'module', 'exports', reviewBundle.outputFiles[0].text)(require, reviewModule, reviewModule.exports)
const compiled = ts.transpileModule(`${functions.join('\n')}\nreturn (${facts});`, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
const renderFacts = new Function('React', 'CostValue', 'selectedLine', 'canViewCosts', 'tr', 't', 'batchDisplayLabel', 'fmtDate', 'supplierDisplay', 'setCostFloatOpen', compiled)
const plain = (html: string) => html.replace(/<[^>]*>/g, '')
for (const language of ['en', 'km']) {
  const labels = JSON.parse(readFileSync(new URL(`../src/lang/${language}.json`, import.meta.url), 'utf8'))
  const t = (key: string) => labels[key] || key
  const tr = (key: string, fallback: string) => labels[key] || fallback
  const review = reviewStockLine({ key: 'unknown', productName: 'Fixture', mode: 'add', product: { id: 1, cost_price_usd: null, stock_quantity: 3 }, quantity: 0, freeQuantity: 2, unitCost: '', freeGoods: true, sellingPrice: '', reason: '' } as StockSessionLine, '1')
  const reviewHtml = plain(renderToStaticMarkup(React.createElement(reviewModule.exports.default, { tr, usdSymbol: '$', canViewCosts: true, summary: [], reviews: [review] })))
  assert.ok(reviewHtml.includes(labels.cost_unknown), `${language}: an unknown result remains visible in the actual confirmation step`)
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
  for (const cell of lineCosts) {
    const body = ts.transpileModule(`${functions.join('\n')}\n${unitCostDeclaration}\nreturn (${cell});`, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
    const renderCell = new Function('React', 'CostValue', 'row', 't', 'tr', body)
    const show = (row: Record<string, unknown>) => plain(renderToStaticMarkup(renderCell(React, costModule.exports.default, row, t, tr)))
    assert.ok(show({ quantity: 0, total_cost_usd: 0, unit_cost_usd: null }).includes(labels.cost_unknown), `${language}: zero quantity has zero total but may still have unknown unit cost`)
    assert.ok(show({ quantity: 0, total_cost_usd: 0, unit_cost_usd: 0 }).includes('$0'), 'zero-cost control stays known')
    assert.ok(show({ quantity: 12, total_cost_usd: 35, unit_cost_usd: 2.9167 }).includes('2.9167'), 'receipt effective unit cost retains four decimals')
  }
}
console.log('PASS actual receipt detail JSX preserves unknown, zero, precision and cost permissions in both languages')

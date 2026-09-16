import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const bundle = buildSync({
  stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import CartItem from './src/components/pos/CartItem.tsx';
    export function render(name) { return renderToStaticMarkup(<CartItem item={{id:1,name,quantity:2,applied_price_usd:12.34,applied_price_khr:49360}} branches={[]} onQtyChange={()=>{}} onPriceChange={()=>{}} onDiscountChange={()=>{}} onBranchChange={()=>{}} onToggleTierTag={()=>{}} onRemove={()=>{}} onShowDetails={()=>{}} fmtUSD={String} fmtKHR={String} usdSymbol="$" khrSymbol="KHR"/>); }`,
    loader: 'tsx', resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react', 'react-dom/server'],
}).outputFiles[0].text
const mod = { exports: {} as { render?: (name: string) => string } }
new Function('require', 'module', 'exports', bundle)(require, mod, mod.exports)
for (const name of ['Long product name '.repeat(40) + 'TAIL-END', 'ផលិតផលសម្រាប់ថែរក្សាសក់'.repeat(40) + 'TAIL-END']) {
  const html = mod.exports.render!(name)
  assert.ok(html.includes(`data-reveal-text="${name}"`), 'actual CartItem wires the full name into the shared reveal')
  assert.ok(html.includes('class="product-name-rail '), 'actual CartItem mounts the shared rail')
  assert.ok(html.includes('-webkit-line-clamp:2') && html.includes('-webkit-box-orient:vertical'), 'shared two-line clamp geometry remains active')
  assert.ok(!html.includes('height:2lh') && !html.includes('column-count'), 'no fixed-height/multicolumn box that clips or fragments the name')
  assert.ok(html.includes(`>${name}<`), 'the full name text is in the DOM, not just the reveal attribute')
  assert.ok(html.includes('value="12.34"') && html.includes('value="2"'), 'price and quantity controls remain unchanged')
}
const detail = fs.readFileSync(path.join(root, 'src/components/sales/SaleDetailModal.tsx'), 'utf8')
const nameSection = detail.slice(detail.indexOf('<div data-sale-line-name='), detail.indexOf('{item.barcode || item.branch_name'))
assert.match(nameSection, /<EntityLink[\s\S]*<ProductNameRail name=\{productName\}/)
assert.doesNotMatch(nameSection, /line-clamp|truncate|whitespace-nowrap|overflow-hidden|scrollbar-width:thin/, 'no wrapper defeats the shared rail')
assert.match(detail, /data-sale-line-edit=""[\s\S]*onClick=\{\(\) => startAmendLine\(/, 'existing Edit callback retained')
console.log('PASS actual CartItem name rail and Sale Detail name-only wiring')

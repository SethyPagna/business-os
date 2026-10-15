import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { knownCost } from '../src/utils/costDisplay.ts'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const source = fs.readFileSync(new URL('../src/components/returns/NewSupplierReturnModal.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('supplier.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ['isSupplierReturnItem', 'supplierReturnCost', 'selectSupplierReturnItems'].includes(node.name?.text || '')).map(node => node.getText(ast)).join('\n')
if (!helpers.includes('selectSupplierReturnItems')) {
  const start = source.indexOf('  const selectedItems = useMemo<SupplierReturnItem[]>(() => {') + '  const selectedItems = useMemo<SupplierReturnItem[]>(() => {'.length
  const end = source.indexOf('  }, [products, quantities])', start)
  helpers += '\nexport function selectSupplierReturnItems(products, quantities) {' + source.slice(start, end) + '\n}'
}
const mod = { exports: {} as any }
new Function('exports', 'knownCost', ts.transpileModule(helpers, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(mod.exports, knownCost)
const products = [
  { id: 1, name: 'Unknown', display_quantity: 5, cost_price_usd: null, purchase_price_usd: 9, cost_price_khr: null, purchase_price_khr: 9 },
  { id: 2, name: 'Zero', display_quantity: 5, cost_price_usd: 0, purchase_price_usd: 9, cost_price_khr: 0, purchase_price_khr: 9 },
  { id: 3, name: 'Legacy', display_quantity: 5, purchase_price_usd: 5.1234, purchase_price_khr: 5.1244 },
]
const rows = mod.exports.selectSupplierReturnItems(products, { '1': 1, '2': 1, '3': 2 })
assert.deepEqual(rows.map((row: any) => [row.cost_price_usd, row.cost_price_khr]), [[null, null], [0, 0], [5.1234, 5.1244]])
assert.equal(JSON.parse(JSON.stringify(rows))[0].cost_price_usd, null)
console.log('PASS real supplier selection/payload canonical NULL/0/legacy/4dp')
const fixture = globalThis as typeof globalThis & { __supplierContext: unknown }
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/components/returns/ReturnDetailModal.tsx', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react', 'react-dom'],
  plugins: [{ name: 'supplier-detail-fixture', setup(builder) {
    builder.onResolve({ filter: /(?:AppContext|AppContextCore)(?:\.tsx)?$/ }, () => ({ path: 'context', namespace: 'fixture' }))
    builder.onResolve({ filter: /\/Modal\.tsx$/ }, () => ({ path: 'modal', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'context'
      ? 'export const useApp=()=>globalThis.__supplierContext;'
      : "import React from 'react'; export default p=>React.createElement('section',null,p.children);" }))
  } }],
})
const detail = { exports: {} as { default: React.ComponentType<any> } }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), detail, detail.exports)
for (const language of ['en', 'km']) {
  const labels = JSON.parse(fs.readFileSync(new URL(`../src/lang/${language}.json`, import.meta.url), 'utf8'))
  for (const value of [null, 0, -1.1234, 5.1244]) {
    fixture.__supplierContext = { user: { permissions: { product_cost_view: true } }, t: (key: string) => labels[key] || key }
    const props = { ret: { id: 900, return_scope: 'supplier', supplier_compensation_usd: value, supplier_compensation_khr: value, supplier_loss_usd: value, supplier_loss_khr: value, items: [{ product_name: 'Synthetic', quantity: 1, total_usd: value, total_khr: value }] }, onClose() {}, fmtUSD: (n: unknown) => `$${Number(n).toFixed(2)}`, fmtKHR: (n: unknown) => `${Math.round(Number(n))}៛` }
    const html = renderToStaticMarkup(React.createElement(detail.exports.default, props))
    assert.ok(html.includes(value === null ? labels.unknown : value === 0 ? '$0' : String(value)), `${language}: supplier detail preserves ${value}`)
    fixture.__supplierContext = { user: { permissions: { returns: true } }, t: (key: string) => labels[key] || key }
    const denied = renderToStaticMarkup(React.createElement(detail.exports.default, props))
    assert.ok(!denied.includes(labels.supplier_compensation) && !denied.includes('5.1244'), `${language}: detail costs absent when denied`)
  }
}
console.log('PASS actual supplier detail NULL/zero/signed4dp/permission EN/KM; modal shell substituted')

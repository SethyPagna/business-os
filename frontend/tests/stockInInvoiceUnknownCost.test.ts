import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const fixture = globalThis as typeof globalThis & { __invoiceContext: unknown; __invoiceReport: unknown }
const result = await build({
  entryPoints: [fileURLToPath(new URL('../src/components/contacts/StockInInvoicesSection.tsx', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react', 'react-dom'],
  plugins: [{ name: 'invoice-fixture', setup(builder) {
    builder.onResolve({ filter: /AppContext(?:\.tsx)?$/ }, () => ({ path: 'context', namespace: 'fixture' }))
    builder.onResolve({ filter: /useStockInInvoiceReport\.ts$/ }, () => ({ path: 'report', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'context'
      ? 'export const useApp = () => globalThis.__invoiceContext;'
      : 'export const LINE_PAGE_SIZE=100; export const groupKeyOf=g=>g.supplier_key; export const useStockInInvoiceReport=()=>globalThis.__invoiceReport;' }))
  } }],
})
const module = { exports: {} as { default: React.ComponentType<{ t: (key: string) => string }> } }
new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
const Component = module.exports.default
for (const language of ['en', 'km']) {
  const labels = JSON.parse(readFileSync(new URL(`../src/lang/${language}.json`, import.meta.url), 'utf8'))
  const t = (key: string) => labels[key] || key
  for (const [cost, unknown, lines, expected] of [[0, 2, 2, 'unknown'], [5.1234, 1, 2, 'partial'], [0, 0, 1, 'zero']] as const) {
    const group = { supplier_key: 'test', supplier_name: 'Synthetic', received_day: '2026-10-15', line_count: lines, cost_usd: cost, lines_without_cost: unknown, units_received: 2, credit_lines: 0 }
    fixture.__invoiceContext = { user: { permissions: { product_cost_view: true } } }
    fixture.__invoiceReport = { data: { invoices: [group], totals: { lines, cost_usd: cost, lines_without_cost: unknown }, total_invoices: 1 }, loading: false, error: '', lineCache: {}, detailGroup: group, closeGroup() {}, openGroup() {}, loadLines() {} }
    const html = renderToStaticMarkup(React.createElement(Component, { t }))
    if (expected === 'unknown') {
      assert.ok(html.split(labels.cost_unknown).length - 1 >= 4, `${language}: all-unknown total, desktop, mobile and detail disclose unknown`)
      assert.ok(!html.includes('$0.00'), `${language}: all-unknown is never numeric zero`)
    } else if (expected === 'partial') {
      assert.ok(html.includes('5.1234'), `${language}: known acquisition precision retained`)
      assert.ok(html.split(labels.cost_partial_count.replace('{count}', '1')).length - 1 >= 4, `${language}: total, desktop, mobile and detail disclose local unknown count`)
    } else assert.ok(html.includes('$0'), `${language}: real zero remains numeric`)
    fixture.__invoiceContext = { user: { permissions: { contacts_suppliers: true } } }
    const hidden = renderToStaticMarkup(React.createElement(Component, { t }))
    assert.ok(!hidden.includes('5.1234') && !hidden.includes(labels.cost_unknown), `${language}: denied costs remain absent`)
  }
}
console.log('PASS actual invoice group/detail unknown, partial, zero and permission surfaces EN/KM')

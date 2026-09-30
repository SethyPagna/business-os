// SCAN2 BP-2: once Shop is retired, the stock-in report still lists it (the
// Worker keeps every retired branch a lot was received into), and the screen
// must say it is retired wherever the branch is named: invoice rows, the
// invoice detail and the branch filter. An older payload without is_active
// means active.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const noop = () => {}
const Pass = ({ children }: any) => React.createElement('div', null, children)
const Select = ({ options }: any) => React.createElement('select', null, options.map((option: any) =>
  React.createElement('option', { key: option.value, value: option.value }, option.label)))
const Detail = ({ sections }: any) => React.createElement('div', null, sections.map((section: any) =>
  React.createElement('section', { key: section.key }, section.facts?.map((fact: any) =>
    React.createElement('span', { key: fact.key, 'data-fact': fact.key }, fact.value)))))

const KHMER_INACTIVE = 'អសកម្ម'
const t = (key: string) => (key === 'inactive' ? KHMER_INACTIVE : undefined)
const shopGroup = { supplier_key: 's7', supplier_name: 'Srey Now', received_day: '2026-08-20', line_count: 1, units_received: 10, cost_usd: 25, lines_without_cost: 0, credit_lines: 0, branch_ids: '2' }
const mixedGroup = { ...shopGroup, received_day: '2026-09-20', branch_ids: '1,4' }
const report = {
  invoices: [shopGroup, mixedGroup],
  total_invoices: 2,
  totals: {},
  meta: { branches: [{ id: 1, name: 'Store', is_active: 1 }, { id: 2, name: 'Shop', is_active: 0 }, { id: 4, name: 'Pop-up' }] },
}

function renderSection(): string {
  const source = readFileSync(new URL('../src/components/contacts/StockInInvoicesSection.tsx', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} as any }
  const mockedRequire = (id: string): any => {
    if (id === 'react') return { ...React, useState: (initial: any) => [typeof initial === 'function' ? initial() : initial, noop] }
    if (id === 'react/jsx-runtime') return require(id)
    if (id.includes('AppContext')) return { useApp: () => ({ user: { id: 1, role: 'admin', permissions: { all: true } } }) }
    if (id.includes('acquisitionCostAccess')) return { canViewAcquisitionCosts: () => false }
    if (id.includes('useStockInInvoiceReport')) return {
      useStockInInvoiceReport: () => ({ data: report, loading: false, error: '', lineCache: {}, detailGroup: shopGroup, closeGroup: noop, openGroup: noop, loadLines: noop }),
      groupKeyOf: (group: any) => `${group.supplier_key}|${group.received_day}`,
      LINE_PAGE_SIZE: 100,
    }
    if (id.includes('AppSelect')) return { default: Select }
    if (id.includes('InvoiceDetailFloat')) return { default: Detail }
    if (id.includes('formatters')) return { fmtDateOnly: (value: string) => value }
    if (id.includes('dateHelpers')) return { todayStr: () => '2026-09-30' }
    if (id.includes('batchLabel')) return { batchDisplayLabel: () => 'Received date' }
    if (id.includes('PaginationControls')) return { default: Pass, DEFAULT_PAGE_SIZE: 25 }
    return { default: Pass }
  }
  new Function('require', 'module', 'exports', compiled)(mockedRequire, module, module.exports)
  return renderToStaticMarkup(React.createElement(module.exports.default, { t }))
}

const markup = renderSection()
const retiredShop = `Shop (${KHMER_INACTIVE})`

assert.match(markup, new RegExp(`<option value="2">${retiredShop.replace(/[()]/g, '\\$&')}</option>`), 'the branch filter offers the retired branch, marked in the viewer language')
assert.match(markup, /<option value="1">Store<\/option>/, 'an active branch option is not marked')
assert.match(markup, /<option value="4">Pop-up<\/option>/, 'a branch without is_active (older payload) reads as active')
console.log('PASS branch filter marks only the retired branch')

const rowAndCardAndDetail = markup.split(retiredShop).length - 1
assert.equal(rowAndCardAndDetail, 4, 'the invoice table row, phone card and detail float all name the retired branch as retired (plus the filter option)')
assert.match(markup, /<span data-fact="branches">Shop \(អសកម្ម\)<\/span>/, 'the invoice detail names the retired branch as retired')
assert.ok(markup.includes('Store, Pop-up'), 'a group received into active branches is named without any marker')
assert.ok(!markup.includes('#2'), 'the retired branch is never shown as a bare id')
console.log('PASS invoice rows and detail name the retired branch as retired')

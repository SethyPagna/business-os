import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { canViewAcquisitionCosts } from '../src/utils/acquisitionCostAccess.ts'

const require = createRequire(import.meta.url)
let user: any = { id: 4, role: 'staff', permissions: { contacts_suppliers: true, product_cost_view: true } }
const noop = () => {}
const Pass = ({ children }: any) => React.createElement('div', null, children)
const Detail = ({ sections }: any) => React.createElement('div', null, sections.map((section: any) =>
  React.createElement('section', { key: section.key }, section.facts?.map((fact: any) =>
    React.createElement('span', { key: fact.key }, fact.label, fact.value)), section.content)))

// Execute the real component with loaded state held constant across permission
// changes. Effects/transports are inert, so a passing revocation cannot depend
// on another server response erasing the already-loaded prices.
function load(name: string, state: Record<string, unknown> = {}): any {
  let source = readFileSync(new URL(`../src/components/contacts/${name}.tsx`, import.meta.url), 'utf8')
  const ast = ts.createSourceFile(`${name}.tsx`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const replacements: Array<{ start: number; end: number; text: string }> = []
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
      const key = node.name.elements[0].getText(ast)
      if (Object.hasOwn(state, key)) {
        const argument = node.initializer.arguments[0]
        replacements.push({ start: argument.getStart(ast), end: argument.end, text: `testState[${JSON.stringify(key)}]` })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  for (const edit of replacements.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end)
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} as any }
  const mockedRequire = (id: string): any => {
    if (id === 'react') return { ...React, useState: (initial: any) => [typeof initial === 'function' ? initial() : initial, noop], useEffect: noop, useMemo: (fn: any) => fn(), useCallback: (fn: any) => fn, useRef: (current: any) => ({ current }) }
    if (id === 'react/jsx-runtime') return require(id)
    if (id.includes('AppContext')) return { useApp: () => ({ user }) }
    if (id.includes('acquisitionCostAccess')) return { canViewAcquisitionCosts }
    if (id.includes('useStockInInvoiceReport')) {
      // Execute the real scoped hook, supplying already-loaded state just as
      // the other ledgers' useState initializers are supplied above. Keep
      // prices present even after permission revocation: rendering must omit
      // them without relying on a fresh server response.
      const hookSource = readFileSync(new URL('../src/components/contacts/useStockInInvoiceReport.ts', import.meta.url), 'utf8')
        .replace('({ scope, view: emptyView() })', '({ scope, view: { ...emptyView(), ...testState } })')
      const hook = { exports: {} as any }
      const code = ts.transpileModule(hookSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
      new Function('require', 'exports', 'testState', code)(mockedRequire, hook.exports, state)
      return hook.exports
    }
    if (id.includes('actorReadScope')) return { captureActorReadScope: () => ({ authority: 'test', revision: '0' }), isActorReadScopeCurrent: () => true }
    if (id.includes('InvoiceLedgerSummary')) return { default: load('InvoiceLedgerSummary') }
    if (id.includes('InvoiceDetailFloat')) return { default: Detail }
    if (id.includes('formatters')) return { fmtDateOnly: (value: string) => value, fmtDate: (value: string) => value }
    if (id.includes('dateHelpers')) return { todayStr: () => '2026-09-20' }
    if (id.includes('batchLabel')) return { batchDisplayLabel: () => 'Received date' }
    if (id.includes('supplierDisplay')) return { supplierDisplay: (name: string) => name }
    if (id.includes('PaginationControls')) return { default: Pass, DEFAULT_PAGE_SIZE: 25, clampPage: (page: number) => page }
    return { default: Pass }
  }
  new Function('require', 'module', 'exports', 'testState', compiled)(mockedRequire, module, module.exports, state)
  return module.exports.default
}

const batch = { id: 1, product_name: 'Retained product', received_quantity: 3, unit_cost_usd: 123.45, line_total_usd: 370.35, payment_status: 'paid' }
const group = { supplier_key: 's1', supplier_name: 'Supplier', received_day: '2026-09-20', line_count: 1, units_received: 3, cost_usd: 987.65, lines_without_cost: 0, credit_lines: 0 }
const invoice = { id: 1, legacy_id: 1, supplier_name: 'Retained product', invoice_date: '2026-09-20', source_branch: 'shop', taxable_amount_usd: 123.45, vat_amount_usd: 543.21, total_amount_usd: 987.65, amount_paid_usd: 370.35, outstanding_balance_usd: 617.30, status: 'Outstanding' }
for (const [name, state] of [
  ['SupplierPurchasesModal', { data: { batches: [batch], total: 1, totals: { cost_usd: 987.65, credit_open_usd: 543.21 } }, loading: false, detailBatch: batch }],
  ['StockInInvoicesSection', { data: { invoices: [group], total_invoices: 1, totals: { cost_usd: 987.65 } }, loading: false, detailGroup: group, lineCache: { 's1|2026-09-20': { lines: [batch], page: 1, pageSize: 100, total: 1, loading: false, error: '' } } }],
  ['ApInvoicesSection', { data: { invoices: [invoice], total_invoices: 1, totals: { total_usd: 987.65, paid_usd: 370.35, outstanding_usd: 617.30 } }, loading: false, detail: invoice }],
] as const) {
  const Component = load(name, state)
  const render = () => renderToStaticMarkup(React.createElement(Component, { t: () => undefined, supplierId: 1, supplierName: 'Supplier', onClose: noop, fetchPurchases: noop }))
  user = { ...user, permissions: { contacts_suppliers: true, product_cost_view: true } }
  const granted = render()
  assert.ok(granted.includes('987.65') && granted.includes('123.45'), `${name} renders granted loaded cost values`)
  user = { ...user, permissions: { contacts_suppliers: true, product_cost_view: false, product_cost_edit: true } }
  const revoked = render()
  for (const amount of ['987.65', '123.45', '370.35', '543.21', '617.30', '$0.00']) assert.ok(!revoked.includes(amount), `${name} immediately omits ${amount} after view is revoked, including edit-only users`)
  assert.ok(revoked.includes('Retained product'), `${name} retains nonfinancial receipt content`)
}
console.log('PASS loaded supplier costs disappear on same-user view revocation without refetch, including edit-only grants')

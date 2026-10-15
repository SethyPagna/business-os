import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as costDisplay from '../src/utils/costDisplay.ts'
import { continuousRangeParams } from '../src/utils/continuousRangeParams.ts'

const source = fs.readFileSync(new URL('../src/components/inventory/Inventory.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('Inventory.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const matches = (predicate: (node: ts.Node) => boolean): ts.Node[] => {
  const found: ts.Node[] = []
  const visit = (node: ts.Node) => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit) }
  visit(ast)
  return found
}
const variable = (name: string) => {
  const node = matches(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name)[0] as ts.VariableDeclaration
  assert.ok(node?.initializer, name)
  return node.initializer.getText(ast)
}
const evaluate = (text: string, scope: Record<string, unknown>) => {
  const code = ts.transpileModule(`return (${text})`, { fileName: 'fixture.tsx', compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(scope), code)(...Object.values(scope))
}
const supplierDetails = matches(node => ts.isSpreadElement(node) && node.expression.getText(ast).includes('canViewCosts ?') && node.expression.getText(ast).includes("t('supplier_returns')"))[0] as ts.SpreadElement
assert.ok(supplierDetails)
for (const language of ['en', 'km']) {
  const labels = JSON.parse(fs.readFileSync(new URL(`../src/lang/${language}.json`, import.meta.url), 'utf8'))
  const t = (key: string) => labels[key] || key
  for (const total of [
    { count: 2, loss_usd: null, loss_khr: null, loss_usd_unknown_count: 2, loss_khr_unknown_count: 2 },
    { count: 3, loss_usd: -1.1234, loss_khr: 5.1244, loss_usd_unknown_count: 1, loss_khr_unknown_count: 2 },
    { count: 1, loss_usd: 0, loss_khr: 0, loss_usd_unknown_count: 0, loss_khr_unknown_count: 0 },
  ]) {
    const scope = { ...costDisplay, React, t, suppReturnTotals: total, canViewCosts: true, stripSupplierReturnCount: total.count, fmtUSD: (value: number) => `$${value.toFixed(2)}` }
    const stripSupplierLoss = evaluate(variable('stripSupplierLoss'), scope)
    const details = evaluate(supplierDetails.expression.getText(ast), { ...scope, stripSupplierLoss })
    const text = renderToStaticMarkup(React.createElement(React.Fragment, null, details[0].value))
    if (total.loss_usd === null) {
      assert.ok(text.includes(t('unknown')) && !text.includes('$0'), `${language}: all-unknown supplier costs stay unknown`)
    } else if (total.loss_usd === 0) {
      assert.ok(text.includes('$0') && text.includes('0៛') && !text.includes(t('unknown')), `${language}: true zero remains zero in both currencies`)
    } else {
      assert.ok(text.includes('-1.1234') && text.includes('5.1244'), `${language}: signed4dp in both currencies`)
      assert.ok(text.includes(costDisplay.partialCostNote(1, t)!) && text.includes(costDisplay.partialCostNote(2, t)!), `${language}: partial counts remain currency-specific`)
    }
    assert.equal(evaluate(supplierDetails.expression.getText(ast), { ...scope, stripSupplierLoss, canViewCosts: false }).length, 0)
  }
}

const callback = variable('runRangedStatsExport')
assert.equal(callback.split("await import('../../utils/csv.ts')").length, 2)
const exportCallback = callback.replace("await import('../../utils/csv.ts')", '{ downloadCSV: csvSink }')
const range = { startDate: '2026-09-01', endDate: '2026-09-03', startTime: '10:00', endTime: '11:30' }
for (const [usd, khr, unknown, known] of [[null, null, 2, 0], [-1.1234, 5.1244, 1, 2], [0, 0, 0, 1]] as const) {
  for (const allowed of [true, false]) {
    let rows: Array<{ metric: string; value: unknown }> = []
    const run = evaluate(exportCallback, {
      useCallback: (fn: unknown) => fn, continuousRangeParams, canViewCosts: allowed,
      getSalesStatsStrip: async () => ({ totals: { revenue_usd: 10 } }),
      getReturnsReport: async (params: Record<string, unknown>) => {
        assert.deepEqual(params, { ...continuousRangeParams(range), startDate: range.startDate, endDate: range.endDate, scope: params.scope })
        return { totals: params.scope === 'supplier' ? { count: known + unknown, loss_usd: usd, loss_khr: khr, loss_usd_unknown_count: unknown, loss_khr_unknown_count: unknown, loss_usd_known_count: known, loss_khr_known_count: known } : { count: 1, refund_usd: 5.12 } }
      },
      csvSink: (_name: string, value: typeof rows) => { rows = value },
      totalProducts: 10, inStockCount: 8, lowStockCount: 2, outStockCount: 2, totalValue: 100, stripRange: range,
    })
    await run(range)
    const metric = (name: string) => rows.find(row => row.metric === name)?.value
    if (allowed) {
      assert.equal(metric('supplier_loss_usd'), usd ?? '')
      assert.equal(metric('supplier_loss_khr'), khr ?? '')
      for (const currency of ['usd', 'khr']) {
        assert.equal(metric(`supplier_loss_${currency}_unknown_count`), unknown)
        assert.equal(metric(`supplier_loss_${currency}_known_count`), known)
      }
    } else assert.ok(!rows.some(row => row.metric.startsWith('supplier_loss_')), 'Cost-denied exports omit amounts and completeness metadata')
    assert.equal(metric('customer_refund_usd'), 5.12)
  }
}
console.log('PASS actual Inventory supplier detail and export: NULL/zero/signed4dp, per-currency completeness, cost permission and ranged customer control')

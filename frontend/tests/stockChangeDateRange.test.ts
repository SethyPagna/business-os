import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/components/products/StockChangeSection.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('StockChangeSection.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const calls: ts.CallExpression[] = []
function visit(node: ts.Node): void {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'getStockLedger') calls.push(node)
  ts.forEachChild(node, visit)
}
visit(ast)
assert.equal(calls.length, 2, 'interactive ledger and paged export both use the same server filter')

// Execute the actual query argument expressions: a time edited on either edge
// must reach the backend in both reads, with the same default shown by the UI.
for (const [startTime, endTime, expectedStart, expectedEnd] of [
  ['', '', undefined, undefined],
  ['09:30', '', '09:30', '23:59'],
  ['', '18:00', '00:00', '18:00'],
  ['22:00', '02:00', '22:00', '02:00'],
]) {
  const range = { startDate: '2026-09-18', endDate: '2026-09-19', startTime, endTime }
  for (const call of calls) {
    const context = { ...range, range, view: 'all', page: 2, exportPage: 2, pageSize: 1000, PAGE_SIZE: 25, search: '', debouncedSearch: '', branchId: 0, supplierId: 0 }
    const params = new Function(...Object.keys(context), `return (${call.arguments[0].getText(ast)})`)(...Object.values(context))
    assert.equal(params.startTime, expectedStart)
    assert.equal(params.endTime, expectedEnd)
    assert.equal(params.startDate, range.startDate)
    assert.equal(params.endDate, range.endDate)
  }
}
console.log('PASS stock ledger and export preserve full-day, single-edge, and overnight time windows')

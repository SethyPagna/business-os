import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/components/sales/ExportModal.tsx', import.meta.url), 'utf8')
assert.match(source, /import DateTimeRangePicker/)
assert.match(source, /<DateTimeRangePicker[\s\S]*?showTime[\s\S]*?continuous=\{false\}/)
assert.doesNotMatch(source, /<DateEntryInput/)
const module = ts.createSourceFile('ExportModal.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const calls: string[] = []
function visit(node: ts.Node): void {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'getSalesExport') calls.push(node.arguments[0].getText(module))
  ts.forEachChild(node, visit)
}
visit(module)
assert.equal(calls.length,3)
for (const expression of calls) {
  const query = new Function('dates','page','cursor', 'return (' + expression + ')')({ start:'2026-09-08',end:'2026-09-09',startTime:'22:00',endTime:'02:00' },{snapshot_max_id:91},{created_at:'2026-09-08 00:00:00',id:5})
  assert.deepEqual([query.startDate,query.endDate,query.startTime,query.endTime],['2026-09-08','2026-09-09','22:00','02:00'])
}
console.log('PASS shared Sales export picker and frozen hours on preview and every CSV page')

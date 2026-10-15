import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { knownCost } from '../src/utils/costDisplay.ts'
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

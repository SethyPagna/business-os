import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const source = fs.readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8')
const start = source.indexOf('const applyCatalogProducts =')
const end = source.indexOf('const applyCategoryOptions =', start)
assert(start >= 0 && end > start)
const compiled = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
let shown: unknown
const apply = new Function('setProducts', 'useCallback', `${compiled}; return applyCatalogProducts`)(
  (rows: unknown) => { shown = rows }, (callback: unknown) => callback,
)
const rows = [
  { id: 1, is_active: 1, stock_quantity: 2 },
  { id: 2, is_active: 0, stock_quantity: 3 },
  { id: 3, is_active: false, stock_quantity: 0, branch_stock: [{ quantity: 4 }] },
  { id: 4, name: 'Restricted fields' },
]
apply([...rows, null])
assert.deepEqual(shown, rows, 'POS retains every server-admitted stocked row, including inactive and restricted-field rows')
apply(null)
assert.deepEqual(shown, [])
console.log('PASS POS does not silently hide stock returned by the server')

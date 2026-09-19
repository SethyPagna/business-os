import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const read = (path: string) => readFileSync(new URL(`../src/components/${path}`, import.meta.url), 'utf8')
const source = read('inventory/FastStockInModal.tsx')
const ast = ts.createSourceFile('FastStockInModal.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let builder = ''
function visit(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'buildLineRequest') builder = node.initializer!.getText(ast)
  ts.forEachChild(node, visit)
}
visit(ast)
assert.ok(builder)
const expression = ts.transpileModule(`const build = ${builder};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
for (const canEditCosts of [false, true]) {
  const context = {
    canEditCosts, branchId: '1', receivedDate: '2026-09-20',
    supplier: { supplierId: 3, supplierName: 'Supplier' }, paymentStatus: 'paid', creditDueDate: '',
    sessionIdRef: { current: 'session' }, stockLineReason: () => 'Correction', tr: (_key: string, fallback: string) => fallback,
  }
  const build = new Function(...Object.keys(context), `${expression}; return build`)(...Object.values(context))
  const line = { key: '1', product: { id: 7 }, quantity: 0, unitCost: '88', expiryDate: '', batchChoice: 4, freeGoods: false }
  const removal = build({ ...line, mode: 'remove' })
  assert.equal(removal.body.type, 'remove')
  assert.equal(Object.hasOwn(removal.body, 'unitCostUsd'), false, 'removal never writes acquisition cost')
  const correction = build({ ...line, mode: 'set' })
  assert.equal(correction.body.type, 'set')
  assert.equal(correction.body.quantity, 0, 'zero set remains a valid stock correction')
  assert.equal(Object.hasOwn(correction.body, 'unitCostUsd'), canEditCosts, 'no-edit corrections omit cost even if a stale draft contains one')
  if (canEditCosts) assert.equal(correction.body.unitCostUsd, 88)
}

// Cost redaction must remove the UI element, not render a numeric fallback.
for (const path of ['products/StockChangeSection.tsx', 'products/StockInSessionsSection.tsx', 'inventory/InventoryStockModals.tsx']) {
  const text = read(path)
  assert.match(text, /canViewAcquisitionCosts\(/)
  assert.match(text, /canViewCosts \?/)
}
for (const path of ['products/forms/StockAdjustModal.tsx', 'inventory/Inventory.tsx']) {
  assert.match(read(path), /if \(isStockIn && !canEditCosts\)/, `${path} refuses receipts requiring unauthorized cost input`)
}
console.log('PASS stock corrections omit unauthorized cost keys while permitted receipt inputs and cost-view guards remain separate')

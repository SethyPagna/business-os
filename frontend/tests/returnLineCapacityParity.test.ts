import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { subtractDecimalSum } from '../src/utils/moneyPrecision.ts'

// The Returns screen's "already returned / still returnable" per sale line
// must count what the Worker's capacity check counts (N1, findings C and the
// float sum):
//   - the units a sales import recorded as already returned
//     (GET /api/sales imported_returned_quantity, RET-B F4) -- otherwise an
//     imported 3-unit line with 2 returned offered 3 and the server refused;
//   - exact decimals on legacy (v0) sales too -- otherwise 0.3 - 0.2 offered
//     0.09999999999999998 and the last 0.1 could not be selected.
// Executes the shipping functions from NewReturnModal.tsx (not a copy).

const MODAL = '../src/components/returns/NewReturnModal.tsx'
function extract(name: string, bindings: Record<string, unknown>): (...args: any[]) => any {
  const source = fs.readFileSync(new URL(MODAL, import.meta.url), 'utf8')
  const ast = ts.createSourceFile(MODAL, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression = ''
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) expression = node.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(expression, `${name} exists in NewReturnModal.tsx`)
  const js = ts.transpileModule(`const handler = ${expression}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  return new Function(...Object.keys(bindings), js + ';return handler')(...Object.values(bindings))
}

const toNumber = extract('toNumber', {})
const exactReturnQuantity = extract('exactReturnQuantity', { subtractDecimalSum })
const legacyReturnQuantity = extract('legacyReturnQuantity', { subtractDecimalSum })
const lineReturnQuantities = extract('lineReturnQuantities', { exactReturnQuantity, legacyReturnQuantity, toNumber })

// Imported line: 3 sold, 2 returned with the import, nothing recorded since.
assert.deepEqual(lineReturnQuantities({ quantity: 3, imported_returned_quantity: 2 }, 0, false), { alreadyQty: 2, remaining: 1 },
  'imported units count as already returned')
// ... then the last unit recorded through the app: nothing left.
assert.deepEqual(lineReturnQuantities({ quantity: 3, imported_returned_quantity: '2' }, 1, false), { alreadyQty: 3, remaining: 0 })
// Control: the same line without imported units offers all 3.
assert.deepEqual(lineReturnQuantities({ quantity: 3 }, 0, false), { alreadyQty: 0, remaining: 3 })
assert.deepEqual(lineReturnQuantities({ quantity: 3, imported_returned_quantity: null }, 0, false), { alreadyQty: 0, remaining: 3 })
// Legacy decimals are exact: 0.3 sold, 0.2 recorded leaves exactly 0.1.
assert.deepEqual(lineReturnQuantities({ quantity: 0.3 }, 0.2, false), { alreadyQty: 0.2, remaining: 0.1 })
assert.equal(legacyReturnQuantity(0.2, [-0.1]), 0.3, 'the recorded history sums exactly')
// Never negative when the history already exceeds the line.
assert.deepEqual(lineReturnQuantities({ quantity: 1 }, 2, false), { alreadyQty: 2, remaining: 0 })
// v1 lines keep their exact path (and never carry imported units).
assert.deepEqual(lineReturnQuantities({ quantity: 0.3 }, 0.1, true), { alreadyQty: 0.1, remaining: 0.2 })
assert.throws(() => lineReturnQuantities({ quantity: 0.3 }, 1e-20, true), /return_v1_review_required/,
  'v1 still refuses an unrepresentable quantity instead of losing it')

// The field this screen reads is the one the Worker's Sales list emits.
const salesRoute = fs.readFileSync(new URL('../../cloudflare/src/routes/sales.ts', import.meta.url), 'utf8')
assert.match(salesRoute, /AS imported_returned_quantity,/, 'GET /api/sales sends imported_returned_quantity')

console.log('PASS return line capacity parity: imported returned units and exact legacy decimals match the Worker capacity check')

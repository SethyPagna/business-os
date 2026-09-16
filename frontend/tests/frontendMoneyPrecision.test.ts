import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { editableMoneyValue, normalizeInternalMoney, normalizeSellingPrice } from '../src/utils/pricing.ts'
import { multiplyMoney4, sumMoney4 } from '../src/utils/moneyPrecision.ts'

for (const value of [0, 0.0001, 1.2345, 10.075, -1.2345]) {
  assert.equal(normalizeInternalMoney(Number(editableMoneyValue(value))), value, 'editable cost roundtrip preserves four decimals')
}
assert.equal(normalizeInternalMoney('1.23455'), 1.2346)
assert.equal(normalizeInternalMoney('-1.23455'), -1.2346)
assert.equal(normalizeSellingPrice('1.2345'), 1.24, 'selling input keeps explicit upward-cent policy')
assert.equal(normalizeSellingPrice('1.23'), 1.23)
assert.equal(normalizeInternalMoney('1.2345'), 1.2345, 'cost is not a selling price')
assert.equal(multiplyMoney4('1.2345', 100), 123.45)
assert.equal(sumMoney4(Array(100).fill('1.2345')), 123.45)
assert.notEqual(normalizeInternalMoney('1.2301'), normalizeInternalMoney('1.2349'), 'subcent stock cost change is real')

// Execute the actual submitted property expressions, not a copied payload.
for (const filename of ['ProductForm.tsx', 'VariantFormModal.tsx']) {
  const source = ts.createSourceFile(filename, fs.readFileSync(new URL(`../src/components/products/forms/${filename}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const expressions: Array<[string, string]> = []
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && ['cost_price_usd', 'cost_price_khr'].includes(node.name.getText(source))
      && node.initializer.getText(source).includes('parseNumericInput(form.')) {
      expressions.push([node.name.getText(source), node.initializer.getText(source)])
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(expressions.length >= 2)
  for (const [field, expression] of expressions) {
    const submit = new Function('form', 'parseNumericInput', 'normalizeInternalMoney', `return ${expression}`)
    for (const value of [0, 0.0001, 1.2345]) {
      assert.equal(submit({ [field]: editableMoneyValue(value) }, Number, normalizeInternalMoney), value, `${filename} ${field} no-op save`)
    }
  }
}
console.log('frontendMoneyPrecision: PASS')

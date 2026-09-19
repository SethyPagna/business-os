import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { editableMoneyValue, normalizeInternalMoney, normalizeSellingPrice } from '../src/utils/pricing.ts'
import { multiplyMoney4, sumMoney4 } from '../src/utils/moneyPrecision.ts'
import { omitUnauthorizedCatalogCosts } from '../src/utils/acquisitionCostAccess.ts'

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
      && node.initializer.getText(source).startsWith('normalizeInternalMoney(parseNumericInput(')) {
      expressions.push([node.name.getText(source), node.initializer.getText(source)])
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(expressions.length >= 2)
  for (const [field, expression] of expressions) {
    const submit = new Function('form', 'parseNumericInput', 'normalizeInternalMoney', 'canViewCosts', 'blindCostInputs', `return ${expression}`)
    for (const value of [0, 0.0001, 1.2345]) {
      assert.equal(submit({ [field]: editableMoneyValue(value) }, Number, normalizeInternalMoney, true, {}), value, `${filename} ${field} no-op save`)
      if (filename === 'ProductForm.tsx') {
        const currency = field === 'cost_price_usd' ? 'usd' : 'khr'
        assert.equal(submit({ [field]: '999.9999' }, Number, normalizeInternalMoney, false, { [currency]: editableMoneyValue(value) }), value,
          `${filename} ${field} blind edit preserves precision and never submits the hidden saved value`)
      }
    }
  }
  if (filename === 'ProductForm.tsx') {
    // Execute the real existing-product omission block: a blank blind edit must
    // preserve server authority, not overwrite an unreadable amount with zero.
    let omissionBlock = ''
    const findOmission = (node: ts.Node) => {
      if (ts.isIfStatement(node) && node.expression.getText(source) === '!canViewCosts && product?.id') omissionBlock = node.getText(source)
      ts.forEachChild(node, findOmission)
    }
    findOmission(source)
    assert.ok(omissionBlock)
    const omitBlank = new Function('payload', 'canViewCosts', 'product', 'blindCostInputs', `${omissionBlock}; return payload`)
    assert.deepEqual(omitBlank({ cost_price_usd: 0, cost_price_khr: 0 }, false, { id: 1 }, { usd: '', khr: ' ' }), {})
    assert.deepEqual(omitBlank({ cost_price_usd: 0, cost_price_khr: 1.2345 }, false, { id: 1 }, { usd: '0', khr: '1.2345' }), { cost_price_usd: 0, cost_price_khr: 1.2345 })
    assert.deepEqual(omitUnauthorizedCatalogCosts({ cost_price_usd: 1.2345, cost_price_khr: 0.0001, name: 'Keep' }, null), { name: 'Keep' },
      'unauthorized costs are absent, never fabricated zero writes')
  }
}
console.log('frontendMoneyPrecision: PASS')

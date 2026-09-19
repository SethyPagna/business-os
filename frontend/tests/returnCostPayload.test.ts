import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Compile and execute each real customer-return map callback. Hidden costs
// must not be converted into zero-valued acquisition-cost overrides.
for (const file of ['NewReturnModal', 'EditReturnModal', 'Returns']) {
  const source = readFileSync(new URL(`../src/components/returns/${file}.tsx`, import.meta.url), 'utf8')
  const ast = ts.createSourceFile(`${file}.tsx`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const callbacks: ts.ArrowFunction[] = []
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'map' && node.arguments[0] && ts.isArrowFunction(node.arguments[0])) {
      const callback = node.arguments[0]
      if (callback.body.getText(ast).includes('sale_item_id:') && callback.body.getText(ast).includes('return_to_stock:')) callbacks.push(callback)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(callbacks.length, `${file} return builder found`)
  for (const callback of callbacks) {
    const code = ts.transpileModule(`const build = ${callback.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    const build = new Function('toNumber', 'foundSale', 'ret', 'snapshot', 'DEFAULT_STOCK_CONDITION_TAG', `${code}; return build`)(Number, { branch_id: 1 }, { branch_id: 1 }, { branch_id: 1 }, 'damaged')
    for (const cost of [undefined, 0, 123.4567]) {
      const result = build({ id: 9, sale_item_id: 9, product_id: 7, quantity: 2, returnQty: 2, applied_price_usd: 30, applied_price_khr: 120000, cost_price_usd: cost, cost_price_khr: cost, stock_action: 'restock' })
      assert.equal(result.product_id, 7)
      if (callback.body.getText(ast).includes('applied_price_usd:')) assert.equal(result.applied_price_usd, 30)
      assert.equal(Object.hasOwn(result, 'cost_price_usd'), false)
      assert.equal(Object.hasOwn(result, 'cost_price_khr'), false)
    }
  }
}
console.log('PASS customer-return create/edit/history omit browser acquisition-cost snapshots')

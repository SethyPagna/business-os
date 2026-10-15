const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const path = require('node:path')
const root = path.join(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src/lib/saleNotPaidStockRecovery.ts'), 'utf8')
const migration = fs.readFileSync(path.join(root, 'migrations/0146_not_paid_sale_stock_recovery.sql'), 'utf8')
const routes = fs.readFileSync(path.join(root, 'src/routes/system.ts'), 'utf8')

assert.match(source, /SALE_NOT_PAID_STOCK_RECOVERY_TARGET = 'sale-not-paid-stock-recovery-20260909-v1'/)
assert.match(source, /SALE_NOT_PAID_STOCK_RECOVERY_CONFIRMATION = 'CORRECT NOT PAID STOCK 16952 16953 16954'/)
for (const id of [16952, 16953, 16954]) assert.match(source, new RegExp(`id: ${id}`))
for (const id of [40378, 40379, 40380, 40381]) assert.match(source, new RegExp(`sale_item_id: ${id}`))
assert.match(source, /released_quantity=0,released_at=NULL/)
assert.match(source, /branch_batch_stock SET quantity=quantity-1/)
assert.match(source, /branch_stock SET quantity=quantity-1/)
assert.match(source, /products SET stock_quantity=stock_quantity-1/)
assert.match(source, /movement_type,quantity,unit_cost_usd.*VALUES\(@product_id.*'sale',-1/s)
assert.match(source, /sale_not_paid_stock_recovery_receipts/)
assert.match(source, /sale_not_paid_stock_recovery_members/)
assert.match(source, /awaiting_payment/)
assert.match(source, /sale_status='completed'.*16951/s)
assert.match(source, /movement_type IN \('sale','sale_from_damaged'\)/)
function assertStockDispatch(text) {
  const tree = ts.createSourceFile('saleNotPaidStockRecovery.ts', text, ts.ScriptTarget.Latest, true)
  const calls = []
  const visit = node => { if (ts.isCallExpression(node)) calls.push(node); ts.forEachChild(node, visit) }
  visit(tree)
  const dispatch = calls.filter(node => node.expression.getText(tree) === 'executeStockTransaction')
  assert.equal(dispatch.length, 1)
  assert.deepEqual(dispatch[0].arguments.map(node => node.getText(tree)), ['db', 'prepared.statements', "'retry'"])
  assert.ok(ts.isAwaitExpression(dispatch[0].parent))
  assert.equal(calls.some(node => ['db.batch', 'db.batchOnce'].includes(node.expression.getText(tree))), false)
  assert.ok(tree.statements.some(node => ts.isImportDeclaration(node) && node.moduleSpecifier.text === './stockTransaction'
    && node.importClause?.namedBindings?.elements?.some(item => item.name.text === 'executeStockTransaction' && !item.propertyName)))
}
assertStockDispatch(source)
const dispatchText = "await executeStockTransaction(db, prepared.statements, 'retry')"
assert.ok(source.includes(dispatchText))
for (const replacement of ['await db.batch(prepared.statements)', "await executeStockTransaction(db, [], 'retry')", dispatchText + '; ' + dispatchText]) {
  assert.throws(() => assertStockDispatch(source.replace(dispatchText, replacement)))
}
assert.match(source, /SaleNotPaidStockRecoveryUncertainError/)
assert.match(migration, /CREATE TABLE sale_not_paid_stock_recovery_receipts/)
assert.match(migration, /CREATE TABLE sale_not_paid_stock_recovery_members/)
assert.match(migration, /CREATE TABLE sale_not_paid_stock_recovery_guards/)
assert.match(routes, /sale-not-paid-stock-recovery-20260909\/preview/)
assert.match(routes, /sale-not-paid-stock-recovery-20260909\/apply/)
console.log('Not Paid stock recovery contract: all source, cohort, atomicity and route checks pass')

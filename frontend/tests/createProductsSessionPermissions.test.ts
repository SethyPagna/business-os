import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { effectivePermissions } from '../src/utils/permissions.ts'
import { createProductsSessionPermissionRequirements } from '../src/utils/createProductsSession.ts'

// UI-STOCK-3 (30 Sep 2026) deleted CreateProductsSessionModal.tsx; the header
// Add opens the Stock Session. What stays pinned here: the grants a chip
// parked by the retired modal carries, the host rechecking every one of them
// on restore, ProductForm's image gate, and Review-tier product creation
// never bypassing its approval workflow (now refused by the float, and still
// applied only through the registered review applier on the Worker).

const create = { kind: 'create_receive' as const, status: 'queued' as const, quantity: 0 }
const createWithStock = { kind: 'create_receive' as const, status: 'queued' as const, quantity: 2 }
const receive = { kind: 'receive' as const, status: 'queued' as const, quantity: 2 }
const savedCreate = { kind: 'created_zero' as const, status: 'saved' as const, quantity: 0 }

assert.deepEqual(createProductsSessionPermissionRequirements([create], 'new'), [
  { permissionKey: 'products', actionKey: 'add' },
])
assert.deepEqual(createProductsSessionPermissionRequirements([receive], 'existing'), [
  { permissionKey: 'inventory', actionKey: 'adjust' },
])
assert.deepEqual(createProductsSessionPermissionRequirements([createWithStock], 'new'), [
  { permissionKey: 'products', actionKey: 'add' },
  { permissionKey: 'inventory', actionKey: 'adjust' },
], 'creating a positive-stock row also receives stock, matching the Worker')
assert.deepEqual(createProductsSessionPermissionRequirements([create, receive], 'existing'), [
  { permissionKey: 'products', actionKey: 'add' },
  { permissionKey: 'inventory', actionKey: 'adjust' },
])
assert.deepEqual(createProductsSessionPermissionRequirements([savedCreate], 'existing'), [
  { permissionKey: 'inventory', actionKey: 'adjust' },
], 'saved rows no longer need write authority; an empty queue follows the exact active mode')
assert.deepEqual(createProductsSessionPermissionRequirements([], 'new'), [
  { permissionKey: 'products', actionKey: 'add' },
])

const productsSource = readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')
const floatSource = readFileSync(new URL('../src/components/inventory/FastStockInModal.tsx', import.meta.url), 'utf8')

assert.match(productsSource, /sessionRequirements\.every\(\(required\) => can\(required\.permissionKey, required\.actionKey\)\)/,
  'the host must recheck every queued-operation grant before opening')
assert.match(productsSource, /if \(!allowed[\s\S]*?reparkDeniedRestore\(entry\)/,
  'a grant revoked after tray dispatch must put the same chip and draft back')
assert.match(productsSource, /legacyDraft: \{ kind: 'create_products_session', data: readWorkDraft\(draftKey\)\?\.data \?\? null \}/,
  'an allowed legacy chip reopens as the Stock Session with its parked draft')
// The session's chip restores through the Stock Changes host, which needs
// inventory adjust, so only that grant is offered a minimize.
assert.match(productsSource, /onMinimize=\{canAdjustInventoryStock \? \(label: string\) => \{\s*minimizeWork\(\{\s*key: 'fast-stockin',/)

console.log('PASS legacy create-products chips restore only when every parked grant still holds')

function loadFunction(source: string, name: string) {
  const ast = ts.createSourceFile('component.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const node = ast.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name)!
  const compiled = ts.transpileModule(node.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  return new Function('effectivePermissions', `${compiled}; return ${name}`)(effectivePermissions)
}
const canImages = loadFunction(readFileSync(new URL('../src/components/products/forms/ProductForm.tsx', import.meta.url), 'utf8'), 'canManageProductImages')
for (const value of [false, 'review', true, 'true', 1, {}]) {
  const user = { role_permissions: { all: true, products: true }, permissions: { all: false, products: value } }
  assert.equal(canImages(user), value === true, 'Review has no image management grant')
}
// Effective admin bypass through the admin role code (not the name, FX-sec).
assert.equal(canImages({ role_code: ' admin ', permissions: { 'products:image': false } }), true)
assert.match(productsSource, /getPermissionTier\('products'\) === 'none' && can\('products_image_only', 'view'\)/)
console.log('PASS product image permission follows the effective Full grant with the admin bypass')

// A Review-tier create goes to review on the normal product route; the float
// refuses to receive stock against a product that does not exist yet.
const applierSource = readFileSync(new URL('../../cloudflare/src/lib/reviewApply.ts', import.meta.url), 'utf8')
const writerSource = readFileSync(new URL('../../cloudflare/src/lib/productWrites.ts', import.meta.url), 'utf8')
function assertReviewCreatePaths(modal: string, appliers: string, writers: string) {
  const start = modal.indexOf('  const createHeldProduct = ')
  const end = modal.indexOf('  // ---- commit ----', start)
  assert.ok(start > 0 && end > start)
  const create = modal.slice(start, end)
  assert.match(create, /const payload = \{[\s\S]*?client_request_id: line\.createRequestId,[\s\S]*?stock_quantity: 0,/)
  assert.match(create, /const attempt = await reserveReceivingProductAttempt\(user\?\.id, line\.createRequestId, payload, validateDestination\)/)
  assert.match(create, /result = await createProduct\(JSON\.parse\(attempt\.bodyJson!\), assertDispatch\)/)
  assert.match(create, /if \(result\?\.pending\) \{\s*try \{ await finishReceivingProductAttempt\(attempt, 'pending'\) \} catch \{ throw unknownError\(\) \}\s*submissionsRef\.current\.productOutcomes\[line\.key\] = 'pending'\s*throw Object\.assign\(new Error\([^\n]+\), \{ code: 'product_pending_review' \}\)/)
  const applierAst = ts.createSourceFile('reviewApply.ts', appliers, ts.ScriptTarget.Latest, true)
  const registration = applierAst.statements.find(item => ts.isExpressionStatement(item) && ts.isCallExpression(item.expression)
    && item.expression.expression.getText(applierAst) === 'registerApplier'
    && item.expression.arguments.slice(0, 3).map(value => ts.isStringLiteral(value) ? value.text : '').join('/') === 'products/create/product')
  assert.ok(registration)
  const registered = registration.getText(applierAst)
  assert.match(registered, /await createProductWithInitialStock\(env, body,[\s\S]*?\{ row, reviewer: \{ reviewedBy: reviewer\.id, reviewedByName: reviewer\.name \} \}(?:, reviewer\.redirectTarget \?\? null)?\)/)
  assert.match(registered, /return \{ pendingActionMarkedAtomically: true \}/)
  const writerAst = ts.createSourceFile('productWrites.ts', writers, ts.ScriptTarget.Latest, true)
  const functionText = (name: string) => {
    const node = writerAst.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name)
    assert.ok(node, name)
    return node.getText(writerAst)
  }
  assert.match(functionText('productCreateDestination'), /const rawQuantity = body\.stock_quantity \?\? 0/)
  const writer = functionText('createProductWithInitialStock')
  assert.match(writer, /const \{ branchId, quantity(?:, landing)? \} = await productCreateDestination\(env, body(?:, redirectTarget)?\)/)
  assert.match(writer, /planInsertRow\('products',[\s\S]*?stock_quantity: quantity, client_request_id: key/)
  for (const table of ['branch_stock', 'product_batches', 'branch_batch_stock']) {
    const insert = writer.indexOf('INSERT INTO ' + table + '(')
    assert.ok(insert > 0 && insert < writer.indexOf('await db.batchOnce(addressedStatements(landing, statements))'), table)
  }
  assert.match(writer, /if \(approval\) \{\s*statements\.push\(\.\.\.pendingActionApprovalStatements\(approval\.row, approval\.reviewer\)\)/)
  assert.match(writer, /statements\.push\(receivingBranchAssertion\(branchId\)\)/)
  assert.equal((writer.match(/await db\.batchOnce\(addressedStatements\(landing, statements\)\)/g) || []).length, 1)
}
assertReviewCreatePaths(floatSource, applierSource, writerSource)
for (const [before, after] of [
  ['stock_quantity: 0,', 'stock_quantity: 1,'],
  ['JSON.parse(attempt.bodyJson!), assertDispatch', 'JSON.parse(attempt.bodyJson!)'],
  ["finishReceivingProductAttempt(attempt, 'pending')", "finishReceivingProductAttempt(attempt, 'unknown')"],
  ["code: 'product_pending_review'", "code: 'ignored_pending'"],
]) {
  const start = floatSource.indexOf('  const createHeldProduct = ')
  const changed = floatSource.slice(0, start) + floatSource.slice(start).replace(before, after)
  assert.throws(() => assertReviewCreatePaths(changed, applierSource, writerSource), assert.AssertionError)
}
assert.throws(() => assertReviewCreatePaths(floatSource, applierSource.replace('await createProductWithInitialStock(env, body', 'await insertRow(env, body'), writerSource), assert.AssertionError)
for (const before of ['INSERT INTO branch_stock(', 'INSERT INTO product_batches(', 'INSERT INTO branch_batch_stock(', '...pendingActionApprovalStatements(approval.row, approval.reviewer)']) {
  assert.throws(() => assertReviewCreatePaths(floatSource, applierSource, writerSource.replace(before, 'removed_atomic_statement')), assert.AssertionError)
}
console.log('PASS Review-tier product creation stays on the review workflow; the Stock Session refuses a pending product')

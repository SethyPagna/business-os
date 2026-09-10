import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { effectivePermissions } from '../src/utils/permissions.ts'
import { createProductsSessionPermissionRequirements } from '../src/utils/createProductsSession.ts'

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
const modalSource = readFileSync(new URL('../src/components/products/CreateProductsSessionModal.tsx', import.meta.url), 'utf8')

assert.match(modalSource, /const \[mode, setMode\] = useState<AddProductsMode>\(restoredMode\)/,
  'restoring must retain the drafted operation instead of choosing another allowed mode')
assert.doesNotMatch(modalSource, /firstAvailableMode/)
assert.match(modalSource, /writeDraft\(\)[\s\S]*?mode,[\s\S]*?requiredPermissions: createProductsSessionPermissionRequirements\(rows, mode\)/,
  'minimize must persist the current draft and park its exact mode and queued-operation grants')
assert.match(productsSource, /sessionRequirements\.every\(\(required\) => can\(required\.permissionKey, required\.actionKey\)\)/,
  'the host must recheck every queued-operation grant before opening')
assert.match(productsSource, /if \(!allowed[\s\S]*?reparkDeniedRestore\(entry\)/,
  'a grant revoked after tray dispatch must put the same chip and draft back')
assert.match(productsSource, /mode: details\.mode,[\s\S]*?requiredPermissions: details\.requiredPermissions/,
  'the parked payload must retain the exact mode and full requirement set')
assert.match(productsSource, /onMinimize=\{\(canAddProduct \|\| canAdjustInventoryStock\)/,
  'inventory-adjust-only operators must retain the session minimize action')

console.log('PASS create-products session restore permissions follow queued operations and retain the exact draft mode')

function loadFunction(source: string, name: string) {
  const ast = ts.createSourceFile('component.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const node = ast.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name)!
  const compiled = ts.transpileModule(node.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  return new Function('effectivePermissions', `${compiled}; return ${name}`)(effectivePermissions)
}
const canCommit = loadFunction(modalSource, 'canCommitProductCreateInStockSession')
const canImages = loadFunction(readFileSync(new URL('../src/components/products/forms/ProductForm.tsx', import.meta.url), 'utf8'), 'canManageProductImages')
for (const value of [false, 'review', true, 'true', 1, {}]) {
  const user = { role_permissions: { all: true, products: true }, permissions: { all: false, products: value } }
  assert.equal(canCommit(user), value === true, 'only effective Full can use atomic product creation')
  assert.equal(canImages(user), value === true, 'Review has no image management grant')
}
assert.equal(canCommit({ role_permissions: { all: true }, permissions: { all: false, products: 'review' } }), false)
assert.equal(canCommit({ permissions: { products: true, 'products:add': false } }), false)
assert.equal(canCommit({ username: ' ADMIN ', permissions: { all: false, products: 'review', 'products:add': false } }), true)
assert.equal(canImages({ role_code: ' admin ', permissions: { 'products:image': false } }), true)
assert.equal(canCommit(null), false)
assert.match(modalSource, /if \(!canCommitProductAdd\)[\s\S]*?await onCreateProduct\(\{ \.\.\.payload, stock_quantity: quantity \}\)/)
assert.match(modalSource, /attemptItems\.some\(\(item\) => item\.kind === 'create_receive'\) && !canCommitProductAdd/)
assert.match(productsSource, /getPermissionTier\('products'\) === 'none' && can\('products_image_only', 'view'\)/)
console.log('PASS actual product modal/image permission functions preserve Review workflow and effective admin bypass')

const modalAst = ts.createSourceFile('modal.tsx', modalSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let saveNewItemSource = ''
function findSave(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(modalAst) === 'saveNewItem') saveNewItemSource = node.initializer!.getText(modalAst)
  ts.forEachChild(node, findSave)
}
findSave(modalAst)
const handlerJs = ts.transpileModule(`const handler = ${saveNewItemSource}`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
for (const quantity of [0, 4]) {
  const reviewedPayloads: Record<string, unknown>[] = []
  let prepared = false
  const user = { role_permissions: { all: true }, permissions: { all: false, products: 'review', inventory: true } }
  const bindings = {
    effectivePermissions, user, saving: false, header: { branchId: '1', supplierName: 'Supplier' }, rows: [], freeGoods: false,
    tr: (_key: string, fallback: string) => fallback, findSessionProductDuplicate: () => false,
    stockReceiptGateCode: () => null, setSaving() {}, canCommitProductAdd: canCommit(user), canReceiveStock: true,
    onCreateProduct: async (payload: Record<string, unknown>) => { reviewedPayloads.push(payload); throw new Error('Pending review') },
    onPrepareProduct: async () => { prepared = true },
  }
  const handler = new Function(...Object.keys(bindings), `${handlerJs}; return handler`)(...Object.values(bindings))
  await assert.rejects(handler({ name: 'New item', barcode: '123', branch_id: 1, stock_quantity: quantity, cost_price_usd: 5 }), /Pending review/)
  assert.equal(reviewedPayloads.length, 1)
  assert.equal(reviewedPayloads[0].stock_quantity, quantity, 'zero/positive opening stock intent goes through registered review')
  assert.equal(prepared, false, 'Inventory Full cannot select atomic product create for Products Review')
}
const applierSource = readFileSync(new URL('../../cloudflare/src/lib/reviewApply.ts', import.meta.url), 'utf8')
assert.match(applierSource, /registerApplier\('products', 'create', 'product'[\s\S]*?body\.stock_quantity[\s\S]*?seedBranchStockForNewProduct[\s\S]*?seedInitialBatchForNewProduct/)
console.log('PASS executable Review plus Full Inventory zero/positive-stock creation follows review; queued atomic submission fails closed after downgrade')

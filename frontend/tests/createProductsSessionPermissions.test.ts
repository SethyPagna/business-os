import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

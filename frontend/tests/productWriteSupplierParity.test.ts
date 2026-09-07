import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const transport = readFileSync(join(here, '..', 'src', 'api', 'productWriteTransport.ts'), 'utf8')
const productForm = readFileSync(join(here, '..', 'src', 'components', 'products', 'forms', 'ProductForm.tsx'), 'utf8')
const stockSupplierPicker = readFileSync(join(here, '..', 'src', 'components', 'shared', 'SupplierPickerField.tsx'), 'utf8')

assert.doesNotMatch(transport, /ensureSupplierExists/, 'product writes must not create a contact as a hidden side effect')
assert.doesNotMatch(transport, /apiFetch\(['"]POST['"],\s*['"]\/api\/suppliers['"]/, 'product writes never post to the supplier-contact endpoint')
assert.doesNotMatch(transport, /getLocalDb/, 'product writes do not consult a stale local supplier cache before saving')

const createStart = transport.indexOf('export async function createProduct')
const updateStart = transport.indexOf('export async function updateProduct')
const deleteStart = transport.indexOf('export async function deleteProduct')
assert.ok(createStart >= 0 && updateStart > createStart && deleteStart > updateStart)
const createBlock = transport.slice(createStart, updateStart)
const updateBlock = transport.slice(updateStart, deleteStart)
assert.match(createBlock, /const body = ensureClientRequestId\(\{ \.\.\.getDevicePayload\(\), \.\.\.\(payload \|\| \{\}\) \}/, 'create keeps the supplied free-text supplier in the product payload')
assert.match(createBlock, /apiFetch\('POST', '\/api\/products', body\)/, 'create performs exactly the product write')
assert.match(updateBlock, /withExpectedUpdatedAt\('products', id, \{ \.\.\.getDevicePayload\(\), \.\.\.\(payload \|\| \{\}\) \}\)/, 'update keeps the supplied free-text supplier in the guarded product payload')
assert.match(updateBlock, /apiFetch\('PUT', `\/api\/products\/\$\{encodeId\(id\)\}`, body\)/, 'update performs exactly the product write')

assert.match(productForm, /supplier NAME[\s\S]{0,120}does not link a contact/i, 'ProductForm documents the free-text supplier contract')
assert.match(stockSupplierPicker, /recorded by name only/i, 'stock-in supplier entry uses the same free-text contract')

console.log('PASS product create/update preserve supplier free text without creating supplier contacts')

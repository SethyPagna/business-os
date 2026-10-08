import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { buildProductExportRows, EXPORT_FIELD_GROUPS } from '../src/components/products/helpers/productExport.ts'
import { buildProductWritePayload } from '../src/components/products/helpers/productWriteHelpers.ts'
import { flattenReplaceColumnGroups, REPLACE_COLUMN_GROUPS, BACKEND_PRODUCT_REPLACE_COLUMNS } from '../src/components/products/import/productReplaceColumnGroups.ts'

for (const is_active of [0, 1, false, true, undefined]) {
  const payload = buildProductWritePayload({ id: 11, name: 'Fixture', is_active })
  assert.equal(Object.hasOwn(payload, 'is_active'), false, 'generic snapshot fields cannot change catalog membership')
  const rows = buildProductExportRows([{ name: 'Fixture', is_active }])
  assert.equal(Object.hasOwn(rows[0], 'Active'), false)
  assert.equal(rows[0].Name, 'Fixture')
}
assert.equal(EXPORT_FIELD_GROUPS.some(group => group.columns.includes('Active')), false)
assert.equal(REPLACE_COLUMN_GROUPS.some(group => group.key === 'status'), false)
assert.equal(BACKEND_PRODUCT_REPLACE_COLUMNS.includes('is_active'), false)
assert.deepEqual(flattenReplaceColumnGroups(['status', 'basic']), ['name', 'sku', 'barcode'])
console.log('PASS actual snapshot/export/replace models expose no product status and retain identity fields')

const methods = readFileSync(new URL('../src/api/methods.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('methods.ts', methods, ts.ScriptTarget.Latest, true)
const template = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'downloadImportTemplate')!
const templateModule = { exports: {} as any }
const compiled = ts.transpileModule(template.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
new Function('exports', 'buildImportCsvTemplate', compiled)(templateModule.exports, (headers: string[], filename: string, exampleRow: unknown) => ({ headers, filename, exampleRow }))
const csv = templateModule.exports.downloadImportTemplate('products')
assert.equal(csv.headers.includes('is_active'), false)
assert.equal(Object.hasOwn(csv.exampleRow, 'is_active'), false)
assert.ok(csv.headers.includes('stock_quantity'))
console.log('PASS actual product CSV template omits status without losing stock columns')

const requests: Array<{ method: string; url: string; body: any }> = []
const source = readFileSync(new URL('../src/api/productWriteTransport.ts', import.meta.url), 'utf8')
const transport = { exports: {} as any }
new Function('exports', 'require', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(transport.exports, (name: string) => {
  if (name.includes('/http')) return { route: (_key: string, run: () => unknown) => run(), apiFetch: async (method: string, url: string, body: any) => { requests.push({ method, url, body }); return { success: true } } }
  if (name.includes('requestIds')) return { ensureClientRequestId: (payload: any) => ({ ...payload, client_request_id: payload.client_request_id || 'fixture-request' }) }
  if (name.includes('deviceInfo')) return { getClientDeviceInfo: () => ({ device_id: 'fixture-device' }) }
  if (name.includes('actorReadScope')) return { captureActorReadScope: () => ({}), assertActorReadScope() {} }
  return {}
})
for (const is_active of [0, 1, false, true]) {
  const original = { name: 'Fixture', is_active, expectedUpdatedAt: 'fixture-version' }
  for (const operation of [() => transport.exports.createProduct(original), () => transport.exports.updateProduct(11, original), () => transport.exports.createProductVariant(original)]) {
    await operation()
    assert.equal(Object.hasOwn(requests.at(-1)!.body, 'is_active'), false)
    assert.equal(requests.at(-1)!.body.name, 'Fixture')
    assert.equal(requests.at(-1)!.body.expectedUpdatedAt, 'fixture-version')
    assert.equal(original.is_active, is_active, 'transport does not mutate saved snapshots')
  }
}
await transport.exports.deleteProduct(11, 'Owner removal', 'fixture-version')
assert.equal(requests.at(-1)!.method, 'DELETE')
assert.equal(requests.at(-1)!.body.reason, 'Owner removal')
assert.equal(requests.at(-1)!.body.expectedUpdatedAt, 'fixture-version')
console.log('PASS actual create/update/variant transports omit status; dedicated removal retains reason/token')

const modal = readFileSync(new URL('../src/components/products/import/BulkImportModal.tsx', import.meta.url), 'utf8')
assert.doesNotMatch(modal, /is_active|deactivat|reactivat/)
assert.ok(/confirm_replace_all_import', '.*removed.*stock/.test(modal))
console.log('PASS import copy describes removal of omitted zero-stock products, with no product status teaching')

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build, transformSync } from 'esbuild'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { omitUnauthorizedCatalogCosts } from '../src/utils/acquisitionCostAccess.ts'
import { effectivePermissions } from '../src/utils/permissions.ts'
import { stockReceiptGateCode } from '../src/utils/stockReceiptFields.ts'

const sourcePath = new URL('../src/components/products/CreateProductsSessionModal.tsx', import.meta.url)
const source = readFileSync(sourcePath, 'utf8')
const globals = globalThis as typeof globalThis & { __sessionCostDraft: unknown }
const line = {
  lineId: 'received-1', kind: 'receive', productId: 1, product: null, name: 'Draft product', barcode: '', brand: '',
  supplierId: 1, supplierName: 'Supplier', branchId: '1', branchName: 'Shop', receivedDate: '2026-09-20',
  expiryDate: '', batchId: null, batchLabel: 'New lot', quantity: 2, unitCostUsd: 876.54,
  freeGoods: false, reason: '', status: 'queued', detail: '', paymentStatus: 'paid', creditDueDate: '',
}
const draft = { sessionId: 1, clientRequestId: 'same-request', header: { brand: '', supplierId: 1, supplierName: 'Supplier', branchId: '1' },
  lines: [line], step: 'items', mode: 'existing', receivedDate: '2026-09-20', submittedItems: null }
globals.__sessionCostDraft = draft
const bundle = await build({ entryPoints: [fileURLToPath(sourcePath)], bundle: true, platform: 'node', format: 'cjs', write: false,
  jsx: 'automatic', external: ['react', 'react-dom'], plugins: [{ name: 'session-cost-stubs', setup(builder) {
    builder.onResolve({ filter: /(?:AppContext(?:Core)?|ProductForm)(?:\.tsx)?$/ }, args => ({ path: args.path, namespace: 'session-test' }))
    builder.onResolve({ filter: /(?:workDrafts|useSavedStockReasons|lazyImport)\.ts$/ }, args => ({ path: args.path, namespace: 'session-test' }))
    builder.onResolve({ filter: /\/shared\/[^/]+(?:\.tsx)?$/ }, args => ({ path: args.path, namespace: 'session-test' }))
    builder.onLoad({ filter: /.*/, namespace: 'session-test' }, args => ({ loader: 'js', contents:
      args.path.includes('AppContext') ? 'export const useApp=()=>({});'
        : args.path.includes('workDrafts') ? `export const scopedWorkDraftKey=()=> 'session'; export const readWorkDraft=()=>({data:globalThis.__sessionCostDraft}); export const scheduleWorkDraftWrite=()=>()=>{}; export const writeWorkDraft=()=>{}; export const clearWorkDraft=()=>{};`
        : args.path.includes('useSavedStockReasons') ? 'export const useSavedStockReasons=()=>[];'
          : args.path.includes('lazyImport') ? 'export const lazyRetry=()=>()=>null;'
            : `import React from 'react'; export default function Stub(p){return React.createElement('div', null, p.children || p.name || null)}`,
    }))
  } }] })
const module = { exports: {} as { default: React.ComponentType<any> } }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
const props = { categories: [], units: [], branches: [{ id: 1, name: 'Shop' }], t: () => '', usdSymbol: '$', khrSymbol: '៛', exchangeRate: 4000,
  notify: () => {}, onDone: () => {}, onClose: () => {}, onPrepareProduct: async (p: unknown) => p, onCreateProduct: async () => 1 }
for (const [view, edit] of [[false, false], [false, true], [true, false], [true, true]]) {
  const html = renderToStaticMarkup(React.createElement(module.exports.default, { ...props, user: { id: 7, permissions: { products: true, inventory: true, product_cost_view: view, product_cost_edit: edit } } }))
  assert.equal(html.includes('1753.08'), view, 'restored derived cost follows view, independently of edit')
  assert.equal(html.includes('Cost edit permission is required'), !edit, 'receive denial is explained before submit')
  assert.deepEqual(globals.__sessionCostDraft, draft, 'permission rendering never destroys or zeros the draft')
}
const admin = renderToStaticMarkup(React.createElement(module.exports.default, { ...props, user: { username: 'admin' } }))
assert.ok(admin.includes('1753.08'))
const defaultDenied = renderToStaticMarkup(React.createElement(module.exports.default, { ...props, user: { id: 7, permissions: { products: true, inventory: true } } }))
assert.ok(!defaultDenied.includes('1753.08') && defaultDenied.includes('Cost edit permission is required'), 'unset grants deny costs by default')

// Execute production callbacks/expressions, not a copy of their permission rule.
const ast = ts.createSourceFile('session.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const currentCostNode = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'currentCost')!
const currentCost = new Function(`${transformSync(currentCostNode.getText(ast), { loader: 'ts' }).code}; return currentCost`)()
assert.equal(currentCost({}), '', 'redacted product cost does not prefill zero')
assert.equal(currentCost({ cost_price_usd: null }), '')
assert.equal(currentCost({ cost_price_usd: 0 }), '0', 'an actual explicit zero is preserved')
assert.equal(currentCost({ cost_price_usd: 1.2345 }), '1.2345', 'receipt prefill keeps monetary precision')
function expression(name: string): string {
  let found = ''
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) found = node.initializer.getText(ast); ts.forEachChild(node, visit) }
  visit(ast); assert.ok(found, name); return transformSync(`const result = ${found}`, { loader: 'tsx' }).code
}
function evaluate(name: string, deps: Record<string, unknown>) {
  return new Function(...Object.keys(deps), `${expression(name)}; return result`)(...Object.values(deps))
}
const notices: string[] = []
const gate = { current: { canEditCosts: false, canViewCosts: false } }
const tr = (_key: string, fallback: string) => fallback
const common = { saving: false, idempotencyConflict: false, submissionLocked: false, canReceiveStock: true,
  costAccessRef: gate, costEditMessage: 'Cost permission denied', tr, notify: (message: string) => notices.push(message), setCommitError: () => {} }
evaluate('queueExistingLine', common)()
assert.deepEqual(notices, ['Cost permission denied'])
await evaluate('finishSession', { ...common, costWritePending: true })()
assert.equal(notices.length, 2, 'direct submit/retry is denied before composing any request')
gate.current.canEditCosts = true
const capturedBeforeRevocation = evaluate('finishSession', { ...common, costWritePending: true })
gate.current.canEditCosts = false
await capturedBeforeRevocation()
assert.equal(notices.length, 3, 'a callback captured before permission revocation reads the current grant')
await assert.rejects(evaluate('saveNewItem', { ...common, user: null, omitUnauthorizedCatalogCosts })({ stock_quantity: 1, cost_price_usd: 0 }), /Cost permission denied/)
const pending = evaluate('costWritePending', { submittedItems: [{ kind: 'create_receive', quantity: 0, product: {} }], rows: [] })
assert.equal(pending, false, 'catalog-only zero-stock requests without costs do not need receipt authority')
assert.equal(evaluate('costWritePending', { submittedItems: [{ kind: 'create_receive', quantity: 0, product: { cost_price_usd: 0 } }], rows: [] }), true, 'explicit zero is still a cost write')
assert.equal(evaluate('costWritePending', { submittedItems: [{ quantity: 0, unit_cost_usd: 0 }], rows: [] }), true, 'frozen receipt payloads cannot bypass edit authority with zero quantity')
const safeProduct = evaluate('editingNewProduct', { canViewCosts: false, editingNewLine: { ...line, product: { cost_price_usd: 876.54, cost_price_khr: 99, purchase_price_usd: 55, name: 'Keep' } } })
for (const key of ['cost_price_usd', 'cost_price_khr', 'purchase_price_usd']) assert.ok(!(key in safeProduct), 'blind editor never receives saved cost props')
assert.match(source, /value=\{canViewCosts \? lineUnitCost : blindLineUnitCost\}/)
assert.match(source, /setLineUnitCost\(canViewCosts && line\.unitCostUsd != null \? String\(line\.unitCostUsd\) : ''\)/)
assert.match(source, /costAccessRef\.current = \{ canViewCosts, canEditCosts \}/, 'async continuations see current authority after revocation')
assert.match(source, /const cost = costText === '' \? null : costValue/, 'missing catalog cost stays unknown, not zero')

let queued: any[] = []
let preparedPayload: Record<string, unknown> | undefined
const catalogueOnly = evaluate('saveNewItem', {
  ...common, user: { permissions: { products: true } }, omitUnauthorizedCatalogCosts, effectivePermissions,
  header: { branchId: '1', brand: '', supplierName: '' }, rows: [], canCommitProductAdd: true,
  stockReceiptGateCode, sessionPaymentDueInvalid: () => false, findSessionProductDuplicate: () => null,
  setSaving: () => {}, onPrepareProduct: async (payload: Record<string, unknown>) => { preparedPayload = payload; return payload },
  STOCK_SESSION_MAX_LINES: 25, branchNameFor: () => 'Shop', receivedDate: '2026-09-20',
  freeGoods: false, reason: '', payment: { paymentStatus: 'paid' }, stockSessionProduct: (value: unknown) => value,
  setRows: (update: (prev: any[]) => any[]) => { queued = update(queued) }, setSubmissionErrorCode: () => {},
})
await catalogueOnly({ name: 'New catalogue row', stock_quantity: 0, cost_price_usd: 876.54 })
assert.ok(preparedPayload && !('cost_price_usd' in preparedPayload), 'no-edit catalogue creation strips even stale cost inputs')
assert.equal(queued[0].unitCostUsd, null, 'no cost becomes unknown, never a fabricated zero')
assert.equal(queued[0].quantity, 0)
assert.equal(queued[0].kind, 'create_receive', 'catalogue-only flow still queues normally')
gate.current.canEditCosts = true
await evaluate('finishSession', { ...common, costWritePending: true, rows: [{ ...line, unitCostUsd: null }], submittedItems: null })()
assert.match(notices.at(-1) || '', /Enter Amount/, 'a restored unknown receipt cost cannot be serialized as zero')
console.log('PASS session cost permission matrix, retained drafts, blind fields, immediate handler denial and catalog-only omission')

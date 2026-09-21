import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { beginSingleAction, finishSingleAction } from '../src/utils/actionGuards.ts'
import { omitUnauthorizedCatalogCosts } from '../src/utils/acquisitionCostAccess.ts'
import { normalizeProductGallery } from '../src/components/products/helpers/productGalleryHelpers.ts'
import { cloneHistorySnapshot, extractHistoryResultId, resolveCreatedHistorySnapshot } from '../src/utils/historyHelpers.ts'

// Execute the actual wired closure and its actual gallery uploader. Only the
// network and surrounding React state are fixtures; no copied save algorithm.
const source = readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('Products.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function initializer(name: string): string {
  const matches: ts.VariableDeclaration[] = []
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) matches.push(node)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(matches.length, 1, `exactly one ${name}`)
  assert.ok(matches[0].initializer)
  return matches[0].initializer!.getText(ast)
}
assert.doesNotMatch(source, /const handleSave\s*=/, 'obsolete unwired handler must remain removed')
assert.match(source, /onSave=\{\(payload\) => handleSaveWithGallery\(/, 'exercise the actual ProductForm callback')
const javascript = ts.transpileModule(`const uploadGalleryImages = ${initializer('uploadGalleryImages')};
const save = ${initializer('handleSaveWithGallery')}; return save;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
type Row = Record<string, unknown>
function fixture(options: { edit?: boolean; granted?: boolean; failure?: 'api' | 'response' | 'upload' | 'refresh'; hold?: ReturnType<typeof deferred>; holdUpload?: ReturnType<typeof deferred>; holdRefresh?: ReturnType<typeof deferred> } = {}) {
  const calls: Array<{ kind: string; payload?: Row }> = []
  const notices: unknown[] = [], history: unknown[] = []
  const guard = { current: false }
  let actor = 7
  const authority = { current: { key: 'initial', revision: 0 } }
  const user = { id: 7, name: 'Staff', role_code: 'staff', permissions: { product_cost_edit: options.granted === true } }
  const api = async (kind: string, payload: Row) => {
    calls.push({ kind, payload })
    if (options.hold) await options.hold.promise
    if (options.failure === 'api') throw new Error('403 permission denied')
    return options.failure === 'response' ? { success: false, error: 'write refused' } : { success: true, id: 12 }
  }
  const scope = {
    user, isActive: true, can: () => true, productSaveAuthorityRef: authority,
    captureProductWriteGuard: (extra?: () => void) => { const captured = actor; return () => { if (actor !== captured) throw new Error('stale actor'); extra?.() } },
    selected: options.edit ? { id: 12, name: 'Before' } : null,
    omitUnauthorizedCatalogCosts, beginSingleAction, finishSingleAction, productSaveInFlightRef: guard,
    t: (key: string) => key, tr: (_key: string, fallback: string) => fallback,
    cloneHistorySnapshot, normalizeProductGallery, extractHistoryResultId, resolveCreatedHistorySnapshot,
    GALLERY_UPLOAD_CONCURRENCY: 3, PRODUCT_IMAGE_UPLOAD_TIMEOUT_MS: 30000,
    runProductWriteMutation: (loader: () => Promise<unknown>) => loader(),
    productApi: {
      createProduct: (payload: Row) => api('create', payload),
      updateProduct: (_id: number, payload: Row) => api('update', payload),
      uploadProductImage: async () => {
        calls.push({ kind: 'upload' })
        if (options.holdUpload) await options.holdUpload.promise
        if (options.failure === 'upload') throw new Error('upload refused')
        return { path: 'uploads/saved.png' }
      },
    },
    notify: (...args: unknown[]) => notices.push(args),
    fetchProductsByIds: async () => {
      if (options.holdRefresh) await options.holdRefresh.promise
      if (options.failure === 'refresh') throw new Error('refresh failed after commit')
      return [{ id: 12, name: 'After' }]
    },
    buildProductIdMap: (rows: Array<{ id: number }>) => new Map(rows.map(row => [row.id, row])),
    pinnedEditedProductsRef: { current: new Map() },
    actionHistory: { pushAction: (value: unknown) => history.push(value) },
    pushCreatedProductHistory: (value: unknown) => history.push(value),
    restoreProductSnapshots: async () => {}, load: async () => {},
    getErrorMessage: (_error: unknown, fallback: string) => fallback,
    console: { error() {}, warn() {} },
  }
  const save = new Function(...Object.keys(scope), javascript)(...Object.values(scope)) as (form: Row) => Promise<void>
  return { save, guard, calls, notices, history, switchActor: () => { actor = 99 }, revoke: () => { authority.current.revision++ } }
}
const form = { name: 'After', cost_price_usd: 3.1234, cost_price_khr: 12345.6789, purchase_price_usd: 4.5678, purchase_price_khr: 22222.3333, selling_price_usd: 9.12 }
for (const edit of [false, true]) {
  const hold = deferred(), f = fixture({ edit, hold })
  const first = f.save(form)
  await assert.rejects(f.save(form), /saving_label/)
  await tick()
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].kind, edit ? 'update' : 'create')
  hold.resolve(); await first; await tick()
  assert.equal(f.guard.current, false)
  assert.equal(f.notices.length, 1)
  assert.equal(f.history.length, 1)
  for (const key of ['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr']) assert.equal(key in f.calls[0].payload!, false)
  assert.equal(f.calls[0].payload!.selling_price_usd, 9.12)
}
for (const failure of ['api', 'response', 'upload'] as const) for (const edit of [false, true]) {
  const f = fixture({ edit, failure })
  // ProductForm clears its draft only after onSave resolves. Rejection must
  // reach that boundary, not be swallowed by a toast-only obsolete handler.
  let cleared = false
  await assert.rejects(async () => { await f.save({ ...form, image_gallery: failure === 'upload' ? ['data:image/png;base64,AA=='] : [] }); cleared = true })
  assert.equal(cleared, false)
  assert.equal(f.guard.current, false)
  assert.equal(f.notices.length, 0)
  assert.equal(f.history.length, 0)
  if (failure === 'upload') assert.deepEqual(f.calls.map(call => call.kind), ['upload'])
}
const granted = fixture({ granted: true, failure: 'refresh' })
await granted.save(form); await tick()
assert.equal(granted.calls[0].payload!.cost_price_usd, 3.1234)
assert.equal(granted.calls[0].payload!.purchase_price_usd, 4.5678)
assert.equal(granted.notices.length, 1, 'post-commit enrichment failure must not report a failed save')
assert.equal(granted.guard.current, false)
const empty = fixture()
await assert.rejects(empty.save({ name: '  ' }), /required/)
assert.equal(empty.calls.length, 0)
assert.equal(empty.guard.current, false)
console.log('PASS actual wired product save: single-flight create/edit, failure propagation, upload refusal, cost grants and post-commit refresh isolation')


for (const edit of [false, true]) for (const change of ['switchActor', 'revoke'] as const) {
  const upload = deferred(), f = fixture({ edit, holdUpload: upload })
  const saving = f.save({ ...form, image_gallery: Array.from({ length: 5 }, () => 'data:image/png;base64,AA==') })
  await tick(); f[change](); upload.resolve()
  await assert.rejects(saving)
  assert.equal(f.calls.some(call => call.kind === 'create' || call.kind === 'update'), false, 'stale upload must not dispatch product write')
  assert.ok(f.calls.filter(call => call.kind === 'upload').length <= 3, 'remaining workers cannot dispatch after authority loss')
  assert.equal(f.notices.length, 0)
  assert.equal(f.history.length, 0)
  assert.equal(f.guard.current, false)
}
const pendingWrite = deferred(), staleWrite = fixture({ hold: pendingWrite })
const writing = staleWrite.save(form)
await tick(); staleWrite.switchActor(); pendingWrite.resolve()
await assert.rejects(writing)
assert.equal(staleWrite.notices.length, 0)
assert.equal(staleWrite.history.length, 0)
const pendingRefresh = deferred(), staleRefresh = fixture({ holdRefresh: pendingRefresh })
await staleRefresh.save(form)
staleRefresh.switchActor(); pendingRefresh.resolve(); await tick()
assert.equal(staleRefresh.history.length, 0, 'late enrichment must not publish old-account undo history')
console.log('PASS delayed product uploads, committed response and enrichment reject changed account/permission')

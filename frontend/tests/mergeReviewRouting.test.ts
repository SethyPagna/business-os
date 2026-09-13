import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSelectedConflictGroupReviewRequest } from '../src/utils/selectedConflictActionReview.ts'
import ts from 'typescript'

const rows = Array.from({ length: 20 }, (_, index) => ({
  type: 'leadingzero' as const, severity: 'leading_zero' as const, value: String(1000 + index),
  products: [index * 3 + 1, index * 3 + 2, index * 3 + 3].map((id) => ({
    id, name: `Item ${index}`, barcode: String(1000 + index), cost_price_usd: 0,
    selling_price_usd: 8, stock_quantity: 1, image_path: null,
  })),
}))
const request = buildSelectedConflictGroupReviewRequest(rows, 'review-large-selection')
assert.equal(request.resolution_version, 2)
assert.equal(request.merge_groups.length, 20, 'new batch review must not truncate at twelve pairs')
assert.equal(request.merge_groups.flatMap((group) => group.member_ids).length, 60, 'three-row groups remain complete')
assert.deepEqual(request.remove_rows, [], 'leading-zero review must not infer independent removal')

const tab = readFileSync(new URL('../src/components/products/ProductDuplicatesTab.tsx', import.meta.url), 'utf8')
assert.match(tab, /onClick=\{\(\) => void openSelectedGroupReview\(clusters\.filter\(\(cluster\) => cluster\.severity === 'leading_zero'\), \{\}\)\}/)
assert.doesNotMatch(tab, /onClick=\{onMergeLeadingZero\}/)
assert.match(tab, /t\('cost_price'\).*money\(product\.cost_price_usd\)/)
assert.match(tab, /t\('selling_price'\).*money\(product\.selling_price_usd\)/)
assert.doesNotMatch(tab, /money\(product\.cost_price_usd\)\} →/)
assert.match(tab, /candidate\.products\.some\(\(product\) => Number\(product\.id\) === id\)/, 'collision routing requires persisted server evidence for both ids')
assert.match(tab, /products: cluster\.products\.filter\(\(product\) => ids\.has\(Number\(product\.id\)\)\)/, 'collision review excludes unrelated siblings')
assert.match(tab, /product_collision_review_unavailable/, 'missing evidence refuses review')
console.log('PASS durable merge routing, complete group membership, labeled economics and evidence-bound collision handoff')

// Execute the actual component callbacks with controlled transports/state.
// Extract through the TypeScript AST so JSX handlers and effect bodies run,
// rather than testing a second implementation of the handoff.
function callback(source: string, marker: string, bindings: Record<string, unknown>): (...args: any[]) => any {
  const file = ts.createSourceFile('component.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const candidates: ts.ArrowFunction[] = []
  const visit = (node: ts.Node) => {
    if (ts.isArrowFunction(node) && node.getText(file).includes(marker)) candidates.push(node)
    ts.forEachChild(node, visit)
  }
  visit(file)
  const node = candidates.sort((a, b) => a.getWidth(file) - b.getWidth(file))[0]
  assert.ok(node, `callback exists: ${marker}`)
  const code = ts.transpileModule(`const run = ${node.getText(file)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  return new Function(...Object.keys(bindings), `${code}; return run;`)(...Object.values(bindings))
}
const formSource = readFileSync(new URL('../src/components/products/forms/ProductForm.tsx', import.meta.url), 'utf8')
const host = readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')
const events: string[] = []
let savedDraft: unknown
const edited = { name: 'Item', barcode: '12345', cost_price_usd: 7.5 }
const product = { id: 7, name: 'Item', barcode: '' }
let parked: any
let seeded: unknown
const park = callback(host, 'key: `edit-product-${productId}`', {
  modalProduct: product, minimizeWork: (entry: unknown) => { parked = entry; events.push('park') },
  setModal: () => {}, setSelected: () => {}, setFormInitialTab: () => {}, notify: () => {}, tr: (_key: string, value: string) => value,
})
const preserve = callback(formSource, 'const typedName = String(form.name', {
  imageUploading: false, imageUploadInFlightRef: { current: false }, draftKey: 'actor-product-7', form: edited, product,
  isEditMode: true, tr: (_key: string, value: string) => value, onMinimize: park,
  flushPendingWorkDraft: () => { savedDraft = { form: { ...edited } }; events.push('flush') },
})
const route = callback(host, 'setIdentityReviewProductIds(productIds)', {
  setIdentityReviewProductIds: (ids: unknown) => { seeded = ids; events.push('seed') }, setActiveProductSection: () => {},
})
const reviewClick = callback(formSource, 'onReviewIdentityCollision(productIds)', {
  imageUploading: false, imageUploadInFlightRef: { current: false }, preserveAndMinimize: preserve,
  product, identityCollision: { id: 8 }, setIdentityCollision: () => {}, onReviewIdentityCollision: route,
})
callback(formSource, 'setIdentityCollision(null)', { setIdentityCollision: () => events.push('cancel') })()
assert.deepEqual(events, ['cancel'], 'cancel does not park, change identity or start review')
events.length = 0
reviewClick()
assert.deepEqual(events, ['flush', 'park', 'seed'], 'draft persistence and parking precede routing')
assert.equal(parked.draftKey, 'actor-product-7')
assert.deepEqual(parked.payload, { productId: 7 })
assert.deepEqual(seeded, [7, 8])
let restoredProduct: unknown
let restoredModal: unknown
await callback(host, 'const current = (await fetchProductsByIds([productId]))[0]', {
  disposed: false, can: () => true, canRestoreMinimizedWork: () => true,
  fetchProductsByIds: async (ids: number[]) => { assert.deepEqual(ids, [7]); return [product] },
  setSelected: (value: unknown) => { restoredProduct = value }, setFormInitialTab: () => {},
  setModal: (value: unknown) => { restoredModal = value }, markRestoreHandled: () => {},
  reparkDeniedRestore: () => { throw new Error('valid parked edit must restore') }, notify: () => {}, tr: () => '',
})(parked)
assert.equal(restoredProduct, product)
assert.equal(restoredModal, 'form', 'Back through the parked chip reopens the original edit')
let restoredForm: Record<string, unknown> = { ...product }
callback(formSource, 'const serverEditedAt', {
  product, draftKey: parked.draftKey, legacyDraftKey: null, form: product, dirtyWorkKey: 'edit7',
  formDirtyRef: { current: false }, restoredLegacyDraftKeyRef: { current: null },
  readWorkDraft: (key: string) => { assert.equal(key, parked.draftKey); return { data: savedDraft } },
  normalizeProductFormDraft: (data: unknown) => data, setForm: (update: any) => { restoredForm = update(restoredForm) },
  canManageImages: false, registerDirtyWork: () => () => {}, clearCurrentProductDraft: () => { throw new Error('must not discard') }, t: () => '',
})()
assert.equal(restoredForm.barcode, edited.barcode, 'returning from review restores the unsaved correction')
assert.equal(restoredForm.cost_price_usd, 7.5)

const evidenceBindings = {
  loaded: true, loading: false, bulkBusy: false, groupReviewPages: [], consumedCollisionRef: { current: null },
  reviewProductIds: [7, 8], onReviewProductIdsConsumed: () => {}, t: () => '',
}
let requested: any[] = []
let refused = false
callback(tab, 'const ids = new Set(reviewProductIds)', {
  ...evidenceBindings, clusters: [{ type: 'name', value: 'Item', products: [{ id: 7 }, { id: 8 }, { id: 9 }] }],
  openSelectedGroupReview: (groups: any[]) => { requested = groups }, notify: () => { refused = true },
})()
assert.deepEqual(requested[0].products.map((row: any) => row.id), [7, 8], 'unrelated siblings never enter collision review')
requested = []
callback(tab, 'const ids = new Set(reviewProductIds)', {
  ...evidenceBindings, consumedCollisionRef: { current: null }, clusters: [{ products: [{ id: 7 }, { id: 9 }] }],
  openSelectedGroupReview: (groups: any[]) => { requested = groups }, notify: () => { refused = true },
})()
assert.equal(refused, true)
assert.deepEqual(requested, [], 'a stale or missing pair does not submit a review')

let applyCalls = 0
const body = { review_id: 'review1', manifest_digest: 'frozen' }
let applyError: unknown
const noop = () => {}
await callback(tab, 'const totalWork = Number(finalized.counts.merge_folds', {
  groupFinalizeResult: { counts: { merge_folds: 104, ready_removals: 0 } }, bulkBusy: false,
  groupReviewRequestRef: { current: { begin: () => ({ signal: undefined, isCurrent: () => true, finish: () => true }) } },
  groupWriteInFlightRef: { current: false }, setBulkBusy: noop, setGroupApplyError: (error: unknown) => { applyError = error },
  setGroupUnknownOutcome: noop, setGroupApplyResult: noop, setGroupApplyGroups: noop, setGroupApplyRemovals: noop,
  setBulkProgress: noop, setSelectedKeys: noop, setGroupRemovalReasons: noop, notify: noop, t: () => '', replaceVars: () => '', load: async () => {},
  applySelectedConflictGroupReview: async (actual: unknown) => {
    assert.equal(actual, body, 'every continuation retains the identical reviewed body')
    applyCalls++
    return { ...body, groups: [], removals: [], status: applyCalls === 13 ? 'completed' : 'running',
      continuation_required: applyCalls < 13, counts: { committed_folds: applyCalls * 8, completed_removals: 0,
        approval_pending_removals: 0, refused_folds: 0, refused_removals: 0 } }
  },
  selectedConflictOutcomeIsUnknown: () => false, selectedConflictErrorMessage: (_t: unknown, error: unknown) => String(error),
})(body)
assert.equal(applyCalls, 13, 'continuation proceeds beyond twelve calls until the reviewed work finishes')
assert.equal(applyError, null)
console.log('PASS executed cancel, draft park/restore, host routing, stale evidence refusal, sibling exclusion and 13-call continuation')

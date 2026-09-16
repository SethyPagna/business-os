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
// Sep 16 2026 owner ruling / P10-5: saving into an existing twin used to
// 409 and park the draft into a separate "review this collision" routing
// (minimize -> seed identityReviewProductIds -> open the Duplicates tab)
// pinned by this file until now. The server folds instead of refusing, so
// that whole park/route/restore detour is gone from both files -- pin its
// absence rather than its shape, so a regression that reintroduces the
// dead-end (instead of the toast+survivor-refresh in Products.tsx's
// handleSaveWithGallery, pinned by tests/mergeStockChoice.test.ts) is caught.
assert.doesNotMatch(formSource, /onReviewIdentityCollision/, 'ProductForm must not regain the 409-collision review escape hatch')
assert.doesNotMatch(formSource, /identityCollision/, 'ProductForm must not regain identity-collision review state')
assert.doesNotMatch(host, /setIdentityReviewProductIds/, 'Products.tsx must not regain the collision-routing seed')
assert.doesNotMatch(host, /onReviewIdentityCollision/, 'Products.tsx must not pass a collision-review callback into ProductForm')

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
console.log('PASS no dead-end collision routing survives, stale evidence refusal, sibling exclusion and 13-call continuation')

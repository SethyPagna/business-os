// Products -> Duplicates on the one conflict resolver (owner asks N1, N3, N4 of
// 23 Sep 2026). The product adapter runs for real against a fake API that
// plays the Worker's preview and merge (keep mode); this pins what the grid
// shows, what the confirm says (before and after) and what is sent.
//
//   N1  Name and barcode follow the kept product; a kept product with no
//       barcode takes the first merged real barcode; the other barcodes are
//       named as staying on the merged records -- never a refusal.
//   N3  every conflict type (leading_zero, same_barcode, same_name,
//       similar_name) reviews to a before/after confirm with no blocker.
//   N4  the cost row is hidden without cost view, locked without cost edit,
//       and a cost is only sent by a user who can edit it.
//   --  stock: Carry or Write off per merged product, answered before writing;
//       apply merges every product one step each, resumes where it stopped.
//
// Run: node tests/productResolveAdapter.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function createStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => { values.clear() },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(String(key)) ?? null,
    setItem: (key: string, value: string) => { values.set(String(key), String(value)) },
    removeItem: (key: string) => { values.delete(String(key)) },
  }
}
globalThis.window = { localStorage: createStorage(), sessionStorage: createStorage(), dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout } as any

const { createProductResolveAdapter, finalProductBarcode, absorbedProductBarcodes, productCellKey } = await import('../src/components/products/productResolveAdapter.ts')
type Draft = import('../src/components/shared/ResolveModal.tsx').ResolveDraft
type Cluster = import('../src/utils/selectedConflictMerge.ts').ProductConflictCluster

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
const t = (key: string) => en[key] ?? key
const signal = new AbortController().signal

let failed = 0
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const product = (id: number, name: string, barcode: string, cost: number, selling: number, stock = 0) => ({
  id, name, barcode, cost_price_usd: cost, cost_price_khr: cost * 4100, selling_price_usd: selling, stock_quantity: stock, image_path: null,
})
const CLUSTERS: Record<string, Cluster> = {
  same_name: { type: 'name', value: 'Rose Toner 100ml', severity: 'same_name', products: [product(10, 'Rose Toner 100ml', '8801111111111', 5, 12, 3), product(11, 'Rose Toner 100ml', '8802222222222', 7, 15, 2)] },
  leading_zero: { type: 'leadingzero', value: '601', severity: 'leading_zero', products: [product(20, 'MAC Shade 601', '0601', 9, 20), product(21, 'MAC Shade 601', '601', 11, 22)] },
  same_barcode: { type: 'barcode', value: '3348901250153', severity: 'same_barcode', products: [product(30, 'Dior Sauvage EDT 100ml', '3348901250153', 60, 95), product(31, 'Dior Sauvage EDP 100ml', '3348901250153', 70, 110)] },
  similar_name: { type: 'similar', value: 'Setting-Spray Fix Plus', severity: 'similar_name', products: [product(40, 'Setting-Spray Fix Plus', '', 4, 9), product(41, 'Setting Spray Fix Plus', '6923644012345', 6, 10)] },
  three: { type: 'name', value: 'Lip Oil', severity: 'same_name', products: [product(50, 'Lip Oil', '111111', 2, 5, 1), product(51, 'Lip Oil', '222222', 4, 6, 4), product(52, 'Lip Oil', '', 0, 5, 0)] },
}

type Call = { kind: 'preview' | 'merge'; args: unknown[] }
function fakeApi(cluster: Cluster, extra: { blocked?: Record<number, unknown>; failMergeAt?: number } = {}) {
  const calls: Call[] = []
  let merges = 0
  const byId = new Map(cluster.products.map((entry) => [entry.id, entry]))
  const api = {
    async preview(keepId: number, mergeId: number, options: { keep: true; groupIds: number[] }) {
      calls.push({ kind: 'preview', args: [keepId, mergeId, options.keep, options.groupIds] })
      const merged = byId.get(mergeId)!
      const keeper = byId.get(keepId)!
      const costs = [...new Set(options.groupIds.map((id) => Number(byId.get(id)?.cost_price_usd) || 0).filter(Boolean))]
      const mean = costs.length ? costs.reduce((sum, value) => sum + value, 0) / costs.length : 0
      return {
        reviewedDigest: 'a'.repeat(64),
        groupProducts: cluster.products,
        stockImpact: { totalQuantity: Number(merged.stock_quantity) || 0, branches: merged.stock_quantity ? [{ branchId: 1, branchName: 'shop', quantity: Number(merged.stock_quantity) }] : [] },
        needsStockChoice: Number(merged.stock_quantity) > 0,
        blocked: extra.blocked?.[mergeId] ?? null,
        keeperStock: { totalQuantity: Number(keeper.stock_quantity) || 0, branches: keeper.stock_quantity ? [{ branchId: 1, branchName: 'shop', quantity: Number(keeper.stock_quantity) }] : [] },
        groupCost: { cost_price_usd: mean, cost_price_khr: mean * 4100 },
      }
    },
    async merge(keepId: number, mergeId: number, stock: unknown, keep: unknown) {
      calls.push({ kind: 'merge', args: [keepId, mergeId, stock, keep] })
      merges += 1
      if (extra.failMergeAt === merges) throw Object.assign(new Error('network down'), { code: '' })
      const keeper = byId.get(keepId)!
      const other = byId.get(mergeId)!
      return { keeper: { id: keepId, name: keeper.name, barcode: keeper.barcode || other.barcode, selling_price_usd: 99, cost_price_usd: 6.5, stock_quantity: 5, branch_stock: [{ branchId: 1, branchName: 'shop', quantity: 5 }], absorbed_barcodes: other.barcode && other.barcode !== keeper.barcode ? [other.barcode] : [] } }
    },
  }
  return { api, calls }
}

const EMPTY: Draft = { selection: {}, columns: {} }
async function open(cluster: Cluster, keeperId: number, perms: { view?: boolean; edit?: boolean } = { view: true, edit: true }, extra = {}) {
  const { api, calls } = fakeApi(cluster, extra)
  const adapter = createProductResolveAdapter({ cluster, keeperId, t, canViewCosts: Boolean(perms.view), canEditCosts: Boolean(perms.edit), canMerge: () => true, api })
  const data = await adapter.load(signal, EMPTY)
  return { adapter, data, calls }
}
const rowOf = (rows: Array<{ key: string }>, key: string) => rows.find((row) => row.key === key) as any

await test('the grid key for a per-record choice is the one ResolveGrid.tsx builds', () => {
  const grid = readFileSync(new URL('../src/components/shared/ResolveGrid.tsx', import.meta.url), 'utf8')
  assert.match(grid, /export function resolveCellKey\(rowKey: string, columnId: string\): string \{\s*return `\$\{rowKey\}\|\$\{columnId\}`/)
  assert.equal(productCellKey('stock', '11'), 'stock|11')
})

await test('load reads every other product against the kept one, in keep mode, with the group', async () => {
  const { calls } = await open(CLUSTERS.three, 51)
  assert.deepEqual(calls.map((call) => call.args), [[51, 50, true, [50, 51, 52]], [51, 52, true, [50, 51, 52]]])
})

await test('load replaces stale list values with the reviewed server projection', async () => {
  const fixture = fakeApi(CLUSTERS.same_name)
  const api = { ...fixture.api, async preview(...args: Parameters<typeof fixture.api.preview>) {
    const reply = await fixture.api.preview(...args)
    return { ...reply, groupProducts: reply.groupProducts.map((entry) => entry.id === 10 ? { ...entry, name: 'Current server name', barcode: '999999' } : entry) }
  } }
  const adapter = createProductResolveAdapter({ cluster: CLUSTERS.same_name, keeperId: 10, t, canViewCosts: true, canEditCosts: false, canMerge: () => true, api })
  const data = await adapter.load(signal, EMPTY)
  assert.equal(rowOf(adapter.rows(data, EMPTY), 'name').final.text, 'Current server name')
  assert.equal(rowOf(adapter.rows(data, EMPTY), 'barcode').final.text, '999999')
  assert.equal(CLUSTERS.same_name.products[0].name, 'Rose Toner 100ml', 'the captured list is not mutated')
})

await test('an oversized group stays editable but cannot show a truncated resolve plan', async () => {
  const cluster: Cluster = { ...CLUSTERS.three, products: Array.from({ length: 13 }, (_, index) => product(100 + index, 'Lip Oil', String(100000 + index), index + 1, 20)) }
  const { adapter, data, calls } = await open(cluster, 100)
  assert.equal(calls.length, 0, 'no truncated group is sent to the preview')
  assert.ok(adapter.blockers!(data, EMPTY).includes('Merge at most 12 records at a time.'))
  const reduced: Draft = { selection: {}, columns: { 112: { disposition: 'separate' } } }
  const fresh = await adapter.load(signal, reduced)
  assert.deepEqual(adapter.blockers!(fresh, reduced), [])
  assert.equal(calls.filter((call) => call.kind === 'preview').length, 11)
})

await test('a deployment budget refusal blocks Resolve with localized copy', async () => {
  const { adapter, data } = await open(CLUSTERS.same_name, 10, { view: true }, { blocked: { 11: { code: 'resolve_plan_budget' } } })
  assert.deepEqual(adapter.blockers!(data, EMPTY), [en.resolve_plan_budget])
})

await test('N1: name and barcode follow the kept product; the other barcode is named, never a refusal', async () => {
  const { adapter, data } = await open(CLUSTERS.same_name, 10)
  const rows = adapter.rows(data, EMPTY)
  assert.equal(rowOf(rows, 'name').final.text, 'Rose Toner 100ml')
  assert.equal(rowOf(rows, 'name').hint, 'Follows the kept product')
  assert.equal(rowOf(rows, 'name').kind, 'computed', 'nothing to pick: the kept product decides')
  assert.equal(rowOf(rows, 'barcode').final.text, '8801111111111')
  assert.equal(rowOf(rows, 'barcode').kind, 'computed')
  assert.match(rowOf(rows, 'barcode').hint, /keeps its barcode/)
  assert.deepEqual(adapter.blockers!(data, EMPTY), [])
  const review = await adapter.review(data, EMPTY, signal)
  assert.ok(review.warnings!.some((warning) => warning.includes('8802222222222')), 'the barcode that stays on the merged record is said')
  assert.equal(review.message, 'Merge Rose Toner 100ml (#11) into Rose Toner 100ml (#10).')
  assert.equal(review.undoable, true, 'a product merge is in History with Undo')
})

await test('N1: finalProductBarcode keeps the stored spelling and fills only a blank one (mirrors keeperFollowsBarcode)', () => {
  assert.equal(finalProductBarcode({ barcode: '0601' }, [{ barcode: '601' }]), '0601')
  assert.equal(finalProductBarcode({ barcode: '' }, [{ barcode: 'abc' }, { barcode: '6923644012345' }]), '6923644012345')
  assert.equal(finalProductBarcode({ barcode: null }, [{ barcode: '' }]), '')
  assert.deepEqual(absorbedProductBarcodes('0601', [{ barcode: '601' }]), [], 'a leading-zero twin is the same barcode')
  assert.deepEqual(absorbedProductBarcodes('111', [{ barcode: '222' }, { barcode: '' }]), ['222'])
  const worker = readFileSync(new URL('../../cloudflare/src/lib/productIdentity.ts', import.meta.url), 'utf8')
  assert.match(worker, /export function keeperFollowsBarcode\(/, 'the Worker twin this mirrors (behaviour: test-product-resolve-keep-merge-native.cjs)')
})

await test('N3: every conflict type reviews to a before/after confirm with no blocker and no "different"', async () => {
  for (const [kind, keeperId] of [['leading_zero', 20], ['same_barcode', 31], ['same_name', 11], ['similar_name', 40]] as const) {
    const { adapter, data } = await open(CLUSTERS[kind], keeperId)
    assert.deepEqual(adapter.blockers!(data, EMPTY), [], kind)
    const review = await adapter.review(data, EMPTY, signal)
    assert.ok(review.changes.length > 0, `${kind}: the confirm shows what changes`)
    for (const change of review.changes) assert.notEqual(change.before, change.after, `${kind}: ${change.label}`)
    assert.ok(!JSON.stringify(review).match(/different|failed/i), `${kind}: ${JSON.stringify(review)}`)
    assert.deepEqual(review.token.steps.map((step) => step.mergeId), CLUSTERS[kind].products.map((entry) => entry.id).filter((id) => id !== keeperId))
  }
  const similar = await open(CLUSTERS.similar_name, 40)
  const barcodeChange = (await similar.adapter.review(similar.data, EMPTY, signal)).changes.find((change) => change.label === 'Barcode')
  assert.deepEqual(barcodeChange, { label: 'Barcode', before: '', after: '6923644012345' }, 'a kept product without a barcode takes the real one')
})

await test('N4: cost is hidden without cost view, locked without cost edit, and sent only by an editor', async () => {
  const hidden = await open(CLUSTERS.same_name, 10, {})
  assert.equal(rowOf(hidden.adapter.rows(hidden.data, EMPTY), 'cost'), undefined)
  assert.equal((await hidden.adapter.review(hidden.data, EMPTY, signal)).token.cost, null)

  const viewer = await open(CLUSTERS.same_name, 10, { view: true })
  const locked = rowOf(viewer.adapter.rows(viewer.data, EMPTY), 'cost')
  assert.equal(locked.locked, 'Changing the cost needs the cost edit permission.')
  assert.equal(locked.custom, undefined)
  const typedByViewer: Draft = { selection: { cost: { custom: '1' } }, columns: {} }
  assert.equal(rowOf(viewer.adapter.rows(viewer.data, typedByViewer), 'cost').final.text, '$6', 'a viewer cannot change it: the rule stays')
  assert.equal((await viewer.adapter.review(viewer.data, typedByViewer, signal)).token.cost, null)

  const editor = await open(CLUSTERS.same_name, 10)
  const rule = rowOf(editor.adapter.rows(editor.data, EMPTY), 'cost')
  assert.equal(rule.final.text, '$6', 'the rule: average of the different costs')
  assert.deepEqual(rule.choice, { option: 'rule' })
  assert.equal(rule.custom.kind, 'money')
  assert.equal(rule.custom.validate('-1'), 'Enter a cost of zero or more.')
  assert.equal(rule.custom.validate('6.25'), null)
  assert.equal((await editor.adapter.review(editor.data, EMPTY, signal)).token.cost, null, 'the server freezes the rule without accepting a client override')
  const typed: Draft = { selection: { cost: { custom: '6.25' } }, columns: {} }
  assert.equal(rowOf(editor.adapter.rows(editor.data, typed), 'cost').final.text, '$6.25')
  const review = await editor.adapter.review(editor.data, typed, signal)
  assert.deepEqual(review.token.cost, { cost_price_usd: 6.25 })
  assert.deepEqual(review.changes.find((change) => change.label === 'Cost'), { label: 'Cost', before: '$5', after: '$6.25' })
  const picked: Draft = { selection: { cost: { source: '11' } }, columns: {} }
  assert.deepEqual((await editor.adapter.review(editor.data, picked, signal)).token.cost, { cost_price_usd: 7, cost_price_khr: 28700 })
})

await test('stock: Carry is shown on each stocked product, Write off changes the after and is warned', async () => {
  const { adapter, data } = await open(CLUSTERS.same_name, 10)
  const stock = rowOf(adapter.rows(data, EMPTY), 'stock')
  assert.deepEqual(stock.cells['11'].options.map((option: { id: string }) => option.id), ['merge', 'write_off'])
  assert.equal(stock.cells['11'].choice, 'merge')
  assert.equal(stock.cells['10'].options, undefined, 'the kept product has nothing to decide')
  assert.equal(stock.final.text, '5 pcs · shop 5')
  const carry = await adapter.review(data, EMPTY, signal)
  assert.deepEqual(carry.token.steps, [{ mergeId: 11, name: 'Rose Toner 100ml (#11)', stock: 'merge' }])
  assert.deepEqual(carry.changes.filter((change) => change.label.startsWith('Stock')), [
    { label: 'Stock', before: '3 pcs', after: '5 pcs' },
    { label: 'Stock · shop', before: '3 pcs', after: '5 pcs' },
  ])
  const writeOff: Draft = { selection: { [productCellKey('stock', '11')]: { option: 'write_off' } }, columns: {} }
  assert.equal(rowOf(adapter.rows(data, writeOff), 'stock').final.text, '3 pcs · shop 3')
  const review = await adapter.review(data, writeOff, signal)
  assert.equal(review.token.steps[0].stock, 'write_off')
  assert.ok(review.warnings!.includes('The stock of Rose Toner 100ml (#11) (2 pcs) will be written off.'))
})

await test('a product kept separate is not merged; a new Keep reads the group again', async () => {
  const { adapter, data } = await open(CLUSTERS.three, 50)
  const separate: Draft = { selection: {}, columns: { '52': { disposition: 'separate' } } }
  assert.deepEqual((await adapter.review(data, separate, signal)).token.steps.map((step) => step.mergeId), [51])
  assert.equal(adapter.reloadWhen!(EMPTY, separate), true, 'the group cost depends on who is in')
  assert.equal(adapter.reloadWhen!(EMPTY, { selection: { record: { source: '51' } }, columns: {} }), true)
  assert.equal(adapter.reloadWhen!(EMPTY, { selection: { cost: { custom: '1' } }, columns: {} }), false)
  const alone: Draft = { selection: {}, columns: { '51': { disposition: 'separate' }, '52': { disposition: 'separate' } } }
  assert.deepEqual(adapter.blockers!(data, alone), ['Merge in at least two records.'])
})

await test('a blocked product says why before Resolve (stock-in session), in the pack\'s words', async () => {
  const { adapter, data } = await open(CLUSTERS.same_name, 10, { view: true, edit: true }, { blocked: { 11: { code: 'stock_session_reversible', operationId: 'S-20260924-0900' } } })
  const [message] = adapter.blockers!(data, EMPTY)
  assert.ok(message.includes('S-20260924-0900'), message)
})

await test('apply merges every product one step each, stops where a step fails and Continue resumes there', async () => {
  const { api, calls } = fakeApi(CLUSTERS.three, { failMergeAt: 2 })
  const written: number[] = []
  const adapter = createProductResolveAdapter({ cluster: CLUSTERS.three, keeperId: 50, t, canViewCosts: true, canEditCosts: true, canMerge: () => true, onWritten: () => written.push(1), api })
  const data = await adapter.load(signal, EMPTY)
  const review = await adapter.review(data, EMPTY, signal)
  const progress: Array<[number, number]> = []
  await assert.rejects(adapter.apply(review.token, signal, (done, total) => progress.push([done, total])), /network down/)
  assert.deepEqual(progress, [[1, 2]])
  assert.equal(written.length, 1, 'the host refreshes after a committed step even though the next failed')
  const result = await adapter.apply(review.token, signal, (done, total) => progress.push([done, total]))
  const merges = calls.filter((call) => call.kind === 'merge').map((call) => call.args)
  assert.deepEqual(merges.map((args) => args[1]), [51, 52, 52], 'the resumed apply re-sends only the step that did not answer')
  assert.deepEqual(merges[0], [50, 51, 'merge', { resolve: { requestId: review.token.requestId, reviewedDigest: 'a'.repeat(64), steps: [{ mergeId: 51, stock: 'merge' }, { mergeId: 52 }] } }], 'every step carries the frozen group and its stock answers')
  assert.deepEqual(merges[1][3], merges[2][3], 'lost responses resend exactly the same receipt identity and choices')
  assert.equal(merges[1][2], undefined, 'a product with no stock needs no answer')
  assert.equal(result.done, 2)
  assert.equal(result.total, 2)
  assert.deepEqual(result.after.map((item) => item.label), ['Product kept', 'Barcode', 'Cost', 'Selling price', 'Stock', 'Merged products', 'Barcodes kept on the merged records'])
  assert.equal(result.after.find((item) => item.label === 'Barcodes kept on the merged records')!.value, '222222')
})

await test('a refusal the Worker states in English reaches the operator in the pack\'s words, code intact', async () => {
  const cluster = CLUSTERS.same_name
  const api = {
    preview: fakeApi(cluster).api.preview,
    merge: async () => { throw Object.assign(new Error('These products are not a current duplicate group.'), { code: 'product_merge_not_duplicates' }) },
  }
  const kt = (key: string) => km[key] ?? key
  const adapter = createProductResolveAdapter({ cluster, keeperId: 10, t: kt, canViewCosts: false, canEditCosts: false, canMerge: () => true, api })
  const data = await adapter.load(signal, EMPTY)
  const review = await adapter.review(data, EMPTY, signal)
  await assert.rejects(adapter.apply(review.token, signal, () => {}), (error: any) => error.code === 'product_merge_not_duplicates' && error.message === km.selected_conflict_product_merge_not_duplicates)
  assert.equal(adapter.isStale(Object.assign(new Error('x'), { code: 'merge_state_conflict' })), true)
  assert.equal(adapter.isStale(Object.assign(new Error('x'), { code: 'product_merge_not_duplicates' })), true)
})

await test('every key the adapter reads exists in both packs', () => {
  const source = readFileSync(new URL('../src/components/products/productResolveAdapter.ts', import.meta.url), 'utf8')
  const keys = [...source.matchAll(/tr\(t, '([a-z0-9_]+)'/g)].map((match) => match[1])
  assert.ok(keys.length >= 20)
  for (const key of keys) {
    assert.ok(en[key], `en: ${key}`)
    assert.ok(km[key], `km: ${key}`)
  }
})

console.log(failed ? `\n${failed} test(s) failed` : '\nall product resolve adapter tests passed')
process.exitCode = failed ? 1 : 0

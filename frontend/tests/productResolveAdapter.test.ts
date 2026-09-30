// Products -> Conflicts on the one conflict resolver. The product adapter runs
// for real against a fake API that plays the Worker's preview and merge (keep
// mode); this pins what the grid shows, what the confirm says (before and
// after) and what is sent.
//
//   30 Sep 2026 (owner): "no need product kept, we should be able to select
//       the segments we want, and the final column should show the final how
//       it looks like" -- the survivor is the lowest included id, never a row;
//       Name, Barcode, Brand, Category, Unit, Cost, Selling, Wholesale and
//       Image are choices (UI-CONFLICTS 3.4 defaults), sent as `choices` and
//       applied by the Worker (shared parity fixture below); an older Worker
//       that cannot apply them keeps today's computed rows.
//   N3  every conflict type reviews to a before/after confirm with no blocker.
//   N4  the cost row is hidden without cost view, locked without cost edit,
//       and a cost is only sent by a user who can edit it.
//   3.5 a definite refusal (a 4xx, merge_failed/not_applied) is told apart
//       from an unknown outcome, and said in the operator's language.
//   --  stock: Carry or Write off per merged product, answered before writing;
//       apply merges every product one step each, resumes where it stopped.
//
// Run: node tests/productResolveAdapter.test.ts
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

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

const { createProductResolveAdapter, finalProductBarcode, absorbedProductBarcodes, productCellKey, productResolveFinalValues, productSurvivor } = await import('../src/components/products/productResolveAdapter.ts')
type Draft = import('../src/components/shared/ResolveModal.tsx').ResolveDraft
type Cluster = import('../src/utils/selectedConflictMerge.ts').ProductConflictCluster
type Record_ = import('../src/components/products/productResolveAdapter.ts').ProductResolveRecord

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
const t = (key: string) => en[key] ?? key
const signal = new AbortController().signal

let failed = 0
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const product = (id: number, name: string, barcode: string, cost: number, selling: number, stock = 0, extra: Partial<Record_> = {}): Record_ => ({
  id, name, barcode, cost_price_usd: cost, cost_price_khr: cost * 4100, selling_price_usd: selling, selling_price_khr: selling * 4100, stock_quantity: stock, image_path: null, ...extra,
})
const CLUSTERS: Record<string, Cluster> = {
  same_name: { type: 'name', value: 'Rose Toner 100ml', severity: 'same_name', products: [product(10, 'Rose Toner 100ml', '8801111111111', 5, 12, 3), product(11, 'Rose Toner 100ml', '8802222222222', 7, 15, 2)] },
  leading_zero: { type: 'leadingzero', value: '601', severity: 'leading_zero', products: [product(20, 'MAC Shade 601', '0601', 9, 20), product(21, 'MAC Shade 601', '601', 11, 22)] },
  same_barcode: { type: 'barcode', value: '3348901250153', severity: 'same_barcode', products: [product(30, 'Dior Sauvage EDT 100ml', '3348901250153', 60, 95), product(31, 'Dior Sauvage EDP 100ml', '3348901250153', 70, 110)] },
  similar_name: { type: 'similar', value: 'Setting-Spray Fix Plus', severity: 'similar_name', products: [product(40, 'Setting-Spray Fix Plus', '', 4, 9), product(41, 'Setting Spray Fix Plus', '6923644012345', 6, 10)] },
  three: { type: 'name', value: 'Lip Oil', severity: 'same_name', products: [product(50, 'Lip Oil', '111111', 2, 5, 1), product(51, 'Lip Oil', '222222', 4, 6, 4), product(52, 'Lip Oil', '', 0, 5, 0)] },
  // A group whose survivor (#60) lacks a brand, a unit, a real barcode and an image.
  catalog: { type: 'name', value: 'Glow Serum', severity: 'similar_name', products: [
    product(60, 'Glow Serum', 'N/A', 5, 12, 0, { brand: '', category: 'Serum', unit: null, wholesale_price_usd: 9, image_path: null }),
    product(61, 'Glow-Serum 30ml', '8850000000061', 6, 14, 0, { brand: 'Glowy', category: 'Skin Care', unit: 'bottle', wholesale_price_usd: 11, image_path: 'products/61.jpg' }),
    product(62, 'Serum Glow', '8850000000062', 7, 14, 0, { brand: 'Glowy Lab', category: null, unit: 'pcs', wholesale_price_usd: 10, image_path: 'products/62.jpg' }),
  ] },
}

type Call = { kind: 'preview' | 'merge'; args: unknown[] }
type FakeOptions = { blocked?: Record<number, unknown>; failMergeAt?: number; choices?: boolean; settles?: string[] }
function fakeApi(cluster: Cluster, extra: FakeOptions = {}) {
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
        ...(extra.choices ? { choicesSupported: true, settlesStockSessions: extra.settles ?? [] } : {}),
      }
    },
    async merge(keepId: number, mergeId: number, stock: unknown, keep: unknown) {
      calls.push({ kind: 'merge', args: [keepId, mergeId, stock, keep] })
      merges += 1
      if (extra.failMergeAt === merges) throw Object.assign(new Error('network down'), { code: 'write_outcome_unknown', outcome: 'unknown' })
      const keeper = byId.get(keepId)!
      const other = byId.get(mergeId)!
      return { keeper: { id: keepId, name: keeper.name, barcode: keeper.barcode || other.barcode, selling_price_usd: 99, cost_price_usd: 6.5, stock_quantity: 5, branch_stock: [{ branchId: 1, branchName: 'shop', quantity: 5 }], absorbed_barcodes: other.barcode && other.barcode !== keeper.barcode ? [other.barcode] : [] } }
    },
  }
  return { api, calls }
}

const EMPTY: Draft = { selection: {}, columns: {} }
async function open(cluster: Cluster, perms: { view?: boolean; edit?: boolean } = { view: true, edit: true }, extra: FakeOptions = {}) {
  const { api, calls } = fakeApi(cluster, extra)
  const adapter = createProductResolveAdapter({ cluster, t, canViewCosts: Boolean(perms.view), canEditCosts: Boolean(perms.edit), canMerge: () => true, api })
  const data = await adapter.load(signal, EMPTY)
  return { adapter, data, calls }
}
const rowOf = (rows: Array<{ key: string }>, key: string) => rows.find((row) => row.key === key) as any
const pick = (selection: Draft['selection']): Draft => ({ selection, columns: {} })

await test('the grid key for a per-record choice is the one ResolveGrid.tsx builds', () => {
  const grid = readFileSync(new URL('../src/components/shared/ResolveGrid.tsx', import.meta.url), 'utf8')
  assert.match(grid, /export function resolveCellKey\(rowKey: string, columnId: string\): string \{\s*return `\$\{rowKey\}\|\$\{columnId\}`/)
  assert.equal(productCellKey('stock', '11'), 'stock|11')
})

await test('the survivor is the lowest included id; load reads every other product against it, in keep mode, with the group', async () => {
  assert.equal(productSurvivor([52, 50, 51]), 50)
  assert.equal(productSurvivor([]), null)
  const { calls } = await open(CLUSTERS.three)
  assert.deepEqual(calls.map((call) => call.args), [[50, 51, true, [50, 51, 52]], [50, 52, true, [50, 51, 52]]])
})

await test('load replaces stale list values with the reviewed server projection', async () => {
  const fixture = fakeApi(CLUSTERS.same_name)
  const api = { ...fixture.api, async preview(...args: Parameters<typeof fixture.api.preview>) {
    const reply = await fixture.api.preview(...args)
    return { ...reply, groupProducts: reply.groupProducts.map((entry) => entry.id === 10 ? { ...entry, name: 'Current server name', barcode: '999999' } : entry) }
  } }
  const adapter = createProductResolveAdapter({ cluster: CLUSTERS.same_name, t, canViewCosts: true, canEditCosts: false, canMerge: () => true, api })
  const data = await adapter.load(signal, EMPTY)
  assert.equal(rowOf(adapter.rows(data, EMPTY), 'name').final.text, 'Current server name')
  assert.equal(rowOf(adapter.rows(data, EMPTY), 'barcode').final.text, '999999')
  assert.equal(CLUSTERS.same_name.products[0].name, 'Rose Toner 100ml', 'the captured list is not mutated')
})

await test('an oversized group stays editable but cannot show a truncated resolve plan', async () => {
  const cluster: Cluster = { ...CLUSTERS.three, products: Array.from({ length: 13 }, (_, index) => product(100 + index, 'Lip Oil', String(100000 + index), index + 1, 20)) }
  const { adapter, data, calls } = await open(cluster)
  assert.equal(calls.length, 0, 'no truncated group is sent to the preview')
  assert.ok(adapter.blockers!(data, EMPTY).includes('Merge at most 12 records at a time.'))
  const reduced: Draft = { selection: {}, columns: { 112: { disposition: 'separate' } } }
  const fresh = await adapter.load(signal, reduced)
  assert.deepEqual(adapter.blockers!(fresh, reduced), [])
  assert.equal(calls.filter((call) => call.kind === 'preview').length, 11)
})

await test('a deployment budget refusal blocks Resolve with localized copy', async () => {
  const { adapter, data } = await open(CLUSTERS.same_name, { view: true }, { blocked: { 11: { code: 'resolve_plan_budget' } } })
  assert.deepEqual(adapter.blockers!(data, EMPTY), [en.resolve_plan_budget])
})

await test('no Product kept row, no info hints, no kept subtitle', async () => {
  for (const choices of [false, true]) {
    const { adapter, data } = await open(CLUSTERS.three, { view: true, edit: true }, { choices })
    const rows = adapter.rows(data, EMPTY)
    assert.equal(rowOf(rows, 'record'), undefined, `choices ${choices}: no record row`)
    assert.equal(rows.some((row) => 'hint' in row), false, `choices ${choices}: no row carries a hint`)
    assert.deepEqual(adapter.columns(data, EMPTY).map((column) => column.subtitle), ['#50', '#51', '#52'])
  }
})

await test('an older Worker (no choicesSupported): name and barcode follow the survivor, selling is the highest, nothing is sent as choices', async () => {
  const { adapter, data } = await open(CLUSTERS.same_name)
  const rows = adapter.rows(data, EMPTY)
  assert.deepEqual(rows.map((row) => row.key), ['name', 'barcode', 'cost', 'selling', 'stock'])
  assert.deepEqual([rowOf(rows, 'name').kind, rowOf(rows, 'name').final.text], ['computed', 'Rose Toner 100ml'])
  assert.deepEqual([rowOf(rows, 'barcode').kind, rowOf(rows, 'barcode').final.text], ['computed', '8801111111111'])
  assert.deepEqual([rowOf(rows, 'selling').kind, rowOf(rows, 'selling').final.text], ['computed', '$15'])
  assert.deepEqual(adapter.blockers!(data, EMPTY), [])
  const review = await adapter.review(data, EMPTY, signal)
  assert.equal(review.token.choices, null)
  assert.ok(review.warnings!.some((warning) => warning.includes('8802222222222')), 'the barcode that stays on the merged record is said')
  assert.equal(review.message, 'Merge Rose Toner 100ml (#11) into Rose Toner 100ml (#10).')
  assert.equal(review.undoable, true, 'a product merge is in History with Undo')
})

await test('choices: every field is a row with the 3.4 defaults', async () => {
  const { adapter, data } = await open(CLUSTERS.catalog, { view: true, edit: true }, { choices: true })
  const rows = adapter.rows(data, EMPTY)
  assert.deepEqual(rows.map((row) => row.key), ['name', 'barcode', 'brand', 'category', 'unit', 'cost', 'selling', 'wholesale', 'image', 'stock'])
  const final = (key: string) => [rowOf(rows, key).kind, rowOf(rows, key).choice, rowOf(rows, key).final.text]
  assert.deepEqual(final('name'), ['choice', { source: '60' }, 'Glow Serum'], "the survivor's name")
  assert.deepEqual(final('barcode'), ['choice', { source: '61' }, '8850000000061'], 'a real barcode over a broken one')
  assert.deepEqual(final('brand'), ['choice', { source: '61' }, 'Glowy'], 'the survivor has none: the first record that has one')
  assert.deepEqual(final('category'), ['choice', { source: '60' }, 'Serum'])
  assert.deepEqual(final('unit'), ['choice', { source: '61' }, 'bottle'])
  assert.deepEqual(final('selling'), ['choice', { source: '61' }, '$14'], 'the highest; a tie takes the lower id')
  assert.deepEqual(final('wholesale'), ['choice', { source: '61' }, '$11'])
  assert.deepEqual(final('image'), ['choice', { source: '61' }, 'products/61.jpg'], 'the survivor has none: the first record with one')
  assert.equal(rowOf(rows, 'brand').custom.kind, 'suggest')
  assert.deepEqual(rowOf(rows, 'brand').custom.suggestions, ['Glowy', 'Glowy Lab'])
  assert.equal(rowOf(rows, 'barcode').custom, undefined, 'a barcode is never typed')
  assert.equal(rowOf(rows, 'image').custom, undefined, 'an image is never typed')
  const review = await adapter.review(data, EMPTY, signal)
  assert.deepEqual(review.token.choices, {
    name: { source_id: 60 }, brand: { source_id: 61 }, category: { source_id: 60 }, unit: { source_id: 61 },
    barcode: { source_id: 61 }, selling_price_usd: { source_id: 61 }, wholesale_price_usd: { source_id: 61 }, image: { source_id: 61 },
  }, 'what the Final column shows is what the Worker is told to write')
  assert.deepEqual(review.changes.find((change) => change.label === 'Image'), { label: 'Image', before: '', after: 'Glow-Serum 30ml (#61)' })
})

await test('choices: a pick or a typed value changes Final and the request; the survivor never moves and nothing is re-read', async () => {
  const { adapter, data, calls } = await open(CLUSTERS.catalog, { view: true, edit: true }, { choices: true })
  const draft = pick({
    name: { source: '62' }, barcode: { source: '62' }, brand: { custom: 'Glowy Labs' }, unit: { source: '60' },
    selling: { custom: '13.001' }, wholesale: { source: '60' }, image: { source: '62' },
  })
  assert.equal(adapter.reloadWhen!(EMPTY, draft), false, 'picking a field never re-reads the server')
  const rows = adapter.rows(data, draft)
  assert.deepEqual(['name', 'barcode', 'brand', 'unit', 'selling', 'wholesale', 'image'].map((key) => rowOf(rows, key).final.text),
    ['Serum Glow', '8850000000062', 'Glowy Labs', '', '$13.01', '$9', 'products/62.jpg'])
  const review = await adapter.review(data, draft, signal)
  assert.equal(review.token.keepId, 60)
  assert.deepEqual(review.token.steps.map((step) => step.mergeId), [61, 62])
  assert.deepEqual(review.token.choices, {
    name: { source_id: 62 }, brand: { custom: 'Glowy Labs' }, category: { source_id: 60 }, unit: { source_id: 60 },
    barcode: { source_id: 62 }, selling_price_usd: { custom: 13.01 }, wholesale_price_usd: { source_id: 60 }, image: { source_id: 62 },
  }, 'a typed price is rounded up to the cent, like every product price')
  assert.deepEqual(review.changes.find((change) => change.label === 'Name'), { label: 'Name', before: 'Glow Serum', after: 'Serum Glow' })
  assert.equal(review.message, 'Merge Glow-Serum 30ml (#61), Serum Glow (#62) into Serum Glow (#60).')
  const invalid = pick({ name: { custom: '   ' }, brand: { custom: 'A||B' }, selling: { custom: '-1' }, wholesale: { custom: 'abc' }, barcode: { custom: '999' } as any, image: { source: '99' } })
  const fallback = (await adapter.review(data, invalid, signal)).token.choices
  assert.deepEqual([fallback?.name, fallback?.brand, fallback?.selling_price_usd, fallback?.wholesale_price_usd, fallback?.barcode, fallback?.image],
    [{ source_id: 60 }, { source_id: 61 }, { source_id: 61 }, { source_id: 61 }, { source_id: 61 }, { source_id: 61 }], 'an invalid typed value or a record outside the group is never sent')
  const editors = adapter.rows(data, EMPTY)
  assert.equal(rowOf(editors, 'name').custom.validate(''), en.resolve_name_invalid)
  assert.equal(rowOf(editors, 'name').custom.validate('x'.repeat(201)), en.resolve_name_invalid)
  assert.equal(rowOf(editors, 'brand').custom.validate('A||B'), en.resolve_text_invalid)
  assert.equal(rowOf(editors, 'selling').custom.validate('-1'), en.resolve_price_invalid)
  assert.equal(rowOf(editors, 'selling').custom.validate('4.5'), null)
  assert.equal(calls.filter((call) => call.kind === 'preview').length, 2, 'only the first read')
  const separate: Draft = { selection: { name: { source: '62' } }, columns: { 62: { disposition: 'separate' } } }
  assert.deepEqual(rowOf(adapter.rows(data, separate), 'name').choice, { source: '60' }, 'a pick from a record kept separate falls back to the default')
})

// The Worker applies `choices` from the frozen reviewed rows; this shared
// table is what both sides are tested against (UI-CONFLICTS-2 lands it).
const PARITY = new URL('../../cloudflare/scripts/fixtures/product-resolve-choices-parity.json', import.meta.url)
await test('parity with the Worker: the Final values and the request for the shared fixture', async () => {
  if (!existsSync(PARITY)) {
    console.log('SKIP parity: cloudflare/scripts/fixtures/product-resolve-choices-parity.json lands with UI-CONFLICTS-2')
    return
  }
  const fixture = JSON.parse(readFileSync(PARITY, 'utf8'))
  const cluster: Cluster = { type: 'name', value: 'fixture', severity: 'similar_name', products: fixture.rows }
  const { adapter, data } = await open(cluster, { view: true, edit: true }, { choices: true })
  const draftOf = (choices: Record<string, any>): Draft => {
    const rowKey: Record<string, string> = { selling_price_usd: 'selling', wholesale_price_usd: 'wholesale' }
    return pick(Object.fromEntries(Object.entries(choices).map(([field, choice]) => [rowKey[field] ?? field,
      'source_id' in choice ? { source: String(choice.source_id) } : { custom: String(choice.custom) }])))
  }
  for (const entry of fixture.cases) {
    const review = await adapter.review(data, draftOf(entry.choices), signal)
    const sent = review.token.choices!
    for (const field of Object.keys(entry.parsed)) assert.deepEqual(sent[field as keyof typeof sent], entry.parsed[field], `${entry.label}: ${field} is sent as the Worker stores it`)
    assert.deepEqual(productResolveFinalValues(entry.parsed, fixture.rows), entry.final, `${entry.label}: the Final values`)
  }
  let invalid = 0
  for (const entry of fixture.invalid) {
    if (Array.isArray(entry.choices)) continue
    const sent = (await adapter.review(data, draftOf(entry.choices), signal)).token.choices!
    for (const [field, choice] of Object.entries(entry.choices)) assert.notDeepEqual(sent[field as keyof typeof sent], choice, `${entry.label}: never sent`)
    invalid += 1
  }
  console.log(`parity: ${fixture.cases.length} cases, ${invalid} invalid never sent`)
})

// Runs on this branch alone too: the shapes the shared table pins (a cleared
// brand, a record with no category or image, a typed price) as Final values.
await test('the Final values follow the Worker rules: blank is null, a record value is copied as stored', () => {
  const rows = CLUSTERS.catalog.products as Record_[]
  assert.deepEqual(productResolveFinalValues({ name: { custom: 'X' }, brand: { custom: '' }, category: { source_id: 62 }, selling_price_usd: { custom: 7.13 }, image: { source_id: 60 }, barcode: { source_id: 60 }, unit: { source_id: 61 } }, rows),
    { name: 'X', brand: null, category: null, selling_price_usd: 7.13, image_path: null, barcode: 'N/A', unit: 'bottle' })
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
  for (const choices of [false, true]) {
    for (const kind of ['leading_zero', 'same_barcode', 'same_name', 'similar_name'] as const) {
      const { adapter, data } = await open(CLUSTERS[kind], { view: true, edit: true }, { choices })
      assert.deepEqual(adapter.blockers!(data, EMPTY), [], kind)
      const review = await adapter.review(data, EMPTY, signal)
      assert.ok(review.changes.length > 0, `${kind}: the confirm shows what changes`)
      for (const change of review.changes) assert.notEqual(change.before, change.after, `${kind}: ${change.label}`)
      assert.ok(!JSON.stringify(review).match(/different|failed/i), `${kind}: ${JSON.stringify(review)}`)
      const ids = CLUSTERS[kind].products.map((entry) => entry.id)
      assert.deepEqual(review.token.steps.map((step) => step.mergeId), ids.filter((id) => id !== Math.min(...ids)))
    }
  }
  const similar = await open(CLUSTERS.similar_name)
  const barcodeChange = (await similar.adapter.review(similar.data, EMPTY, signal)).changes.find((change) => change.label === 'Barcode')
  assert.deepEqual(barcodeChange, { label: 'Barcode', before: '', after: '6923644012345' }, 'a survivor without a barcode takes the real one')
})

await test('N4: cost is hidden without cost view, locked without cost edit, and sent only by an editor', async () => {
  const hidden = await open(CLUSTERS.same_name, {})
  assert.equal(rowOf(hidden.adapter.rows(hidden.data, EMPTY), 'cost'), undefined)
  assert.equal((await hidden.adapter.review(hidden.data, EMPTY, signal)).token.cost, null)

  const viewer = await open(CLUSTERS.same_name, { view: true })
  const locked = rowOf(viewer.adapter.rows(viewer.data, EMPTY), 'cost')
  assert.equal(locked.locked, 'Changing the cost needs the cost edit permission.')
  assert.equal(locked.custom, undefined)
  const typedByViewer: Draft = { selection: { cost: { custom: '1' } }, columns: {} }
  assert.equal(rowOf(viewer.adapter.rows(viewer.data, typedByViewer), 'cost').final.text, '$6', 'a viewer cannot change it: the rule stays')
  assert.equal((await viewer.adapter.review(viewer.data, typedByViewer, signal)).token.cost, null)

  const editor = await open(CLUSTERS.same_name)
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
  const { adapter, data } = await open(CLUSTERS.same_name)
  const stock = rowOf(adapter.rows(data, EMPTY), 'stock')
  assert.deepEqual(stock.cells['11'].options.map((option: { id: string }) => option.id), ['merge', 'write_off'])
  assert.equal(stock.cells['11'].choice, 'merge')
  assert.equal(stock.cells['10'].options, undefined, 'the survivor has nothing to decide')
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

await test('a product kept separate is not merged; only Merge in / Keep separate reads the group again', async () => {
  const { adapter, data } = await open(CLUSTERS.three)
  const separate: Draft = { selection: {}, columns: { '52': { disposition: 'separate' } } }
  assert.deepEqual((await adapter.review(data, separate, signal)).token.steps.map((step) => step.mergeId), [51])
  assert.equal(adapter.reloadWhen!(EMPTY, separate), true, 'the group cost depends on who is in')
  assert.equal(adapter.reloadWhen!(EMPTY, { selection: { record: { source: '51' } }, columns: {} }), false, 'there is no record to pick any more')
  assert.equal(adapter.reloadWhen!(EMPTY, { selection: { cost: { custom: '1' } }, columns: {} }), false)
  const survivorOut: Draft = { selection: {}, columns: { '50': { disposition: 'separate' } } }
  const reread = await adapter.load(signal, survivorOut)
  assert.equal(reread.keeperId, 51, 'keeping the survivor separate hands it to the next lowest id')
  const alone: Draft = { selection: {}, columns: { '51': { disposition: 'separate' }, '52': { disposition: 'separate' } } }
  assert.deepEqual(adapter.blockers!(data, alone), ['Merge in at least two records.'])
})

await test('a blocked product says why before Resolve (older Worker, stock-in session), in the pack\'s words', async () => {
  const { adapter, data } = await open(CLUSTERS.same_name, { view: true, edit: true }, { blocked: { 11: { code: 'stock_session_reversible', operationId: 'S-20260924-0900' } } })
  const [message] = adapter.blockers!(data, EMPTY)
  assert.ok(message.includes('S-20260924-0900'), message)
})

await test('a Worker that settles stock-in sessions: the confirm warns, nothing blocks', async () => {
  const { adapter, data } = await open(CLUSTERS.three, { view: true, edit: true }, { choices: true, settles: ['S-20260924-0900'] })
  assert.deepEqual(adapter.blockers!(data, EMPTY), [])
  const review = await adapter.review(data, EMPTY, signal)
  assert.deepEqual(review.warnings!.filter((warning) => warning.includes('S-20260924-0900')), ['Stock-in session S-20260924-0900 can no longer be undone after this merge.'], 'said once, not once per merged product')
})

await test('apply merges every product one step each, stops where a step fails and Continue resumes there', async () => {
  const { api, calls } = fakeApi(CLUSTERS.three, { failMergeAt: 2, choices: true })
  const written: number[] = []
  const adapter = createProductResolveAdapter({ cluster: CLUSTERS.three, t, canViewCosts: true, canEditCosts: true, canMerge: () => true, onWritten: () => written.push(1), api })
  const data = await adapter.load(signal, EMPTY)
  const review = await adapter.review(data, EMPTY, signal)
  const progress: Array<[number, number]> = []
  await assert.rejects(adapter.apply(review.token, signal, (done, total) => progress.push([done, total])), (error: any) => /network down/.test(error.message) && !adapter.isDefinite(error))
  assert.deepEqual(progress, [[1, 2]])
  assert.equal(written.length, 1, 'the host refreshes after a committed step even though the next failed')
  const result = await adapter.apply(review.token, signal, (done, total) => progress.push([done, total]))
  const merges = calls.filter((call) => call.kind === 'merge').map((call) => call.args)
  assert.deepEqual(merges.map((args) => args[1]), [51, 52, 52], 'the resumed apply re-sends only the step that did not answer')
  assert.deepEqual(merges[0], [50, 51, 'merge', {
    resolve: { requestId: review.token.requestId, reviewedDigest: 'a'.repeat(64), steps: [{ mergeId: 51, stock: 'merge' }, { mergeId: 52 }] },
    choices: review.token.choices,
  }], 'every step carries the frozen group, its stock answers and the same choices')
  assert.deepEqual(merges[1][3], merges[2][3], 'lost responses resend exactly the same receipt identity and choices')
  assert.equal(merges[1][2], undefined, 'a product with no stock needs no answer')
  assert.equal(result.done, 2)
  assert.equal(result.total, 2)
  assert.deepEqual(result.after.map((item) => item.label), ['Name', 'Barcode', 'Cost', 'Selling price', 'Stock', 'Merged products', 'Barcodes kept on the merged records'])
  assert.equal(result.after.find((item) => item.label === 'Barcodes kept on the merged records')!.value, '222222')
})

await test('3.5: a definite refusal is told apart from an unknown outcome, in the pack\'s words, code intact', async () => {
  const cluster = CLUSTERS.same_name
  const refusals: unknown[] = [
    Object.assign(new Error('These products are not a current duplicate group.'), { code: 'product_merge_not_duplicates', status: 409 }),
    Object.assign(new Error('The server could not merge these products. Nothing was changed. Reference: 9f1c-77'), { code: 'merge_failed', status: 409 }),
    Object.assign(new Error('A number is invalid'), { code: 'invalid_merge_numeric', status: 409 }),
    Object.assign(new Error('Server error'), { status: 500, outcome: 'unknown', code: 'write_outcome_unknown' }),
  ]
  const kt = (key: string) => km[key] ?? key
  const api = { preview: fakeApi(cluster).api.preview, merge: async () => { throw refusals.shift() } }
  const adapter = createProductResolveAdapter({ cluster, t: kt, canViewCosts: false, canEditCosts: false, canMerge: () => true, api })
  const data = await adapter.load(signal, EMPTY)
  const review = await adapter.review(data, EMPTY, signal)
  const caught = async () => { try { await adapter.apply(review.token, signal, () => {}) } catch (error) { return error as any } throw new Error('expected a refusal') }
  const stale = await caught()
  assert.deepEqual([stale.code, stale.message, adapter.isStale(stale)], ['product_merge_not_duplicates', km.selected_conflict_product_merge_not_duplicates, true])
  const failedMerge = await caught()
  assert.deepEqual([failedMerge.code, adapter.isStale(failedMerge), adapter.isDefinite(failedMerge), adapter.describe(failedMerge)],
    ['merge_failed', false, true, km.resolve_refusal_merge_failed.replace('{errorId}', '9f1c-77')], 'merge_failed wrote nothing: no Continue, the reference is kept')
  const numeric = await caught()
  assert.deepEqual([adapter.isDefinite(numeric), adapter.describe(numeric)], [true, km.resolve_refusal_invalid_merge_numeric])
  const unknown = await caught()
  assert.deepEqual([adapter.isStale(unknown), adapter.isDefinite(unknown)], [false, false], 'a 5xx may have landed: Continue')
  assert.equal(adapter.isDefinite(Object.assign(new Error('forbidden'), { status: 403 })), true, 'an uncoded 403 (image permission) wrote nothing')
  assert.equal(adapter.isStale(Object.assign(new Error('x'), { code: 'merge_state_conflict' })), true)
  const denied = createProductResolveAdapter({ cluster, t, canViewCosts: false, canEditCosts: false, canMerge: () => false, api })
  await assert.rejects(denied.apply(review.token, signal, () => {}), (error: any) => error.message === 'Access Denied' && denied.isDefinite(error))
})

await test('every key the adapter reads exists in both packs', () => {
  const source = readFileSync(new URL('../src/components/products/productResolveAdapter.ts', import.meta.url), 'utf8')
  const keys = [...source.matchAll(/tr\(t, '([a-z0-9_]+)'/g)].map((match) => match[1])
  assert.ok(keys.length >= 20)
  for (const key of keys) {
    assert.ok(en[key], `en: ${key}`)
    assert.ok(km[key], `km: ${key}`)
  }
  for (const retired of ['resolve_product_kept', 'resolve_follows_kept', 'resolve_product_barcode_hint', 'resolve_cost_hint', 'resolve_selling_hint', 'resolve_stock_hint']) {
    assert.equal(source.includes(retired), false, `${retired} is not read`)
    assert.equal(retired in en || retired in km, false, `${retired} is gone from both packs`)
  }
})

console.log(failed ? `\n${failed} test(s) failed` : '\nall product resolve adapter tests passed')
process.exitCode = failed ? 1 : 0

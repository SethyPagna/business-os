import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

globalThis.window = { localStorage: { getItem: () => null }, sessionStorage: { getItem: () => null }, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout } as any
const { createProductResolveAdapter } = await import('../src/components/products/productResolveAdapter.ts')
const cluster: any = { type: 'name', severity: 'same_name', value: 'Toner', products: [1, 2, 3].map((id) => ({ id, name: 'Toner', brand: 'Brand ' + id, category: 'Skin', unit: 'pcs', barcode: String(id), selling_price_usd: id, wholesale_price_usd: id, cost_price_usd: id, stock_quantity: 0, image_path: null })) }
const signal = new AbortController().signal
const empty = { selection: {}, columns: {} }
let failed = 0
async function test(name: string, run: () => Promise<void>) {
  try { await run(); console.log('PASS ' + name) } catch (error) { failed += 1; console.error('FAIL ' + name, error) }
}
function open(pack: Record<string, string>, canEditProducts: boolean, refusal?: string, canOverridePrices?: boolean) {
  let writes = 0
  const options: any = {
    cluster, t: (key: string) => pack[key] ?? key, canEditProducts, ...(canOverridePrices === undefined ? {} : { canOverridePrices }), canViewCosts: true, canEditCosts: false, canMerge: () => true,
    api: {
      preview: async () => ({ choicesSupported: true, groupProducts: cluster.products, reviewedDigest: 'a'.repeat(64), stockImpact: { totalQuantity: 0, branches: [] }, keeperStock: { totalQuantity: 0, branches: [] } }),
      merge: async () => { writes += 1; if (writes === 2 && refusal) throw Object.assign(new Error('Refused'), { code: refusal, status: refusal === 'access_denied' ? 403 : 409 }); return { keeper: cluster.products[0] } },
    },
  }
  return createProductResolveAdapter(options)
}
for (const language of ['en', 'km']) {
  const pack = JSON.parse(readFileSync(new URL('../src/lang/' + language + '.json', import.meta.url), 'utf8'))
  await test(language + ': full product-edit gates custom rows while source picks remain', async () => {
    const adapter = open(pack, false)
    const data = await adapter.load(signal, empty)
    const rows = adapter.rows(data, empty)
    for (const key of ['name', 'brand', 'category', 'unit']) {
      const row = rows.find((entry) => entry.key === key)!
      assert.equal(row.custom, undefined, key)
      assert.equal(row.locked, undefined, key + ' source choices stay enabled')
    }
    // Owner, 5 Oct 2026 (evening): the merge takes the HIGHEST price by rule; only choosing another price is a product edit.
    // Without it the price rows are locked on the rule's value (record 3 holds the highest price in this fixture).
    for (const key of ['selling', 'wholesale']) {
      const row = rows.find((entry) => entry.key === key)!
      assert.equal(row.custom, undefined, key)
      assert.ok(pack.resolve_price_locked && pack.resolve_price_locked !== 'resolve_price_locked', language + ' pack carries the tooltip')
      assert.equal(row.locked, pack.resolve_price_locked, key + ' is locked with the translated reason')
      assert.equal((row.choice as any)?.source, '3', key + ' sits on the rule value, the highest price')
    }
    const restored = { selection: { name: { custom: 'Unauthorized' }, selling: { custom: '999' }, wholesale: { source: '3' } }, columns: {} }
    const review = await adapter.review(data, restored, signal)
    assert.ok(review.token.choices && Object.values(review.token.choices).every((choice) => !('custom' in choice)))
    assert.deepEqual([review.token.choices!.selling_price_usd, review.token.choices!.wholesale_price_usd], [{ source_id: 3 }, { source_id: 3 }], 'a restored draft cannot pick or type a price: the rule value (the highest) is sent, never refused')
    const editor = open(pack, true)
    assert.equal(editor.rows(await editor.load(signal, empty), empty).filter((row) => row.custom).length, 6)
    const editorRows = editor.rows(await editor.load(signal, empty), empty)
    assert.ok(['selling', 'wholesale'].every((key) => editorRows.find((row) => row.key === key)!.locked === undefined))
  })
  await test(language + ': Edit product without full tier (canOverridePrices false) types names but cannot override the price rule', async () => {
    const adapter = open(pack, true, undefined, false)
    const data = await adapter.load(signal, empty)
    const rows = adapter.rows(data, empty)
    assert.equal(rows.find((row) => row.key === 'name')!.custom !== undefined, true)
    for (const key of ['selling', 'wholesale']) {
      assert.equal(rows.find((row) => row.key === key)!.locked, pack.resolve_price_locked)
      assert.equal(rows.find((row) => row.key === key)!.custom, undefined)
    }
    const review = await adapter.review(data, { selection: { selling: { custom: '999' } }, columns: {} }, signal)
    assert.deepEqual(review.token.choices!.selling_price_usd, { source_id: 3 })
  })
  await test(language + ': an override-capable editor defaults to the highest price and may pick or type another', async () => {
    const adapter = open(pack, true, undefined, true)
    const data = await adapter.load(signal, empty)
    const rows = adapter.rows(data, empty)
    for (const key of ['selling', 'wholesale']) {
      assert.equal(rows.find((row) => row.key === key)!.locked, undefined)
      assert.equal((rows.find((row) => row.key === key)!.choice as any)?.source, '3', key + ' defaults to the highest, not the survivor')
    }
    const picked = await adapter.review(data, { selection: { selling: { source: '2' }, wholesale: { custom: '9.5' } }, columns: {} }, signal)
    assert.deepEqual(picked.token.choices!.selling_price_usd, { source_id: 2 })
    assert.deepEqual(picked.token.choices!.wholesale_price_usd, { custom: 9.5 })
  })
  await test(language + ': the Worker product-edit refusal reads in the operator language, by code', async () => {
    const adapter = open(pack, true, 'product_edit_permission_required')
    const reviewed = await adapter.review(await adapter.load(signal, empty), empty, signal)
    await assert.rejects(adapter.apply(reviewed.token, signal, () => {}), (error: any) => {
      assert.equal(error.message, pack.merge_needs_product_edit)
      assert.equal(error.code, 'product_edit_permission_required')
      return true
    })
  })
  for (const code of ['access_denied', 'merge_conflict_retry', 'merge_case_exceeds_safe_limit', 'merge_state_conflict', 'resolve_plan_budget']) {
    await test(language + ': partial refusal reason excludes whole-request zero-write claim ' + code, async () => {
      const adapter = open(pack, true, code)
      const reviewed = await adapter.review(await adapter.load(signal, empty), empty, signal)
      const progress: number[] = []
      await assert.rejects(adapter.apply(reviewed.token, signal, (done) => progress.push(done)), (error: any) => {
        const partialKey: Record<string, string> = { access_denied: 'resolve_partial_refusal_permission', merge_conflict_retry: 'resolve_partial_refusal_retry', merge_case_exceeds_safe_limit: 'resolve_partial_refusal_too_large', merge_state_conflict: 'resolve_partial_refusal_changed', resolve_plan_budget: 'resolve_partial_refusal_budget' }
        assert.equal(error.message, pack[partialKey[code]])
        const fullKeys = ['resolve_refusal_permission', 'resolve_refusal_retry', 'resolve_refusal_too_large', 'resolve_refusal_changed', 'resolve_plan_budget']
        assert.ok(fullKeys.every((key) => error.message !== pack[key]))
        assert.ok(!/Nothing was saved|No changes were saved/.test(error.message))
        assert.equal(error.status, code === 'access_denied' ? 403 : 409)
        return true
      })
      assert.deepEqual(progress, [1])
    })
  }
}
const host = readFileSync(new URL('../src/components/products/ProductDuplicatesTab.tsx', import.meta.url), 'utf8')
assert.match(host, /const canEditProducts = can \? can\('products', 'edit'\) : false/)
assert.match(host, /createProductResolveAdapter\(\{[\s\S]*?canEditProducts,\s*canOverridePrices,/)
assert.match(host, /const canOverridePrices = canOverrideMergePrice\(user\)/)
process.exitCode = failed ? 1 : 0

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
function open(pack: Record<string, string>, canEditProducts: boolean, refusal?: string) {
  let writes = 0
  const options: any = {
    cluster, t: (key: string) => pack[key] ?? key, canEditProducts, canViewCosts: true, canEditCosts: false, canMerge: () => true,
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
    for (const key of ['name', 'brand', 'category', 'unit', 'selling', 'wholesale']) {
      const row = rows.find((entry) => entry.key === key)!
      assert.equal(row.custom, undefined, key)
      assert.equal(row.locked, undefined, key + ' source choices stay enabled')
    }
    const restored = { selection: { name: { custom: 'Unauthorized' }, selling: { custom: '999' } }, columns: {} }
    const review = await adapter.review(data, restored, signal)
    assert.ok(review.token.choices && Object.values(review.token.choices).every((choice) => !('custom' in choice)))
    const editor = open(pack, true)
    assert.equal(editor.rows(await editor.load(signal, empty), empty).filter((row) => row.custom).length, 6)
  })
  for (const code of ['access_denied', 'merge_conflict_retry', 'merge_case_exceeds_safe_limit', 'merge_state_conflict', 'resolve_plan_budget']) {
    await test(language + ': partial refusal reason excludes whole-request zero-write claim ' + code, async () => {
      const adapter = open(pack, true, code)
      const reviewed = await adapter.review(await adapter.load(signal, empty), empty, signal)
      const progress: number[] = []
      await assert.rejects(adapter.apply(reviewed.token, signal, (done) => progress.push(done)), (error: any) => {
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
process.exitCode = failed ? 1 : 0

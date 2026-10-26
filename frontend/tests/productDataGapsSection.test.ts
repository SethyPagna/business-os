// Products -> Conflicts: unknown-cost, no-barcode and barcode-0 sections (owner, 14-15 Oct 2026; lane 6.0.988).
// The paging state machine is driven for real with controllable loaders (cursor paging, the last-request-wins guard, the error state and
// retry, the step back from an emptied page); the row card is rendered for real; the wiring that has no DOM here is pinned in source.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createDataGapsPager, dataGapsPagerTotal, type DataGapsLoaders } from '../src/utils/productDataGapsPager.ts'

const read = (rel: string) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')
const en = JSON.parse(read('lang/en.json')) as Record<string, string>
const km = JSON.parse(read('lang/km.json')) as Record<string, string>
const tr = (key: string) => en[key]

async function loadRowCard(): Promise<React.ComponentType<any>> {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/components/products/ProductDataGapRowCard.tsx', import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react', 'react-dom'], logLevel: 'silent',
  })
  const module = { exports: {} as { ProductDataGapRowCard: React.ComponentType<any> } }
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  return module.exports.ProductDataGapRowCard
}
const ProductDataGapRowCard = await loadRowCard()

let failures = 0
async function runTest(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failures++; console.error(`FAIL ${name}`); console.error(String((error as Error).stack || error)) }
}

type Row = { id: number; name: string; barcode: string | null; sku: null; brand: null; category: null; stock_quantity: number; image_path: null }
const row = (id: number, over: Partial<Row> = {}): Row => ({ id, name: `Product ${id}`, barcode: '', sku: null, brand: null, category: null, stock_quantity: id, image_path: null, ...over })

// Loaders whose answers the test releases by hand, so ordering is the test's decision, not the scheduler's.
function controlled() {
  const calls: Array<{ kind: string; after: number | null; resolve: (page: any) => void; reject: (error: Error) => void }> = []
  const loaders: DataGapsLoaders = {
    fetchPage: (kind, after) => new Promise((resolve, reject) => { calls.push({ kind, after, resolve, reject }) }),
    fetchCounts: async () => ({ unknown_cost: 45, empty_barcode: 3, placeholder_barcode: 0 }),
  }
  return { calls, loaders }
}
const page = (ids: number[], nextAfter: number | null) => ({ items: ids.map((id) => row(id)), has_more: nextAfter !== null, next_after: nextAfter })
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

await runTest('paging moves one page at a time with the cursor each page started from, and ignores a jump it cannot reach', async () => {
  const { calls, loaders } = controlled()
  const pager = createDataGapsPager(loaders, 'unknown_cost')
  const started = pager.start()
  assert.deepEqual(calls.map((c) => [c.kind, c.after]), [['unknown_cost', null]])
  calls[0].resolve(page([1, 2], 2)); await started
  assert.deepEqual(pager.getState().rows.map((r) => r.id), [1, 2])
  assert.equal(pager.getState().hasMore, true)
  void pager.goTo(3); await settle(); assert.equal(calls.length, 1, 'a jump over the next page makes no request')
  const next = pager.goTo(2)
  assert.deepEqual([calls[1].kind, calls[1].after], ['unknown_cost', 2], 'page 2 is read after the last id of page 1')
  calls[1].resolve(page([3, 4], 4)); await next
  assert.equal(pager.getState().page, 2)
  const next2 = pager.goTo(3)
  assert.equal(calls[2].after, 4)
  calls[2].resolve(page([5], null)); await next2
  assert.equal(pager.getState().hasMore, false)
  void pager.goTo(4); await settle(); assert.equal(calls.length, 3, 'no next page after the last')
  const back = pager.goTo(2)
  assert.equal(calls[3].after, 2, 'Previous re-reads page 2 from the cursor page 2 started at, not from page 3')
  calls[3].resolve(page([3, 4], 4)); await back
  assert.deepEqual(pager.getState().rows.map((r) => r.id), [3, 4])
  assert.equal(pager.getState().page, 2)
  const first = pager.goTo(1)
  assert.equal(calls[4].after, null)
  calls[4].resolve(page([1, 2], 2)); await first
  pager.dispose()
})

await runTest('the last request wins: a slow answer for a kind the user already left never lands', async () => {
  const { calls, loaders } = controlled()
  const pager = createDataGapsPager(loaders, 'unknown_cost')
  const slow = pager.start()
  const fast = pager.setKind('empty_barcode')
  calls[1].resolve(page([10], null)); await fast
  calls[0].resolve(page([99], null)); await slow
  assert.equal(pager.getState().kind, 'empty_barcode')
  assert.deepEqual(pager.getState().rows.map((r) => r.id), [10], 'the stale unknown-cost page was dropped')
  assert.equal(pager.getState().status, 'ready')
  pager.dispose()
})

await runTest('a failed read is an error state, not an endless Loading; retry repeats the same page; a stale failure is ignored', async () => {
  const { calls, loaders } = controlled()
  const pager = createDataGapsPager(loaders, 'empty_barcode')
  const first = pager.start()
  assert.equal(pager.getState().status, 'loading')
  calls[0].reject(new Error('boom')); await first
  assert.equal(pager.getState().status, 'error')
  assert.deepEqual(pager.getState().rows, [])
  const again = pager.retry()
  assert.equal(pager.getState().status, 'loading')
  assert.deepEqual([calls[1].kind, calls[1].after], ['empty_barcode', null])
  calls[1].resolve(page([7], null)); await again
  assert.equal(pager.getState().status, 'ready')
  const stale = pager.reload(); const fresh = pager.reload()
  calls[2].reject(new Error('late failure')); calls[3].resolve(page([8], null)); await Promise.all([stale, fresh])
  assert.equal(pager.getState().status, 'ready', 'an older failure does not overwrite a newer success')
  assert.deepEqual(pager.getState().rows.map((r) => r.id), [8])
  pager.dispose()
})

await runTest('reload re-reads the current page, and when that page was emptied it steps back instead of showing an empty list', async () => {
  const { calls, loaders } = controlled()
  const pager = createDataGapsPager(loaders, 'unknown_cost')
  const a = pager.start(); calls[0].resolve(page([1], 1)); await a
  const b = pager.goTo(2); calls[1].resolve(page([2], null)); await b
  assert.equal(pager.getState().page, 2)
  const reloading = pager.reload()
  assert.equal(calls[2].after, 1, 'the same cursor page 2 was read with')
  calls[2].resolve({ items: [], has_more: false, next_after: null })
  await settle()
  assert.equal(calls[3].after, null, 'page 2 came back empty, so page 1 is read')
  calls[3].resolve(page([1], null)); await reloading
  assert.equal(pager.getState().page, 1)
  assert.deepEqual(pager.getState().rows.map((r) => r.id), [1])
  pager.dispose()
})

await runTest('counts arrive with the first read, a failed count read is silent, and the pager total covers what is on screen', async () => {
  const { calls, loaders } = controlled()
  const pager = createDataGapsPager(loaders, 'unknown_cost')
  const first = pager.start(); calls[0].resolve(page([1, 2], 2)); await first; await settle()
  assert.equal(pager.getState().counts?.unknown_cost, 45)
  assert.equal(dataGapsPagerTotal(pager.getState(), 20), 45)
  assert.equal(dataGapsPagerTotal({ ...pager.getState(), counts: { unknown_cost: 1, empty_barcode: 0, placeholder_barcode: 0 } }, 20), 3, 'a stale small count never hides the next page')
  pager.dispose()
  const failing = createDataGapsPager({ ...loaders, fetchCounts: async () => { throw new Error('nope') } }, 'unknown_cost')
  const p = failing.start(); await settle(); calls[calls.length - 1].resolve(page([1], null)); await p
  assert.equal(failing.getState().counts, null)
  assert.equal(failing.getState().status, 'ready')
  failing.dispose()
})

const card = (kind: string, over = {}, handlers: Record<string, unknown> = { onOpen: () => {}, onConfirmZero: () => {}, onMarkNoBarcode: () => {} }) =>
  renderToStaticMarkup(React.createElement(ProductDataGapRowCard, { row: row(41, { barcode: '', ...over }), kind, t: tr, ...handlers }))

await runTest('the unknown-cost row states every reason with the conflict triangle and offers Confirm $0 only for an unconfirmed $0', () => {
  const html = card('unknown_cost', { reasons: ['catalog_unknown', 'lots_unknown', 'held_unknown', 'zero_unconfirmed'], unknown_lot_count: 2, unknown_units: 9, held_unknown_count: 1, held_unknown_units: 3 })
  assert.ok(html.includes(en.conflict_unknown_cost_catalog))
  assert.ok(html.includes('2 received date(s), 9 pcs with unknown cost'))
  assert.ok(html.includes('3 pcs held as damaged with unknown cost'))
  assert.ok(html.includes(en.cost_zero_unconfirmed))
  assert.match(html, /lucide-triangle-alert|lucide-alert-triangle/)
  assert.match(html, /data-product-data-gap-confirm-zero/)
  assert.doesNotMatch(html, /data-product-data-gap-no-barcode/)
  assert.doesNotMatch(card('unknown_cost', { reasons: ['catalog_unknown'] }), /data-product-data-gap-confirm-zero/, 'a NULL cost has nothing to confirm')
})

await runTest('barcode rows offer the no-barcode mark, each with a translated tooltip; without the handler no decision button is drawn', () => {
  for (const kind of ['empty_barcode', 'placeholder_barcode']) {
    const html = card(kind, kind === 'placeholder_barcode' ? { barcode: '000' } : {})
    assert.match(html, /data-product-data-gap-no-barcode/)
    assert.ok(html.includes(`title="${en.conflict_mark_no_barcode}"`))
    assert.doesNotMatch(html, /data-product-data-gap-confirm-zero/)
    assert.doesNotMatch(card(kind, {}, { onOpen: () => {} }), /data-product-data-gap-no-barcode/)
  }
  assert.ok(card('placeholder_barcode', { barcode: '000' }).includes('000'), 'a placeholder barcode is shown so the owner sees what it is')
  assert.ok(card('placeholder_barcode').includes(en.conflict_type_placeholder_barcode))
})

await runTest('the row is inert without an open handler', () => {
  assert.match(card('empty_barcode', {}, {}), /disabled=""/)
})

await runTest('wiring: the tab mounts the section with its Refresh token, the section follows products sync, the transport hits the gated routes', () => {
  const section = read('components/products/ProductDataGapsSection.tsx')
  const tab = read('components/products/ProductDuplicatesTab.tsx')
  assert.match(tab, /<ProductDataGapsSection t=\{t\} notify=\{notify\} onPreviewProduct=\{onPreviewProduct\} refreshToken=\{gapsRefreshToken\} \/>/)
  assert.match(tab, /setGapsRefreshToken\(\(token\) => token \+ 1\); void load\(\)/)
  assert.doesNotMatch(section, /refresh-cw/, 'no second Refresh button beside the tab title action')
  assert.match(section, /syncChannel\?\.channel === 'products'/, 'an edit saved from the preview refreshes the list')
  assert.match(section, /<PaginationControls/, 'the shared Previous/Next pager, not a Load more button')
  assert.doesNotMatch(section, /load_more/)
  assert.match(section, /canViewAcquisitionCosts\(user\)/, 'the unknown-cost chip is for roles that may see costs')
  const transport = read('api/productWriteTransport.ts')
  assert.match(transport, /\/api\/products\/data-gaps\?\$\{query\}/)
  assert.match(transport, /\/api\/products\/data-gaps\/counts/)
  assert.match(transport, /\/api\/products\/data-gaps\/marks/)
})

await runTest('every new string exists in both packs and Khmer is not an English placeholder', () => {
  const keys = ['product_data_gaps_none_unknown_cost', 'product_data_gaps_none_empty_barcode', 'product_data_gaps_none_placeholder_barcode', 'product_data_gaps_load_failed',
    'product_data_gaps_save_failed', 'conflict_type_unknown_cost', 'conflict_type_empty_barcode', 'conflict_type_placeholder_barcode', 'conflict_unknown_cost_catalog',
    'conflict_confirm_zero', 'conflict_confirm_zero_message', 'conflict_zero_confirmed_state', 'conflict_mark_no_barcode', 'conflict_mark_no_barcode_message', 'conflict_no_barcode_marked_state']
  for (const key of keys) {
    assert.ok(en[key], `${key} en`)
    assert.ok(km[key], `${key} km`)
    assert.notEqual(km[key], en[key], `${key} km is not English`)
    assert.match(km[key], /[ក-៿]/, `${key} km has Khmer`)
  }
})

if (failures) process.exit(1)

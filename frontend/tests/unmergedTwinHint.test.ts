// Round 3 review of lane no-folded-duplicates (R2-3, R2-4, R2-8): the Duplicate tag's tooltip follows the merge permission,
// the Transfer twin date is the shop day, and the Transfer group header says "records" for twins. Behaviour is pinned mounted
// in noFoldedSurfaces.test.ts; this file pins the pure parts and that every tag site goes through the one helper.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { unmergedTwinHint } from '../src/components/products/unmergedTwinHint.ts'
import { fmtDate } from '../src/utils/formatters.ts'

const src = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const packs = { en: JSON.parse(src('lang/en.json')), km: JSON.parse(src('lang/km.json')) } as Record<string, Record<string, string>>

for (const lang of ['en', 'km']) {
  const t = (key: string) => packs[lang][key]
  const withMerge = unmergedTwinHint(t, true)
  const without = unmergedTwinHint(t, false)
  assert.equal(withMerge, packs[lang].product_twin_row_hint)
  assert.equal(without, packs[lang].product_twin_row_hint_ask)
  assert.notEqual(withMerge, without, `${lang}: the two tooltips differ`)
  assert.ok(packs[lang].transfer_group_record_count.includes('{n}'), `${lang}: record count keeps its {n}`)
  assert.notEqual(packs[lang].transfer_group_record_count, packs[lang].transfer_group_variant_count)
}
assert.equal(packs.en.product_twin_row_hint_ask, 'Same name and barcode as another product. Ask a manager to merge them.')
assert.match(packs.km.product_twin_row_hint_ask, /[\u1780-\u17FF]/, 'km tooltip is Khmer')
assert.match(packs.km.transfer_group_record_count, /[\u1780-\u17FF]/, 'km record count is Khmer')
assert.ok(!/Conflicts|ទំនាស់ទិន្នន័យ/.test(unmergedTwinHint((key) => packs.km[key], false)), 'the no-permission tooltip names no tab the role cannot open')

// R2-3: 23:30 UTC on 1 Sep is 06:30 on 2 Sep in the shop (UTC+7).
assert.equal(fmtDate('2026-09-01 23:30:00'), '02/09/2026')
assert.equal(fmtDate('2026-09-01T23:30:00Z'), '02/09/2026')

for (const file of ['components/products/Products.tsx', 'components/inventory/InventoryProductsSurface.tsx', 'components/branches/TransferModal.tsx']) {
  const text = src(file)
  assert.ok(text.includes('unmergedTwinHint('), `${file} builds the tag tooltip with the shared helper`)
  assert.ok(!text.includes("hint={t('product_twin_row_hint')") && !text.includes("hint={tr('product_twin_row_hint'"), `${file} no longer hard-wires the Conflicts-tab tooltip`)
}
assert.ok(!src('components/branches/TransferModal.tsx').includes('fmtDateOnly(product.created_at)'), 'the twin date is not the UTC slice')

console.log('PASS unmerged twin hint: permission-aware tooltip in both packs, shop-day date, record-count header key; 3 call sites use the helper')

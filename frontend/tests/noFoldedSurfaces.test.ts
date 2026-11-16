// Owner, 16 Nov 2026: "if the duplicate row is not merged then show it as separate" and "show them next to each other".
// The shared helper (noFoldedDuplicates.test.ts) and the Inventory list are pinned elsewhere. This file pins the three other
// staff surfaces that render one row per record, MOUNTED for real with two unmerged duplicates (same name, same barcode, stock
// 8 and 50, a real variant between them by id):
//   * the Products list (a name group of twins starts open, one row per record, the figure of each),
//   * the Branches stock grid (one card per record, each with its own figure),
//   * the Transfer multi-picker (one checkbox row per record, each selectable, twins told apart by a Duplicate tag and the date).
// The same probes then run against a copy of the app whose grouping rows are folded again (rows: mergeSameDetailRows(items)): every
// surface must turn red, which proves the probes can see a fold.
import assert from 'node:assert/strict'
import { createHarness } from './mountedComponentHarness.ts'
import { writeTransferDraft, transferDraftKey } from '../src/utils/minimizedWork.ts'

const USER = { id: 7, organization_id: 1, name: 'Owner', role_code: 'admin', permissions: { all: true }, role_permissions: { all: true } }

const base = { unit: 'pcs', selling_price_usd: 5, selling_price_khr: 20500, applied_price_usd: 5, applied_price_khr: 20500, is_active: 1, status: 'active', category: 'Care', brand: 'Acme', images: [], batches: [], batch_count: 0, low_stock_threshold: 10, out_of_stock_threshold: 0 }
const rec = (id: number, name: string, barcode: string, qty: number, created: string, time = '00:00:00') => ({
  ...base, id, name, barcode, stock: qty, stock_quantity: qty, branch_quantity: qty, created_at: `${created} ${time}`, updated_at: `${created} ${time}`,
  branch_stock: [{ branch_id: 1, branch_name: 'LC Store', quantity: qty }],
})
// Twins 31 (8 left) and 33 (50 left); the variant 32 sits between them by id and has its own barcode.
// 23:30 UTC on 1 Sep is already 2 Sep in the shop (UTC+7): the picker must show the shop's date, not the UTC slice (R2-3).
const TWIN_A = rec(31, 'Glow Serum', '8851234567890', 8, '2026-09-01', '23:30:00')
const VARIANT = rec(32, 'Glow Serum', '8859999999999', 5, '2026-09-02')
const TWIN_B = rec(33, 'Glow Serum', '8851234567890', 50, '2026-10-05')
const OTHER = rec(34, 'Aloe Gel', '8850000000011', 30, '2026-09-03')
const CATALOG = [TWIN_A, VARIANT, TWIN_B, OTHER]

const FOLD_BACK = (key: string, code: string): string => key === 'utils/productGrouping.ts' ? code.replace('rows: ownRows(items),', 'rows: mergeSameDetailRows(items),') : code
const app = (page: string) => ({
  t: (key: string) => key, notify: () => {}, user: USER, authReady: true, page, settings: {}, language: 'en',
  fmtUSD: (value: number) => `$${value}`, fmtKHR: (value: number) => `${value}`, usdSymbol: '$', khrSymbol: 'R', exchangeRate: 4100,
  can: () => true, hasPermission: () => true, getPermissionTier: () => 'all', canWriteToServer: true, navigateTo: () => {},
})
const unique = (values: string[]): string[] => [...new Set(values)]
const figure = (text: string, own: string): boolean => new RegExp(`(^|[^\\d.])${own}([^\\d.]|$)`).test(text)

type Harness = Awaited<ReturnType<typeof createHarness>>
const probes: Record<string, (harness: Harness) => Promise<void>> = {
  async 'Products list'(harness) {
    const page = await harness.mount({
      component: '../tests/productsSyncHost.tsx', app: app('products'),
      doubles: {
        'api/productReadTransport.ts': {
          searchProducts: async () => ({ items: CATALOG, total: CATALOG.length, page: 1, pageSize: 50, totalPages: 1, promotion_rules: [] }),
          getProductFilters: async () => ({ brands: [], categories: [], suppliers: [], initials: [] }),
        },
        'api/productWriteTransport.ts': { getPossiblySameProducts: async () => ({ clusters: [] }) },
        'api/damagedLotsTransport.ts': { getTaggedLots: async () => ({ items: [] }) },
      },
    })
    try {
      await page.settle()
      const rows = page.findAll((node) => node.getAttribute('data-product-jump-id') !== null && node.getAttribute('data-clickable') === 'true')
      const ids = unique(rows.map((node) => String(node.getAttribute('data-product-jump-id')))).filter((id) => ['31', '32', '33'].includes(id))
      // The group holds twins, so it starts open (owner ruling): one row per record, no click needed.
      assert.deepEqual([...ids].sort(), ['31', '32', '33'], `one row per record (31, 32, 33), got ${ids}`)
      assert.equal(Math.abs(ids.indexOf('31') - ids.indexOf('33')), 1, `the twins sit next to each other: ${ids}`)
      for (const [id, own] of [['31', '8'], ['33', '50']]) {
        const row = rows.find((node) => node.getAttribute('data-product-jump-id') === id)!
        assert.ok(figure(row.textContent, own), `row ${id} shows its own figure ${own}: "${row.textContent.slice(0, 160)}"`)
        assert.ok(!figure(row.textContent, '58'), `row ${id} does not show the folded sum 58`)
      }
    } finally { await page.unmount() }
  },
}

const BRANCHES = [
  { id: 1, name: 'LC Store', canonical_key: 'shop', role: 'shop', is_active: 1, is_default: 1, successor_branch_id: null },
  { id: 2, name: 'Warehouse', canonical_key: 'warehouse', role: 'warehouse', is_active: 1, is_default: 0, successor_branch_id: null },
]
probes['Branches stock grid'] = async (harness) => {
  const page = await harness.mount({
    component: 'components/branches/Branches.tsx', props: {}, app: { ...app('branches'), khrToUsd: (value: number) => value / 4000, usdToKhr: (value: number) => value * 4000, displayCurrency: 'USD' },
    doubles: {
      'api/branchTransport.ts': {
        getBranches: async () => [BRANCHES[0]], getTransfers: async () => ({ transfers: [], total: 0 }),
        getBranchSummary: async () => ({ branch_count: 1, total_products: 4, stock_value_usd: 10 }),
        getBranchStock: async () => ({ items: CATALOG, page: 1, pageSize: 20, total: 4, totalPages: 1 }),
      },
    },
  })
  try {
    await page.settle()
    const toggle = page.findAll((node) => node.getAttribute('aria-expanded') !== null && node.textContent.includes('LC Store'))[0]
    assert.ok(toggle, 'the branch row is there')
    await page.click(toggle)
    await page.settle()
    const cards = page.findAll((node) => String(node.className || '').includes('border-l-4')).map((node) => node.textContent)
    const glow = cards.filter((text) => text.startsWith('Glow Serum'))
    assert.equal(glow.length, 3, `one card per record of Glow Serum (31, 32, 33), got ${JSON.stringify(cards)}`)
    const at = (own: string) => glow.findIndex((text) => figure(text, own))
    assert.ok(at('8') >= 0 && at('50') >= 0 && at('5') >= 0, `each record shows its own figure 8, 50 and 5: ${JSON.stringify(glow)}`)
    assert.ok(!glow.some((text) => figure(text, '58')), 'no card shows the folded sum 58')
    assert.equal(Math.abs(at('8') - at('50')), 1, `the twins (8 and 50) sit next to each other: ${JSON.stringify(glow)}`)
  } finally { await page.unmount() }
}
const transferProbe = (can: (page: string, action?: string) => boolean, wantHint: string) => async (harness: Harness) => {
  assert.ok(writeTransferDraft('branch_transfer', USER.id, transferDraftKey('branch_transfer'), { fromBranch: '1', toBranch: '2', search: '', reason: '', selectedQuantities: {}, showAllProducts: true, showSelectedOnly: false }), 'the draft that opens the picker on the source branch was stored')
  const page = await harness.mount({
    component: 'components/branches/TransferModal.tsx', props: { branches: BRANCHES, onClose() {}, onDone() {}, user: USER, notify() {} }, app: { ...app('branches'), can, khrToUsd: (value: number) => value / 4000, usdToKhr: (value: number) => value * 4000, displayCurrency: 'USD' },
    doubles: { 'api/branchTransport.ts': { getBranchStock: async () => ({ items: CATALOG, page: 1, pageSize: 20, total: 4, totalPages: 1 }) } },
  })
  try {
    await page.settle({ waitingFor: 'the picker rows', until: () => page.text().includes('Glow Serum') })
    const boxes = page.findAll((node) => node.tagName === 'INPUT' && node.getAttribute('type') === 'checkbox' && node.getAttribute('aria-label') === 'Glow Serum')
    assert.equal(boxes.length, 3, 'one selectable checkbox row per Glow Serum record (31, 32, 33): a folded twin had none')
    const rows = boxes.map((box) => box.parentElement!.textContent)
    const at = (own: string) => rows.findIndex((text) => text.includes('available: ' + own + ' '))
    assert.ok(at('8') >= 0 && at('50') >= 0 && at('5') >= 0, `each record shows its own available figure 8, 50 and 5: ${JSON.stringify(rows)}`)
    assert.equal(Math.abs(at('8') - at('50')), 1, `the twins sit next to each other: ${JSON.stringify(rows)}`)
    // F9: the two twin rows are told apart by a Duplicate tag and the date their record was created; the variant has neither.
    for (const [own, date] of [['8', '02/09/2026'], ['50', '05/10/2026']]) {
      assert.ok(rows[at(own)].includes('product_duplicate_badge') && rows[at(own)].includes(date), `the twin with ${own} carries the Duplicate tag and its date ${date}: ${rows[at(own)]}`)
    }
    assert.ok(!rows[at('5')].includes('product_duplicate_badge') && !rows[at('5')].includes('/2026'), `the variant carries neither: ${rows[at('5')]}`)
    assert.notEqual(rows[at('8')], rows[at('50')], 'the twin rows no longer read the same')
    assert.ok(!rows[at('8')].includes('01/09/2026'), 'the UTC day is not shown')
    // R2-4: the tag points to the Conflicts tab only for a role that can open it; the group header counts records, not variants.
    const tags = page.findAll((node) => node.getAttribute('data-unmerged-twin') === 'true')
    assert.equal(tags.length, 2, 'both twins are tagged')
    for (const tag of tags) assert.equal(tag.getAttribute('title'), wantHint, 'the tag tooltip follows the merge permission')
    const header = page.text()
    assert.ok(header.includes('transfer_group_record_count') && !header.includes('transfer_group_variant_count'), 'a group holding twins counts records, not variants')
  } finally { await page.unmount() }
}

probes['Transfer multi-picker'] = transferProbe(() => true, 'product_twin_row_hint')
probes['Transfer multi-picker without merge permission'] = transferProbe((_page, action) => action !== 'merge_duplicates', 'product_twin_row_hint_ask')

let failed = 0
const real = await createHarness({ localStorage: { businessos_user: JSON.stringify(USER) } })
;(globalThis as unknown as { fetch: unknown }).fetch = async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
for (const [name, probe] of Object.entries(probes)) {
  try { await probe(real); console.log(`PASS ${name}: one row per record, each with its own figure`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}
await real.close()
const folded = await createHarness({ localStorage: { businessos_user: JSON.stringify(USER) }, mutateSource: FOLD_BACK })
for (const [name, probe] of Object.entries(probes)) {
  let survived = false
  try { await probe(folded); survived = true } catch { /* red, as required */ }
  if (survived) { failed += 1; console.error(`FAIL ${name}: a re-introduced fold went unnoticed (mutant survived)`) } else console.log(`PASS ${name}: a re-introduced fold turns the probe red`)
}
await folded.close()
// F9 mutants: the picker without the twin's date, and without its Duplicate tag, reads the two twins alike again: its probe must go red.
for (const [name, from, to] of [
  ['no creation date on a twin row', '{product.__unmergedTwin && product.created_at ? (', '{false ? ('],
  ['tooltip ignores the merge permission', "hint={unmergedTwinHint(t, can('products', 'merge_duplicates'))}", "hint={unmergedTwinHint(t, true)}"],
  ['date from the UTC slice', '{fmtDate(product.created_at)}', '{String(product.created_at).slice(8, 10) + "/" + String(product.created_at).slice(5, 7) + "/" + String(product.created_at).slice(0, 4)}'],
  ['header counts variants for twins', "(group.rows.some((row: any) => row.__unmergedTwin) ? (t('transfer_group_record_count') || '{n} records') : (t('transfer_group_variant_count') || '{n} variants'))", "(t('transfer_group_variant_count') || '{n} variants')"],
  ['no Duplicate tag on a twin row', '{product.__unmergedTwin ? <UnmergedTwinTag', '{false ? <UnmergedTwinTag'],
]) {
  const mutant = await createHarness({ localStorage: { businessos_user: JSON.stringify(USER) }, mutateSource: (key, code) => {
    if (key !== 'components/branches/TransferModal.tsx') return code
    assert.ok(code.includes(from), `mutant "${name}" no longer matches the source (stale mutant)`)
    return code.replace(from, to)
  } })
  let survived = false
  try { await probes['Transfer multi-picker'](mutant); await probes['Transfer multi-picker without merge permission'](mutant); survived = true } catch { /* red, as required */ }
  if (survived) { failed += 1; console.error(`FAIL Transfer multi-picker: mutant survived: ${name}`) } else console.log(`PASS Transfer multi-picker: mutant killed: ${name}`)
  await mutant.close()
}
if (failed) process.exit(1)

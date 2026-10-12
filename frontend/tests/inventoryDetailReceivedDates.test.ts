// Inventory > product detail > Received dates (owner ruling, 12 Oct 2026:
// newest first, dd/mm/yyyy, nothing silently capped).
//
// The section used to read `product.batches`, but no product read attaches it:
// the Worker's list reads ship only the scalar `batch_count` (lib/productBatches.ts
// attachBatchCounts, "the detail view loads them on demand") and /api/products
// never parses `include=batches`. So the section never rendered and the
// "Received dates" tile read 0. The modal now loads the product's lots when it
// opens, through the batches transport (GET /api/batches is per branch, so one
// read per branch the product has a stock line at, merged by lot id).
import assert from 'node:assert/strict'
import { createHarness } from './mountedComponentHarness.ts'
import { mergeBranchLots } from '../src/utils/productBatches.ts'

type Lot = { id: number; lot_code: string | null; received_at: string | null; expiry_date: string | null; is_active: number; quantity: number; batch_number: number }
const lot = (id: number, day: string, quantity: number): Lot => ({ id, lot_code: null, received_at: `${day} 03:00:00`, expiry_date: null, is_active: 1, quantity, batch_number: id })

// Pure merge: GET /api/batches answers per branch, so a lot held at two branches arrives twice.
{
  const merged = mergeBranchLots([
    [lot(1, '2026-07-01', 4), lot(2, '2026-08-01', 0)],
    [lot(1, '2026-07-01', 3), lot(3, '2026-09-01', 5)],
  ])
  assert.deepEqual(merged.map((entry) => [entry.id, entry.quantity]), [[1, 7], [2, 0], [3, 5]], 'quantities of one lot add up across branches; the sold-out lot stays')
  assert.deepEqual(mergeBranchLots([]), [])
  console.log('PASS mergeBranchLots adds one lot\'s quantity across branches')
}

// The mounted surface runs in the harness's own module graph, so the server the actor scope reads is
// switched through a double of httpState (observed), not by importing the module natively here.
let serverUrl = ''
const harness = await createHarness({ observe: ['api/httpState.ts'] })
try {
  const app = {
    t: (key: string) => key,
    user: { id: 1, role_code: 'admin', role_permissions: { all: true } },
    getPermissionTier: () => 'none',
    notify() {},
  }
  const noop = () => {}
  const base = {
    onClose: noop, fmtUSD: (value: number) => `$${value}`, fmtKHR: (value: number) => `${value}៛`, t: () => undefined,
  }
  const reads: Array<[number, number]> = []
  let serve: (productId: number, branchId: number) => Promise<{ batches: Lot[] }> = async () => ({ batches: [] })
  const doubles = { 'api/httpState.ts': { getSyncServerUrl: () => serverUrl }, 'api/batchesTransport.ts': { getProductBatches: async (productId: number, branchId: number) => { reads.push([Number(productId), Number(branchId)]); return serve(Number(productId), Number(branchId)) } } }
  // A product as the list reads serve it: a scalar batch_count and NO batches array.
  const listRow = (extra: Record<string, unknown> = {}) => ({
    id: 7, name: 'Synthetic serum', unit: 'pcs', stock_quantity: 12, batch_count: 3, selling_price_usd: 2,
    branch_stock: [{ branch_id: 1, branch_name: 'LC Store', branch_active: 1, quantity: 12 }],
    ...extra,
  })
  const labelsIn = (text: string, labels: string[]) => labels.map((label) => ({ label, at: text.indexOf(label) })).filter((entry) => entry.at >= 0).sort((a, b) => a.at - b.at).map((entry) => entry.label)

  // 1. The section renders from the loaded lots, newest first, dd/mm/yyyy, sold-out lots after those on hand.
  serve = async () => ({ batches: [lot(11, '2026-07-01', 4), lot(12, '2026-08-15', 0), lot(13, '2026-09-20', 6), lot(14, '2026-10-05', 2)] })
  const surface = await harness.mount({ component: 'components/inventory/ProductDetailModal.tsx', props: { ...base, product: listRow() }, app, doubles })
  await surface.waitFor(() => surface.text().includes('05/10/2026'), 'the received dates')
  assert.deepEqual(reads, [[7, 1]], 'one read for the one branch the product has a stock line at')
  assert.deepEqual(
    labelsIn(surface.text(), ['01/07/2026', '15/08/2026', '20/09/2026', '05/10/2026']),
    ['05/10/2026', '20/09/2026', '01/07/2026', '15/08/2026'],
    'on hand newest first, then the sold-out lot',
  )
  assert.ok(!surface.text().includes('2026-10-05'), 'dates are dd/mm/yyyy, never ISO')
  const quantities = surface.findAll((node) => node.tagName === 'SPAN' && /^\d+ pcs$/.test(node.textContent)).map((node) => node.textContent)
  assert.deepEqual(quantities.slice(-4), ['2 pcs', '6 pcs', '4 pcs', '0 pcs'], 'each lot shows its quantity with the unit, in list order')
  await surface.unmount()
  console.log('PASS the received-date list loads on open and renders newest first in dd/mm/yyyy')

  // 2. More than the first screenful: nothing is silently dropped; "Show more" reveals the rest.
  reads.length = 0
  serve = async () => ({ batches: Array.from({ length: 12 }, (_, index) => lot(100 + index, `2026-0${1 + (index % 9)}-${String(10 + index).padStart(2, '0')}`, 1)) })
  const many = await harness.mount({ component: 'components/inventory/ProductDetailModal.tsx', props: { ...base, product: listRow({ id: 8, batch_count: 12 }) }, app, doubles })
  await many.waitFor(() => /\d\d\/\d\d\/2026/.test(many.text()), 'the first received dates')
  const shownBefore = (many.text().match(/\d\d\/\d\d\/2026/g) || []).length
  assert.ok(shownBefore >= 1 && shownBefore < 12, `the first screenful is shorter than the list (${shownBefore} of 12)`)
  await many.click(many.button(/Show more/))
  const shownAfter = (many.text().match(/\d\d\/\d\d\/2026/g) || []).length
  assert.equal(shownAfter, 12, 'Show more reveals every lot, none is capped away')
  await many.unmount()
  console.log('PASS a long list is paged with Show more, not capped')

  // 3. Two branches: one read each, a lot held at both adds up, the tile counts lots.
  reads.length = 0
  serve = async (_product, branchId) => ({ batches: branchId === 1 ? [lot(21, '2026-07-01', 4)] : [lot(21, '2026-07-01', 3), lot(22, '2026-09-01', 5)] })
  const two = await harness.mount({
    component: 'components/inventory/ProductDetailModal.tsx',
    props: { ...base, product: listRow({ id: 9, branch_stock: [
      { branch_id: 1, branch_name: 'Warehouse', branch_active: 1, quantity: 7 },
      { branch_id: 2, branch_name: 'Shop', branch_active: 1, quantity: 5 },
    ] }) },
    app, doubles,
  })
  await two.waitFor(() => two.text().includes('01/09/2026'), 'both branches\' lots')
  assert.deepEqual([...reads].sort(), [[9, 1], [9, 2]], 'one read per branch with a stock line')
  assert.equal((two.text().match(/01\/07\/2026/g) || []).length, 1, 'the shared lot is listed once')
  assert.ok(/7\s*pcs/.test(two.text()), 'its quantity is the sum over both branches')
  await two.unmount()
  console.log('PASS lots held at two branches are read per branch and merged')

  // 4. A late answer for the product that was closed is dropped.
  reads.length = 0
  let releaseSlow!: () => void
  const slow = new Promise<void>((resolve) => { releaseSlow = resolve })
  serve = async (productId) => {
    if (productId === 31) { await slow; return { batches: [lot(311, '2026-06-06', 9)] } }
    return { batches: [lot(321, '2026-09-09', 2)] }
  }
  const switching = await harness.mount({ component: 'components/inventory/ProductDetailModal.tsx', props: { ...base, product: listRow({ id: 31 }) }, app, doubles })
  await switching.render({ ...base, product: listRow({ id: 32 }) })
  await switching.waitFor(() => switching.text().includes('09/09/2026'), 'the second product\'s lots')
  releaseSlow()
  await switching.settle()
  assert.ok(!switching.text().includes('06/06/2026'), 'the first product\'s late answer never shows under the second product')
  assert.ok(switching.text().includes('09/09/2026'))
  await switching.unmount()
  console.log('PASS a late response for a previous product is dropped')

  // 5. An answer that lands after the account or server changed is dropped.
  reads.length = 0
  let releaseAccount!: () => void
  const accountGate = new Promise<void>((resolve) => { releaseAccount = resolve })
  serve = async () => { await accountGate; return { batches: [lot(41, '2026-04-04', 3)] } }
  const scoped = await harness.mount({ component: 'components/inventory/ProductDetailModal.tsx', props: { ...base, product: listRow({ id: 41 }) }, app, doubles })
  serverUrl = 'https://server-b.example'
  releaseAccount()
  await scoped.settle()
  assert.ok(!scoped.text().includes('04/04/2026'), 'lots read under the earlier account/server are never shown after it changed')
  serverUrl = ''
  await scoped.unmount()
  console.log('PASS a response from before an account or server change is dropped')

  // 6. A failed read says so and offers Retry; it never claims the product has no received dates.
  reads.length = 0
  let fail = true
  serve = async () => { if (fail) throw new Error('lots unavailable'); return { batches: [lot(51, '2026-05-05', 1)] } }
  const failing = await harness.mount({ component: 'components/inventory/ProductDetailModal.tsx', props: { ...base, product: listRow({ id: 51 }) }, app, doubles })
  await failing.waitFor(() => failing.text().includes('lots unavailable'), 'the failure')
  fail = false
  await failing.click(failing.button(/Retry/))
  await failing.waitFor(() => failing.text().includes('05/05/2026'), 'the lots after Retry')
  await failing.unmount()
  console.log('PASS a failed lot read is shown and can be retried')
} finally {
  await harness.close()
}

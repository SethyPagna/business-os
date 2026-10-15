import assert from 'node:assert/strict'
import { reviewStockLine, buildStockLineRequest, type StockSessionLine } from '../src/utils/stockSessionDraft.ts'

function line(product: StockSessionLine['product'], changes: Partial<StockSessionLine> = {}): StockSessionLine {
  return { key: 'preview-a', requestId: 'synthetic-preview-a', product, productName: 'Synthetic receiving', mode: 'add', quantity: 5, freeQuantity: 0, unitCost: '8', sellingPrice: '', freeGoods: false, expiryDate: '', batchChoice: 'new', batchLabel: '', reason: '', conditionTag: '', createdProduct: false, status: 'queued', detail: '', ...changes }
}

const excludedFree = line({ id: 1, stock_quantity: 10, cost_price_usd: 4 })
assert.equal(reviewStockLine(excludedFree, '1').costAfter, null, 'without authoritative lot state do not present rounded mean4 × total stock10 as an accurate after cost5.3333; actual eligible5@4 plus5@8 is6')
const roundedNumerator = line({ id: 2, stock_quantity: 2, cost_price_usd: 1.0002 }, { quantity: 1, unitCost: '1.0001' })
assert.equal(reviewStockLine(roundedNumerator, '1').costAfter, null, 'rounded catalog1.0002 cannot reconstruct the numerator of1@1.0001 plus1@1.0002; never assert a guessed after')
console.log('PASS receiving review does not manufacture a cost-after from rounded catalog means')

for (const afterUsd of [6, 1.0001, null, 0]) {
  const review = reviewStockLine(excludedFree, '1', { status: 'ready', beforeUsd: null, afterUsd })
  assert.equal(review.costAfter, afterUsd)
  assert.equal(review.costPreview?.status, 'ready')
}
for (const status of ['calculating', 'unavailable'] as const) {
  const review = reviewStockLine(excludedFree, '1', { status })
  assert.equal(review.costAfter, null)
  assert.equal(review.costPreview?.status, status)
}

const wireContext = { branchId: '2', receivedDate: '2026-10-14', supplier: { supplierId: 4, supplierName: 'Synthetic supplier' }, paymentStatus: 'paid' as const, creditDueDate: '', sessionId: 123, canEditPrice: true, reasonFor: () => '' }
const freeWire = buildStockLineRequest({ ...excludedFree, quantity: 10, freeQuantity: 2, unitCost: '3.5' }, wireContext)
assert.equal(freeWire.wire, 'receive')
assert.equal((freeWire.body as any).unitCostUsd, 3.5, 'the preview receives the same paid cost as the writer; the server dilutes free units')
assert.equal((freeWire.body as any).freeQuantity, 2)
assert.equal((freeWire.body as any).branchId, 2)
assert.equal((freeWire.body as any).receivedDate, '2026-10-14')
const lotWire = buildStockLineRequest({ ...excludedFree, batchChoice: 9 }, wireContext)
assert.equal((lotWire.body as any).batchId, 9)
assert.equal((lotWire.body as any).receivedDate, null, 'an explicit target lot keeps its writer date semantics')
const taggedWire = buildStockLineRequest({ ...excludedFree, conditionTag: 'damaged' }, wireContext)
assert.equal(taggedWire.wire, 'adjust')
assert.equal((taggedWire.body as any).type, 'add')
assert.equal((taggedWire.body as any).conditionTag, 'damaged')

const { createHarness } = await import('./mountedComponentHarness.ts')
const actor = { id: 3, organization_id: 1, username: 'synthetic', role_code: 'admin' }
const harness = await createHarness({ localStorage: { businessos_user: JSON.stringify(actor), businessos_read_session: 'synthetic-preview-session' } })
const { receivingCostPreviewBatches } = await import('../src/api/batchesTransport.ts')
const boundedLines = Array.from({ length: 51 }, (_, index) => ({ key: String(index), wire: 'receive' as const, body: { productId: index + 1 } }))
assert.deepEqual(receivingCostPreviewBatches(boundedLines).map(batch => batch.length), [25, 25, 1])
const wideLines = boundedLines.slice(0, 4).map(row => ({ ...row, body: { ...row.body, reason: 'ក'.repeat(10000) } }))
for (const batch of receivingCostPreviewBatches(wideLines)) assert.ok(new TextEncoder().encode(JSON.stringify({ lines: batch })).byteLength <= 65536)
assert.deepEqual(receivingCostPreviewBatches([{ key: 'oversize', wire: 'receive', body: { reason: 'x'.repeat(65536) } }]), [])
const calls: { lines: any[]; signal: AbortSignal; resolve: (result: unknown) => void }[] = []
const tr = (key: string, fallback?: string) => fallback || key
const app = { user: actor, language: 'en', t: tr, settings: {}, notify: () => {}, hasPermission: () => true, can: () => true, canAccessPage: () => true, getPermissions: () => ({}), fmtUSD: (v: number) => `$${v.toFixed(2)}`, fmtKHR: String, usdSymbol: '$', khrSymbol: '៛', exchangeRate: 4100 }
const props = { tr, notify: () => {}, onClose: () => {}, onDone: () => {}, branchOptions: [{ value: '1', label: 'Synthetic branch' }], defaultBranchId: '1', brandOptions: [], canCreateProducts: false, initialHeader: { branchId: '1', receivedDate: '2026-10-15', supplier: { supplierId: 4, supplierName: 'Synthetic supplier' } }, initialLines: [{ product: { id: 1, name: 'Synthetic receiving', cost_price_usd: 4, selling_price_usd: 12, stock_quantity: 10 }, quantity: 5 }] }
try {
  const surface = await harness.mount({ component: 'components/inventory/FastStockInModal.tsx', props, app, doubles: { 'api/batchesTransport.ts': { getReceivingCostPreview: ((lines: any[], signal: AbortSignal) => new Promise(resolve => calls.push({ lines, signal, resolve }))) as any, getProductBatches: (async () => ({ batches: [] })) as any } } })
  await surface.click(surface.button(/^Next$/))
  await surface.click(surface.button(/^Next$/))
  assert.equal(calls.length, 1, 'actual review requests the final writer wire once')
  assert.ok(surface.text().includes('Calculating…'))
  assert.equal(calls[0].lines[0].wire, 'receive')
  assert.equal(calls[0].lines[0].body.unitCostUsd, 4)
  assert.equal(calls[0].lines[0].body.receivedDate, '2026-10-15')
  assert.equal(calls[0].lines[0].body.branchId, 1)
  await surface.click(surface.button(/2 Payment/))
  assert.equal(calls[0].signal.aborted, true, 'leaving review aborts A')
  await surface.type(surface.find(node => node.getAttribute('aria-label') === 'Cost: Synthetic receiving', 'cost input'), '8')
  await surface.click(surface.button(/^Next$/))
  assert.equal(calls.length, 2)
  assert.equal(calls[1].lines[0].body.unitCostUsd, 8, 'B uses final changed writer cost')
  const answer = (call: typeof calls[number], afterUsd: number | null) => ({ advisory: true, results: call.lines.map(row => ({ key: row.key, productId: row.body.productId, status: 'ready', beforeUsd: 4, afterUsd, reason: null })) })
  calls[1].resolve(answer(calls[1], 6))
  await surface.settle()
  assert.ok(surface.text().includes('$6.0000'), 'B authoritative6 is rendered')
  calls[0].resolve(answer(calls[0], 99))
  await surface.settle()
  assert.ok(!surface.text().includes('99.0000'), 'late A cannot overwrite B')
  assert.ok(surface.text().includes('$6.0000'))
  assert.ok(!JSON.stringify(calls[1].lines).includes('afterUsd'), 'preview result never enters the actual write wire')
  await surface.click(surface.button(/2 Payment/))
  await surface.click(surface.button(/^Next$/))
  assert.equal(calls.length, 3)
  app.user = { ...actor, role_code: 'staff', permissions: [], role_permissions: [] } as any
  await surface.render(props)
  assert.equal(calls[2].signal.aborted, true, 'cost permission revocation aborts C')
  calls[2].resolve(answer(calls[2], 77))
  await surface.settle()
  assert.equal(calls.length, 3, 'cost-blind actor makes no replacement request')
  assert.ok(!surface.text().includes('77.0000') && !surface.text().includes('Cost estimate'), 'late cost result is hidden from cost-blind actor')
  app.user = actor
  await surface.render(props)
  assert.equal(calls.length, 4)
  calls[3].resolve({ advisory: true, results: calls[3].lines.map(row => ({ key: row.key, productId: 999, status: 'ready', beforeUsd: 4, afterUsd: 99 })) })
  await surface.settle()
  assert.ok(surface.text().includes('Estimate unavailable'), 'mismatched product cannot provide a ready estimate')
  await surface.click(surface.button(/2 Payment/))
  await surface.click(surface.button(/^Next$/))
  assert.equal(calls.length, 5)
  window.localStorage.removeItem('businessos_user')
  app.user = null as any
  await surface.render(props)
  assert.equal(calls[4].signal.aborted, true, 'signout aborts the advisory request')
  calls[4].resolve(answer(calls[4], 88))
  await surface.settle()
  assert.ok(!surface.text().includes('88.0000'))
  assert.equal(calls.length, 5, 'signed-out actor sends no requests')
  await surface.unmount()
  app.user = actor
  window.localStorage.clear()
  window.localStorage.setItem('businessos_user', JSON.stringify(actor))
  window.localStorage.setItem('businessos_read_session', 'synthetic-preview-session')
  const duplicateProps = { ...props, initialLines: [...props.initialLines, ...props.initialLines, { ...props.initialLines[0], product: { ...props.initialLines[0].product, id: 2, name: 'Synthetic peer' } }] }
  const duplicateSurface = await harness.mount({ component: 'components/inventory/FastStockInModal.tsx', props: duplicateProps, app, doubles: { 'api/batchesTransport.ts': { getReceivingCostPreview: ((lines: any[], signal: AbortSignal) => new Promise(resolve => calls.push({ lines, signal, resolve }))) as any, getProductBatches: (async () => ({ batches: [] })) as any } } })
  const beforeDuplicates = calls.length
  await duplicateSurface.click(duplicateSurface.button(/^Next$/))
  await duplicateSurface.click(duplicateSurface.button(/^Next$/))
  assert.equal(calls.length, beforeDuplicates + 1)
  assert.deepEqual(calls.at(-1)!.lines.map(row => row.body.productId), [2], 'globally duplicated product rows are unavailable, while a unique valid peer is still previewed')
  assert.ok(duplicateSurface.text().includes('Estimate unavailable'))
  console.log('PASS actual mounted review final-wire, delayed A/B, exit, permission-revocation and no-cost-write controls')
} finally { await harness.close() }

import assert from 'node:assert/strict'
import { createHarness, type MountedSurface } from './mountedComponentHarness.ts'

// Owner, 17 Nov 2026 (Inventory redesign, slice C1): Inventory's product detail IS Products' ProductDetailModal, wired through three optional props. This file mounts the REAL modal and pins them:
//   visible   a viewer whose grants cut stock or price sees no stock row and no price cell, never a false 0 or $0.00 (the modal used to print Number(p.stock_quantity || 0) and $0 prices)
//   children  the caller's own facts, drawn under the product's rows
//   report    false: ProductDetailReport (the detail report + the stock ledger) is never mounted, so opening a product makes no read at all
// With none of the three passed the modal is exactly what Products has always drawn, and reads what it always read.

const harness = await createHarness({})
const reads: string[] = []
const money = (value: unknown) => `$${Number(value).toFixed(2)}`
const doubles = {
  'api/productReadTransport.ts': {
    getProductDetailReport: async (id: unknown) => { reads.push(`report:${String(id)}`); return {} },
    getStockLedger: async () => { reads.push('ledger'); return { items: [], total: 0 } },
    getProductSalesDetail: async () => { reads.push('sales'); return {} },
    getProductSupplierPurchases: async () => { reads.push('purchases'); return {} },
  },
}
const app = { user: { id: 1, role_code: 'admin', permissions: {} }, getPermissionTier: () => 'full', can: () => true, t: (key: string) => key, settings: {} }
const full = { id: 41, name: 'Synthetic serum', barcode: '885000041', brand: 'Brand Z', category: 'Skin', unit: 'pcs', stock_quantity: 7, selling_price_usd: 12.5, selling_price_khr: 51250, wholesale_price_usd: 10, cost_price_usd: 3.21 }
const bare = { id: 41, name: 'Synthetic serum', unit: 'pcs' }
const live: MountedSurface[] = []
const mount = async (props: Record<string, unknown>) => {
  reads.length = 0
  const surface = await harness.mount({ component: 'components/products/surfaces/ProductDetailModal.tsx', props: { p: full, fmtUSD: money, fmtKHR: (v: unknown) => `${v}៛`, onClose: () => {}, ...props }, app, doubles })
  live.push(surface)
  return surface
}
const priceRows = (surface: MountedSurface) => surface.findAll(node => node.getAttribute('data-detail-price-row') !== null).map(node => node.getAttribute('data-detail-price-row'))
const text = (surface: MountedSurface) => surface.text().replace(/\s+/g, ' ')
const settleReads = async (surface: MountedSurface) => { await surface.settle({}) }

const cases: Array<[string, () => Promise<void>]> = [
  ['with none of the new props the modal is what Products always drew: stock, prices, cost, and its report reads', async () => {
    const s = await mount({})
    await settleReads(s)
    assert.deepEqual(priceRows(s), ['cost-wholesale', 'selling-margin'])
    const body = text(s)
    for (const word of ['Stock', 'Selling price', 'Wholesale price', 'Cost', 'Brand Z', '885000041']) assert.ok(body.includes(word), `${word} is drawn`)
    assert.ok(body.includes('$12.50') && body.includes('$10.00') && body.includes('$3.21'), 'selling, wholesale and cost values')
    assert.ok(reads.includes('report:41') && reads.includes('ledger'), `the report and the ledger are read on open (${reads.join(', ')})`)
  }],
  ['report={false} makes no read at all: no detail report, no stock ledger', async () => {
    const s = await mount({ report: false })
    await settleReads(s)
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.deepEqual(reads, [], 'nothing is requested when a product opens from Inventory')
    assert.equal(s.findAll(node => node.getAttribute('data-detail-links-row') !== null && node.textContent.includes('movement')).length, 0)
    assert.ok(text(s).includes('Synthetic serum'), 'the modal itself is drawn from first paint')
  }],
  ['visible cuts: a viewer without stock or price sees no stock row and no price cell, never a false 0 or $0.00', async () => {
    // contrast: the same record WITHOUT the map draws the false figures
    const open = await mount({ p: bare, report: false })
    assert.ok(text(open).includes('Stock') && text(open).includes('$0.00'), 'without visible the modal prints a stock 0 and $0.00 for a record that carries neither')
    await open.unmount()
    const cut = await mount({ p: bare, report: false, visible: { stock: false, price: false, cost: false } })
    const body = text(cut)
    assert.ok(!body.includes('Stock'), 'no stock row')
    assert.ok(!body.includes('$0') && !body.includes('Wholesale price') && !body.includes('Selling price') && !body.includes('Cost') && !body.includes('Margin'), `no price, cost or margin cell: ${body}`)
    assert.deepEqual(priceRows(cut), [], 'the price rows are not drawn at all')
    assert.equal(cut.findAll(node => (node.getAttribute('class') ?? '').includes('badge-red') || (node.getAttribute('class') ?? '').includes('badge-green')).length, 0, 'and no In stock / Out of stock badge')
    assert.ok(body.includes('Synthetic serum'), 'the name still titles the modal')
  }],
  ['visible narrows each group on its own: stock only, price only, cost only', async () => {
    const stockOnly = await mount({ report: false, visible: { price: false, cost: false } })
    assert.ok(text(stockOnly).includes('Stock') && !text(stockOnly).includes('Selling price'), 'stock stays, prices go')
    assert.deepEqual(priceRows(stockOnly), [])
    await stockOnly.unmount()
    const priceOnly = await mount({ report: false, visible: { stock: false, cost: false } })
    assert.ok(!text(priceOnly).includes('Stock') && text(priceOnly).includes('$12.50') && !text(priceOnly).includes('$3.21'), 'prices stay, stock and cost go')
    assert.deepEqual(priceRows(priceOnly), ['cost-wholesale', 'selling-margin'], 'the rows exist for the price cells')
    assert.ok(!text(priceOnly).includes('Cost') && !text(priceOnly).includes('Margin'), 'no cost, no margin')
    await priceOnly.unmount()
    const costOnly = await mount({ report: false, visible: { price: false, stock: false } })
    assert.ok(text(costOnly).includes('Cost') && text(costOnly).includes('$3.21') && !text(costOnly).includes('Selling price') && !text(costOnly).includes('Margin'), 'cost without price: no selling price, and no margin (it needs the selling price)')
    assert.deepEqual(priceRows(costOnly), ['cost-wholesale'])
    await costOnly.unmount()
    const noIdentity = await mount({ report: false, visible: { barcode: false, brand: false, category: false } })
    for (const word of ['885000041', 'Brand Z', 'Skin']) assert.ok(!text(noIdentity).includes(word), `${word} is hidden when its field is cut`)
  }],
  ['a non-admin without the cost grant never sees cost, whatever visible says', async () => {
    reads.length = 0
    const surface = await harness.mount({ component: 'components/products/surfaces/ProductDetailModal.tsx', props: { p: full, fmtUSD: money, fmtKHR: (v: unknown) => `${v}៛`, onClose: () => {}, visible: { cost: true }, report: false }, app: { ...app, user: { id: 2, role_code: 'employee', permissions: {} } }, doubles })
    live.push(surface)
    assert.ok(!text(surface).includes('$3.21') && !text(surface).includes('Cost'), 'visible can only narrow what canViewAcquisitionCosts allows')
  }],
  ['children is drawn under the product rows, above the links row; absent children draw nothing', async () => {
    const s = await mount({ report: false })
    assert.equal(s.findAll(node => node.getAttribute('data-detail-extra') !== null).length, 0, 'Products passes none: no wrapper at all')
    await s.render({ p: full, fmtUSD: money, fmtKHR: (v: unknown) => `${v}៛`, onClose: () => {}, report: false, children: 'INVENTORY FACTS' })
    const extra = s.find(node => node.getAttribute('data-detail-extra') !== null, 'extra slot')
    assert.equal(extra.textContent, 'INVENTORY FACTS')
  }],
]

const failures: string[] = []
try {
  for (const [name, run] of cases) {
    try { await run() } catch (cause) { failures.push(`${name}\n    ${(cause instanceof Error ? cause.message : String(cause)).split('\n')[0]}`) } finally { for (const surface of live.splice(0)) await surface.unmount() }
  }
} finally { await harness.close() }
if (failures.length) throw new Error(`${failures.length} of ${cases.length} detail cases failed:\n  - ${failures.join('\n  - ')}`)
console.log(`productDetailVisible passed: ${cases.length} cases (defaults unchanged, report off reads nothing, visible hides false 0 and $0, children slot)`)

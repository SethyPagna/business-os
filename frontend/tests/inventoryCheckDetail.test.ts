import assert from 'node:assert/strict'
import { createHarness, type MountedSurface } from './mountedComponentHarness.ts'
import type { InventoryCheckProduct } from '../src/types/inventoryChecks.ts'
import { readFileSync } from 'node:fs'

// Owner, 17 Nov 2026: Inventory's product detail is Products' own detail modal, wired from the Products page: the product NAME is the title (no "Product" heading), brand · category and the barcode sit in the header,
// the prices are Products' coloured prices, the cost shows only to a viewer who may see it, and Inventory's own facts (check status, counted, last checked, LAST STOCK CHANGE, Fix stock, the Sales link) fill the modal's
// slot. Opening it re-reads nothing. The mapping from an Inventory row to the modal is the part that could print a false 0: it is mounted for real here, with every read counted.

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
const harness = await createHarness({})
const reads: string[] = []
const spy = (name: string) => async () => { reads.push(name); return {} }
const doubles = {
  'api/productReadTransport.ts': { getProductDetailReport: spy('report'), getStockLedger: spy('ledger'), getProductSalesDetail: spy('sales'), getProductSupplierPurchases: spy('purchases'), getProductCostBreakdown: spy('cost') },
}
const asAdmin = { id: 1, role_code: 'admin', permissions: {} }
const asEmployee = { id: 2, role_code: 'employee', permissions: {} }
const money = (value: unknown) => `$${Number(value).toFixed(2)}`
const ALL = { price: true, barcode: true, category: true, brand: true, stock: true, received: true, sales: false, customers: false, cost: true }
const product = { id: 41, name: 'Synthetic serum', barcode: '885000041', brand: 'Brand Z', category: 'Skin', unit: 'pcs', quantity: 8, damaged_quantity: 2, check_status: 'issue', check_counted_quantity: 5, check_note: 'Two crushed',
  check_by: 'amy', check_at: '2026-11-10T08:15:00.000Z', last_change_at: '2026-11-12T03:30:00.000Z', latest_received_at: '2026-10-01 09:00:00', next_expiry_date: '2027-03-15',
  selling_price_usd: 12.5, selling_price_khr: 51250, wholesale_price_usd: 10, cost_price_usd: 3.21 } as unknown as InventoryCheckProduct
const live: MountedSurface[] = []
async function mount(extra: Record<string, unknown> = {}, user = asAdmin, row: InventoryCheckProduct = product) {
  reads.length = 0
  const surface = await harness.mount({ component: 'components/inventory/InventoryCheckDetail.tsx',
    props: { product: row, unavailable: false, fields: ALL, priceText: money, fmtUSD: money, fmtKHR: (v: unknown) => `${v}៛`, t: (key: string) => key, onClose: () => {}, ...extra },
    app: { user, getPermissionTier: () => 'none', can: () => true, t: (key: string) => key, settings: {} }, doubles })
  live.push(surface)
  return surface
}
const text = (surface: MountedSurface) => surface.text().replace(/\s+/g, ' ')
const has = (surface: MountedSurface, attribute: string) => surface.findAll(node => node.getAttribute(attribute) !== null).length

const cases: Array<[string, () => Promise<void>]> = [
  ['the name is the title, brand · category sit in the header, the barcode is a row: no "Product" heading', async () => {
    const s = await mount()
    const body = text(s)
    assert.ok(body.startsWith('Synthetic serum'), `the modal opens with the name: ${body.slice(0, 60)}`)
    assert.equal(s.findAll(node => node.tagName === 'H2' && node.textContent.trim() === 'Product').length, 0, 'no heading that says Product')
    assert.equal(s.find(node => node.getAttribute('data-detail-meta-row') !== null, 'brand and category').textContent, 'Brand Z·Skin')
    assert.ok(body.includes('885000041'), 'the barcode')
  }],
  ['prices show in Products\' tones, and cost (red, opens the cost float) only to a viewer who may see it AND only when the row carries it', async () => {
    const admin = await mount()
    const body = text(admin)
    assert.ok(body.includes('$12.50') && body.includes('$10.00'), 'selling and wholesale')
    assert.ok(body.includes('$3.21'), 'an administrator sees the cost')
    assert.ok(admin.findAll(node => node.className.includes('text-red-600') && node.textContent.includes('$3.21')).length > 0, 'cost is red')
    assert.ok(admin.findAll(node => node.className.includes('text-green-600') && node.textContent.includes('$12.50')).length > 0, 'selling is green')
    await admin.unmount()
    const employee = await mount({}, asEmployee)
    assert.ok(!text(employee).includes('$3.21') && !text(employee).includes('Cost'), 'an employee without the cost view never sees the cost the row carries')
    assert.ok(text(employee).includes('$12.50'), 'but sees the price they are granted')
    await employee.unmount()
    const bare = await mount({}, asAdmin, Object.fromEntries(Object.entries(product).filter(([key]) => key !== 'cost_price_usd')) as unknown as InventoryCheckProduct)
    assert.ok(!text(bare).includes('Cost') && !text(bare).includes('Unknown cost'), 'an administrator is not shown an unknown cost when the server sent none')
    await bare.unmount()
    const noGrant = await mount({ fields: { ...ALL, cost: false } })
    assert.ok(!text(noGrant).includes('$3.21'), 'fields.cost false: no cost even for an admin session')
  }],
  ['a viewer whose grants cut stock or price sees no stock row, no price cell, never a false 0 or $0.00', async () => {
    const blind = await mount({ fields: { ...ALL, stock: false, price: false, cost: false } }, asAdmin, { id: 41, name: 'Synthetic serum', check_status: 'ok' } as unknown as InventoryCheckProduct)
    const body = text(blind)
    assert.ok(!body.includes('Stock') && !body.includes('$0') && !body.includes('Selling price') && !body.includes('Wholesale price'), `nothing false is drawn: ${body}`)
    assert.equal(has(blind, 'data-detail-price-row'), 0)
    await blind.unmount()
    const noPriceKeys = await mount({}, asAdmin, { id: 41, name: 'Synthetic serum', quantity: 3 } as unknown as InventoryCheckProduct)
    assert.ok(!text(noPriceKeys).includes('$0'), 'price granted but the row carries no price (an older server): no $0.00 either')
    assert.ok(text(noPriceKeys).includes('Stock3'), 'the stock it does carry shows')
  }],
  ['the check facts fill the slot: status with its note, counted against stock, last checked, last stock change, held, received date', async () => {
    const s = await mount()
    const facts = s.find(node => node.getAttribute('data-inventory-check-detail') !== null, 'check facts').textContent
    assert.ok(facts.includes('Check statusIssue · Two crushed'), facts)
    assert.ok(facts.includes('Counted5 (−3)'), 'counted against the stock now: ' + facts)
    assert.ok(facts.includes('Last checked@amy'), 'who checked: ' + facts)
    assert.ok(/Last stock change\d{2}\/\d{2}\/\d{4}/.test(facts), 'the overlay\'s last_change_at is shown at last: ' + facts)
    assert.ok(facts.includes('Held2') && facts.includes('Received date01/10/2026'), facts)
    await s.unmount()
    const blind = await mount({ fields: { ...ALL, stock: false } })
    const blindFacts = blind.find(node => node.getAttribute('data-inventory-check-detail') !== null, 'check facts').textContent
    assert.ok(!blindFacts.includes('Last stock change') && !blindFacts.includes('Held'), 'a viewer who may not see stock learns nothing about its movement: ' + blindFacts)
    await blind.unmount()
    const quiet = await mount({}, asAdmin, { ...product, last_change_at: null } as unknown as InventoryCheckProduct)
    assert.ok(!quiet.find(node => node.getAttribute('data-inventory-check-detail') !== null, 'facts').textContent.includes('Last stock change'), 'no recorded change: no row')
  }],
  ['Fix stock and the Sales link are in the modal when offered, and call back', async () => {
    const calls: string[] = []
    const s = await mount({ onFixStock: () => { calls.push('fix') }, onSales: () => { calls.push('sales') } })
    await s.click(s.find(node => node.getAttribute('data-check-fix-stock') !== null, 'Fix stock'))
    await s.click(s.find(node => node.getAttribute('data-check-sales-link') !== null, 'Sales link'))
    assert.deepEqual(calls, ['fix', 'sales'])
    await s.unmount()
    const plain = await mount({})
    assert.equal(has(plain, 'data-check-fix-stock') + has(plain, 'data-check-sales-link'), 0, 'absent when the viewer may not')
  }],
  ['opening the detail reads NOTHING: no detail report, no stock ledger, no sales, no cost breakdown', async () => {
    const s = await mount({ onFixStock: () => {}, onSales: () => {} })
    await s.settle({})
    await new Promise(resolve => setTimeout(resolve, 60))
    assert.deepEqual(reads, [], 'zero requests on open')
  }],
  ['the unavailable note and both language packs: the one new key exists in en and km', async () => {
    const s = await mount({ unavailable: true })
    assert.ok(text(s).includes('This original product is unavailable'), 'the saved-snapshot note')
    assert.ok(en.inventory_check_last_change === 'Last stock change' && km.inventory_check_last_change && km.inventory_check_last_change !== en.inventory_check_last_change && /[ក-៿]/.test(km.inventory_check_last_change), 'real Khmer, not an English placeholder')
  }],
]

const failures: string[] = []
try {
  for (const [name, run] of cases) {
    try { await run() } catch (cause) { failures.push(`${name}\n    ${(cause instanceof Error ? cause.message : String(cause)).split('\n')[0]}`) } finally { for (const surface of live.splice(0)) await surface.unmount() }
  }
} finally { await harness.close() }
if (failures.length) throw new Error(`${failures.length} of ${cases.length} Inventory detail cases failed:\n  - ${failures.join('\n  - ')}`)
console.log(`inventoryCheckDetail passed: ${cases.length} cases (title, tones, cost gate, no false 0, check facts, last stock change, actions, zero reads)`)

import assert from 'node:assert/strict'
import { validateSupplierSourceOptions } from '../src/api/returnsTransport.ts'
import { createHarness, propsOf } from './mountedComponentHarness.ts'

const source = {
  supplier_condition_version: 1, branch_id: 1, financial_visibility: true, financial_editable: true,
  items: [{ product_id: 2, branch_id: 1, product_name: 'Coffee', ordinary_available: .3, ordinary_unlotted: .1,
    return_cost_usd: 2, return_cost_khr: 8000,
    ordinary_receipts: [{ batch_id: 4, received_at: '2026-10-01T23:00:00Z', lot_code: null, batch_number: 7, available: .2, source_cost_usd: 1.0000000000000002 }],
    tagged_sources: [{ damaged_lot_id: 8, stock_condition: 'opened', batch_id: null, received_at: null, lot_code: null, batch_number: null,
      available: .30000000000000004, source_cost_usd: 3, source: 'return' }],
  }],
}
function changed(change: (value: typeof source) => void): typeof source { const value = structuredClone(source); change(value); return value }
function refuses(value: unknown, ids = [2]): void {
  assert.throws(() => validateSupplierSourceOptions(value, 1, ids), error => (error as { code?: string; outcome?: string }).code === 'supplier_sources_unavailable'
    && (error as { outcome?: string }).outcome === 'not_dispatched')
}

const result = validateSupplierSourceOptions(source, 1, [2])
assert.deepEqual(result, source)
assert.notEqual(result, source)
assert.equal(result.items[0]?.tagged_sources[0]?.batch_id, null)
assert.equal(result.items[0]?.ordinary_receipts[0]?.source_cost_usd, 1.0000000000000002)
assert.equal(result.items[0]?.tagged_sources[0]?.available, .30000000000000004)
assert.equal(result.items[0]?.return_cost_usd, 2)
assert.equal(result.items[0]?.tagged_sources[0]?.source_cost_usd, 3)
console.log('PASS supplier source metadata preserves exact numeric values and distinct original/catalog costs')

refuses(changed(v => { v.supplier_condition_version = 0 }))
refuses(changed(v => { v.items = [] }))
refuses(changed(v => { v.items[0]!.branch_id = 2 }))
refuses(changed(v => { v.items[0]!.product_id = 3 }))
refuses(changed(v => { v.items.push(structuredClone(v.items[0]!)) }), [2, 3])
refuses(changed(v => { v.items[0]!.tagged_sources[0]!.stock_condition = 'translated damaged' }))
refuses(changed(v => { v.items[0]!.tagged_sources[0]!.available = Infinity }))
refuses(changed(v => { v.items[0]!.ordinary_receipts.push(structuredClone(v.items[0]!.ordinary_receipts[0]!)) }))
refuses(changed(v => { v.items[0]!.tagged_sources.push(structuredClone(v.items[0]!.tagged_sources[0]!)) }))
refuses(source, Array.from({ length: 26 }, (_, i) => i + 1))
console.log('PASS supplier options require complete branch/product/source identity and a bounded canonical capability')

const hidden = structuredClone(source) as Record<string, any>
hidden.financial_visibility = false
hidden.financial_editable = false
delete hidden.items[0].return_cost_usd
delete hidden.items[0].return_cost_khr
delete hidden.items[0].ordinary_receipts[0].source_cost_usd
delete hidden.items[0].tagged_sources[0].source_cost_usd
assert.deepEqual(validateSupplierSourceOptions(hidden, 1, [2]), hidden)
hidden.items[0].tagged_sources[0].source_cost_usd = 3
refuses(hidden)
console.log('PASS redacted cost capability remains usable without private source cost leakage')

const operator = { id: 3, name: 'Dara', username: 'dara', role: 'admin' }
const harness = await createHarness({ localStorage: { businessos_user: JSON.stringify(operator), businessos_read_session: 'supplier-source-review' } })
const app = { user: operator, language: 'en', t: (key: string) => key, settings: {}, hasPermission: () => true, can: () => true, canAccessPage: () => true,
  getPermissions: () => ({}), saveSettings: async () => ({ success: true }), navigateTo: () => {}, notify: () => {} }
try {
  for (const mode of ['unchanged', 'catalog-usd', 'catalog-khr', 'tag-cost', 'receipt-cost', 'receipt-date', 'visibility', 'permission', 'editable', 'known-null', 'null-change', 'absent-cost', 'retag', 'membership']) {
    let options = structuredClone(source) as Record<string, any>
    if (mode === 'known-null' || mode === 'null-change') options.items[0].tagged_sources[0].source_cost_usd = null
    let reads = 0
    const writes: Record<string, any>[] = []
    const notices: string[] = []
    const page = await harness.mount({ component: 'components/returns/NewSupplierReturnModal.tsx', app,
      props: { notify: (message: string) => notices.push(message), fmtUSD: (value: number) => `$${value.toFixed(2)}`, fmtKHR: String, onClose: () => {}, onSuccess: () => {} },
      doubles: {
        'api/branchTransport.ts': { getBranches: async () => [{ id: 1, name: 'Store', is_active: true, is_default: true }] },
        'api/contactReadTransport.ts': { getSuppliers: async () => [{ id: 4, name: 'Glow Co' }] },
        'api/inventoryTransport.ts': { getInventorySummary: async () => [{ id: 2, name: 'Coffee', display_quantity: 1 }] },
        'api/returnsReadTransport.ts': { getReturnReasonPresets: async () => ({}) },
        'api/returnsTransport.ts': {
          getSupplierReturnSourceOptions: async () => { reads++; if (mode === 'permission' && reads > 1) throw Object.assign(new Error('Forbidden'), { status: 403 }); return validateSupplierSourceOptions(options, 1, [2]) },
          prepareSupplierReturnRequest: (payload: unknown) => structuredClone(payload),
          createSupplierReturn: async (payload: Record<string, any>) => { writes.push(structuredClone(payload)); return { id: 91, returnNumber: payload.return_number } },
        },
      },
    })
    try {
      await page.waitFor(() => page.findAll(node => node.tagName === 'INPUT' && String(propsOf(node)['aria-label']).includes('opened · #8')).length > 0, 'coherent source options')
      await page.type(page.field('supplier-return-supplier'), 'Glow')
      await page.click(page.find(node => node.getAttribute('role') === 'option' && node.textContent.includes('Glow Co'), 'supplier'))
      await page.type(page.field('supplier-return-reason'), 'Return reviewed stock')
      const ordinary = mode === 'receipt-cost' || mode === 'receipt-date'
      const quantity = page.find(node => node.tagName === 'INPUT' && String(propsOf(node)['aria-label']).includes(ordinary ? 'Coffee · Ordinary' : 'opened · #8'), 'chosen source')
      await page.type(quantity, '.1')
      if (mode === 'catalog-usd') options.items[0].return_cost_usd = 5
      if (mode === 'catalog-khr') options.items[0].return_cost_khr = 9000
      if (mode === 'tag-cost' || mode === 'null-change') options.items[0].tagged_sources[0].source_cost_usd = 4
      if (mode === 'receipt-cost') options.items[0].ordinary_receipts[0].source_cost_usd = 9
      if (mode === 'receipt-date') options.items[0].ordinary_receipts[0].received_at = '2026-10-02'
      if (mode === 'retag') options.items[0].tagged_sources[0].stock_condition = 'damaged'
      if (mode === 'membership') options.items[0].ordinary_receipts.push({ ...options.items[0].ordinary_receipts[0], batch_id: 5 })
      if (mode === 'editable') options.financial_editable = false
      if (mode === 'absent-cost') delete options.items[0].return_cost_usd
      if (mode === 'visibility') {
        options.financial_visibility = false
        delete options.items[0].return_cost_usd
        delete options.items[0].return_cost_khr
        delete options.items[0].ordinary_receipts[0].source_cost_usd
        delete options.items[0].tagged_sources[0].source_cost_usd
      }
      await page.click(page.button('Refresh'))
      await page.waitFor(() => reads === 2, 'reviewed source refresh')
      if (['visibility', 'permission', 'editable', 'absent-cost'].includes(mode)) assert.equal(propsOf(page.button('Save')).disabled, true, `${mode}: fresh submit is visibly refused`)
      else await page.click(page.button('Save'))
      if (mode === 'unchanged' || mode === 'known-null') {
        assert.equal(writes.length, 1, mode)
        assert.equal(writes[0]!.items[0].cost_price_usd, 2)
      } else {
        assert.equal(writes.length, 0, `${mode}: no fresh write from a stale or unverifiable review`)
        if (mode === 'visibility' || mode === 'permission') {
          assert.equal(page.findAll(node => node.tagName === 'INPUT' && Boolean(node.getAttribute('id')?.startsWith('supplier-return-compensation'))).length, 0)
          assert.doesNotMatch(page.text(), /\$[\d.]+|Total cost|Original source cost/)
        }
        if (mode === 'catalog-usd') {
          await page.click(page.button('Remove'))
          await page.type(page.find(node => node.tagName === 'INPUT' && String(propsOf(node)['aria-label']).includes('opened · #8'), 'refreshed tagged source'), '.1')
          await page.click(page.button('Save'))
          assert.equal(writes.length, 1, 'explicit reselection admits the refreshed valuation')
          assert.equal(writes[0]!.items[0].cost_price_usd, 5)
          assert.equal(writes[0]!.supplier_compensation_usd, .5)
        }
      }
      console.log(`PASS mounted supplier source review ${mode}`)
    } finally { await page.unmount() }
  }
} finally { await harness.close() }

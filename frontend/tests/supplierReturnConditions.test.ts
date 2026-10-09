import assert from 'node:assert/strict'
import { validateSupplierSourceOptions } from '../src/api/returnsTransport.ts'

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

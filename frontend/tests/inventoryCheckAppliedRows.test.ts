import assert from 'node:assert/strict'
import { workerState } from './inventoryApprovalStates.ts'
import { patchWiredApplied, withAppliedRowStock } from '../src/components/inventory/inventoryCheckAppliedRows.ts'
import { wiredResult, type WiredList } from '../src/components/inventory/inventoryWired.ts'
import type { InventoryCheckProduct } from '../src/types/inventoryChecks.ts'

// The rows outside the approval panel after lines were applied: what the Worker's own answer says each line wrote, with no read.
const accepted = workerState('accepted_one'), pending = workerState('pending')
const applied = accepted.approval.applied_lines ?? {}

{
  const rows = [{ id: 1, name: 'Serum', quantity: 9 }, { id: 2, name: 'Toner', quantity: 5 }] as InventoryCheckProduct[]
  const next = withAppliedRowStock(rows, { '1': 7 }, pending.items)
  assert.deepEqual(next.map(row => row.quantity), [7, 5], 'the applied line takes the figure the answer wrote; another line is untouched')
  assert.equal(next[1], rows[1], 'an untouched row is the same object')
  assert.equal(withAppliedRowStock([{ id: 1, name: 'S', quantity: 9, damaged_quantity: 2 }] as InventoryCheckProduct[], { '1': 7 }, [])[0].quantity, 9, 'units held aside stay in the sum the list shows (7 + 2)')
  const held = pending.items.map(item => ({ ...item, current_stock: { ...item.current_stock, recorded_damaged_quantity: 3 } }))
  assert.equal(withAppliedRowStock([{ id: 1, name: 'S', quantity: 12 }] as InventoryCheckProduct[], { '1': 7 }, held as typeof pending.items)[0].quantity, 10, 'a row that does not say its damaged units takes them from the session item')
}

{
  const list: WiredList = {
    items: [{ id: 1, name: 'Serum', stock_quantity: 9, branch_stock: [{ branch_id: 1, quantity: 9 }],
      lots: [{ id: 10, received_at: '2026-09-02', branches: [{ branch_id: 1, quantity: 5 }] }, { id: 11, received_at: '2026-09-09', branches: [{ branch_id: 1, quantity: 4 }] }] },
    { id: 3, name: 'Cream', stock_quantity: 5, branch_stock: [{ branch_id: 1, quantity: 5 }], lots: [{ id: 30, received_at: '2026-09-02', branches: [{ branch_id: 1, quantity: 5 }] }] }],
    total: 2, page: 1, pageSize: 20, wired: true,
  }
  const raw = { list, overlay: new Map(), lots: new Map(), branches: [{ id: 1, name: 'Main' }], branchId: 1, extras: {} }
  const before = wiredResult(raw).items
  assert.deepEqual(before[0].lot_rows?.map(row => [row.batchId, row.quantity]), [[10, 5], [11, 4]])
  const next = wiredResult(patchWiredApplied(raw, applied)).items
  assert.equal(next[0].quantity, 7, 'a dated line: the branch total is the answer\'s after (7)')
  assert.deepEqual(next[0].lot_rows?.map(row => [row.batchId, row.quantity]), [[10, 3], [11, 4]], 'and the date the answer moved takes its own figure (5 to 3); the other date is as it was')
  assert.equal(next[1].quantity, 5, 'a product not in the answer is untouched')
  const plain = wiredResult(patchWiredApplied(raw, { '3': { after: 2 } })).items[1]
  assert.equal(plain.quantity, 2, 'a line with no dates in the answer keeps only its branch quantity, which takes the answer')
  assert.deepEqual(plain.lot_rows?.map(row => row.quantity), [5], 'and no date figure is invented')
  assert.equal(patchWiredApplied(raw, { '99': { after: 1 } }).list.items[0], raw.list.items[0], 'a product the page does not list is skipped')
}
console.log('PASS Inventory check applied rows: the session list and the wired rows take the stock an accepted line wrote')
